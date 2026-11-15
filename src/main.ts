// Commander-owned: game loop + wiring of sim / render / ui / ai / audio / net.
import type { AiController, GameUi, NetMatch, Renderer } from './core/api';
import { TICK_MS } from './core/constants';
import type { Command, GameSetup, PlayerId, SimEvent, World } from './core/types';
import { BUILDINGS, UNITS, WEAPONS } from './data';
import { createAi } from './ai';
import { createAudio } from './audio';
import { MAPS } from './maps';
import { createNet } from './net';
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
  /** LAN match: commands flow through lockstep turns; no pause, always 1×. */
  net: NetMatch | null;
  paused: boolean;
  speed: number;
  acc: number;
  last: number;
  over: boolean;
  /** Tick of the last fight involving the viewer — drives calm/battle music. */
  lastCombatTick: number;
  mood: 'calm' | 'battle';
}

/** Set by vite.config.ts `define` at build / dev-server start. */
declare const __CF_BUILD__: string;

/** Peers must run the same code and the same numbers, or lockstep desyncs. */
function buildId(): string {
  const text = __CF_BUILD__ + '|' + import.meta.env.MODE + '|' + JSON.stringify([UNITS, BUILDINGS, WEAPONS]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return 'cf1-' + (h >>> 0).toString(36);
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

const net = createNet({ maps: MAPS, buildId: buildId() });

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
  if (m.net) {
    m.net.leave();
    net.leave();
  }
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

function startMatch(setup: GameSetup, netMatch: NetMatch | null = null): void {
  if (match) endMatch(false);
  menu.hide();
  const world = sim.createWorld(setup);
  const viewer = netMatch ? netMatch.localPlayer : Math.max(0, setup.players.findIndex((p) => p.controller === 'human'));
  const renderer = createRenderer(canvas);
  const cmds: Command[] = [];
  const m: Match = {
    world,
    viewer,
    renderer,
    ui: null as unknown as GameUi,
    ais: [],
    cmds,
    net: netMatch,
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
    send: netMatch ? (c) => netMatch.send(c) : (c) => cmds.push(c),
    setPaused: (p) => {
      if (!m.net) m.paused = p;
    },
    setSpeed: (s) => {
      if (!m.net) m.speed = Math.max(0.25, Math.min(4, s));
    },
    quitToMenu: () => endMatch(false),
    net: netMatch ?? undefined,
    netApi: netMatch ? net : undefined,
  });
  // In a LAN match only the host thinks for the AIs; their commands go through the lockstep stream.
  if (!netMatch || netMatch.isHost) {
    setup.players.forEach((p, id) => {
      if (p.controller === 'ai') m.ais.push(createAi(id, p.difficulty, (setup.seed + id * 7919) | 0, sim));
    });
  }
  audio.setMusic('calm');
  canvas.focus();
}

const menu = createMenu({ root: app, audio, maps: MAPS, start: (s) => startMatch(s), net });

net.on((ev) => {
  if (ev.type === 'matchStart') startMatch(ev.match.setup, ev.match);
});

function thinkAis(m: Match, out: (c: Command) => void): void {
  for (const ai of m.ais) {
    if (m.world.players[ai.player].defeated) continue;
    try {
      for (const c of ai.think(m.world)) out(c);
    } catch (err) {
      console.error('[ai] think failed', err);
    }
  }
}

function present(m: Match, events: SimEvent[]): void {
  m.renderer.handleEvents(events, m.world);
  m.ui.handleEvents(events, m.world);
  audio.handleEvents(events, m.world, m.viewer, m.renderer.camera);

  let ended = false;
  for (const e of events) {
    if (e.type === 'underAttack' && e.player === m.viewer) m.lastCombatTick = m.world.tick;
    else if (e.type === 'entityDestroyed' && (e.owner === m.viewer || e.killer === m.viewer)) m.lastCombatTick = m.world.tick;
    else if (e.type === 'gameOver') ended = true;
    // Skirmish: over for the human as soon as they are out. LAN: keep stepping (the others still play,
    // and this peer must stay in lockstep); the HUD shows a spectating banner with a leave button.
    else if (e.type === 'playerDefeated' && e.player === m.viewer && !m.net) ended = true;
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

function localTick(m: Match): void {
  thinkAis(m, (c) => m.cmds.push(c));
  sim.step(m.world, m.cmds.splice(0));
  present(m, m.world.events);
}

/** One lockstep turn; false = the turn is not available yet (stall). */
function netTick(m: Match, n: NetMatch): boolean {
  const cmds = n.takeTurn(m.world.tick);
  if (!cmds) return false;
  sim.step(m.world, cmds);
  n.afterStep(m.world.tick, () => sim.hashWorld(m.world));
  present(m, m.world.events);
  // Host AIs react to the new state; their commands are scheduled for a later turn.
  thinkAis(m, (c) => n.send(c));
  return true;
}

/** Advance the simulation by wall-clock time. Called from rAF and, in LAN matches, from a timer as well. */
function advance(m: Match, now: number): number {
  const dt = Math.min(250, Math.max(0, now - m.last));
  m.last = now;
  if (m.over) return dt;
  const n = m.net;
  if (n) {
    const st = n.status.state;
    if (st !== 'running' && st !== 'waiting') return dt;
    m.acc += dt;
    let guard = 0;
    // Step on schedule, and catch up quickly when turns have piled up (this peer fell behind).
    while ((m.acc >= TICK_MS || n.ready(m.world.tick) > 2) && guard++ < 20) {
      if (!netTick(m, n)) {
        m.acc = Math.min(m.acc, TICK_MS);
        break;
      }
      m.acc = Math.max(0, m.acc - TICK_MS);
      if (m.over) break;
    }
    return dt;
  }
  if (!m.paused) {
    m.acc += dt * m.speed;
    let guard = 0;
    while (m.acc >= TICK_MS && guard++ < 10) {
      m.acc -= TICK_MS;
      localTick(m);
      if (m.over) break;
    }
    if (guard >= 10) m.acc = 0;
  }
  return dt;
}

let lastFrame = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  lastFrame = now;
  const m = match;
  if (!m) return;
  const dt = advance(m, now);
  m.ui.update(m.world, dt);
  const frozen = m.paused || m.over || (m.net !== null && m.net.status.state !== 'running');
  m.renderer.render(m.world, m.ui.view, frozen ? 0.999 : Math.min(0.999, m.acc / TICK_MS));
}

// A LAN match must keep its clock when rAF is throttled (window hidden / occluded): other peers wait on us.
window.setInterval(() => {
  const m = match;
  if (!m || !m.net) return;
  const now = performance.now();
  if (now - lastFrame > 120) advance(m, now);
}, 25);

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
  net,
  startMatch,
};
