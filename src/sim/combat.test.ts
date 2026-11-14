import { describe, expect, it } from 'vitest';
import { WARHEADS, WEAPONS } from '../data';
import { alive, building, has, run, runUntil, scenario, unit } from './testutil';

describe('combat', () => {
  it('idle units auto-acquire and kill enemies in range, emitting combat events', () => {
    const sc = scenario();
    const tank = unit(sc, 'h_javelin', 0, 15.5, 15.5);
    const m = unit(sc, 'f_militia', 1, 19.5, 15.5);
    expect(runUntil(sc, 600, () => !alive(sc, m))).toBe(true);
    expect(tank.kills).toBe(1);
    expect(tank.lastFireTick).toBeGreaterThan(0);
    for (const t of ['weaponFired', 'impact', 'entityDamaged', 'entityDestroyed', 'underAttack'] as const) expect(has(sc, t)).toBe(true);
    const fired = sc.events.find((e) => e.type === 'weaponFired' && e.sourceId === tank.id)!;
    expect(fired.type === 'weaponFired' && fired.kind).toBe('shell');
    expect(sc.world.players[0].stats.kills).toBe(1);
    expect(sc.world.players[1].stats.unitsLost).toBe(1);
    // under-attack alerts are rate limited per area
    expect(sc.events.filter((e) => e.type === 'underAttack' && e.player === 1).length).toBe(1);
    run(sc, 3);
    expect(tank.targetId).toBeNull();
  });

  it('applies warhead multipliers', () => {
    const sc = scenario();
    const w = unit(sc, 'h_warden', 0, 15.5, 15.5);
    const tank = unit(sc, 'f_hammer', 1, 18.5, 15.5);
    tank.order = { type: 'guard' }; // would shoot back anyway; keep it still
    runUntil(sc, 40, () => tank.hp < tank.maxHp);
    const dmg = sc.events.find((e) => e.type === 'entityDamaged' && e.id === tank.id)!;
    expect(dmg.type === 'entityDamaged' && dmg.amount).toBeCloseTo(WEAPONS.h_rifle.damage * WARHEADS.bullet.heavy, 5);
    expect(w.targetId).toBe(tank.id);
  });

  it('promotes units by kill value and veterans hit harder', () => {
    const sc = scenario();
    const tank = unit(sc, 'h_javelin', 0, 15.5, 15.5); // cost 800 → rank 1 at 2400, rank 2 at 5600
    const victims = [0, 1, 2].map((i) => unit(sc, 'f_hammer', 1, 19.5, 14 + i * 1.5));
    for (const v of victims) {
      v.hp = 1;
      v.order = { type: 'guard' };
    }
    expect(runUntil(sc, 400, () => victims.every((v) => !alive(sc, v)))).toBe(true);
    expect(tank.kills).toBe(3);
    expect(tank.rank).toBe(1);
    expect(sc.events.some((e) => e.type === 'unitPromoted' && e.id === tank.id && e.rank === 1)).toBe(true);
    const dummy = unit(sc, 'f_hauler', 1, 19.5, 15.5); // unarmed, heavy armour
    sc.events.length = 0;
    runUntil(sc, 100, () => dummy.hp < dummy.maxHp);
    const dmg = sc.events.find((e) => e.type === 'entityDamaged' && e.id === dummy.id)!;
    expect(dmg.type === 'entityDamaged' && dmg.amount).toBeCloseTo(WEAPONS.h_javelin_cannon.damage * 1.15, 4);
    // elite: regenerates
    tank.rank = 2;
    tank.hp = 100;
    dummy.hp = 0.5;
    run(sc, 200);
    expect(tank.hp).toBeGreaterThan(100);
  });

  it('splash damages nearby enemies with falloff but never friendlies', () => {
    const sc = scenario();
    const g = unit(sc, 'f_grenadier', 1, 15.5, 15.5); // arc, splash 0.8
    const a = unit(sc, 'h_warden', 0, 19.5, 15.5);
    const b = unit(sc, 'h_warden', 0, 19.9, 15.5);
    const far = unit(sc, 'h_warden', 0, 19.5, 18.5);
    const friend = unit(sc, 'f_militia', 1, 19.5, 15.1);
    for (const u of [a, b, far, friend]) u.order = { type: 'guard' };
    g.order = { type: 'attack', targetId: a.id };
    runUntil(sc, 200, () => sc.events.some((e) => e.type === 'impact' && e.weaponId === 'f_grenade'));
    expect(has(sc, 'impact')).toBe(true);
    expect(sc.world.projectiles.length).toBe(0);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(a.maxHp - a.hp).toBeGreaterThan(b.maxHp - b.hp); // falloff
    expect(far.hp).toBe(far.maxHp);
    const friendDamagedByGrenade = sc.events.some((e) => e.type === 'entityDamaged' && e.id === friend.id && e.amount > 20);
    expect(friendDamagedByGrenade).toBe(false);
  });

  it('projectiles travel: missiles home on moving targets', () => {
    const sc = scenario();
    const b = unit(sc, 'h_breacher', 0, 15.5, 15.5);
    const j = unit(sc, 'f_jackal', 1, 20.5, 15.5);
    j.order = { type: 'guard' };
    b.order = { type: 'attack', targetId: j.id };
    runUntil(sc, 100, () => sc.world.projectiles.length > 0);
    const p = sc.world.projectiles[0];
    expect(p.kind).toBe('missile');
    expect(p.targetId).toBe(j.id);
    run(sc, 1, [{ type: 'move', player: 1, ids: [j.id], x: 20.5, y: 25.5 }]);
    const hp = j.hp;
    runUntil(sc, 100, () => sc.world.projectiles.length === 0);
    expect(j.hp).toBeLessThan(hp);
  });

  it('aircraft are only hit by anti-air; ground-only weapons ignore them', () => {
    const sc = scenario();
    const k = unit(sc, 'h_kestrel', 0, 15.5, 15.5);
    const hammer = unit(sc, 'f_hammer', 1, 18.5, 15.5);
    hammer.order = { type: 'guard' };
    run(sc, 120);
    expect(k.hp).toBe(k.maxHp); // hammer cannot touch it
    expect(hammer.targetId).toBeNull();
    expect(hammer.hp).toBeLessThan(hammer.maxHp); // kestrel strafes the tank
    const flak = unit(sc, 'f_flakcrawler', 1, 20.5, 17.5);
    flak.order = { type: 'guard' };
    expect(runUntil(sc, 300, () => !alive(sc, k))).toBe(true);
    expect(flak.kills).toBe(1);
    // AA-only vehicle never engages ground units
    const w = unit(sc, 'h_warden', 0, 22.5, 17.5);
    w.order = { type: 'guard' };
    run(sc, 60);
    expect(flak.targetId).toBeNull();
    // explicit attack on something it cannot hit is ignored
    run(sc, 2, [{ type: 'attack', player: 1, ids: [flak.id], targetId: w.id }]);
    expect(flak.order?.type).toBe('guard');
  });

  it('secondary weapon engages aircraft while the main gun fights ground targets', () => {
    const sc = scenario();
    const c = unit(sc, 'f_colossus', 1, 15.5, 15.5);
    const k = unit(sc, 'h_kestrel', 0, 19.5, 13.5);
    const j = unit(sc, 'h_javelin', 0, 19.5, 17.5);
    k.order = { type: 'guard' };
    j.order = { type: 'guard' };
    run(sc, 200);
    const weapons = new Set(sc.events.filter((e) => e.type === 'weaponFired' && e.sourceId === c.id).map((e) => (e.type === 'weaponFired' ? e.weaponId : '')));
    expect(weapons.has('f_colossus_cannon')).toBe(true);
    expect(weapons.has('f_colossus_aa')).toBe(true);
    expect(k.hp).toBeLessThan(k.maxHp);
    expect(j.hp).toBeLessThan(j.maxHp);
  });

  it('explicit attack chases the target; attack-move engages on the way and then continues', () => {
    const sc = scenario(undefined, { fog: false });
    const t = unit(sc, 'h_javelin', 0, 10.5, 15.5);
    const prey = unit(sc, 'f_sapper', 1, 26.5, 15.5);
    run(sc, 1, [{ type: 'attack', player: 0, ids: [t.id], targetId: prey.id }]);
    expect(t.order?.type).toBe('attack');
    expect(runUntil(sc, 600, () => !alive(sc, prey))).toBe(true);
    expect(t.x).toBeGreaterThan(15);
    run(sc, 3);
    expect(t.order).toBeNull();

    const sc2 = scenario();
    const a = unit(sc2, 'h_javelin', 0, 8.5, 20.5);
    const blocker = unit(sc2, 'f_militia', 1, 18.5, 21.5);
    blocker.order = { type: 'guard' };
    run(sc2, 1, [{ type: 'attackMove', player: 0, ids: [a.id], x: 30.5, y: 20.5 }]);
    expect(runUntil(sc2, 900, () => a.order === null)).toBe(true);
    expect(alive(sc2, blocker)).toBe(false);
    expect(Math.hypot(a.x - 30.5, a.y - 20.5)).toBeLessThan(0.5);
  });

  it('turreted defences shoot; powered ones go silent in low power; walls are not auto-targeted', () => {
    const sc = scenario();
    building(sc, 'f_core', 1, 20, 20);
    const bunker = building(sc, 'f_bunker', 1, 20, 16);
    const siege = building(sc, 'f_siege', 1, 22, 16); // needs power: 20 - 50 → low power
    const wall = building(sc, 'h_wall', 0, 21, 12);
    const w = unit(sc, 'h_warden', 0, 20.5, 13.5);
    const tank = unit(sc, 'h_javelin', 0, 23.5, 12.5);
    tank.order = { type: 'guard' };
    w.order = { type: 'guard' };
    run(sc, 100);
    expect(sc.world.players[1].lowPower).toBe(true);
    expect(siege.powered).toBe(false);
    expect(siege.lastFireTick).toBe(-1);
    expect(bunker.lastFireTick).toBeGreaterThan(0);
    expect(wall.hp).toBe(wall.maxHp);
    building(sc, 'f_power', 1, 24, 20);
    run(sc, 100);
    expect(siege.powered).toBe(true);
    expect(siege.lastFireTick).toBeGreaterThan(0);
  });

  it('respects minimum range and burst fire', () => {
    const sc = scenario(undefined, { fog: false });
    const art = unit(sc, 'h_farstrike', 0, 15.5, 15.5);
    const close = unit(sc, 'f_militia', 1, 17.0, 15.5);
    close.order = { type: 'guard' };
    art.order = { type: 'guard' };
    run(sc, 150);
    expect(art.lastFireTick).toBe(-1);
    const far = unit(sc, 'f_hammer', 1, 25.5, 15.5);
    far.order = { type: 'guard' };
    expect(runUntil(sc, 300, () => far.hp < far.maxHp)).toBe(true);

    const sc2 = scenario(undefined, { fog: false });
    const hail = unit(sc2, 'f_hailstorm', 1, 15.5, 15.5);
    const tgt = building(sc2, 'h_power', 0, 24, 15);
    hail.order = { type: 'attack', targetId: tgt.id };
    run(sc2, 60);
    const shots = sc2.events.filter((e) => e.type === 'weaponFired' && e.sourceId === hail.id);
    expect(shots.length).toBe(4); // one burst of 4, then the long cooldown
  });

  it('crusher vehicles run over enemy infantry but not friendly ones', () => {
    const sc = scenario();
    const h = unit(sc, 'h_harvester', 0, 12.5, 15.5);
    const enemy = unit(sc, 'f_sapper', 1, 16.5, 15.5);
    const friend = unit(sc, 'h_engineer', 0, 20.5, 15.5);
    enemy.order = { type: 'guard' };
    run(sc, 1, [{ type: 'move', player: 0, ids: [h.id], x: 24.5, y: 15.5 }]);
    runUntil(sc, 400, () => h.order === null);
    expect(alive(sc, enemy)).toBe(false);
    expect(alive(sc, friend)).toBe(true);
    expect(h.kills).toBe(1);
  });

  it('stop and guard orders', () => {
    const sc = scenario();
    const t = unit(sc, 'h_javelin', 0, 10.5, 15.5);
    run(sc, 20, [{ type: 'move', player: 0, ids: [t.id], x: 30.5, y: 15.5 }, { type: 'move', player: 0, ids: [t.id], x: 30.5, y: 25.5, queue: true }]);
    expect(t.queue.length).toBe(1);
    run(sc, 5, [{ type: 'stop', player: 0, ids: [t.id] }]);
    const x = t.x;
    expect(t.order).toBeNull();
    expect(t.queue.length).toBe(0);
    run(sc, 20);
    expect(t.x).toBeCloseTo(x, 5);
    run(sc, 2, [{ type: 'guard', player: 0, ids: [t.id] }]);
    expect(t.order?.type).toBe('guard');
    // a guarding unit holds position even when shot from outside its range
    const art = unit(sc, 'f_hailstorm', 1, t.x + 10, 15.5);
    art.order = { type: 'attack', targetId: t.id };
    sc.world.players[1].visible.fill(1);
    run(sc, 3);
    expect(t.x).toBeCloseTo(x, 5);
  });
});
