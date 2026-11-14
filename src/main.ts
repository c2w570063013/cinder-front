// Commander-owned: game loop + wiring of sim / render / ui / ai / audio.
import type { AiController, GameUi, Renderer } from './core/api';
import { TICK_MS } from './core/constants';
import type { Command, GameSetup, PlayerId, World } from './core/types';
import { createAi } from './ai';
import { createAudio } from './audio';
import { MAPS } from './maps';
import { createRenderer } from './render';
import { sim } from './sim';
import { createGameUi, createMenu } from './ui';

interface Match {
  world: World;
  viewer: PlayerId;
  renderer: Renderer;
  ui: GameUi;
  ais: AiController[];
  cmds: Command[];
  paused: boolean;
  speed: number;
  acc: number;
  last: number;
  over: boolean;
  /** Tick of the last fight involving the viewer — drives calm/battle music. */
  lastCombatTick: number;
  mood: 'calm' | 'battle';
}

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'game';
canvas.tabIndex = 0;
canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;';
app.append(canvas);

const audio = createAudio();
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });

let match: Match | null = null;

function fit(): void {
  if (!match) return;
  match.renderer.resize(app.clientWidth, app.clientHeight, Math.min(3, window.devicePixelRatio || 1));
  match.renderer.clampCamera(match.world);
}
new ResizeObserver(fit).observe(app);
// devicePixelRatio changes when the window moves between Retina and non-Retina displays.
window.addEventListener('resize', fit);

function endMatch(showResult: boolean): void {
  const m = match;
  if (!m) return;
  match = null;
  m.ui.destroy();
  m.renderer.destroy();
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(1, 0, 0, 1, 0, 0);
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  if (showResult) {
    menu.showResult(m.world, m.viewer);
  } else {
    audio.setMusic('menu');
    menu.show();
  }
}

function startMatch(setup: GameSetup): void {
  if (match) endMatch(false);
  menu.hide();
  const world = sim.createWorld(setup);
  const viewer = Math.max(0, setup.players.findIndex((p) => p.controller === 'human'));
  const renderer = createRenderer(canvas);
  const cmds: Command[] = [];
  const m: Match = {
    world,
    viewer,
    renderer,
    ui: null as unknown as GameUi,
    ais: [],
    cmds,
    paused: false,
    speed: 1,
    acc: 0,
    last: performance.now(),
    over: false,
    lastCombatTick: -10_000,
    mood: 'calm',
  };
  match = m;
  fit();
  for (const e of world.entities.values()) {
    if (e.owner === viewer) {
      renderer.camera.x = e.x;
      renderer.camera.y = e.y;
      break;
    }
  }
  renderer.clampCamera(world);
  m.ui = createGameUi({
    root: app,
    canvas,
    renderer,
    sim,
    audio,
    viewer,
    send: (c) => cmds.push(c),
    setPaused: (p) => (m.paused = p),
    setSpeed: (s) => (m.speed = Math.max(0.25, Math.min(4, s))),
    quitToMenu: () => endMatch(false),
  });
  setup.players.forEach((p, id) => {
    if (p.controller === 'ai') m.ais.push(createAi(id, p.difficulty, (setup.seed + id * 7919) | 0, sim));
  });
  audio.setMusic('calm');
  canvas.focus();
}

const menu = createMenu({ root: app, audio, maps: MAPS, start: startMatch });

function tick(m: Match): void {
  for (const ai of m.ais) {
    if (m.world.players[ai.player].defeated) continue;
    try {
      m.cmds.push(...ai.think(m.world));
    } catch (err) {
      console.error('[ai] think failed', err);
    }
  }
  sim.step(m.world, m.cmds.splice(0));
  const events = m.world.events;
  m.renderer.handleEvents(events, m.world);
  m.ui.handleEvents(events, m.world);
  audio.handleEvents(events, m.world, m.viewer, m.renderer.camera);

  let ended = false;
  for (const e of events) {
    if (e.type === 'underAttack' && e.player === m.viewer) m.lastCombatTick = m.world.tick;
    else if (e.type === 'entityDestroyed' && (e.owner === m.viewer || e.killer === m.viewer)) m.lastCombatTick = m.world.tick;
    else if (e.type === 'gameOver') ended = true;
    // The match is over for the human as soon as they are out, even if AIs fight on.
    else if (e.type === 'playerDefeated' && e.player === m.viewer) ended = true;
  }
  const mood = m.world.tick - m.lastCombatTick < 20 * 20 ? 'battle' : 'calm';
  if (mood !== m.mood && !m.over) {
    m.mood = mood;
    audio.setMusic(mood);
  }
  if (ended && !m.over) {
    m.over = true;
    const won = m.world.winnerTeam === m.world.players[m.viewer].team;
    audio.setMusic(won ? 'victory' : 'defeat');
    window.setTimeout(() => {
      if (match === m) endMatch(true);
    }, 2500);
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const m = match;
  if (!m) return;
  const dt = Math.min(250, now - m.last);
  m.last = now;
  if (!m.paused && !m.over) {
    m.acc += dt * m.speed;
    let guard = 0;
    while (m.acc >= TICK_MS && guard++ < 10) {
      m.acc -= TICK_MS;
      tick(m);
      if (m.over) break;
    }
    if (guard >= 10) m.acc = 0;
  }
  m.ui.update(m.world, dt);
  m.renderer.render(m.world, m.ui.view, m.paused || m.over ? 0.999 : Math.min(0.999, m.acc / TICK_MS));
}

audio.setMusic('menu');
menu.show();
requestAnimationFrame(frame);

// Debug handle for the console / automated checks.
(window as unknown as Record<string, unknown>).__cinder = {
  get match() {
    return match;
  },
  sim,
  MAPS,
  startMatch,
};
