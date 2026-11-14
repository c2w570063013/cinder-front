// Dev harness for the ui session (dev/ui.html). A miniature main.ts: menu → skirmish setup → HUD → result.
// Uses the real sim / render / maps / audio / ai modules when they exist and load, otherwise the stand-ins in ./dev/.
//   ?fake=all | sim,render,maps,audio,ai   force stand-ins          ?autostart=1   skip the menu
//   ?prebuilt=1   (fake sim only) start with a full base            ?credits=N
import type { AiController, AudioApi, CreateAi, CreateAudio, CreateRenderer, GameUi, MapInfo, Renderer, SimApi } from '../core/api';
import { TICK_MS } from '../core/constants';
import type { Command, GameSetup, SimEvent, World } from '../core/types';
import { FACTIONS } from '../data';
import { audioLog, createFakeAudio, FAKE_MAPS } from './dev/fakeMisc';
import { createFakeRenderer } from './dev/fakeRenderer';
import { fakeSim, fakeSpawn } from './dev/fakeSim';
import { createGameUi, createMenu } from './index';
import { settings, updateSettings } from './settings';

const params = new URLSearchParams(location.search);
const forced = new Set((params.get('fake') ?? '').split(',').filter(Boolean));
const wantFake = (n: string) => forced.has('all') || forced.has(n);

type Loader = Record<string, () => Promise<unknown>>;
const loaders: Record<string, Loader> = {
  sim: import.meta.glob('../sim/index.ts'),
  render: import.meta.glob('../render/index.ts'),
  maps: import.meta.glob('../maps/index.ts'),
  audio: import.meta.glob('../audio/index.ts'),
  ai: import.meta.glob('../ai/index.ts'),
};
const status: Record<string, string> = {};

async function load<T>(name: string, pick: (mod: Record<string, unknown>) => T | undefined, fallback: T): Promise<T> {
  if (wantFake(name)) {
    status[name] = 'fake (forced)';
    return fallback;
  }
  const fn = Object.values(loaders[name])[0];
  if (!fn) {
    status[name] = 'fake (module missing)';
    return fallback;
  }
  try {
    const mod = (await fn()) as Record<string, unknown>;
    const v = pick(mod);
    if (v === undefined) throw new Error('expected export not found');
    status[name] = 'real';
    return v;
  } catch (err) {
    console.warn(`[ui dev] ${name}: real module failed to load, using stand-in`, err);
    status[name] = 'fake (load failed)';
    return fallback;
  }
}

const app = document.getElementById('app')!;
const badge = document.getElementById('dev-badge');
const errBox = document.getElementById('dev-err');
function showError(msg: string): void {
  if (!errBox) return;
  errBox.hidden = false;
  errBox.textContent = (errBox.textContent ? errBox.textContent + '\n' : '') + msg;
}
window.addEventListener('error', (e) => showError(`${e.message}  (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => showError('unhandled: ' + String((e as PromiseRejectionEvent).reason)));

interface Session {
  world: World;
  renderer: Renderer;
  ui: GameUi;
  ais: AiController[];
  cmds: Command[];
  paused: boolean;
  speed: number;
  acc: number;
  last: number;
  over: boolean;
  viewer: number;
}

async function boot(): Promise<void> {
  const sim = await load<SimApi>('sim', (m) => (m.sim as SimApi | undefined) ?? (typeof m.createWorld === 'function' ? (m as unknown as SimApi) : undefined), fakeSim);
  const createRenderer = await load<CreateRenderer>('render', (m) => m.createRenderer as CreateRenderer | undefined, createFakeRenderer);
  const maps = await load<MapInfo[]>('maps', (m) => (Array.isArray(m.MAPS) && m.MAPS.length ? (m.MAPS as MapInfo[]) : undefined), FAKE_MAPS);
  const createAudio = await load<CreateAudio>('audio', (m) => m.createAudio as CreateAudio | undefined, createFakeAudio);
  const createAi = await load<CreateAi | null>('ai', (m) => m.createAi as CreateAi | undefined, null);
  const simIsFake = sim === fakeSim;

  let audio: AudioApi;
  try {
    audio = createAudio();
  } catch (err) {
    console.warn('[ui dev] audio init failed, using stand-in', err);
    status.audio = 'fake (init failed)';
    audio = createFakeAudio();
  }
  if (badge) badge.textContent = Object.entries(status).map(([k, v]) => `${k}: ${v}`).join('  ·  ');

  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;';
  app.append(canvas);

  let session: Session | null = null;

  function fit(): void {
    if (!session) return;
    const w = app.clientWidth;
    const h = app.clientHeight;
    session.renderer.resize(w, h, Math.min(3, window.devicePixelRatio || 1));
    session.renderer.clampCamera(session.world);
  }
  new ResizeObserver(fit).observe(app);

  function end(toMenu: boolean): void {
    const s = session;
    if (!s) return;
    session = null;
    s.ui.destroy();
    s.renderer.destroy();
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(1, 0, 0, 1, 0, 0);
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    if (toMenu) menu.show();
    else menu.showResult(s.world, s.viewer);
  }

  function start(setup: GameSetup): void {
    if (session) end(true);
    menu.hide();
    const credits = Number(params.get('credits'));
    if (credits > 0) setup.startingCredits = credits;
    const world = sim.createWorld(setup);
    const viewer = Math.max(0, setup.players.findIndex((p) => p.controller === 'human'));
    if (simIsFake && params.get('prebuilt')) prebuild(world, viewer);
    const renderer = createRenderer(canvas);
    const cmds: Command[] = [];
    const s: Session = { world, renderer, ui: null as unknown as GameUi, ais: [], cmds, paused: false, speed: 1, acc: 0, last: performance.now(), over: false, viewer };
    session = s;
    fit();
    for (const e of world.entities.values()) {
      if (e.owner === viewer) {
        renderer.camera.x = e.x;
        renderer.camera.y = e.y;
        break;
      }
    }
    renderer.clampCamera(world);
    s.ui = createGameUi({
      root: app,
      canvas,
      renderer,
      sim,
      audio,
      viewer,
      send: (c) => cmds.push(c),
      setPaused: (p) => (s.paused = p),
      setSpeed: (m) => (s.speed = m),
      quitToMenu: () => end(true),
    });
    if (createAi && !simIsFake) {
      setup.players.forEach((p, id) => {
        if (p.controller !== 'ai') return;
        try {
          s.ais.push(createAi(id, p.difficulty, (setup.seed + id * 7919) | 0, sim));
        } catch (err) {
          console.warn('[ui dev] AI init failed', err);
        }
      });
    }
    try {
      audio.setMusic('calm');
    } catch {
      /* ignore */
    }
  }

  function prebuild(world: World, viewer: number): void {
    const p = world.players[viewer];
    const f = FACTIONS[p.faction];
    const pre = p.faction === 'helion' ? 'h_' : 'f_';
    let base = { x: 10, y: 10 };
    for (const e of [...world.entities.values()]) {
      if (e.owner === viewer && e.defId === f.baseVehicle) {
        base = { x: Math.floor(e.x), y: Math.floor(e.y) };
        world.entities.delete(e.id);
      }
    }
    const put = (id: string, dx: number, dy: number) => fakeSpawn(world, id, viewer, base.x + dx, base.y + dy);
    put(f.conyard, 0.5, 0.5);
    put(pre + 'power', -3, -3);
    put(pre + 'power', 0, -3);
    put(pre + 'power', 3, -3);
    put(pre + 'refinery', 4.5, 0.5);
    put(pre + 'barracks', -3, 1);
    put(pre + 'factory', -3.5, 4.5);
    put(pre + 'radar', 4, 4);
    put(pre + 'lab', 0.5, 4);
    put(p.faction === 'helion' ? 'h_uplink' : 'f_drill', 7.5, -2.5);
    put(pre + 'power', -6, -3);
    put(pre + 'power', -6, 0);
    put(p.faction === 'helion' ? 'h_harvester' : 'f_hauler', 6, 3).order = { type: 'harvest', tx: null, ty: null };
    put(p.faction === 'helion' ? 'h_engineer' : 'f_sapper', 1, 7);
    world.events = [];
  }

  const menu = createMenu({ root: app, audio, maps, start });

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const s = session;
    if (!s) return;
    const dt = Math.min(250, now - s.last);
    s.last = now;
    if (!s.paused && !s.over) {
      s.acc += dt * s.speed;
      let guard = 0;
      while (s.acc >= TICK_MS && guard++ < 8) {
        s.acc -= TICK_MS;
        for (const ai of s.ais) {
          try {
            s.cmds.push(...ai.think(s.world));
          } catch (err) {
            console.warn('[ui dev] AI think failed', err);
          }
        }
        const batch = s.cmds.splice(0);
        sim.step(s.world, batch);
        const events = s.world.events;
        s.renderer.handleEvents(events, s.world);
        s.ui.handleEvents(events, s.world);
        try {
          audio.handleEvents(events, s.world, s.viewer, s.renderer.camera);
        } catch {
          /* ignore */
        }
        if (events.some((e) => e.type === 'gameOver')) {
          s.over = true;
          window.setTimeout(() => {
            if (session === s) end(false);
          }, 1600);
        }
      }
      if (guard >= 8) s.acc = 0;
    }
    s.ui.update(s.world, dt);
    s.renderer.render(s.world, s.ui.view, s.paused ? 0 : Math.min(0.999, s.acc / TICK_MS));
  }
  requestAnimationFrame(frame);

  // Console helpers for poking the UI by hand.
  (window as unknown as Record<string, unknown>).__dev = {
    get session() {
      return session;
    },
    status,
    audioLog,
    settings,
    updateSettings,
    emit(ev: SimEvent | SimEvent[]) {
      if (session) session.ui.handleEvents(Array.isArray(ev) ? ev : [ev], session.world);
    },
    showResult(win = true) {
      if (!session) return;
      session.world.winnerTeam = win ? session.world.players[session.viewer].team : 99;
      end(false);
    },
  };

  if (params.get('autostart')) {
    const info = maps[Number(params.get('map') ?? 0)] ?? maps[0];
    const seed = Number(params.get('seed') ?? 7);
    const faction = params.get('faction') === 'ferrum' ? 'ferrum' : 'helion';
    start({
      map: info.generate(seed),
      seed,
      startingCredits: 10000,
      options: { fog: params.get('fog') !== '0', shortGame: false, superweapons: true },
      players: [
        { name: '指揮官', faction, color: FACTIONS[faction].colors[0], team: 1, controller: 'human', difficulty: 'normal', startIndex: 0 },
        { name: '電腦 1', faction: faction === 'helion' ? 'ferrum' : 'helion', color: FACTIONS[faction === 'helion' ? 'ferrum' : 'helion'].colors[0], team: 2, controller: 'ai', difficulty: 'normal', startIndex: 1 },
      ],
    });
  } else menu.show();
}

void boot().catch((err) => showError('boot failed: ' + String(err?.stack ?? err)));
