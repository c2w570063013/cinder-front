// Dev page for the audio module (dev/audio-mac.html, launch entry `dev-audio-mac`, port 5177).
// Fires every event / weapon / UI sound / ack / announcer line / music mood against a hand-made World,
// and can render everything offline to check that the graph really produces signal.
import type { Camera, MusicMood, UiSound } from '../core/api';
import { isoToWorld } from '../core/iso';
import type { Entity, ProjectileKind, SimEvent, SupportPowerId, World } from '../core/types';
import { BUILDINGS, SUPPORT_POWERS, UNITS, WEAPONS } from '../data';
import { LINES, type LineId } from './announcer';
import { Engine, type Recipe } from './engine';
import { ackProfile, deathProfile, impactSize, weaponProfile } from './logic';
import { Music } from './music';
import * as S from './sfx';
import { createAudioSystem, MUSIC_TRIM } from './system';
import { ackSound, uiSound } from './uisounds';

const audio = createAudioSystem();
audio.debug.keepAliveWhenHidden = true;
(window as any).__audio = audio;

// ───────────────────────────── fake world ─────────────────────────────

const MAP = 64;
const camera: Camera = { x: 32, y: 32, zoom: 1 };
const mkPlayer = (id: number, faction: 'helion' | 'ferrum', team: number) => ({ id, faction, team, visible: new Uint8Array(MAP * MAP).fill(1), explored: new Uint8Array(MAP * MAP).fill(1) });
const ent = (id: number, defId: string, kind: 'unit' | 'building', x: number, y: number) => ({ id, defId, kind, owner: 0, x, y }) as unknown as Entity;
const world = {
  tick: 0,
  setup: { options: { fog: false, shortGame: false, superweapons: true } },
  map: { width: MAP, height: MAP },
  players: [mkPlayer(0, 'helion', 0), mkPlayer(1, 'ferrum', 1)],
  entities: new Map<number, Entity>([
    [1, ent(1, 'h_nexus', 'building', 32, 32)],
    [2, ent(2, 'h_harvester', 'unit', 34, 30)],
  ]),
  events: [],
} as unknown as World;

/** Event position as an offset from the view centre, in half-screens. */
const offset = { nx: 0, ny: 0 };
const pos = (nx = offset.nx, ny = offset.ny) => {
  const w = isoToWorld((nx * window.innerWidth) / 2 / camera.zoom, (ny * window.innerHeight) / 2 / camera.zoom);
  return { x: camera.x + w.x, y: camera.y + w.y };
};
const send = (...events: SimEvent[]) => audio.handleEvents(events, world, 0, camera);

const fire = (weaponId: string, nx?: number, ny?: number) => {
  const w = WEAPONS[weaponId];
  const p = pos(nx, ny);
  const z = w.projectile === 'bomb' ? 2.4 : 0.3;
  send({ type: 'weaponFired', sourceId: 99, weaponId, kind: w.projectile, x: p.x, y: p.y, z, tx: p.x + 2, ty: p.y, tz: 0 });
};
const impact = (weaponId: string, nx?: number, ny?: number) => {
  const w = WEAPONS[weaponId];
  const p = pos(nx, ny);
  send({ type: 'impact', weaponId, kind: w.projectile, x: p.x, y: p.y, z: 0, splash: w.splash ?? 0 });
};
const destroy = (defId: string, nx?: number, ny?: number) => {
  const p = pos(nx, ny);
  send({ type: 'entityDestroyed', id: 50, defId, kind: UNITS[defId] ? 'unit' : 'building', owner: 1, killer: 0, x: p.x, y: p.y });
};

// ───────────────────────────── UI helpers ─────────────────────────────

const app = document.getElementById('app')!;
const section = (title: string): HTMLDivElement => {
  const h = document.createElement('h2');
  h.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  app.append(h, row);
  return row;
};
const btn = (row: HTMLElement, label: string, fn: (b: HTMLButtonElement) => void, cls = ''): HTMLButtonElement => {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', () => {
    audio.unlock();
    fn(b);
  });
  row.append(b);
  return b;
};
const slider = (row: HTMLElement, label: string, min: number, max: number, value: number, fn: (v: number) => void): HTMLInputElement => {
  const l = document.createElement('label');
  const i = document.createElement('input');
  const out = document.createElement('span');
  i.type = 'range';
  i.min = String(min);
  i.max = String(max);
  i.step = '0.01';
  i.value = String(value);
  out.textContent = value.toFixed(2);
  i.addEventListener('input', () => {
    out.textContent = (+i.value).toFixed(2);
    fn(+i.value);
  });
  l.append(label, i, out);
  row.append(l);
  return i;
};
const fc = (id: string) => (id.startsWith('h_') ? 'h' : 'f');

// ───────────────────────────── sections ─────────────────────────────

{
  const row = section('音量 volumes · 位置 event position (half-screens from view centre) · 鏡頭 zoom');
  const v = audio.getVolume();
  (['master', 'sfx', 'music', 'voice'] as const).forEach((k) => slider(row, k, 0, 1, v[k], (x) => audio.setVolume({ [k]: x })));
  slider(row, 'x', -3, 3, 0, (x) => (offset.nx = x));
  slider(row, 'y', -3, 3, 0, (x) => (offset.ny = x));
  slider(row, 'zoom', 0.5, 2, 1, (x) => (camera.zoom = x));
  btn(row, 'fog: off', (b) => {
    const fog = !world.setup.options.fog;
    world.setup.options.fog = fog;
    // with fog on, the right half of the map is hidden from the viewer
    const vis = world.players[0].visible;
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) vis[y * MAP + x] = !fog || x < 32 ? 1 : 0;
    b.textContent = `fog: ${fog ? 'ON (x ≥ 32 hidden)' : 'off'}`;
  });
}
{
  const row = section('武器開火 weaponFired (+ impact when the shot would land)');
  for (const w of Object.values(WEAPONS)) {
    btn(row, `${w.id.slice(2)} · ${w.projectile}`, () => {
      fire(w.id);
      const delay = w.projectileSpeed ? 450 : 60;
      setTimeout(() => impact(w.id), delay);
    }, fc(w.id));
  }
}
{
  const row = section('摧毀 entityDestroyed (size from def hp / footprint)');
  for (const d of [...Object.values(UNITS), ...Object.values(BUILDINGS)]) btn(row, `${d.name} ${d.nameEn}`, () => destroy(d.id), fc(d.id));
}
{
  const row = section('基地事件 base events');
  const p = () => pos();
  for (const f of ['h', 'f'] as const) {
    const pre = `${f}_`;
    btn(row, 'buildingPlaced', () => send({ type: 'buildingPlaced', id: 1, defId: pre + 'power', owner: 0, ...p() }), f);
    btn(row, 'buildingComplete', () => send({ type: 'buildingComplete', id: 77, defId: pre + 'power', owner: 0 }), f);
    btn(row, 'buildingSold', () => send({ type: 'buildingSold', id: 1, defId: pre + 'power', owner: 0, ...p() }), f);
    btn(row, 'constructionReady', () => send({ type: 'constructionReady', defId: pre + 'power', owner: 0 }), f);
    btn(row, 'unitReady', () => send({ type: 'unitReady', id: 2, defId: pre + (f === 'h' ? 'javelin' : 'hammer'), owner: 0 }), f);
  }
  btn(row, 'captured (gained)', () => send({ type: 'buildingCaptured', id: 1, defId: 'f_power', from: 1, to: 0 }));
  btn(row, 'captured (lost)', () => send({ type: 'buildingCaptured', id: 1, defId: 'h_power', from: 0, to: 1 }));
  btn(row, 'unitDeployed', () => send({ type: 'unitDeployed', unitId: 2, buildingId: 1, owner: 0 }));
  btn(row, 'harvesterUnloaded', () => send({ type: 'harvesterUnloaded', id: 2, owner: 0, credits: 500 }));
  btn(row, 'unitPromoted ★', () => send({ type: 'unitPromoted', id: 2, owner: 0, rank: 1 }));
  btn(row, 'unitPromoted ★★', () => send({ type: 'unitPromoted', id: 2, owner: 0, rank: 2 }));
  btn(row, 'insufficientFunds', () => send({ type: 'insufficientFunds', player: 0 }));
  btn(row, 'cannotPlace', () => send({ type: 'cannotPlace', player: 0 }));
  btn(row, 'lowPower', () => send({ type: 'lowPower', player: 0, low: true }));
  btn(row, 'power restored', () => send({ type: 'lowPower', player: 0, low: false }));
  btn(row, 'underAttack (base)', () => send({ type: 'underAttack', player: 0, ...p(), base: true }));
  btn(row, 'underAttack (units)', () => send({ type: 'underAttack', player: 0, ...p(), base: false }));
  btn(row, 'playerDefeated (enemy)', () => send({ type: 'playerDefeated', player: 1 }));
  btn(row, 'gameOver — victory', () => send({ type: 'gameOver', winnerTeam: 0 }));
  btn(row, 'gameOver — defeat', () => send({ type: 'gameOver', winnerTeam: 1 }));
}
{
  const row = section('支援武力 support powers');
  for (const id of Object.keys(SUPPORT_POWERS) as SupportPowerId[]) {
    const d = SUPPORT_POWERS[id];
    btn(row, `${d.name} ready`, () => send({ type: 'powerReady', player: 0, power: id }));
    btn(row, `${d.name} used → impact (mine)`, () => {
      const p = pos();
      send({ type: 'powerUsed', player: 0, power: id, ...p });
      setTimeout(() => send({ type: 'powerImpact', player: 0, power: id, ...p, radius: d.radius }), d.delay * 1000);
    });
    btn(row, `${d.name} (enemy)`, () => {
      const p = pos();
      send({ type: 'powerUsed', player: 1, power: id, ...p });
      setTimeout(() => send({ type: 'powerImpact', player: 1, power: id, ...p, radius: d.radius }), d.delay * 1000);
    });
  }
}
{
  const row = section('介面 UI sounds');
  for (const s of ['click', 'select', 'move', 'attack', 'place', 'error', 'tab', 'queue', 'cancel'] as UiSound[]) btn(row, s, () => audio.playUi(s));
}
{
  const row = section('單位回應 acks');
  let kind: 'select' | 'move' | 'attack' = 'select';
  const kinds = (['select', 'move', 'attack'] as const).map((k) =>
    btn(row, k, () => {
      kind = k;
      kinds.forEach((b, i) => b.classList.toggle('on', ['select', 'move', 'attack'][i] === k));
    }),
  );
  kinds[0].classList.add('on');
  for (const d of [...Object.values(UNITS), ...Object.values(BUILDINGS).filter((b) => !b.wall)]) btn(row, d.name, () => audio.playAck(d.id, kind), fc(d.id));
}
{
  const row = section('播報 announcer lines (zh-TW speech; silent if no such voice)');
  for (const id of Object.keys(LINES) as LineId[]) btn(row, `${id} 「${LINES[id].text}」`, () => audio.debug.announcer.say(id, id === 'powerReady' || id === 'enemyPower' || id === 'powerLaunched' ? 'orbital_lance' : undefined));
}
{
  const row = section('音樂 music mood (calm auto-escalates to battle with combat heat)');
  for (const m of ['menu', 'calm', 'battle', 'victory', 'defeat', 'off'] as MusicMood[]) btn(row, m, () => audio.setMusic(m));
}

// ── stress, pan sweep ──
let stressTimer: ReturnType<typeof setInterval> | null = null;
{
  const row = section('測試 tests');
  const weaponIds = Object.keys(WEAPONS);
  const unitIds = Object.keys(UNITS);
  btn(row, 'stress: 100 mixed events/s', (b) => {
    if (stressTimer) {
      clearInterval(stressTimer);
      stressTimer = null;
      b.classList.remove('on');
      return;
    }
    b.classList.add('on');
    stressTimer = setInterval(() => {
      const evs: SimEvent[] = [];
      for (let i = 0; i < 5; i++) {
        const wid = weaponIds[Math.floor(Math.random() * weaponIds.length)];
        const w = WEAPONS[wid];
        const p = pos(Math.random() * 3 - 1.5, Math.random() * 3 - 1.5);
        const roll = Math.random();
        if (roll < 0.55) evs.push({ type: 'weaponFired', sourceId: 9, weaponId: wid, kind: w.projectile, x: p.x, y: p.y, z: 0.3, tx: p.x, ty: p.y, tz: 0 });
        else if (roll < 0.9) evs.push({ type: 'impact', weaponId: wid, kind: w.projectile, x: p.x, y: p.y, z: 0, splash: w.splash ?? 0 });
        else evs.push({ type: 'entityDestroyed', id: 5, defId: unitIds[Math.floor(Math.random() * unitIds.length)], kind: 'unit', owner: 1, killer: 0, x: p.x, y: p.y });
      }
      send(...evs);
    }, 50);
  });
  btn(row, '40 tanks fire at once', () => {
    const evs: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      const p = pos(Math.random() * 1.6 - 0.8, Math.random() * 1.6 - 0.8);
      evs.push({ type: 'weaponFired', sourceId: i, weaponId: 'f_hammer_cannon', kind: 'shell', x: p.x, y: p.y, z: 0.3, tx: p.x, ty: p.y, tz: 0 });
    }
    send(...evs);
  });
  btn(row, 'pan / distance sweep (left → right, 3 s)', () => {
    let i = 0;
    const t = setInterval(() => {
      fire('h_javelin_cannon', -3 + (i / 20) * 6, 0);
      if (++i > 20) clearInterval(t);
    }, 150);
  });
  btn(row, 'offline audit (render every sound)', () => void runAudit());
}

// ───────────────────────────── live status ─────────────────────────────

const meterFill = document.querySelector<HTMLElement>('#meter i')!;
const meterHold = document.querySelector<HTMLElement>('#meter b')!;
const info = document.getElementById('info')!;
let hold = 0;
let maxPeak = 0;
const loop = () => {
  const pk = audio.debug.peak();
  hold = Math.max(pk, hold * 0.97);
  maxPeak = Math.max(maxPeak, pk);
  meterFill.style.width = `${Math.min(100, pk * 100)}%`;
  meterHold.style.left = `${Math.min(99, hold * 100)}%`;
  const d = audio.debug;
  const e = d.engine;
  const sp = d.announcer;
  info.textContent =
    `ctx ${d.contextState}  peak ${pk.toFixed(3)} (max ${maxPeak.toFixed(3)})  voices ${e?.budget.count ?? 0}/${e?.budget.max ?? 0}` +
    `  played ${e?.stats.played ?? 0} dropped ${e?.stats.dropped ?? 0} stolen ${e?.stats.stolen ?? 0}\n` +
    `music ${d.effectiveMood} (tracks ${d.music?.activeTracks ?? 0})  heat ${d.heat.heat.toFixed(2)}${d.heat.inBattle ? ' BATTLE' : ''}` +
    `  announcer ${sp.status} ${sp.voiceName}  last 「${sp.lastSpoken}」 queued ${sp.queue.pending}`;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
// rAF stops in hidden tabs; keep the max-peak tracker alive for automated checks
setInterval(() => {
  maxPeak = Math.max(maxPeak, audio.debug.peak());
  (window as any).__maxPeak = maxPeak;
}, 20);
(window as any).__resetPeak = () => (maxPeak = 0);

// ───────────────────────────── offline audit ─────────────────────────────

export interface AuditRow {
  name: string;
  dur: number;
  peak: number;
  rms: number;
  /** Zero crossings per second / 2 — a rough brightness measure in Hz. */
  zc: number;
  ok: boolean;
}

function analyse(name: string, buf: AudioBuffer): AuditRow {
  const a = buf.getChannelData(0);
  const b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
  let peak = 0;
  let sum = 0;
  let zc = 0;
  let last = -1;
  let prev = 0;
  let bad = false;
  for (let i = 0; i < a.length; i++) {
    const v = (a[i] + b[i]) * 0.5;
    if (!Number.isFinite(v)) bad = true;
    const av = Math.max(Math.abs(a[i]), Math.abs(b[i]));
    if (av > peak) peak = av;
    if (av > 0.003) last = i;
    sum += v * v;
    if ((v >= 0) !== (prev >= 0)) zc++;
    prev = v;
  }
  const dur = (last + 1) / buf.sampleRate;
  const rms = Math.sqrt(sum / Math.max(1, last + 1));
  return { name, dur, peak, rms, zc: dur > 0 ? zc / 2 / dur : 0, ok: !bad && peak > 0.01 && peak <= 1.0001 };
}

async function renderOne<P>(name: string, recipe: Recipe<P>, p: P, seconds: number, gain = 1, reverb = 0.15): Promise<AuditRow> {
  const octx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  const eng = new Engine(octx);
  eng.play(recipe, p, { gain, reverb });
  return analyse(name, await octx.startRendering());
}

const FIRE: Record<ProjectileKind, Recipe<S.FireP>> = {
  tracer: S.fireTracer,
  shell: S.fireShell,
  beam: S.fireBeam,
  arc: S.fireArc,
  missile: S.fireMissile,
  flame: S.fireFlame,
  flakburst: S.fireFlak,
  bomb: S.fireBomb,
};

export async function runAudit(): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  const add = async (p: Promise<AuditRow>) => rows.push(await p);
  for (const w of Object.values(WEAPONS)) {
    const wp = weaponProfile(w.id, w.projectile);
    await add(renderOne(`fire ${w.id}`, FIRE[wp.kind], { power: wp.power, helion: wp.helion, r: 1, warhead: wp.warhead, fall: 0.5 }, 2));
  }
  await add(renderOne('impact tracer', S.impactTick, { r: 1 }, 0.5, 0.35));
  await add(renderOne('impact beam', S.impactBeam, { r: 1 }, 1));
  await add(renderOne('impact flak', S.impactFlak, { r: 1, size: 1 }, 1));
  for (const id of ['f_grenade', 'h_javelin_cannon', 'f_siege', 'h_howitzer', 'f_vulture_bomb']) {
    const size = impactSize(id, WEAPONS[id].splash ?? 0);
    await add(renderOne(`impact ${id} (size ${size.toFixed(2)})`, S.explosion, { size, r: 1 }, 3));
  }
  for (const id of ['h_warden', 'h_ranger', 'f_hammer', 'f_colossus', 'h_kestrel', 'h_wall', 'h_power', 'f_core']) {
    const dp = deathProfile(id);
    const r: Recipe<any> = dp.cls === 'infantry' ? S.infantryDown : dp.cls === 'wall' ? S.wallCrumble : dp.cls === 'building' ? S.buildingCollapse : dp.cls === 'aircraft' ? S.aircraftDown : S.explosion;
    await add(renderOne(`destroyed ${id} (${dp.cls} ${dp.size.toFixed(2)})`, r, { size: dp.size, r: 1, metal: true }, 4));
  }
  for (const helion of [true, false]) {
    const f = helion ? 'helion' : 'ferrum';
    await add(renderOne(`placed ${f}`, S.buildingPlaced, { helion, r: 1 }, 1.5));
    await add(renderOne(`complete ${f}`, S.buildingComplete, { helion, r: 1 }, 2));
    await add(renderOne(`deploy ${f}`, S.deploy, { helion, r: 1 }, 2));
    await add(renderOne(`unitReady ${f}`, S.unitReady, { helion, r: 1 }, 1));
    await add(renderOne(`constructionReady ${f}`, S.constructionReady, { helion, r: 1 }, 1.5));
  }
  await add(renderOne('sold', S.buildingSold, { helion: true, r: 1 }, 1.2));
  await add(renderOne('captured +', S.buildingCaptured, { gained: true, r: 1 }, 1));
  await add(renderOne('captured -', S.buildingCaptured, { gained: false, r: 1 }, 1));
  await add(renderOne('unload chime', S.unloadChime, { helion: true, r: 1 }, 1));
  await add(renderOne('promotion', S.promotion, { rank: 2, r: 1 }, 1.2));
  await add(renderOne('powerReady chime', S.powerReadyChime, { r: 1 }, 1.6));
  await add(renderOne('alert klaxon', S.alertKlaxon, { base: true }, 1.2));
  await add(renderOne('denied', S.denied, { r: 1 }, 0.6));
  await add(renderOne('power down', S.powerHum, { up: false }, 2));
  await add(renderOne('power up', S.powerHum, { up: true }, 1.2));
  await add(renderOne('eliminated', S.eliminated, { r: 1 }, 2.2));
  await add(renderOne('stinger win', S.stinger, { win: true }, 3.5));
  await add(renderOne('stinger lose', S.stinger, { win: false }, 3.8));
  for (const id of Object.keys(SUPPORT_POWERS) as SupportPowerId[]) {
    const d = SUPPORT_POWERS[id];
    await add(renderOne(`charge ${id}`, S.powerCharge, { power: id, seconds: d.delay || 1 }, (d.delay || 1) + 1.5));
    await add(renderOne(`impact ${id}`, S.powerImpact, { power: id, seconds: d.damage ? d.duration : 1 }, 6, d.damage ? 1.1 : 0.5, 0.5));
  }
  for (const s of ['click', 'select', 'move', 'attack', 'place', 'error', 'tab', 'queue', 'cancel'] as UiSound[]) await add(renderOne(`ui ${s}`, uiSound, s, 0.6, 0.8, 0));
  for (const id of ['h_warden', 'f_militia', 'h_javelin', 'f_hammer', 'h_kestrel', 'f_vulture', 'h_nexus', 'f_core']) {
    for (const kind of ['select', 'move', 'attack'] as const) await add(renderOne(`ack ${id} ${kind}`, ackSound, { ...ackProfile(id), kind }, 0.8, 0.75, 0.1));
  }
  for (const mood of ['menu', 'calm', 'battle', 'victory', 'defeat'] as const) {
    const seconds = 24;
    const octx = new OfflineAudioContext(2, 44100 * seconds, 44100);
    const eng = new Engine(octx);
    eng.musicBus.gain.value = 0.55 * MUSIC_TRIM;
    eng.master.gain.value = 0.8;
    const m = new Music(eng);
    m.setMood(mood);
    m.pump(seconds);
    await add(Promise.resolve(analyse(`music ${mood} (${seconds}s, default volume)`, await octx.startRendering())));
  }

  let table = document.getElementById('audit');
  if (!table) {
    table = document.createElement('table');
    table.id = 'audit';
    app.append(table);
  }
  const db = (x: number) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
  table.innerHTML =
    '<tr><th>sound</th><th>dur s</th><th>peak dBFS</th><th>rms dBFS</th><th>~Hz</th><th>ok</th></tr>' +
    rows.map((r) => `<tr class="${r.ok ? '' : 'bad'}"><td>${r.name}</td><td>${r.dur.toFixed(2)}</td><td>${db(r.peak)}</td><td>${db(r.rms)}</td><td>${r.zc.toFixed(0)}</td><td>${r.ok ? '✓' : '✗'}</td></tr>`).join('');
  (window as any).__audit = rows;
  return rows;
}
(window as any).__runAudit = runAudit;
