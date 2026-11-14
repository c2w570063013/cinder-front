// Headless AI-vs-AI match runner, shared by the tests and the dev page. The sim is passed in so this
// file (like the rest of src/ai) never imports src/sim.
import type { MapInfo, SimApi } from '../core/api';
import { TICK_RATE } from '../core/constants';
import type { Command, Difficulty, FactionId, World } from '../core/types';
import { BUILDINGS, UNITS } from '../data';
import { createAi } from './index';

export interface MatchPlayer {
  faction: FactionId;
  difficulty: Difficulty;
}

export interface MatchSample {
  tick: number;
  credits: number;
  buildings: number;
  harvesters: number;
  armyValue: number;
}

export interface MatchResult {
  world: World;
  ticks: number;
  winnerTeam: number | null;
  /** Average milliseconds spent in think() per AI per tick. */
  thinkMsAvg: number;
  thinkMsMax: number;
  /** Per player: every distinct building def ever owned. */
  everBuilt: Set<string>[];
  maxArmyValue: number[];
  maxHarvesters: number[];
  /** Commands issued per player by type. */
  commands: Record<string, number>[];
  samples: MatchSample[][];
  /** Per player: units lost by distance from the own start (home < 20 tiles, mid < 40, far). */
  unitDeaths: Record<string, number>[];
  /** Per player: the AI's decision log. */
  logs: string[][];
}

export function runMatch(sim: SimApi, info: MapInfo, seed: number, players: MatchPlayer[], maxTicks: number, opts?: { startingCredits?: number; superweapons?: boolean; fog?: boolean }): MatchResult {
  const colors = ['#3fa7ff', '#ff8a2a', '#b08cff', '#7bd148'];
  const world = sim.createWorld({
    map: info.generate(seed),
    seed,
    players: players.map((p, k) => ({ name: `AI${k}-${p.difficulty}`, faction: p.faction, color: colors[k % 4], team: k, controller: 'ai', difficulty: p.difficulty, startIndex: k })),
    startingCredits: opts?.startingCredits ?? 10000,
    options: { fog: opts?.fog ?? true, shortGame: true, superweapons: opts?.superweapons ?? true },
  });
  const ais = players.map((p, k) => createAi(k, p.difficulty, seed * 7919 + k, sim));
  const everBuilt = players.map(() => new Set<string>());
  const maxArmyValue = players.map(() => 0);
  const maxHarvesters = players.map(() => 0);
  const commands: Record<string, number>[] = players.map(() => ({}));
  const samples: MatchSample[][] = players.map(() => []);
  const unitDeaths: Record<string, number>[] = players.map(() => ({}));
  let thinkMs = 0;
  let thinkN = 0;
  let thinkMax = 0;
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
  while (world.tick < maxTicks && world.winnerTeam === null) {
    const cmds: Command[] = [];
    for (let k = 0; k < ais.length; k++) {
      const t0 = now();
      const out = ais[k].think(world);
      const dt = now() - t0;
      thinkMs += dt;
      thinkN++;
      if (dt > thinkMax) thinkMax = dt;
      for (const c of out) {
        cmds.push(c);
        commands[k][c.type] = (commands[k][c.type] ?? 0) + 1;
      }
    }
    sim.step(world, cmds);
    for (const ev of world.events) {
      if (ev.type !== 'entityDestroyed' || ev.kind !== 'unit') continue;
      const st = world.map.starts[ev.owner];
      const d = Math.hypot(ev.x - st.x, ev.y - st.y);
      const bucket = d < 20 ? 'home' : d < 40 ? 'mid' : 'far';
      unitDeaths[ev.owner][bucket] = (unitDeaths[ev.owner][bucket] ?? 0) + 1;
      const key = `${ev.defId}@${bucket}`;
      unitDeaths[ev.owner][key] = (unitDeaths[ev.owner][key] ?? 0) + 1;
    }
    if (world.tick % (5 * TICK_RATE) === 0) {
      const army = players.map(() => 0);
      const harv = players.map(() => 0);
      const blds = players.map(() => 0);
      for (const e of world.entities.values()) {
        if (e.kind === 'building') {
          blds[e.owner]++;
          if (BUILDINGS[e.defId]) everBuilt[e.owner].add(e.defId);
        } else {
          const d = UNITS[e.defId];
          if (d?.harvester) harv[e.owner]++;
          else if (d?.weapon) army[e.owner] += d.cost;
        }
      }
      for (let k = 0; k < players.length; k++) {
        maxArmyValue[k] = Math.max(maxArmyValue[k], army[k]);
        maxHarvesters[k] = Math.max(maxHarvesters[k], harv[k]);
        if (world.tick % (60 * TICK_RATE) === 0) samples[k].push({ tick: world.tick, credits: Math.floor(world.players[k].credits), buildings: blds[k], harvesters: harv[k], armyValue: army[k] });
      }
    }
  }
  return { world, ticks: world.tick, winnerTeam: world.winnerTeam, thinkMsAvg: thinkMs / Math.max(1, thinkN), thinkMsMax: thinkMax, everBuilt, maxArmyValue, maxHarvesters, commands, samples, unitDeaths, logs: ais.map((a) => (a as { log?: string[] }).log ?? []) };
}
