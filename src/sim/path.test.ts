import { describe, expect, it } from 'vitest';
import { Terrain } from '../core/types';
import { sim } from './index';
import { getSim, type SimEntity } from './state';
import { fillRect, makeMap } from './testmap';
import { alive, run, runUntil, scenario, unit } from './testutil';

const corners = [{ x: 2, y: 2 }, { x: 37, y: 37 }];

describe('pathfinding & movement', () => {
  it('walks around a wall through the only gap', () => {
    const map = makeMap(40, 40, corners);
    fillRect(map, 0, 20, 33, 20, Terrain.Rock); // gap at x 34..39
    const sc = scenario(map);
    const u = unit(sc, 'h_ranger', 0, 6.5, 12.5);
    const S = getSim(sc.world);
    let onBlocked = false;
    sim.step(sc.world, [{ type: 'move', player: 0, ids: [u.id], x: 6.5, y: 28.5 }]);
    for (let i = 0; i < 900 && u.order !== null; i++) {
      sim.step(sc.world, []);
      if (S.blocked[(u.y | 0) * S.w + (u.x | 0)]) onBlocked = true;
    }
    expect(onBlocked).toBe(false);
    expect(u.order).toBeNull();
    expect(Math.hypot(u.x - 6.5, u.y - 28.5)).toBeLessThan(0.3);
    // previous-tick position is maintained for interpolation
    expect(u.px).toBeCloseTo(u.x, 5);
  });

  it('stops at the nearest reachable tile when the goal is walled in or blocked', () => {
    const map = makeMap(40, 40, corners);
    fillRect(map, 20, 20, 26, 26, Terrain.Rock);
    fillRect(map, 22, 22, 24, 24, Terrain.Ground); // sealed pocket
    const sc = scenario(map);
    const a = unit(sc, 'h_ranger', 0, 10.5, 23.5);
    const b = unit(sc, 'h_ranger', 0, 10.5, 12.5);
    run(sc, 1, [
      { type: 'move', player: 0, ids: [a.id], x: 23.5, y: 23.5 }, // inside the pocket
      { type: 'move', player: 0, ids: [b.id], x: 20.5, y: 20.5 }, // on rock
    ]);
    expect(runUntil(sc, 600, () => a.order === null && b.order === null)).toBe(true);
    expect(sim.isPassable(sc.world, Math.floor(a.x), Math.floor(a.y), 'wheel')).toBe(true);
    expect(a.x > 21.9 && a.x < 25.1 && a.y > 21.9 && a.y < 25.1).toBe(false); // never inside the pocket
    expect(Math.hypot(a.x - 23.5, a.y - 23.5)).toBeLessThan(5);
    expect(Math.hypot(b.x - 20.5, b.y - 20.5)).toBeLessThan(1.6);
    expect(sim.isPassable(sc.world, 20, 20, 'track')).toBe(false);
    expect(sim.isPassable(sc.world, 20, 20, 'air')).toBe(true);
  });

  it('spreads a group into a formation without stacking', () => {
    const sc = scenario();
    const us: SimEntity[] = [];
    for (let i = 0; i < 24; i++) us.push(unit(sc, i % 2 ? 'h_javelin' : 'h_warden', 0, 8.5 + (i % 6), 8.5 + Math.floor(i / 6)));
    run(sc, 1, [{ type: 'move', player: 0, ids: us.map((u) => u.id), x: 25.5, y: 22.5 }]);
    expect(runUntil(sc, 900, () => us.every((u) => u.order === null))).toBe(true);
    run(sc, 40);
    let minGap = Infinity;
    for (let i = 0; i < us.length; i++) {
      expect(alive(sc, us[i])).toBe(true);
      expect(Math.hypot(us[i].x - 25.5, us[i].y - 22.5)).toBeLessThan(6);
      for (let j = i + 1; j < us.length; j++) {
        const gap = Math.hypot(us[i].x - us[j].x, us[i].y - us[j].y) - (us[i].r + us[j].r);
        if (gap < minGap) minGap = gap;
      }
    }
    expect(minGap).toBeGreaterThan(-0.08);
  });

  it('terrain changes speed: roads are faster than rough for wheels', () => {
    const map = makeMap(40, 40, corners);
    fillRect(map, 5, 10, 30, 10, Terrain.Road);
    fillRect(map, 5, 14, 30, 14, Terrain.Rough);
    const sc = scenario(map);
    const a = unit(sc, 'h_ranger', 0, 6.5, 10.5);
    const b = unit(sc, 'h_ranger', 0, 6.5, 14.5);
    run(sc, 80, [
      { type: 'move', player: 0, ids: [a.id], x: 29.5, y: 10.5 },
      { type: 'move', player: 0, ids: [b.id], x: 29.5, y: 14.5 },
    ]);
    expect(a.x).toBeGreaterThan(b.x + 3);
  });

  it('aircraft fly straight over obstacles', () => {
    const map = makeMap(40, 40, corners);
    fillRect(map, 0, 20, 39, 20, Terrain.Water);
    const sc = scenario(map);
    const k = unit(sc, 'h_kestrel', 0, 10.5, 10.5);
    expect(k.altitude).toBeGreaterThan(1);
    run(sc, 1, [{ type: 'move', player: 0, ids: [k.id], x: 10.5, y: 30.5 }]);
    expect(runUntil(sc, 200, () => k.order === null)).toBe(true);
    expect(Math.hypot(k.x - 10.5, k.y - 30.5)).toBeLessThan(0.3);
  });

  it('budgets path requests: 160 units ordered at once all get going', () => {
    const map = makeMap(64, 64, [{ x: 2, y: 2 }, { x: 61, y: 61 }]);
    fillRect(map, 10, 30, 63, 30, Terrain.Rock);
    const sc = scenario(map);
    const us: SimEntity[] = [];
    for (let i = 0; i < 160; i++) us.push(unit(sc, 'h_warden', 0, 20.5 + (i % 16), 10.5 + Math.floor(i / 16)));
    run(sc, 1, [{ type: 'move', player: 0, ids: us.map((u) => u.id), x: 40.5, y: 45.5 }]);
    run(sc, 40);
    expect(us.filter((u) => u.path !== null).length).toBe(160);
    expect(getSim(sc.world).pathQueue.length).toBe(0);
  });
});
