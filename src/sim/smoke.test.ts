import { describe, expect, it } from 'vitest';
import type { Command } from '../core/types';
import { sim } from './index';
import { makeMap, makeSetup, oreRect } from './testmap';

function run(ticks: number) {
  const map = makeMap(48, 48);
  oreRect(map, 14, 6, 18, 10);
  const world = sim.createWorld(makeSetup(map));
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const cmds: Command[] = [];
    if (t === 1) for (const e of world.entities.values()) if (e.defId.endsWith('crawler')) cmds.push({ type: 'deploy', player: e.owner, ids: [e.id] });
    if (t === 60) cmds.push({ type: 'produce', player: 0, defId: 'h_power' });
    if (t === 300) {
      const c = [...world.entities.values()].find((e) => e.defId === 'h_nexus')!;
      cmds.push({ type: 'placeBuilding', player: 0, defId: 'h_power', tx: Math.round(c.x + 2.5), ty: Math.round(c.y - 1.5) });
    }
    if (t === 400) {
      const ids = [...world.entities.values()].filter((e) => e.owner === 1 && e.kind === 'unit').map((e) => e.id);
      cmds.push({ type: 'attackMove', player: 1, ids, x: 9, y: 9 });
    }
    sim.step(world, cmds);
    if (t % 100 === 0) hashes.push(sim.hashWorld(world));
  }
  return { world, hashes };
}

describe('sim smoke', () => {
  it('deploys, builds, fights and stays deterministic', () => {
    const a = run(1500);
    const b = run(1500);
    expect(a.hashes).toEqual(b.hashes);
    const defs = [...a.world.entities.values()].map((e) => e.defId);
    expect(a.world.tick).toBe(1500);
    expect(defs.includes('h_nexus') || a.world.winnerTeam !== null).toBe(true);
    expect(a.world.players[0].stats.buildingsBuilt).toBeGreaterThanOrEqual(1);
  });
});
