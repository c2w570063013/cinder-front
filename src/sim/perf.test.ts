import { describe, expect, it } from 'vitest';
import { Terrain } from '../core/types';
import type { Command } from '../core/types';
import { makeRng } from '../core/rng';
import { spawnUnit } from './entities';
import { sim } from './index';
import { getSim } from './state';
import { fillRect, makeMap, makeSetup, oreRect } from './testmap';

const H = ['h_warden', 'h_warden', 'h_breacher', 'h_javelin', 'h_javelin', 'h_ranger', 'h_farstrike', 'h_skyveil', 'h_arbiter', 'h_kestrel'];
const F = ['f_militia', 'f_militia', 'f_grenadier', 'f_hammer', 'f_hammer', 'f_jackal', 'f_hailstorm', 'f_flakcrawler', 'f_salamander', 'f_vulture'];

function setup(sameTeam: boolean) {
  const map = makeMap(96, 96, [{ x: 4, y: 4 }, { x: 91, y: 91 }]);
  const rng = makeRng(7);
  for (let i = 0; i < 60; i++) {
    const x = rng.int(12, 82);
    const y = rng.int(12, 82);
    fillRect(map, x, y, x + rng.int(0, 3), y + rng.int(0, 3), rng.chance(0.5) ? Terrain.Rock : Terrain.Tree);
  }
  fillRect(map, 30, 46, 64, 48, Terrain.Water); // a river that has to be walked around
  oreRect(map, 10, 80, 16, 86);
  const gs = makeSetup(map, ['helion', 'ferrum'], { fog: true });
  if (sameTeam) gs.players[1].team = gs.players[0].team;
  const world = sim.createWorld(gs);
  const S = getSim(world);
  const ids: number[][] = [[], []];
  for (let side = 0; side < 2; side++) {
    const defs = side === 0 ? H : F;
    let placed = 0;
    for (let k = 0; placed < 150 && k < 2000; k++) {
      const x = 36.5 + (k % 25);
      const y = side === 0 ? 12.5 + Math.floor(k / 25) : 83.5 - Math.floor(k / 25);
      if (S.blocked[(y | 0) * 96 + (x | 0)]) continue;
      ids[side].push(spawnUnit(world, S, defs[placed % defs.length], side, x, y).id);
      placed++;
    }
  }
  return { world, ids };
}

const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return { avg: a.reduce((x, y) => x + y, 0) / a.length, p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1] };
};
const f = (n: number) => n.toFixed(3);

describe('performance', () => {
  it('300 mixed units on a 96×96 map average well under 4 ms per step', () => {
    // warm the JIT so the numbers reflect steady state
    {
      const { world, ids } = setup(false);
      sim.step(world, [{ type: 'attackMove', player: 0, ids: ids[0], x: 48, y: 44 }, { type: 'attackMove', player: 1, ids: ids[1], x: 48, y: 51 }]);
      for (let t = 0; t < 300; t++) sim.step(world, []);
    }

    // A) marching only (allied sides, nobody dies): all 300 units ordered at once, twice
    const march = setup(true);
    const mt: number[] = [];
    const orderTicks: number[] = [];
    for (let t = 0; t < 800; t++) {
      const cmds: Command[] = [];
      if (t % 400 === 0) {
        cmds.push({ type: 'move', player: 0, ids: march.ids[0], x: 48, y: t === 0 ? 80 : 14 });
        cmds.push({ type: 'move', player: 1, ids: march.ids[1], x: 48, y: t === 0 ? 14 : 80 });
      }
      const t0 = performance.now();
      sim.step(march.world, cmds);
      const dt = performance.now() - t0;
      mt.push(dt);
      if (cmds.length) orderTicks.push(dt);
    }
    expect(march.world.entities.size).toBe(311); // 300 + both starting forces
    const moving = [...march.world.entities.values()].filter((e) => Math.abs(e.y - 48) < 40).length;
    expect(moving).toBeGreaterThan(250);
    const a = stats(mt);

    // B) a full-on battle: measure while at least 150 units are still alive
    const fight = setup(false);
    const ft: number[] = [];
    let fired = 0;
    for (let t = 0; t < 1500; t++) {
      const cmds: Command[] = [];
      if (t === 0) {
        cmds.push({ type: 'attackMove', player: 0, ids: fight.ids[0], x: 48, y: 44 });
        cmds.push({ type: 'attackMove', player: 1, ids: fight.ids[1], x: 48, y: 51 });
      }
      const t0 = performance.now();
      sim.step(fight.world, cmds);
      const dt = performance.now() - t0;
      if (fight.world.entities.size >= 150) ft.push(dt);
      for (const ev of fight.world.events) if (ev.type === 'weaponFired') fired++;
    }
    const b = stats(ft);
    console.log(
      `perf (300 units, 96×96): march avg ${f(a.avg)} ms, p99 ${f(a.p99)}, max ${f(a.max)}, mass-order ticks ${orderTicks.map(f).join(' / ')} ms | ` +
        `battle avg ${f(b.avg)} ms over ${ft.length} ticks, p99 ${f(b.p99)}, max ${f(b.max)}, shots ${fired}, survivors ${fight.world.entities.size}`,
    );
    expect(fired).toBeGreaterThan(500); // they really fought
    expect(a.avg).toBeLessThan(2);
    expect(b.avg).toBeLessThan(2);
    // p99 / max are logged, not asserted: other sessions and test files share this machine's cores
  });
});
