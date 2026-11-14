// The live audio system behind `createAudio`: context lifecycle, event → sound mapping,
// spatialisation, rate limiting, adaptive music and the announcer.
import type { AudioApi, Camera, MusicMood, UiSound } from '../core/api';
import type { PlayerId, SimEvent, World } from '../core/types';
import { BUILDINGS, SUPPORT_POWERS } from '../data';
import { Announcer } from './announcer';
import { Engine, type Recipe, type VoiceOpts } from './engine';
import { ackProfile, clamp, CombatHeat, deathProfile, impactSize, isVisibleTo, RateLimiter, spatialize, weaponProfile } from './logic';
import { Music } from './music';
import * as S from './sfx';
import { ackSound, uiSound } from './uisounds';

export interface Volumes {
  master: number;
  sfx: number;
  music: number;
  voice: number;
}

export interface AudioDebug {
  readonly engine: Engine | null;
  readonly music: Music | null;
  readonly announcer: Announcer;
  readonly limiter: RateLimiter;
  readonly heat: CombatHeat;
  readonly contextState: string;
  readonly effectiveMood: MusicMood;
  /** Dev pages set this so the context keeps running while the tab is hidden. */
  keepAliveWhenHidden: boolean;
  /** Current output peak (0..1) from the master analyser. */
  peak(): number;
}

export type AudioSystem = AudioApi & { debug: AudioDebug };

const STORE_KEY = 'cinderfront.audio.volume';
const DEFAULT_VOL: Volumes = { master: 0.8, sfx: 0.8, music: 0.55, voice: 0.9 };
const LOOKAHEAD = 0.35;
/** Keeps the soundtrack under the effects at equal slider positions. */
export const MUSIC_TRIM = 0.7;

interface Pending {
  key: string;
  interval: number;
  opts: VoiceOpts;
  run: (e: Engine, o: VoiceOpts) => void;
}

interface PosOpts {
  gain: number;
  prio: number;
  reverb?: number;
  reach?: number;
  floor?: number;
  /** Heard even inside fog (map-wide events). */
  fogless?: boolean;
}

const wall = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const win = (): any => (typeof window !== 'undefined' ? window : undefined);

function loadVolumes(): Volumes {
  const v = { ...DEFAULT_VOL };
  try {
    const raw = win()?.localStorage?.getItem(STORE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      for (const k of Object.keys(v) as (keyof Volumes)[]) if (typeof o[k] === 'number' && isFinite(o[k])) v[k] = clamp(o[k], 0, 1);
    }
  } catch {
    /* storage unavailable */
  }
  return v;
}

export function createAudioSystem(): AudioSystem {
  const vol = loadVolumes();
  const limiter = new RateLimiter(0.5);
  const heat = new CombatHeat();
  let ctx: AudioContext | null = null;
  let engine: Engine | null = null;
  let music: Music | null = null;
  let failed = false;
  let unlocked = false;
  let baseMood: MusicMood = 'off';
  let speaking = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let keepAliveWhenHidden = false;
  let analyserBuf: Float32Array<ArrayBuffer> | null = null;

  const applyDuck = (): void => {
    if (engine) engine.musicDuck.gain.setTargetAtTime(speaking ? 0.5 : 1, engine.now, 0.12);
  };
  const announcer = new Announcer(
    () => vol.master * vol.voice,
    (s) => {
      speaking = s;
      applyDuck();
    },
  );

  const effectiveMood = (): MusicMood => (baseMood === 'calm' && heat.inBattle ? 'battle' : baseMood);

  const applyVolumes = (): void => {
    if (!engine) return;
    const t = engine.now;
    engine.master.gain.setTargetAtTime(vol.master, t, 0.03);
    engine.sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
    engine.uiBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
    engine.musicBus.gain.setTargetAtTime(vol.music * MUSIC_TRIM, t, 0.03);
  };

  const allowedToStart = (): boolean => {
    const w = win();
    if (!w) return false;
    return unlocked || w.cinderNative?.isNative === true || w.navigator?.userActivation?.hasBeenActive === true;
  };

  const tick = (): void => {
    if (!engine || !music || !ctx) return;
    try {
      heat.update(wall());
      music.setMood(effectiveMood());
      if (ctx.state === 'running') music.pump(engine.now + LOOKAHEAD);
      engine.prune();
      engine.pruneUi();
    } catch {
      /* keep the timer alive */
    }
  };

  /** Create (or wake) the audio graph if the browser allows it. Null = stay silent. */
  const ensure = (): Engine | null => {
    if (engine && ctx) {
      if (ctx.state !== 'running' && ctx.state !== 'closed' && allowedToStart() && !(win()?.document?.hidden && !keepAliveWhenHidden)) {
        ctx.resume().catch(() => {});
      }
      return engine;
    }
    if (failed || !allowedToStart()) return null;
    try {
      const w = win();
      const AC: typeof AudioContext | undefined = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) {
        failed = true;
        return null;
      }
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        ctx = new AC();
      }
      engine = new Engine(ctx);
      music = new Music(engine);
      engine.master.gain.value = vol.master;
      engine.sfxBus.gain.value = vol.sfx;
      engine.uiBus.gain.value = vol.sfx;
      engine.musicBus.gain.value = vol.music * MUSIC_TRIM;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      timer = setInterval(tick, 60);
      w.document?.addEventListener('visibilitychange', onVisibility);
      tick();
    } catch {
      failed = true;
      engine = null;
      music = null;
      ctx = null;
    }
    return engine;
  };

  const onVisibility = (): void => {
    if (!ctx || ctx.state === 'closed') return;
    const hidden = win()?.document?.hidden;
    if (hidden && !keepAliveWhenHidden) ctx.suspend().catch(() => {});
    else if (!hidden && allowedToStart()) ctx.resume().catch(() => {});
  };

  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      /* audio must never break the game */
    }
  };

  /** Non-positional notification sound (already rate-limited by key). */
  const flat = <P>(key: string, interval: number, recipe: Recipe<P>, p: P, gain: number, prio = 8, reverb = 0.1): void => {
    const e = ensure();
    if (!e) return;
    const k = limiter.hit(key, wall(), interval);
    if (!k) return;
    e.play(recipe, p, { gain, prio, reverb });
  };

  // ───────────────────────────── AudioApi ─────────────────────────────

  const api: AudioApi = {
    unlock() {
      safe(() => {
        unlocked = true;
        const e = ensure();
        if (!e || !ctx) return;
        if (ctx.state !== 'running') ctx.resume().catch(() => {});
        // a silent one-sample buffer wakes Safari's audio session inside the gesture
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start();
      });
    },

    handleEvents(events: SimEvent[], world: World, viewer: PlayerId, camera: Camera) {
      safe(() => {
        announcer.tick();
        if (!events || events.length === 0) return;
        const e = ensure();
        const w = win();
        const vw = w?.innerWidth || 1440;
        const vh = w?.innerHeight || 900;
        const now = wall();
        const pending: Pending[] = [];
        const players = world.players;
        const me = players[viewer] ?? players.find((p) => p.id === viewer);
        const teamOf = (id: PlayerId): number => (players[id] ?? players.find((p) => p.id === id))?.team ?? -1;
        const myTeam = me?.team ?? -2;
        const r = (): number => (e ? e.vary(1, 0.06) : 1);
        let fireHeat = 0;

        /** Queue a positional sound; false if it is fogged or out of earshot. */
        const at = <P>(key: string, interval: number, x: number, y: number, o: PosOpts, recipe: Recipe<P>, p: P): boolean => {
          if (!o.fogless && !isVisibleTo(world, viewer, x, y)) return false;
          const sp = spatialize(x, y, camera, vw, vh, o.reach ?? 1, o.floor ?? 0);
          if (!sp.audible) return false;
          pending.push({
            key,
            interval,
            opts: { gain: o.gain * sp.gain, pan: sp.pan, cutoff: sp.cutoff, reverb: (o.reverb ?? 0.1) * (1 + Math.min(1.5, sp.dist)), prio: o.prio },
            run: (en, vo) => en.play(recipe, p, vo),
          });
          return true;
        };
        const entPos = (id: number): { x: number; y: number } | null => {
          const en = world.entities.get(id);
          return en ? { x: en.x, y: en.y } : null;
        };

        for (const ev of events) {
          switch (ev.type) {
            case 'weaponFired': {
              const wp = weaponProfile(ev.weaponId, ev.kind);
              const p: S.FireP = { power: wp.power, helion: wp.helion, r: r(), warhead: wp.warhead };
              const key = `fire:${ev.weaponId}`;
              let ok = false;
              switch (wp.kind) {
                case 'tracer':
                  ok = at(key, 0.055, ev.x, ev.y, { gain: 0.5 + 0.2 * wp.power, prio: 2, reverb: 0.08 }, S.fireTracer, p);
                  break;
                case 'shell':
                  ok = at(key, 0.07, ev.x, ev.y, { gain: 0.8 + 0.2 * wp.power, prio: 5, reverb: 0.18, reach: 1.3 }, S.fireShell, p);
                  break;
                case 'beam':
                  ok = at(key, 0.08, ev.x, ev.y, { gain: 0.95, prio: 6, reverb: 0.3, reach: 1.4 }, S.fireBeam, p);
                  break;
                case 'arc':
                  ok = at(key, 0.08, ev.x, ev.y, { gain: wp.power > 0.6 ? 1 : 0.6, prio: wp.power > 0.6 ? 5 : 3, reverb: 0.2, reach: wp.power > 0.6 ? 1.4 : 1 }, S.fireArc, p);
                  break;
                case 'missile':
                  ok = at(key, 0.06, ev.x, ev.y, { gain: 0.6, prio: 3, reverb: 0.12 }, S.fireMissile, p);
                  break;
                case 'flame':
                  ok = at(key, 0.13, ev.x, ev.y, { gain: 0.7, prio: 3, reverb: 0.05 }, S.fireFlame, p);
                  break;
                case 'flakburst':
                  ok = at(key, 0.06, ev.x, ev.y, { gain: 0.65, prio: 3, reverb: 0.1 }, S.fireFlak, p);
                  break;
                case 'bomb':
                  p.fall = Math.abs(ev.z - ev.tz) / Math.max(1, wp.projectileSpeed);
                  ok = at(key, 0.1, ev.x, ev.y, { gain: 0.7, prio: 3, reverb: 0.15 }, S.fireBomb, p);
                  break;
              }
              if (ok) fireHeat += 0.15;
              break;
            }

            case 'impact': {
              const kind = ev.kind;
              if (kind === 'flame') break;
              if (kind === 'tracer') at('imp:tracer', 0.05, ev.x, ev.y, { gain: 0.35, prio: 1, reverb: 0.05 }, S.impactTick, { r: r() });
              else if (kind === 'beam') at('imp:beam', 0.07, ev.x, ev.y, { gain: 0.7, prio: 3, reverb: 0.2 }, S.impactBeam, { r: r() });
              else if (kind === 'flakburst') {
                const size = impactSize(ev.weaponId, ev.splash);
                at('imp:flak', 0.06, ev.x, ev.y, { gain: 0.7, prio: 3, reverb: 0.2 }, S.impactFlak, { r: r(), size: clamp(size * 1.6, 0.5, 1.2) });
              } else {
                const size = impactSize(ev.weaponId, ev.splash);
                at(`imp:boom${Math.round(size * 3)}`, 0.06, ev.x, ev.y, { gain: Math.min(1, 0.55 + 0.3 * size), prio: 3 + Math.round(size * 3), reverb: 0.15 + 0.15 * size, reach: 1 + 0.5 * size }, S.explosion, { size, r: r() });
              }
              break;
            }

            case 'entityDestroyed': {
              const dp = deathProfile(ev.defId);
              const rr = r();
              if (dp.cls === 'infantry') at('die:inf', 0.05, ev.x, ev.y, { gain: 0.5, prio: 2 }, S.infantryDown, { r: rr });
              else if (dp.cls === 'wall') at('die:wall', 0.07, ev.x, ev.y, { gain: 0.6, prio: 3, reverb: 0.15 }, S.wallCrumble, { r: rr });
              else if (dp.cls === 'building') at('die:bld', 0.1, ev.x, ev.y, { gain: 1, prio: 9, reverb: 0.4, reach: 2.2 }, S.buildingCollapse, { size: dp.size, r: rr });
              else if (dp.cls === 'aircraft') at('die:air', 0.07, ev.x, ev.y, { gain: 0.9, prio: 7, reverb: 0.3, reach: 1.5 }, S.aircraftDown, { size: dp.size, r: rr });
              else at('die:veh', 0.07, ev.x, ev.y, { gain: 0.9, prio: 7, reverb: 0.3, reach: 1.5 }, S.explosion, { size: dp.size, r: rr, metal: true });
              if (ev.owner === viewer) {
                if (ev.kind === 'unit') announcer.say('unitLost');
                else if (dp.cls !== 'wall') announcer.say('buildingLost');
              }
              if (ev.owner === viewer || ev.killer === viewer) heat.add(1.5, now);
              break;
            }

            case 'unitReady':
              if (ev.owner === viewer) {
                flat('unitReady', 0.15, S.unitReady, { helion: ev.defId.startsWith('h_'), r: 1 }, 0.5, 6);
                announcer.say('unitReady');
              }
              break;

            case 'constructionReady':
              if (ev.owner === viewer) {
                flat('constructionReady', 0.2, S.constructionReady, { helion: ev.defId.startsWith('h_'), r: 1 }, 0.6, 7, 0.2);
                announcer.say('constructionReady');
              }
              break;

            case 'buildingPlaced':
              at('placed', 0.08, ev.x, ev.y, { gain: 0.7, prio: 4, reverb: 0.15 }, S.buildingPlaced, { helion: ev.defId.startsWith('h_'), r: r() });
              break;

            case 'buildingComplete': {
              const wallDef = BUILDINGS[ev.defId]?.wall;
              const p = entPos(ev.id);
              const bp = { helion: ev.defId.startsWith('h_'), r: 1 };
              if (!wallDef) {
                if (p) at('complete', 0.15, p.x, p.y, { gain: 0.6, prio: 5, reverb: 0.3 }, S.buildingComplete, bp);
                else if (ev.owner === viewer) flat('complete', 0.15, S.buildingComplete, bp, 0.5, 5, 0.3);
                if (ev.owner === viewer) announcer.say('buildingComplete');
              }
              break;
            }

            case 'buildingSold':
              at('sold', 0.1, ev.x, ev.y, { gain: 0.7, prio: 4, reverb: 0.15 }, S.buildingSold, { helion: ev.defId.startsWith('h_'), r: r() });
              break;

            case 'buildingCaptured': {
              const mine = ev.to === viewer || ev.from === viewer;
              if (mine) {
                flat('captured', 0.2, S.buildingCaptured, { gained: ev.to === viewer, r: 1 }, 0.7, 8, 0.2);
                announcer.say(ev.to === viewer ? 'buildingCaptured' : 'buildingTaken');
              } else {
                const p = entPos(ev.id);
                if (p) at('captured', 0.2, p.x, p.y, { gain: 0.6, prio: 4 }, S.buildingCaptured, { gained: true, r: 1 });
              }
              break;
            }

            case 'unitDeployed': {
              const p = entPos(ev.buildingId) ?? entPos(ev.unitId);
              const b = world.entities.get(ev.buildingId);
              const helion = (b?.defId ?? '').startsWith('h_') || (!b && (players[ev.owner]?.faction ?? 'helion') === 'helion');
              if (p) at('deploy', 0.2, p.x, p.y, { gain: 0.8, prio: 5, reverb: 0.2 }, S.deploy, { helion, r: r() });
              break;
            }

            case 'unitPromoted':
              if (ev.owner === viewer) {
                const p = entPos(ev.id);
                if (p) at('promo', 0.3, p.x, p.y, { gain: 0.55, prio: 5, reverb: 0.25, floor: 0.2, fogless: true }, S.promotion, { rank: ev.rank, r: 1 });
                announcer.say('promoted');
              }
              break;

            case 'harvesterUnloaded':
              if (ev.owner === viewer) {
                const p = entPos(ev.id);
                const helion = (me?.faction ?? 'helion') === 'helion';
                if (p) at('unload', 0.25, p.x, p.y, { gain: 0.45, prio: 2, reverb: 0.2 }, S.unloadChime, { helion, r: 1 });
              }
              break;

            case 'insufficientFunds':
              if (ev.player === viewer) {
                flat('ui:error', 0.3, S.denied, { r: 1 }, 0.6, 7, 0);
                announcer.say('insufficientFunds');
              }
              break;

            case 'cannotPlace':
              if (ev.player === viewer) {
                flat('ui:error', 0.3, S.denied, { r: 1 }, 0.6, 7, 0);
                announcer.say('cannotPlace');
              }
              break;

            case 'lowPower':
              if (ev.player === viewer) {
                flat(ev.low ? 'powerDown' : 'powerUp', 1, S.powerHum, { up: !ev.low }, 0.8, 8, 0.15);
                announcer.say(ev.low ? 'lowPower' : 'powerRestored');
              }
              break;

            case 'underAttack':
              if (ev.player === viewer) {
                flat('alert', 2, S.alertKlaxon, { base: ev.base }, 0.55, 8, 0.1);
                announcer.say(ev.base ? 'baseUnderAttack' : 'unitsUnderAttack');
                heat.add(4, now);
              }
              break;

            case 'powerReady':
              if (ev.player === viewer) {
                flat('powerReady', 0.5, S.powerReadyChime, { r: 1 }, 0.6, 8, 0.3);
                announcer.say('powerReady', ev.power);
              }
              break;

            case 'powerUsed': {
              const def = SUPPORT_POWERS[ev.power];
              const damaging = (def?.damage ?? 0) > 0;
              const friendly = teamOf(ev.player) === myTeam;
              if (damaging || friendly) {
                at(`charge:${ev.power}`, 0.5, ev.x, ev.y, { gain: 0.9, prio: 9, reverb: 0.35, reach: 3, floor: damaging ? 0.25 : 0.4, fogless: true }, S.powerCharge, { power: ev.power, seconds: def?.delay || 1 });
              }
              if (ev.player === viewer) announcer.say('powerLaunched', ev.power);
              else if (damaging && !friendly) announcer.say('enemyPower', ev.power);
              break;
            }

            case 'powerImpact': {
              const def = SUPPORT_POWERS[ev.power];
              const damaging = (def?.damage ?? 0) > 0;
              if (damaging) {
                at(`impactPower:${ev.power}`, 0.5, ev.x, ev.y, { gain: 1.1, prio: 10, reverb: 0.5, reach: 4, floor: 0.35, fogless: true }, S.powerImpact, { power: ev.power, seconds: def.duration || 2 });
                heat.add(3, now);
              } else if (teamOf(ev.player) === myTeam) {
                at(`impactPower:${ev.power}`, 0.5, ev.x, ev.y, { gain: 0.5, prio: 5, reverb: 0.4, floor: 0.2, fogless: true }, S.powerImpact, { power: ev.power, seconds: 1 });
              }
              break;
            }

            case 'playerDefeated':
              flat('eliminated', 0.5, S.eliminated, { r: 1 }, 0.6, 8, 0.4);
              if (ev.player === viewer) {
                announcer.say('defeat');
                if (baseMood !== 'off') baseMood = 'defeat';
              } else announcer.say(teamOf(ev.player) === myTeam ? 'allyDefeated' : 'enemyDefeated');
              break;

            case 'gameOver': {
              const won = ev.winnerTeam === myTeam;
              flat('stinger', 3, S.stinger, { win: won }, 0.9, 10, 0.4);
              announcer.say(won ? 'victory' : 'defeat');
              if (baseMood !== 'off') baseMood = won ? 'victory' : 'defeat';
              break;
            }

            default:
              break; // entityCreated, entityDamaged: no sound of their own
          }
        }

        if (fireHeat > 0) heat.add(Math.min(1, fireHeat), now);
        if (!e || pending.length === 0) return;

        // Loudest first, so when the limiter has to drop duplicates it keeps the ones that matter.
        pending.sort((a, b) => (b.opts.gain ?? 0) - (a.opts.gain ?? 0));
        for (const p of pending) {
          const k = limiter.hit(p.key, now, p.interval);
          if (!k) continue;
          p.opts.gain = (p.opts.gain ?? 1) * k * e.vary(1, 0.12);
          p.run(e, p.opts);
        }
      });
    },

    playUi(sound: UiSound) {
      safe(() => {
        const e = ensure();
        if (!e) return;
        if (!limiter.hit(`ui:${sound}`, wall(), sound === 'error' ? 0.25 : 0.04)) return;
        e.play(uiSound, sound, { bus: 'ui', gain: 0.8 });
      });
    },

    playAck(defId: string, kind: 'select' | 'move' | 'attack') {
      safe(() => {
        const e = ensure();
        if (!e) return;
        if (!limiter.hit('ack', wall(), 0.12)) return;
        e.play(ackSound, { ...ackProfile(defId), kind }, { bus: 'ui', gain: 0.75, reverb: 0.1 });
      });
    },

    setMusic(mood: MusicMood) {
      safe(() => {
        if (mood === baseMood) return;
        // entering a match or the menu starts from a clean slate
        if (mood === 'menu' || (mood === 'calm' && baseMood !== 'battle')) heat.reset();
        if (mood === 'menu') announcer.stop();
        baseMood = mood;
        if (ensure()) tick();
      });
    },

    setVolume(v) {
      safe(() => {
        for (const k of ['master', 'sfx', 'music', 'voice'] as const) {
          const x = v?.[k];
          if (typeof x === 'number' && isFinite(x)) vol[k] = clamp(x, 0, 1);
        }
        applyVolumes();
        try {
          win()?.localStorage?.setItem(STORE_KEY, JSON.stringify(vol));
        } catch {
          /* storage unavailable */
        }
      });
    },

    getVolume() {
      return { ...vol };
    },
  };

  const debug: AudioDebug = {
    get engine() {
      return engine;
    },
    get music() {
      return music;
    },
    announcer,
    limiter,
    heat,
    get contextState() {
      return failed ? 'unavailable' : ctx ? ctx.state : 'not-created';
    },
    get effectiveMood() {
      return effectiveMood();
    },
    get keepAliveWhenHidden() {
      return keepAliveWhenHidden;
    },
    set keepAliveWhenHidden(v: boolean) {
      keepAliveWhenHidden = v;
      onVisibility();
    },
    peak() {
      if (!engine) return 0;
      const a = engine.analyser;
      if (!analyserBuf || analyserBuf.length !== a.fftSize) analyserBuf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(analyserBuf);
      let pk = 0;
      for (let i = 0; i < analyserBuf.length; i++) pk = Math.max(pk, Math.abs(analyserBuf[i]));
      return pk;
    },
  };
  void timer;

  // Belt and braces: the first real user gesture unlocks audio even if the UI forgets to.
  try {
    const w = win();
    if (w?.addEventListener) {
      const once = (): void => {
        w.removeEventListener('pointerdown', once, true);
        w.removeEventListener('keydown', once, true);
        api.unlock();
      };
      w.addEventListener('pointerdown', once, true);
      w.addEventListener('keydown', once, true);
    }
  } catch {
    /* no window */
  }

  return Object.assign(api, { debug });
}
