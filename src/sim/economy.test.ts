import { describe, expect, it } from 'vitest';
import { ORE_UNIT_VALUE } from '../core/constants';
import { makeMap, oreRect } from './testmap';
import { building, has, run, runUntil, scenario, unit } from './testutil';

const corners = [{ x: 2, y: 2 }, { x: 37, y: 37 }];

describe('economy', () => {
  it('runs the full harvest cycle and keeps cycling', () => {
    const map = makeMap(40, 40, corners);
    oreRect(map, 20, 10, 22, 12, 6);
    const sc = scenario(map, {}, 1000);
    const world = sc.world;
    building(sc, 'h_refinery', 0, 10, 10);
    const h = unit(sc, 'h_harvester', 0, 12.5, 15.5);
    const oreBefore = world.map.ore.reduce((a, b) => a + b, 0);
    run(sc, 1, [{ type: 'harvest', player: 0, ids: [h.id], tx: 20, ty: 10 }]);
    let sawHarvest = false;
    let sawUnload = false;
    for (let i = 0; i < 1200 && !has(sc, 'harvesterUnloaded'); i++) {
      run(sc, 1);
      if (h.action === 'harvest') sawHarvest = true;
      if (h.action === 'unload') sawUnload = true;
    }
    expect(sawHarvest).toBe(true);
    expect(sawUnload).toBe(true);
    expect(has(sc, 'harvesterUnloaded')).toBe(true);
    const cap = 20;
    expect(world.players[0].credits).toBe(1000 + cap * ORE_UNIT_VALUE);
    expect(world.players[0].stats.oreHarvested).toBe(cap * ORE_UNIT_VALUE);
    expect(oreBefore - world.map.ore.reduce((a, b) => a + b, 0)).toBe(cap);
    expect(h.cargo).toBe(0);
    // goes back out for more, re-targeting when tiles run dry
    const n1 = sc.events.filter((e) => e.type === 'harvesterUnloaded').length;
    runUntil(sc, 1500, () => sc.events.filter((e) => e.type === 'harvesterUnloaded').length > n1);
    expect(world.players[0].credits).toBeGreaterThan(1000 + cap * ORE_UNIT_VALUE);
    // setup map is untouched (the world owns a copy of the ore layer)
    expect(map.ore[10 * 40 + 20]).toBe(6);
  });

  it('auto-harvests with a null target, and waits when there is no refinery', () => {
    const map = makeMap(40, 40, corners);
    oreRect(map, 20, 20, 21, 21, 12);
    const sc = scenario(map, {}, 0);
    const h = unit(sc, 'f_hauler', 1, 18.5, 18.5);
    h.order = { type: 'harvest', tx: null, ty: null };
    run(sc, 700);
    expect(h.cargo).toBe(24);
    expect(sc.world.players[1].credits).toBe(0);
    const ref = building(sc, 'f_refinery', 1, 24, 14);
    expect(runUntil(sc, 600, () => has(sc, 'harvesterUnloaded'))).toBe(true);
    expect(sc.world.players[1].credits).toBe(24 * ORE_UNIT_VALUE);
    expect(ref.owner).toBe(1);
  });

  it('dock command unloads a partial load', () => {
    const map = makeMap(40, 40, corners);
    oreRect(map, 20, 10, 22, 12, 12);
    const sc = scenario(map, {}, 0);
    const ref = building(sc, 'h_refinery', 0, 10, 10);
    const h = unit(sc, 'h_harvester', 0, 20.5, 14.5);
    h.cargo = 5;
    run(sc, 1, [{ type: 'dock', player: 0, ids: [h.id], targetId: ref.id }]);
    expect(runUntil(sc, 600, () => has(sc, 'harvesterUnloaded'))).toBe(true);
    expect(sc.world.players[0].credits).toBe(5 * ORE_UNIT_VALUE);
    expect(h.order?.type).toBe('harvest');
  });

  it('ore slowly regrows next to rich tiles', () => {
    const map = makeMap(40, 40, corners);
    oreRect(map, 15, 15, 24, 24, 8);
    const sc = scenario(map);
    const before = sc.world.map.ore.reduce((a, b) => a + b, 0);
    run(sc, 3000);
    expect(sc.world.map.ore.reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
  });
});
