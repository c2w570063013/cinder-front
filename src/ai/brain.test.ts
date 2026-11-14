// Controller tests on hand-made worlds with a fake SimApi (no src/sim involved).
import { describe, expect, it } from 'vitest';
import type { Command, FactionId, World } from '../core/types';
import { BUILDINGS, UNITS } from '../data';
import { createAi } from './index';
import { factionInfo } from './knowledge';
import { findPlacement, OreGrid, rectGap, rectOf } from './placement';
import { addEntity, baseVehicleOf, fakeSim, makeWorld, reveal } from './testkit';

const FACTIONS: FactionId[] = ['helion', 'ferrum'];

/** Every entity id a command refers to. */
function idsOf(c: Command): number[] {
  if ('ids' in c) return c.ids;
  if ('buildingId' in c) return [c.buildingId];
  return [];
}

/** Assert the AI only ever commands its own living entities. */
function assertOwnLiving(world: World, player: number, cmds: Command[]): void {
  for (const c of cmds) {
    expect(c.player).toBe(player);
    for (const id of idsOf(c)) {
      const e = world.entities.get(id);
      if (!e || e.owner !== player) throw new Error(`command ${c.type} for dead/foreign entity ${id}`);
    }
  }
}

describe('opening', () => {
  for (const f of FACTIONS) {
    it(`${f}: deploys the base vehicle on the very first think`, () => {
      const world = makeWorld([f, 'ferrum']);
      const v = addEntity(world, baseVehicleOf(f), 0, 12.5, 12.5);
      const ai = createAi(0, 'normal', 1, fakeSim());
      const cmds = ai.think(world);
      expect(cmds).toContainEqual({ type: 'deploy', player: 0, ids: [v.id] });
    });
  }

  it('moves a little and retries when the deploy does not take', () => {
    const world = makeWorld();
    const v = addEntity(world, baseVehicleOf('helion'), 0, 12.5, 12.5);
    const ai = createAi(0, 'normal', 1, fakeSim());
    const seen: string[] = [];
    for (let t = 0; t < 600; t++) {
      world.tick = t;
      for (const c of ai.think(world)) {
        seen.push(c.type);
        if (c.type === 'move') {
          // The fake vehicle "arrives" instantly.
          v.x = c.x;
          v.y = c.y;
          expect(Math.hypot(c.x - 12.5, c.y - 12.5)).toBeLessThan(11);
        }
      }
    }
    const firstMove = seen.indexOf('move');
    expect(seen[0]).toBe('deploy');
    expect(firstMove).toBeGreaterThan(0);
    expect(seen.slice(firstMove).filter((s) => s === 'deploy').length).toBeGreaterThan(1);
    expect(seen.every((s) => s === 'deploy' || s === 'move')).toBe(true);
  });
});

describe('build order and placement against the fake sim', () => {
  for (const f of FACTIONS) {
    for (const difficulty of ['normal', 'hard'] as const) {
      it(`${f}/${difficulty}: deploys, then builds a spaced-out, powered base in a sensible order`, () => {
        const world = makeWorld([f, 'ferrum']);
        world.players[0].credits = 60000;
        // Ore to the east of the start.
        for (let y = 10; y < 15; y++) for (let x = 22; x < 27; x++) world.map.ore[y * 64 + x] = 10;
        reveal(world, 0, 12.5, 12.5, 20);
        addEntity(world, baseVehicleOf(f), 0, 12.5, 12.5);
        const sim = fakeSim();
        const ai = createAi(0, difficulty, 7, sim);
        const info = factionInfo(f);
        let busyTicks = 0;
        for (let t = 0; t < 4000; t++) {
          const cmds = ai.think(world);
          assertOwnLiving(world, 0, cmds);
          if (cmds.length) busyTicks++;
          sim.step(world, cmds);
          expect(world.players[0].lowPower).toBe(false);
        }
        // Throttled: silent on the vast majority of ticks.
        expect(busyTicks).toBeLessThan(4000 * 0.2);
        const core = sim.placed.filter((id) => BUILDINGS[id].power <= 0 && BUILDINGS[id].category === 'structure');
        expect(sim.placed[0]).toBe(info.power[0].id);
        expect(core.slice(0, 3)).toEqual([info.refinery.id, info.barracks!.id, info.factory!.id]);
        for (const want of [info.radar!.id, info.airpad!.id, info.tech[0].id, info.superweapon!.id]) expect(sim.placed).toContain(want);
        expect(sim.placed.filter((id) => id === info.refinery.id).length).toBeGreaterThanOrEqual(2);
        expect(sim.placed.some((id) => BUILDINGS[id].category === 'defense')).toBe(true);

        // No two buildings touch (units can path between them), and production/refineries get extra room.
        const mine = [...world.entities.values()].filter((e) => e.owner === 0 && e.kind === 'building');
        for (let a = 0; a < mine.length; a++) {
          for (let b = a + 1; b < mine.length; b++) {
            const ra = rectOf(mine[a]);
            const rb = rectOf(mine[b]);
            expect(rectGap(ra, rb)).toBeGreaterThanOrEqual(ra.roomy || rb.roomy ? 2 : 1);
          }
        }
        // The first refinery went toward the ore; nothing was built on or right next to the field.
        const firstRef = mine.find((e) => e.defId === info.refinery.id)!;
        expect(firstRef.x).toBeGreaterThan(13);
        for (const e of mine) {
          const r = rectOf(e);
          for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) expect(world.map.ore[y * 64 + x]).toBe(0);
        }
        // Harvesters, an army and aircraft were produced.
        const units = [...world.entities.values()].filter((e) => e.owner === 0 && e.kind === 'unit');
        expect(units.filter((u) => UNITS[u.defId].harvester).length).toBeGreaterThanOrEqual(4);
        expect(units.filter((u) => UNITS[u.defId].weapon).length).toBeGreaterThan(8);
        expect(units.some((u) => UNITS[u.defId].category === 'aircraft')).toBe(true);
      });
    }
  }

  it('easy builds slowly and stays low-tech', () => {
    const run = (difficulty: 'easy' | 'normal'): string[] => {
      const world = makeWorld();
      world.players[0].credits = 60000;
      reveal(world, 0, 12.5, 12.5, 20);
      addEntity(world, baseVehicleOf('helion'), 0, 12.5, 12.5);
      const sim = fakeSim();
      const ai = createAi(0, difficulty, 3, sim);
      for (let t = 0; t < 2400; t++) sim.step(world, ai.think(world));
      return sim.placed;
    };
    const easy = run('easy');
    const normal = run('normal');
    const info = factionInfo('helion');
    expect(easy.length).toBeLessThan(normal.length);
    expect(easy).not.toContain(info.superweapon!.id);
    expect(easy).not.toContain(info.airpad!.id);
  });
});

describe('placement search', () => {
  it('honours spacing, lanes and ore clearance, and returns null when nothing fits', () => {
    const world = makeWorld();
    const sim = fakeSim();
    const cy = addEntity(world, 'h_nexus', 0, 12.5, 12.5);
    const own = [rectOf(cy)];
    const res = findPlacement({ world, sim, player: 0, defId: 'h_power', own, anchor: { x: 12.5, y: 12.5 }, lanes: [], oreClearance: 1, skip: 0, maxChecks: 50 });
    expect(res.place).not.toBeNull();
    const r = { x: res.place!.tx, y: res.place!.ty, w: 2, h: 2, roomy: false };
    expect(rectGap(r, own[0])).toBeGreaterThanOrEqual(2); // the conyard produces → roomy
    expect(rectGap(r, own[0])).toBeLessThanOrEqual(3);
    // Surround the base with ore: nowhere legal.
    world.map.ore.fill(5);
    const none = findPlacement({ world, sim, player: 0, defId: 'h_power', own, anchor: { x: 12.5, y: 12.5 }, lanes: [], oreClearance: 1, skip: 0, maxChecks: 50 });
    expect(none.place).toBeNull();
  });

  it('keeps the harvester lane between refinery and ore open', () => {
    const world = makeWorld();
    const sim = fakeSim();
    const cy = addEntity(world, 'h_nexus', 0, 12.5, 12.5);
    const lane = { x0: 12.5, y0: 12.5, x1: 30, y1: 12.5 };
    const res = findPlacement({ world, sim, player: 0, defId: 'h_power', own: [rectOf(cy)], anchor: { x: 17, y: 12.5 }, lanes: [lane], oreClearance: 1, skip: 0, maxChecks: 50 });
    expect(res.place).not.toBeNull();
    const cyTile = res.place!.ty + 1;
    expect(Math.abs(cyTile - 12.5)).toBeGreaterThan(2.5);
  });

  it('summarises ore fields, limited to explored tiles when asked', () => {
    const world = makeWorld();
    for (let y = 20; y < 24; y++) for (let x = 40; x < 44; x++) world.map.ore[y * 64 + x] = 8;
    const grid = new OreGrid();
    grid.update(world, null);
    expect(grid.sumWithin(42, 22, 6)).toBe(16 * 8);
    const near = grid.nearest(12, 12, 10)!;
    expect(Math.hypot(near.x - 42, near.y - 22)).toBeLessThan(4);
    expect(world.map.ore[near.ty * 64 + near.tx]).toBe(8);
    grid.update(world, world.players[0].explored); // nothing explored yet
    expect(grid.cells.length).toBe(0);
  });
});

describe('fog-limited knowledge and reactions', () => {
  const setup = (difficulty: 'easy' | 'normal' | 'hard' = 'normal') => {
    const world = makeWorld();
    const sim = fakeSim();
    addEntity(world, 'h_nexus', 0, 12.5, 12.5);
    addEntity(world, 'h_power', 0, 17, 12);
    addEntity(world, 'h_refinery', 0, 12.5, 18.5);
    const army = [0, 1, 2, 3, 4, 5].map((k) => addEntity(world, 'h_javelin', 0, 18 + k, 20));
    reveal(world, 0, 12.5, 12.5, 14);
    const ai = createAi(0, difficulty, 5, sim) as ReturnType<typeof createAi> & { debug(): { seen: number; waves: number } };
    return { world, sim, ai, army };
  };

  it('remembers only enemy buildings it has actually seen', () => {
    const { world, ai } = setup();
    const enemy = addEntity(world, 'f_core', 1, 50.5, 50.5);
    ai.think(world);
    expect(ai.debug().seen).toBe(0);
    reveal(world, 0, 50.5, 50.5, 4);
    world.tick = 10;
    ai.think(world);
    expect(ai.debug().seen).toBe(1);
    // Destroyed while we are watching → forgotten.
    world.entities.delete(enemy.id);
    world.tick = 20;
    ai.think(world);
    expect(ai.debug().seen).toBe(0);
  });

  it('sends the garrison at enemies that show up at the base, and ignores invisible ones', () => {
    const { world, ai, army } = setup();
    const raider = addEntity(world, 'f_hammer', 1, 20.5, 14.5);
    const hidden = addEntity(world, 'f_hammer', 1, 60.5, 60.5); // out of sight
    const cmds = ai.think(world);
    const defend = cmds.find((c) => c.type === 'attackMove');
    expect(defend && defend.type === 'attackMove' && Math.hypot(defend.x - raider.x, defend.y - raider.y) < 3).toBe(true);
    if (defend && defend.type === 'attackMove') expect(defend.ids.sort()).toEqual(army.map((e) => e.id).sort());
    for (const c of cmds) if ('x' in c && 'y' in c) expect(Math.hypot(c.x - hidden.x, c.y - hidden.y)).toBeGreaterThan(20);
    assertOwnLiving(world, 0, cmds);
  });

  it('attacks in a wave once strong enough, at a remembered enemy building', () => {
    const { world, ai, army } = setup();
    const target = addEntity(world, 'f_refinery', 1, 50.5, 50.5);
    reveal(world, 0, 50.5, 50.5, 5);
    const all: Command[] = [];
    for (let t = 0; t < 9000; t++) {
      world.tick = t;
      for (const c of ai.think(world)) all.push(c);
    }
    expect(ai.debug().waves).toBeGreaterThanOrEqual(1);
    const toward = all.filter((c) => c.type === 'attackMove' && Math.hypot(c.x - target.x, c.y - target.y) < 2);
    expect(toward.length).toBeGreaterThan(0);
    assertOwnLiving(world, 0, all);
    expect(all.some((c) => 'ids' in c && c.ids.some((id) => army.some((e) => e.id === id)))).toBe(true);
  });

  it('does not attack before the first-attack time', () => {
    const { world, ai } = setup();
    addEntity(world, 'f_refinery', 1, 50.5, 50.5);
    reveal(world, 0, 50.5, 50.5, 5);
    for (let t = 0; t < 3000; t++) {
      world.tick = t;
      ai.think(world);
    }
    expect(ai.debug().waves).toBe(0);
  });

  it('fires a ready superweapon at the best known cluster, and repairs damaged buildings', () => {
    const { world, ai } = setup();
    addEntity(world, 'f_core', 1, 50.5, 50.5);
    addEntity(world, 'f_factory', 1, 54.5, 50.5);
    addEntity(world, 'f_power', 1, 30, 50); // a lone plant elsewhere
    reveal(world, 0, 50.5, 50.5, 8);
    reveal(world, 0, 30, 50, 3);
    world.players[0].powers.push({ id: 'orbital_lance', sourceId: 1, charge: 10, chargeMax: 10, ready: true });
    const hurt = [...world.entities.values()].find((e) => e.defId === 'h_power')!;
    hurt.hp = hurt.maxHp * 0.3;
    const all: Command[] = [];
    for (let t = 0; t < 200; t++) {
      world.tick = t;
      for (const c of ai.think(world)) all.push(c);
    }
    const strike = all.find((c) => c.type === 'usePower');
    expect(strike && strike.type === 'usePower' && strike.power === 'orbital_lance' && Math.hypot(strike.x - 52.5, strike.y - 50.5) < 4).toBe(true);
    expect(all).toContainEqual({ type: 'toggleRepair', player: 0, buildingId: hurt.id });
  });

  it('keeps quiet and never throws for a defeated or missing player', () => {
    const { world, ai } = setup();
    world.players[0].defeated = true;
    expect(ai.think(world)).toEqual([]);
    const ghost = createAi(7, 'hard', 1, fakeSim());
    expect(ghost.think(world)).toEqual([]);
  });

  it('is deterministic for a given seed', () => {
    const run = (): string => {
      const { world, ai } = setup('hard');
      addEntity(world, 'f_refinery', 1, 50.5, 50.5);
      reveal(world, 0, 50.5, 50.5, 5);
      const out: Command[] = [];
      for (let t = 0; t < 7000; t++) {
        world.tick = t;
        for (const c of ai.think(world)) out.push(c);
      }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});
