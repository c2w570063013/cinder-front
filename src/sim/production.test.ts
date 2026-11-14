import { describe, expect, it } from 'vitest';
import { MAX_QUEUE } from '../core/constants';
import { sim } from './index';
import { building, find, has, run, runUntil, scenario, unit } from './testutil';

const avail = (sc: ReturnType<typeof scenario>, p: number) =>
  new Set(sim.getBuildOptions(sc.world, p).filter((o) => o.available).map((o) => o.defId));

describe('production & tech', () => {
  it('gates build options by prerequisites, producers, faction and superweapon option', () => {
    const sc = scenario();
    expect(avail(sc, 0).size).toBe(0); // nothing without a conyard
    building(sc, 'h_nexus', 0, 8, 8);
    let a = avail(sc, 0);
    expect(a.has('h_power')).toBe(true);
    expect(a.has('h_barracks')).toBe(false);
    expect(a.has('h_warden')).toBe(false);
    building(sc, 'h_power', 0, 12, 8);
    a = avail(sc, 0);
    expect(a.has('h_barracks') && a.has('h_refinery')).toBe(true);
    expect(a.has('h_warden')).toBe(false); // prereq + no infantry producer
    building(sc, 'h_barracks', 0, 12, 11);
    a = avail(sc, 0);
    expect(a.has('h_warden') && a.has('h_sentry') && a.has('h_wall')).toBe(true);
    expect(a.has('f_militia')).toBe(false);
    // a building still rising does not count
    building(sc, 'h_refinery', 0, 15, 8, 0.5);
    expect(avail(sc, 0).has('h_factory')).toBe(false);
    // all of the tech tree is listed, conyard itself excluded
    const all = sim.getBuildOptions(sc.world, 0).map((o) => o.defId);
    expect(all.includes('h_uplink') && all.includes('h_arbiter')).toBe(true);
    expect(all.includes('h_nexus')).toBe(false);

    const noSw = scenario(undefined, { superweapons: false });
    for (const [d, x] of [['h_nexus', 8], ['h_power', 12], ['h_refinery', 15], ['h_radar', 19], ['h_factory', 22], ['h_lab', 26]] as const) building(noSw, d, 0, x, 8);
    expect(avail(noSw, 0).has('h_uplink')).toBe(false);
    expect(avail(noSw, 0).has('h_lab')).toBe(true);
  });

  it('builds a structure progressively, waits for placement, then rises', () => {
    const sc = scenario(undefined, {}, 5000);
    const world = sc.world;
    const ny = building(sc, 'h_nexus', 0, 8, 8);
    run(sc, 1, [
      { type: 'produce', player: 0, defId: 'h_power' },
      { type: 'produce', player: 0, defId: 'h_factory' }, // not available → ignored
    ]);
    const q = world.players[0].queues.structure;
    expect(q.items.map((i) => i.defId)).toEqual(['h_power']);
    run(sc, 89);
    expect(q.items[0].progress).toBeCloseTo(0.5, 2);
    expect(world.players[0].credits).toBe(5000 - 300);
    expect(q.items[0].paid).toBe(300);
    run(sc, 95);
    expect(q.ready).toBe(true);
    expect(has(sc, 'constructionReady')).toBe(true);
    expect(world.players[0].credits).toBe(4400);
    // too far from the base → refused
    expect(sim.canPlaceBuilding(world, 0, 'h_power', 25, 25).ok).toBe(false);
    run(sc, 1, [{ type: 'placeBuilding', player: 0, defId: 'h_power', tx: 25, ty: 25 }]);
    expect(has(sc, 'cannotPlace')).toBe(true);
    expect(q.ready).toBe(true);
    const chk = sim.canPlaceBuilding(world, 0, 'h_power', 12, 8);
    expect(chk.ok).toBe(true);
    expect(chk.cells.length).toBe(4);
    run(sc, 1, [{ type: 'placeBuilding', player: 0, defId: 'h_power', tx: 12, ty: 8 }]);
    expect(has(sc, 'buildingPlaced')).toBe(true);
    const pw = find(sc, 'h_power', 0)!;
    expect(pw.buildProgress).toBeLessThan(1);
    expect(pw.action).toBe('construct');
    expect(q.items.length).toBe(0);
    expect(world.players[0].powerProduced).toBe(20);
    expect(runUntil(sc, 100, () => has(sc, 'buildingComplete'))).toBe(true);
    run(sc, 1);
    expect(world.players[0].powerProduced).toBe(140);
    expect(world.players[0].stats.buildingsBuilt).toBe(1);
    expect(ny.owner).toBe(0);
  });

  it('cancelProduction pauses first, then removes and refunds; resume continues', () => {
    const sc = scenario(undefined, {}, 5000);
    const p = sc.world.players[0];
    building(sc, 'h_nexus', 0, 8, 8);
    building(sc, 'h_power', 0, 12, 8);
    run(sc, 100, [{ type: 'produce', player: 0, defId: 'h_refinery' }]);
    const q = p.queues.structure;
    const paid = q.items[0].paid;
    expect(paid).toBeGreaterThan(0);
    expect(p.credits).toBe(5000 - paid);
    run(sc, 20, [{ type: 'cancelProduction', player: 0, defId: 'h_refinery' }]);
    expect(q.paused).toBe(true);
    expect(q.items[0].paid).toBe(paid); // no progress while paused
    run(sc, 20, [{ type: 'resumeProduction', player: 0, category: 'structure' }]);
    expect(q.paused).toBe(false);
    expect(q.items[0].paid).toBeGreaterThan(paid);
    run(sc, 1, [{ type: 'cancelProduction', player: 0, defId: 'h_refinery' }]);
    run(sc, 1, [{ type: 'cancelProduction', player: 0, defId: 'h_refinery' }]);
    expect(q.items.length).toBe(0);
    expect(q.paused).toBe(false);
    expect(p.credits).toBe(5000);
    expect(p.stats.creditsSpent).toBe(0);
    // a finished-but-unplaced building refunds in full too
    run(sc, 200, [{ type: 'produce', player: 0, defId: 'h_power' }]);
    expect(q.ready).toBe(true);
    run(sc, 1, [{ type: 'cancelProduction', player: 0, defId: 'h_power' }]);
    expect(q.items.length).toBe(0);
    expect(q.ready).toBe(false);
    expect(p.credits).toBe(5000);
  });

  it('trains units that leave the factory and walk to the rally point; queue is capped', () => {
    const sc = scenario(undefined, {}, 9000);
    const world = sc.world;
    building(sc, 'h_nexus', 0, 8, 8);
    building(sc, 'h_power', 0, 12, 8);
    const bar = building(sc, 'h_barracks', 0, 12, 12);
    const cmds = [];
    for (let i = 0; i < MAX_QUEUE + 5; i++) cmds.push({ type: 'produce' as const, player: 0, defId: 'h_warden' });
    run(sc, 1, [{ type: 'setRally', player: 0, buildingId: bar.id, x: 20.5, y: 20.5 }, ...cmds]);
    expect(world.players[0].queues.infantry.items.length).toBe(MAX_QUEUE);
    expect(bar.rally).toEqual({ x: 20.5, y: 20.5 });
    expect(runUntil(sc, 100, () => has(sc, 'unitReady'))).toBe(true);
    const w = find(sc, 'h_warden', 0)!;
    expect(w.y).toBeGreaterThan(14); // spawned outside the footprint, at the exit side
    expect(world.players[0].stats.unitsBuilt).toBe(1);
    expect(world.players[0].credits).toBeLessThanOrEqual(9000 - 120);
    expect(runUntil(sc, 400, () => Math.hypot(w.x - 20.5, w.y - 20.5) < 1.5)).toBe(true);
    // removing a queued duplicate does not pause the active one
    const q = world.players[0].queues.infantry;
    const n = q.items.length;
    run(sc, 1, [{ type: 'cancelProduction', player: 0, defId: 'h_warden' }]);
    expect(q.paused).toBe(true);
    run(sc, 1, [{ type: 'cancelProduction', player: 0, defId: 'h_warden' }]);
    expect(q.items.length).toBe(n - 1);
  });

  it('stalls with one insufficientFunds event when broke and resumes when money arrives', () => {
    const sc = scenario(undefined, {}, 100);
    const p = sc.world.players[0];
    building(sc, 'h_nexus', 0, 8, 8);
    run(sc, 200, [{ type: 'produce', player: 0, defId: 'h_power' }]);
    expect(p.credits).toBe(0);
    expect(p.queues.structure.items[0].paid).toBe(100);
    expect(p.queues.structure.ready).toBe(false);
    expect(sc.events.filter((e) => e.type === 'insufficientFunds').length).toBe(1);
    p.credits = 2000;
    run(sc, 200);
    expect(p.queues.structure.ready).toBe(true);
    expect(p.credits).toBe(1500);
  });

  it('low power: event, halved build speed, radar and powered defences go offline', () => {
    const sc = scenario(undefined, {}, 9000);
    const p = sc.world.players[0];
    building(sc, 'h_nexus', 0, 8, 8); // +20
    run(sc, 1);
    expect(p.lowPower).toBe(false);
    const radar = building(sc, 'h_radar', 0, 12, 8); // -50
    const turret = building(sc, 'h_railturret', 0, 15, 8);
    run(sc, 2);
    expect(p.lowPower).toBe(true);
    expect(sc.events.some((e) => e.type === 'lowPower' && e.low)).toBe(true);
    expect(p.hasRadar).toBe(false);
    expect(radar.powered).toBe(false);
    expect(turret.powered).toBe(false);
    run(sc, 180, [{ type: 'produce', player: 0, defId: 'h_power' }]);
    expect(p.queues.structure.items[0].progress).toBeCloseTo(0.5, 1);
    // a damaged plant gives less; enough plants restore power
    const plant = building(sc, 'h_power', 0, 12, 12); // +120 → 140 vs 120
    run(sc, 2);
    expect(p.lowPower).toBe(false);
    expect(p.hasRadar).toBe(true);
    expect(turret.powered).toBe(true);
    expect(sc.events.some((e) => e.type === 'lowPower' && !e.low)).toBe(true);
    plant.hp = plant.maxHp * 0.5; // 20 + 60 = 80 < 120
    run(sc, 2);
    expect(p.powerProduced).toBe(80);
    expect(p.lowPower).toBe(true);
  });

  it('more factories of a category build faster', () => {
    const one = scenario(undefined, {}, 9000);
    const two = scenario(undefined, {}, 9000);
    for (const sc of [one, two]) {
      building(sc, 'h_nexus', 0, 8, 8);
      building(sc, 'h_power', 0, 12, 8);
      building(sc, 'h_barracks', 0, 12, 12);
    }
    building(two, 'h_barracks', 0, 16, 12);
    for (const sc of [one, two]) run(sc, 41, [{ type: 'produce', player: 0, defId: 'h_engineer' }]);
    const p1 = one.world.players[0].queues.infantry.items[0].progress;
    const p2 = two.world.players[0].queues.infantry.items[0].progress;
    expect(p2 / p1).toBeCloseTo(1.5, 1);
  });

  it('setPrimary picks the exit building', () => {
    const sc = scenario(undefined, {}, 9000);
    building(sc, 'h_nexus', 0, 8, 8);
    building(sc, 'h_power', 0, 12, 8);
    const a = building(sc, 'h_barracks', 0, 12, 12);
    const b = building(sc, 'h_barracks', 0, 24, 12);
    run(sc, 1, [{ type: 'setPrimary', player: 0, buildingId: b.id }, { type: 'produce', player: 0, defId: 'h_warden' }]);
    expect(b.primary).toBe(true);
    expect(runUntil(sc, 120, () => has(sc, 'unitReady'))).toBe(true);
    const w = find(sc, 'h_warden', 0)!;
    expect(Math.abs(w.x - b.x)).toBeLessThan(2);
    run(sc, 1, [{ type: 'setPrimary', player: 0, buildingId: a.id }]);
    expect(a.primary && !b.primary).toBe(true);
    expect(unit(sc, 'h_warden', 0, 30.5, 30.5).owner).toBe(0);
  });

  it('a refinery completes with its free harvester', () => {
    const sc = scenario(undefined, {}, 9000);
    building(sc, 'h_nexus', 0, 8, 8);
    building(sc, 'h_power', 0, 12, 8);
    run(sc, 400, [{ type: 'produce', player: 0, defId: 'h_refinery' }]);
    run(sc, 1, [{ type: 'placeBuilding', player: 0, defId: 'h_refinery', tx: 8, ty: 13 }]);
    expect(runUntil(sc, 100, () => !!find(sc, 'h_harvester', 0))).toBe(true);
    expect(find(sc, 'h_harvester', 0)!.order?.type).toBe('harvest');
  });
});
