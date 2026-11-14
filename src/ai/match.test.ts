// Headless AI-vs-AI matches on the real simulation.
import { describe, expect, it } from 'vitest';
import type { FactionId } from '../core/types';
import { MAPS } from '../maps/index';
import { sim } from '../sim/index';
import { factionInfo } from './knowledge';
import { runMatch, type MatchResult } from './match';

const TICK_BUDGET = 60000; // 50 minutes of game time
const SEEDS = [1, 2, 3, 4];
const thinkTimes: number[] = [];

function expectFullBase(r: MatchResult, k: number, faction: FactionId, tech: boolean): void {
  const info = factionInfo(faction);
  const built = r.everBuilt[k];
  // Deployed and built the core of a base.
  for (const id of [info.conyard.id, info.power[0].id, info.refinery.id, info.barracks!.id, info.factory!.id]) {
    if (!built.has(id)) throw new Error(`P${k} (${faction}) never built ${id}; had ${[...built].join(',')}`);
  }
  expect([...built].some((id) => info.groundDefenses.some((d) => d.id === id))).toBe(true);
  if (tech) expect(built.has(info.radar!.id)).toBe(true);
  // Harvested, fielded an army beyond the starting units, and issued attack orders.
  const p = r.world.players[k];
  expect(p.stats.oreHarvested).toBeGreaterThan(0);
  expect(p.stats.unitsBuilt).toBeGreaterThan(5);
  expect(r.maxArmyValue[k]).toBeGreaterThan(2500);
  expect(r.commands[k].deploy).toBeGreaterThanOrEqual(1);
  expect(r.commands[k].placeBuilding).toBeGreaterThanOrEqual(6);
  expect(r.commands[k].attackMove).toBeGreaterThan(0);
}

for (const mapId of ['cinder_pass', 'riven_fords']) {
  const info = MAPS.find((m) => m.id === mapId)!;
  for (const [fNormal, fEasy] of [
    ['helion', 'ferrum'],
    ['ferrum', 'helion'],
  ] as [FactionId, FactionId][]) {
    describe(`${mapId}: ${fNormal} normal vs ${fEasy} easy`, () => {
      const results: MatchResult[] = [];
      for (const seed of SEEDS) {
        it(`seed ${seed}: both sides play a full game and it ends`, () => {
          const r = runMatch(sim, info, seed, [{ faction: fNormal, difficulty: 'normal' }, { faction: fEasy, difficulty: 'easy' }], TICK_BUDGET);
          results.push(r);
          thinkTimes.push(r.thinkMsAvg);
          expectFullBase(r, 0, fNormal, true);
          // Easy may be overrun before it finishes its (deliberately slow) build-up; if it lived long enough, check it too.
          if (r.ticks > 9 * 60 * 20) expectFullBase(r, 1, fEasy, false);
          expect(r.logs[0].some((l) => l.includes('wave'))).toBe(true);
          expect(r.winnerTeam).not.toBeNull();
          expect(r.thinkMsAvg).toBeLessThan(0.3);
        });
      }
      it('normal wins most seeds', () => {
        const wins = results.filter((r) => r.winnerTeam === 0).length;
        console.log(`[ai] ${mapId} ${fNormal}/normal vs ${fEasy}/easy: normal won ${wins}/${results.length}; game length ${results.map((r) => (r.ticks / 1200).toFixed(1) + 'm').join(', ')}`);
        expect(results.length).toBe(SEEDS.length);
        expect(wins).toBeGreaterThan(results.length / 2);
      });
    });
  }
}

describe('other match-ups', () => {
  it('hard vs normal duel: both tech up, the game ends', () => {
    const info = MAPS.find((m) => m.id === 'cinder_pass')!;
    const r = runMatch(sim, info, 5, [{ faction: 'helion', difficulty: 'hard' }, { faction: 'ferrum', difficulty: 'normal' }], TICK_BUDGET);
    thinkTimes.push(r.thinkMsAvg);
    expectFullBase(r, 0, 'helion', true);
    expectFullBase(r, 1, 'ferrum', true);
    expect(r.winnerTeam).not.toBeNull();
    console.log(`[ai] hard vs normal: winner team ${r.winnerTeam} after ${(r.ticks / 1200).toFixed(1)} min`);
  });

  it('4-player free-for-all on a 96×96 map runs to a winner', () => {
    const info = MAPS.find((m) => m.id === 'cross_mesa')!;
    const r = runMatch(
      sim,
      info,
      2,
      [
        { faction: 'helion', difficulty: 'normal' },
        { faction: 'ferrum', difficulty: 'hard' },
        { faction: 'helion', difficulty: 'easy' },
        { faction: 'ferrum', difficulty: 'normal' },
      ],
      90000,
    );
    thinkTimes.push(r.thinkMsAvg);
    for (let k = 0; k < 4; k++) expect(r.everBuilt[k].size).toBeGreaterThanOrEqual(5);
    expect(r.winnerTeam).not.toBeNull();
    expect(r.thinkMsAvg).toBeLessThan(0.3);
    console.log(`[ai] 4-player FFA: winner team ${r.winnerTeam} after ${(r.ticks / 1200).toFixed(1)} min, think ${r.thinkMsAvg.toFixed(4)} ms avg / ${r.thinkMsMax.toFixed(2)} ms max`);
  });

  it('3-player map and the island map play through without errors', () => {
    for (const id of ['tri_crown', 'shard_isles']) {
      const info = MAPS.find((m) => m.id === id)!;
      const players = Array.from({ length: info.maxPlayers }, (_, k) => ({ faction: (k % 2 ? 'ferrum' : 'helion') as FactionId, difficulty: 'normal' as const }));
      const r = runMatch(sim, info, 3, players, 24000);
      thinkTimes.push(r.thinkMsAvg);
      for (let k = 0; k < players.length; k++) {
        expect(r.world.players[k].stats.oreHarvested).toBeGreaterThan(0);
        expect(r.everBuilt[k].size).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('matches are reproducible: same seed → identical world', () => {
    const info = MAPS.find((m) => m.id === 'cinder_pass')!;
    const players = [
      { faction: 'helion' as FactionId, difficulty: 'hard' as const },
      { faction: 'ferrum' as FactionId, difficulty: 'normal' as const },
    ];
    const a = runMatch(sim, info, 9, players, 8000);
    const b = runMatch(sim, info, 9, players, 8000);
    expect(sim.hashWorld(a.world)).toBe(sim.hashWorld(b.world));
    expect(a.commands).toEqual(b.commands);
  });

  it('reports think time', () => {
    const avg = thinkTimes.reduce((x, y) => x + y, 0) / Math.max(1, thinkTimes.length);
    console.log(`[ai] think() average over ${thinkTimes.length} matches: ${avg.toFixed(4)} ms per AI per tick (budget 0.3 ms)`);
    expect(avg).toBeLessThan(0.3);
  });
});
