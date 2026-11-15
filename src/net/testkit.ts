// Test harness: a virtual LAN of NetApi peers over the in-memory transport, each running the real sim.
import type { AiController, NetApi, NetEvent, NetMatch } from '../core/api';
import type { Command, World } from '../core/types';
import { createAi } from '../ai';
import { MAPS } from '../maps';
import { sim } from '../sim';
import { botCommands, type BotPlan } from '../sim/testbot';
import { VirtualClock } from './clock';
import { createNetWith } from './index';
import { MemoryNetwork, type MemoryNetOptions, type MemoryTransport } from './memory';

export const BUILD = 'cinder-test-build';

export const PLANS: Record<'helion' | 'ferrum', BotPlan> = {
  helion: { build: ['h_power', 'h_refinery', 'h_barracks', 'h_factory', 'h_power'], units: { h_warden: 4, h_javelin: 4 }, attackAt: 1800 },
  ferrum: { build: ['f_power', 'f_refinery', 'f_barracks', 'f_factory', 'f_power'], units: { f_militia: 5, f_hammer: 3 }, attackAt: 2200 },
};

export interface TestPeer {
  name: string;
  tp: MemoryTransport;
  net: NetApi;
  events: NetEvent[];
  match: NetMatch | null;
  world: World | null;
  ais: AiController[];
  /** Skip stepping (simulates a hung machine whose connection stays open). */
  frozen: boolean;
  /** Run the scripted bot for the local player. */
  bot: boolean;
  /** Every turn this peer applied, by tick (for order checks). */
  applied: Map<number, Command[]>;
  steps: number;
  /** Most steps taken in a single drive() call (catch-up). */
  maxBurst: number;
}

export interface Lan {
  clock: VirtualClock;
  network: MemoryNetwork;
  peers: TestPeer[];
}

export function makeLan(opts: MemoryNetOptions = { minDelay: 1, maxDelay: 8, seed: 3 }): Lan {
  const clock = new VirtualClock();
  return { clock, network: new MemoryNetwork(clock, opts), peers: [] };
}

export function addPeer(lan: Lan, name: string, buildId = BUILD): TestPeer {
  const tp = lan.network.createTransport();
  const net = createNetWith({ maps: MAPS, buildId }, { transport: tp, clock: lan.clock, randomSeed: () => 777 });
  const peer: TestPeer = { name, tp, net, events: [], match: null, world: null, ais: [], frozen: false, bot: false, applied: new Map(), steps: 0, maxBurst: 0 };
  net.on((e) => {
    peer.events.push(e);
    if (e.type === 'matchStart') {
      peer.match = e.match;
      peer.world = sim.createWorld(e.match.setup);
      if (e.match.isHost) {
        e.match.setup.players.forEach((p, id) => {
          if (p.controller === 'ai') peer.ais.push(createAi(id, p.difficulty, (e.match.setup.seed + id * 7919) | 0, sim));
        });
      }
    }
  });
  lan.peers.push(peer);
  return peer;
}

/** Let the network and timers run for `ms` of virtual time. */
export function pump(lan: Lan, ms: number, slice = 10): void {
  for (let t = 0; t < ms; t += slice) lan.clock.advance(Math.min(slice, ms - t));
}

/** One frame of the main.ts lockstep loop for one peer (what src/main.ts is expected to do). */
export function drive(peer: TestPeer, opts: { maxSteps?: number; untilTick?: number } = {}): void {
  const m = peer.match;
  const w = peer.world;
  if (!m || !w || peer.frozen) return;
  const maxSteps = opts.maxSteps ?? 6;
  const until = opts.untilTick ?? Infinity;
  for (let n = 0; n < maxSteps && w.tick < until; n++) {
    if (n > 0 && m.ready(w.tick) <= 2) break; // extra steps only when behind
    peer.maxBurst = Math.max(peer.maxBurst, n + 1);
    const cmds = m.takeTurn(w.tick);
    if (!cmds) break;
    if (m.isHost) {
      for (const ai of peer.ais) {
        if (w.players[ai.player].defeated) continue;
        for (const c of ai.think(w)) m.send(c);
      }
    }
    if (peer.bot && !w.players[m.localPlayer].defeated) {
      const plan = PLANS[w.players[m.localPlayer].faction];
      for (const c of botCommands(w, m.localPlayer, plan)) m.send(c);
    }
    peer.applied.set(w.tick, cmds);
    sim.step(w, cmds);
    peer.steps++;
    m.afterStep(w.tick, () => sim.hashWorld(w));
  }
}

/** Advance virtual time frame by frame (50 ms), driving every peer each frame. */
export function run(lan: Lan, frames: number, opts: { untilTick?: number; skip?: (peer: TestPeer, frame: number) => boolean } = {}): void {
  for (let f = 0; f < frames; f++) {
    pump(lan, 50);
    for (const p of lan.peers) {
      if (opts.skip?.(p, f)) continue;
      drive(p, { untilTick: opts.untilTick });
    }
  }
}

export const errors = (p: TestPeer): string[] => p.events.flatMap((e) => (e.type === 'error' ? [e.text] : []));
export const notices = (p: TestPeer): string[] => p.events.flatMap((e) => (e.type === 'notice' ? [e.text] : []));

/** Host + clients joined to one room (map `mapId`), not yet started. */
export function setupRoom(lan: Lan, names: string[], mapId: string): TestPeer[] {
  const [hostName, ...clientNames] = names;
  const host = addPeer(lan, hostName);
  host.net.host(hostName, `${hostName} room`);
  host.net.setRoom({ mapId, seed: 4242 });
  pump(lan, 50);
  const clients = clientNames.map((n) => addPeer(lan, n));
  for (const c of clients) {
    c.net.browse();
    for (let i = 0; i < 20 && c.net.getState().rooms.length === 0; i++) pump(lan, 50);
    const ad = c.net.getState().rooms[0];
    if (!ad) throw new Error('room not found');
    c.net.join(ad.id, c.name);
    for (let i = 0; i < 40 && c.net.getState().phase !== 'lobby'; i++) pump(lan, 50);
    if (c.net.getState().phase !== 'lobby') throw new Error(`${c.name} did not reach the lobby: ${errors(c).join(',')}`);
  }
  return [host, ...clients];
}

export function startRoom(lan: Lan, peers: TestPeer[]): void {
  const [host, ...clients] = peers;
  for (const c of clients) c.net.setMe({ ready: true });
  for (let i = 0; i < 40 && !host.net.getState().room?.canStart; i++) pump(lan, 50);
  if (!host.net.getState().room?.canStart) throw new Error('cannot start');
  host.net.startMatch();
  for (let i = 0; i < 40 && peers.some((p) => !p.match); i++) pump(lan, 50);
  for (const p of peers) if (!p.match) throw new Error(`${p.name} did not start`);
}
