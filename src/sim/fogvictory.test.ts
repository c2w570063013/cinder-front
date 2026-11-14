import { describe, expect, it } from 'vitest';
import type { Command } from '../core/types';
import { sim } from './index';
import { makeMap, makeSetup } from './testmap';
import { alive, building, find, has, run, runUntil, scenario, unit } from './testutil';

describe('fog of war', () => {
  it('reveals around own entities, remembers explored tiles, hides what is out of sight', () => {
    const sc = scenario();
    const p = sc.world.players[0];
    const at = (x: number, y: number) => y * 40 + x;
    expect(p.visible[at(2, 2)]).toBe(1); // around the base vehicle
    expect(p.visible[at(20, 20)]).toBe(0);
    expect(p.explored[at(20, 20)]).toBe(0);
    const scout = unit(sc, 'h_ranger', 0, 8.5, 8.5);
    run(sc, 1, [{ type: 'move', player: 0, ids: [scout.id], x: 20.5, y: 20.5 }]);
    runUntil(sc, 300, () => scout.order === null);
    run(sc, 5);
    expect(p.visible[at(20, 20)]).toBe(1);
    expect(p.visible[at(27, 20)]).toBe(1); // sight 9
    expect(p.visible[at(32, 20)]).toBe(0);
    run(sc, 1, [{ type: 'move', player: 0, ids: [scout.id], x: 8.5, y: 30.5 }]);
    runUntil(sc, 300, () => scout.order === null);
    run(sc, 5);
    expect(p.visible[at(27, 20)]).toBe(0);
    expect(p.explored[at(27, 20)]).toBe(1);
    // the enemy sees none of this
    expect(sc.world.players[1].visible[at(8, 30)]).toBe(0);
  });

  it('units do not auto-target what their team cannot see; a spotter fixes that', () => {
    const sc = scenario();
    const art = unit(sc, 'h_farstrike', 0, 10.5, 20.5); // range 13, sight 7
    const prey = unit(sc, 'f_hauler', 1, 21.5, 20.5);
    art.order = { type: 'guard' };
    run(sc, 120);
    expect(art.lastFireTick).toBe(-1);
    expect(prey.hp).toBe(prey.maxHp);
    const spotter = unit(sc, 'h_ranger', 0, 15.5, 24.5); // sight 9, weapon range 5 → cannot shoot it itself
    spotter.order = { type: 'guard' };
    expect(runUntil(sc, 300, () => prey.hp < prey.maxHp)).toBe(true);
    expect(art.lastFireTick).toBeGreaterThan(0);
  });

  it('fog off: everything visible and explored; teammates share vision', () => {
    const open = scenario(undefined, { fog: false });
    expect(open.world.players[0].visible.every((v) => v === 1)).toBe(true);
    expect(open.world.players[1].explored.every((v) => v === 1)).toBe(true);

    const map = makeMap(40, 40, [{ x: 3, y: 3 }, { x: 36, y: 3 }, { x: 20, y: 36 }]);
    const setup = makeSetup(map, ['helion', 'ferrum', 'ferrum']);
    setup.players[1].team = 0;
    setup.players[2].team = 1;
    const w = sim.createWorld(setup);
    sim.step(w, []);
    expect(w.players[0].visible[3 * 40 + 36]).toBe(1); // sees the ally's start
    expect(w.players[1].visible[3 * 40 + 3]).toBe(1);
    expect(w.players[2].visible[3 * 40 + 3]).toBe(0);
    expect(sim.isEnemy(w, 0, 1)).toBe(false);
    expect(sim.isEnemy(w, 0, 2)).toBe(true);
    // allies never shoot each other
    for (let i = 0; i < 100; i++) sim.step(w, []);
    expect([...w.entities.values()].every((e) => e.hp === e.maxHp)).toBe(true);
  });
});

describe('victory', () => {
  it('short game: losing every building (with no base vehicle) defeats the player', () => {
    const sc = scenario(undefined, { fog: false });
    const core = building(sc, 'f_core', 1, 20, 20);
    const crawler = find(sc, 'f_crawler', 1)!;
    const straggler = unit(sc, 'f_militia', 1, 30.5, 10.5);
    building(sc, 'h_nexus', 0, 6, 6);
    crawler.hp = 1;
    core.hp = 1;
    const a = unit(sc, 'h_javelin', 0, 34.5, 34.5);
    run(sc, 1, [{ type: 'attack', player: 0, ids: [a.id], targetId: crawler.id }]);
    expect(runUntil(sc, 300, () => !alive(sc, crawler))).toBe(true);
    expect(sc.world.players[1].defeated).toBe(false); // still has the core
    run(sc, 1, [{ type: 'attack', player: 0, ids: [a.id], targetId: core.id }]);
    expect(runUntil(sc, 900, () => sc.world.winnerTeam !== null)).toBe(true);
    expect(sc.world.winnerTeam).toBe(0);
    expect(sc.world.players[1].defeated).toBe(true);
    expect(sc.events.some((e) => e.type === 'playerDefeated' && e.player === 1)).toBe(true);
    expect(sc.events.filter((e) => e.type === 'gameOver').length).toBe(1);
    expect(alive(sc, straggler)).toBe(false); // leftovers are destroyed
    expect(sc.world.players[1].stats.buildingsLost).toBe(1);
    run(sc, 50); // keeps simulating peacefully afterwards
    expect(sc.events.filter((e) => e.type === 'gameOver').length).toBe(1);
  });

  it('long game: units keep a player alive until the last one falls', () => {
    const sc = scenario(undefined, { fog: false, shortGame: false });
    const crawler = find(sc, 'f_crawler', 1)!;
    const last = unit(sc, 'f_militia', 1, 30.5, 10.5);
    crawler.hp = 1;
    last.hp = 1;
    const a = unit(sc, 'h_javelin', 0, 34.5, 34.5);
    run(sc, 1, [{ type: 'attack', player: 0, ids: [a.id], targetId: crawler.id }]);
    expect(runUntil(sc, 300, () => !alive(sc, crawler))).toBe(true);
    run(sc, 5);
    expect(sc.world.players[1].defeated).toBe(false);
    run(sc, 1, [{ type: 'attack', player: 0, ids: [a.id], targetId: last.id }]);
    expect(runUntil(sc, 900, () => sc.world.winnerTeam === 0)).toBe(true);
  });

  it('surrender ends the game for the other team', () => {
    const sc = scenario();
    run(sc, 1, [{ type: 'surrender', player: 0 }]);
    expect(sc.world.players[0].defeated).toBe(true);
    expect(sc.world.winnerTeam).toBe(1);
    expect(has(sc, 'gameOver')).toBe(true);
    expect([...sc.world.entities.values()].some((e) => e.owner === 0)).toBe(false);
  });
});

describe('robustness', () => {
  it('ignores invalid, foreign and garbage commands without throwing', () => {
    const sc = scenario();
    const mine = unit(sc, 'h_javelin', 0, 10.5, 10.5);
    const theirs = unit(sc, 'f_hammer', 1, 30.5, 30.5);
    const bld = building(sc, 'f_power', 1, 30, 26);
    const junk = [
      { type: 'move', player: 0, ids: [theirs.id, 9999, -1, 'x'], x: 5, y: 5 },
      { type: 'move', player: 0, ids: [mine.id], x: NaN, y: 5 },
      { type: 'move', player: 7, ids: [mine.id], x: 5, y: 5 },
      { type: 'move', player: 0, ids: null, x: 5, y: 5 },
      { type: 'attack', player: 0, ids: [mine.id], targetId: mine.id },
      { type: 'attack', player: 0, ids: [mine.id], targetId: 424242 },
      { type: 'harvest', player: 0, ids: [mine.id], tx: 5, ty: 5 },
      { type: 'dock', player: 0, ids: [mine.id], targetId: bld.id },
      { type: 'capture', player: 0, ids: [mine.id], targetId: bld.id },
      { type: 'deploy', player: 0, ids: [mine.id] },
      { type: 'produce', player: 0, defId: 'f_militia' },
      { type: 'produce', player: 0, defId: 'does_not_exist' },
      { type: 'produce', player: 0, defId: 'h_uplink' },
      { type: 'cancelProduction', player: 0, defId: 'h_power' },
      { type: 'resumeProduction', player: 0, category: 'bogus' },
      { type: 'placeBuilding', player: 0, defId: 'h_power', tx: 10, ty: 10 },
      { type: 'placeBuilding', player: 0, defId: 'h_warden', tx: 10, ty: 10 },
      { type: 'sell', player: 0, buildingId: bld.id },
      { type: 'sell', player: 0, buildingId: mine.id },
      { type: 'toggleRepair', player: 0, buildingId: bld.id },
      { type: 'setRally', player: 0, buildingId: bld.id, x: 1, y: 1 },
      { type: 'setPrimary', player: 0, buildingId: bld.id },
      { type: 'usePower', player: 0, power: 'orbital_lance', x: 30, y: 30 },
      { type: 'usePower', player: 0, power: 'nope', x: 30, y: 30 },
      { type: 'what' },
      null,
      { type: 'move', player: 0, ids: [mine.id], x: 1e9, y: -1e9 },
    ] as unknown as Command[];
    expect(() => run(sc, 1, junk)).not.toThrow();
    expect(theirs.order).toBeNull();
    expect(alive(sc, bld)).toBe(true);
    expect(bld.owner).toBe(1);
    expect(sc.world.players[0].credits).toBe(10000);
    expect(sc.world.players[0].queues.structure.items.length).toBe(0);
    expect(() => run(sc, 200)).not.toThrow();
    expect(mine.x).toBeGreaterThanOrEqual(0);
    expect(mine.y).toBeGreaterThanOrEqual(0);
    // dead entities vanish the tick they die and nobody keeps pointing at them
    const prey = unit(sc, 'f_militia', 1, mine.x + 3, mine.y);
    prey.hp = 1;
    runUntil(sc, 200, () => !alive(sc, prey));
    for (const e of sc.world.entities.values()) expect(e.targetId === null || sc.world.entities.has(e.targetId)).toBe(true);
    expect(typeof sim.hashWorld(sc.world)).toBe('number');
  });
});
