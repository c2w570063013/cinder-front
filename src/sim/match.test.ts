import { describe, expect, it } from 'vitest';
import { Terrain } from '../core/types';
import type { SimEvent, World } from '../core/types';
import { sim } from './index';
import { botCommands, type BotPlan } from './testbot';
import { fillRect, makeMap, makeSetup, oreRect } from './testmap';

const attacker: BotPlan = {
  build: ['h_power', 'h_refinery', 'h_barracks', 'h_factory', 'h_power'],
  units: { h_warden: 4, h_javelin: 6 },
  attackAt: 2600,
};
const defender: BotPlan = { build: ['f_power', 'f_barracks'], units: { f_militia: 5 }, attackAt: Infinity };

function newMatch(): World {
  const map = makeMap(48, 48, [{ x: 7, y: 7 }, { x: 40, y: 40 }]);
  oreRect(map, 14, 4, 18, 8, 10);
  oreRect(map, 30, 40, 34, 44, 10);
  fillRect(map, 20, 22, 27, 25, Terrain.Rock);
  fillRect(map, 10, 30, 14, 31, Terrain.Water);
  fillRect(map, 30, 14, 31, 18, Terrain.Tree);
  return sim.createWorld(makeSetup(map, ['helion', 'ferrum'], {}, 10000));
}

function tick(world: World): void {
  sim.step(world, [...botCommands(world, 0, attacker), ...botCommands(world, 1, defender)]);
}

describe('scripted mini match', () => {
  it('deploys, builds power → refinery → barracks → factory, trains an army and wins', () => {
    const world = newMatch();
    const seen = new Set<SimEvent['type']>();
    const built: string[] = [];
    let ticks = 0;
    while (world.winnerTeam === null && ticks < 12000) {
      tick(world);
      ticks++;
      for (const ev of world.events) {
        seen.add(ev.type);
        if (ev.type === 'buildingComplete' && ev.owner === 0) built.push(ev.defId);
      }
    }
    console.log(`mini match: game over at tick ${world.tick}, winner team ${world.winnerTeam}, P0 stats ${JSON.stringify(world.players[0].stats)}`);
    expect(built.slice(0, 5)).toEqual(['h_nexus', 'h_power', 'h_refinery', 'h_barracks', 'h_factory']);
    expect(world.winnerTeam).toBe(0);
    expect(world.players[1].defeated).toBe(true);
    expect(world.players[0].stats.unitsBuilt).toBeGreaterThanOrEqual(5);
    expect(world.players[0].stats.oreHarvested).toBeGreaterThan(0);
    expect(world.players[0].stats.kills).toBeGreaterThan(3);
    for (const t of ['unitDeployed', 'constructionReady', 'buildingPlaced', 'buildingComplete', 'unitReady', 'harvesterUnloaded', 'weaponFired', 'entityDestroyed', 'underAttack', 'playerDefeated', 'gameOver'] as const) {
      expect(seen.has(t), t).toBe(true);
    }
    expect([...world.entities.values()].some((e) => e.owner === 1)).toBe(false);
  });

  it('is deterministic: identical hashes every 100 ticks over 3000 ticks', () => {
    const run = (): number[] => {
      const world = newMatch();
      const hashes: number[] = [];
      for (let i = 1; i <= 3000; i++) {
        tick(world);
        if (i % 100 === 0) hashes.push(sim.hashWorld(world));
      }
      return hashes;
    };
    const a = run();
    const b = run();
    expect(a.length).toBe(30);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(30); // the world actually evolves
  });

  it('a different rng state diverges (the seeded rng is really in use)', () => {
    const w1 = newMatch();
    const w2 = newMatch();
    w2.rngState = 999;
    for (let i = 0; i < 400; i++) {
      tick(w1);
      tick(w2);
    }
    expect(sim.hashWorld(w1)).not.toBe(sim.hashWorld(w2));
  });
});
