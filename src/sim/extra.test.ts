import { describe, expect, it } from 'vitest';
import type { Entity } from '../core/types';
import { sim } from './index';
import { alive, building, find, has, run, runUntil, scenario, unit } from './testutil';

describe('unit behaviour details', () => {
  it('idle units chase a nearby enemy on a leash and then walk back', () => {
    const sc = scenario(undefined, { fog: false });
    const tank = unit(sc, 'h_javelin', 0, 15.5, 15.5); // range 5.5, notices up to +2
    const prey = unit(sc, 'f_hauler', 1, 22.5, 15.5); // edge distance ≈ 6.5
    prey.hp = 60;
    let maxX = tank.x;
    for (let i = 0; i < 400 && alive(sc, prey); i++) {
      run(sc, 1);
      maxX = Math.max(maxX, tank.x);
    }
    expect(alive(sc, prey)).toBe(false);
    expect(maxX).toBeGreaterThan(15.9); // it had to close in
    expect(runUntil(sc, 300, () => !tank.mv && Math.hypot(tank.x - 15.5, tank.y - 15.5) < 1.05)).toBe(true);
    // far-away enemies are left alone
    const far = unit(sc, 'f_hauler', 1, 30.5, 15.5);
    run(sc, 100);
    expect(far.hp).toBe(far.maxHp);
    expect(Math.hypot(tank.x - 15.5, tank.y - 15.5)).toBeLessThan(1.05);
  });

  it('shift-queued orders run one after another', () => {
    const sc = scenario();
    const r = unit(sc, 'h_ranger', 0, 10.5, 10.5);
    run(sc, 1, [
      { type: 'move', player: 0, ids: [r.id], x: 16.5, y: 10.5 },
      { type: 'move', player: 0, ids: [r.id], x: 16.5, y: 16.5, queue: true },
      { type: 'move', player: 0, ids: [r.id], x: 10.5, y: 16.5, queue: true },
    ]);
    expect(r.queue.length).toBe(2);
    let passedFirst = false;
    for (let i = 0; i < 600 && (r.order !== null || r.queue.length > 0); i++) {
      run(sc, 1);
      if (Math.hypot(r.x - 16.5, r.y - 10.5) < 0.3) passedFirst = true;
    }
    expect(passedFirst).toBe(true);
    expect(Math.hypot(r.x - 10.5, r.y - 16.5)).toBeLessThan(0.3);
    // a non-queued order replaces the queue
    run(sc, 1, [
      { type: 'move', player: 0, ids: [r.id], x: 20.5, y: 20.5 },
      { type: 'move', player: 0, ids: [r.id], x: 5.5, y: 20.5, queue: true },
    ]);
    run(sc, 1, [{ type: 'move', player: 0, ids: [r.id], x: 12.5, y: 12.5 }]);
    expect(r.queue.length).toBe(0);
  });

  it('aircraft roll out airborne above the pad and can be told to attack', () => {
    const sc = scenario(undefined, { fog: false }, 9000);
    building(sc, 'h_nexus', 0, 6, 6);
    building(sc, 'h_power', 0, 10, 6);
    building(sc, 'h_power', 0, 10, 9);
    building(sc, 'h_refinery', 0, 13, 6);
    building(sc, 'h_radar', 0, 6, 10);
    const pad = building(sc, 'h_airpad', 0, 13, 10);
    run(sc, 1, [{ type: 'produce', player: 0, defId: 'h_kestrel' }]);
    expect(runUntil(sc, 400, () => has(sc, 'unitReady'))).toBe(true);
    const k = find(sc, 'h_kestrel', 0)!;
    expect(k.altitude).toBeGreaterThan(1);
    expect(Math.hypot(k.x - pad.x, k.y - pad.y)).toBeLessThan(1);
    const prey = unit(sc, 'f_jackal', 1, 28.5, 28.5); // ground-only gun: cannot fight back
    prey.order = { type: 'guard' };
    run(sc, 1, [{ type: 'attack', player: 0, ids: [k.id], targetId: prey.id }]);
    expect(runUntil(sc, 900, () => !alive(sc, prey))).toBe(true);
    expect(k.hp).toBe(k.maxHp);
  });

  it('vulture bombs fall as projectiles and splash the ground', () => {
    const sc = scenario(undefined, { fog: false });
    const v = unit(sc, 'f_vulture', 1, 10.5, 20.5);
    const tgt = building(sc, 'h_power', 0, 20, 20);
    run(sc, 1, [{ type: 'attack', player: 1, ids: [v.id], targetId: tgt.id }]);
    let sawBomb = false;
    for (let i = 0; i < 400 && tgt.hp === tgt.maxHp; i++) {
      run(sc, 1);
      if (sc.world.projectiles.some((p) => p.kind === 'bomb' && p.z > 0.5)) sawBomb = true;
    }
    expect(sawBomb).toBe(true);
    expect(tgt.hp).toBeLessThan(tgt.maxHp);
  });
});

describe('api purity', () => {
  it('query functions never change the world, even right after a power swing', () => {
    const sc = scenario();
    building(sc, 'h_nexus', 0, 6, 6);
    const radar = building(sc, 'h_radar', 0, 10, 6);
    run(sc, 3);
    radar.hp = 0.01;
    const before = sim.hashWorld(sc.world);
    sim.getBuildOptions(sc.world, 0);
    sim.getBuildOptions(sc.world, 1);
    sim.canPlaceBuilding(sc.world, 0, 'h_power', 10, 10);
    sim.isPassable(sc.world, 5, 5, 'foot');
    sim.isEnemy(sc.world, 0, 1);
    expect(sim.hashWorld(sc.world)).toBe(before);
  });

  it('accepts entities added to the world by hand (dev fixtures)', () => {
    const sc = scenario();
    const w = sc.world;
    const plain: Entity = {
      id: w.nextEntityId++, defId: 'h_sentry', kind: 'building', owner: 0, x: 20.5, y: 20.5, px: 20.5, py: 20.5, facing: 0, turretFacing: 0, altitude: 0,
      hp: 450, maxHp: 450, rank: 0, kills: 0, action: 'idle', order: null, queue: [], targetId: null, lastFireTick: -1, lastHitTick: -1, cargo: 0,
      buildProgress: 1, rally: null, primary: false, repairing: false, powered: true,
    };
    w.entities.set(plain.id, plain);
    const m = unit(sc, 'f_militia', 1, 23.5, 20.5);
    m.order = { type: 'guard' };
    expect(() => run(sc, 100)).not.toThrow();
    expect(sim.isPassable(w, 20, 20, 'foot')).toBe(false);
    expect(alive(sc, m)).toBe(false);
  });
});
