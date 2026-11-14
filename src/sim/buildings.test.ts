import { describe, expect, it } from 'vitest';
import { SELL_REFUND, secToTicks } from '../core/constants';
import { Terrain } from '../core/types';
import { BUILDINGS, SUPPORT_POWERS } from '../data';
import { sim } from './index';
import { fillRect, makeMap, oreRect } from './testmap';
import { alive, building, find, has, run, runUntil, scenario, unit } from './testutil';

const corners = [{ x: 2, y: 2 }, { x: 37, y: 37 }];

describe('buildings', () => {
  it('canPlaceBuilding gives per-cell verdicts for terrain, ore, units, buildings and adjacency', () => {
    const map = makeMap(40, 40, corners);
    fillRect(map, 14, 8, 14, 8, Terrain.Rock);
    oreRect(map, 12, 12, 12, 12);
    fillRect(map, 9, 13, 9, 13, Terrain.Road);
    const sc = scenario(map);
    const w = sc.world;
    building(sc, 'h_nexus', 0, 8, 8);
    unit(sc, 'h_warden', 0, 8.5, 12.5);
    expect(sim.canPlaceBuilding(w, 0, 'h_power', 11, 8).ok).toBe(true);
    const rock = sim.canPlaceBuilding(w, 0, 'h_power', 13, 8);
    expect(rock.ok).toBe(false);
    expect(rock.cells.filter((c) => !c.ok)).toEqual([{ tx: 14, ty: 8, ok: false }]);
    expect(sim.canPlaceBuilding(w, 0, 'h_power', 11, 11).ok).toBe(false); // ore at 12,12
    expect(sim.canPlaceBuilding(w, 0, 'h_power', 8, 11).ok).toBe(false); // warden standing there
    expect(sim.canPlaceBuilding(w, 0, 'h_power', 9, 13).ok).toBe(true); // road is buildable
    expect(sim.canPlaceBuilding(w, 0, 'h_power', 9, 9).ok).toBe(false); // overlaps the nexus
    expect(sim.canPlaceBuilding(w, 0, 'h_power', -1, 9).ok).toBe(false); // off the map
    expect(sim.canPlaceBuilding(w, 0, 'h_power', 14, 11).ok).toBe(true); // 3 tiles away: still adjacent
    const far = sim.canPlaceBuilding(w, 0, 'h_power', 15, 12);
    expect(far.ok).toBe(false);
    expect(far.cells.every((c) => !c.ok)).toBe(true);
    expect(sim.canPlaceBuilding(w, 1, 'f_power', 11, 8).ok).toBe(false); // enemy has no base here
    expect(sim.canPlaceBuilding(w, 0, 'h_wall', 11, 8).ok).toBe(true);
    expect(sim.canPlaceBuilding(w, 0, 'h_wall', 20, 20).ok).toBe(false); // walls need adjacency too
    expect(sim.canPlaceBuilding(w, 0, 'nope', 11, 8).ok).toBe(false);
    // buildings block ground movement, not aircraft
    expect(sim.isPassable(w, 9, 9, 'foot')).toBe(false);
    expect(sim.isPassable(w, 9, 9, 'air')).toBe(true);
    expect(sim.isPassable(w, 11, 9, 'wheel')).toBe(true);
  });

  it('base vehicle deploys into a conyard, or refuses on a bad site', () => {
    const map = makeMap(40, 40, corners);
    fillRect(map, 36, 36, 36, 36, Terrain.Rock);
    const sc = scenario(map);
    const c0 = find(sc, 'h_crawler', 0)!;
    const c1 = find(sc, 'f_crawler', 1)!;
    run(sc, 1, [
      { type: 'deploy', player: 0, ids: [c0.id] },
      { type: 'deploy', player: 1, ids: [c1.id] },
      { type: 'deploy', player: 1, ids: [c0.id] }, // not yours
    ]);
    expect(alive(sc, c0)).toBe(false);
    const nexus = find(sc, 'h_nexus', 0)!;
    expect(nexus.x).toBe(2.5);
    expect(nexus.y).toBe(2.5);
    expect(sc.events.some((e) => e.type === 'unitDeployed' && e.unitId === c0.id && e.buildingId === nexus.id)).toBe(true);
    expect(sc.events.some((e) => e.type === 'cannotPlace' && e.player === 1)).toBe(true);
    expect(alive(sc, c1)).toBe(true);
    expect(c1.order).toBeNull();
    expect(sim.getBuildOptions(sc.world, 0).some((o) => o.available)).toBe(false); // still unfolding
    expect(runUntil(sc, 80, () => has(sc, 'buildingComplete'))).toBe(true);
    expect(sim.getBuildOptions(sc.world, 0).find((o) => o.defId === 'h_power')!.available).toBe(true);
    expect(sc.world.players[0].stats.unitsLost).toBe(0);
    // deploying is how a player with no buildings stays alive
    expect(sc.world.players[0].defeated).toBe(false);
  });

  it('sell refunds by hp ratio; repair drains credits and restores hp', () => {
    const sc = scenario(undefined, {}, 1000);
    const p = sc.world.players[0];
    building(sc, 'h_nexus', 0, 8, 8);
    const pw = building(sc, 'h_power', 0, 12, 8);
    const bar = building(sc, 'h_barracks', 0, 12, 11);
    pw.hp = pw.maxHp / 2;
    run(sc, 1, [{ type: 'sell', player: 0, buildingId: pw.id }, { type: 'sell', player: 1, buildingId: bar.id }]);
    expect(alive(sc, pw)).toBe(false);
    expect(alive(sc, bar)).toBe(true);
    expect(p.credits).toBe(1000 + BUILDINGS.h_power.cost * SELL_REFUND * 0.5);
    expect(has(sc, 'buildingSold')).toBe(true);
    expect(sim.isPassable(sc.world, 12, 8, 'foot')).toBe(true);
    expect(p.stats.buildingsLost).toBe(0);

    bar.hp = bar.maxHp * 0.5;
    const before = p.credits;
    run(sc, 100, [{ type: 'toggleRepair', player: 0, buildingId: bar.id }]);
    expect(bar.repairing).toBe(true);
    expect(bar.hp).toBeGreaterThan(bar.maxHp * 0.5);
    expect(p.credits).toBeLessThan(before);
    run(sc, 2, [{ type: 'toggleRepair', player: 0, buildingId: bar.id }]);
    expect(bar.repairing).toBe(false);
    const hp = bar.hp;
    run(sc, 20);
    expect(bar.hp).toBe(hp);
    run(sc, 400, [{ type: 'toggleRepair', player: 0, buildingId: bar.id }]);
    expect(bar.hp).toBe(bar.maxHp);
    expect(bar.repairing).toBe(false);
    // half a repair costs about 12.5% of the building's price
    expect(before - p.credits).toBeGreaterThan(40);
    expect(before - p.credits).toBeLessThan(90);
  });

  it('engineers capture enemy buildings and patch up friendly ones', () => {
    const sc = scenario(undefined, { fog: false });
    building(sc, 'f_core', 1, 20, 20);
    const plant = building(sc, 'f_power', 1, 24, 20);
    const own = building(sc, 'h_power', 0, 10, 20);
    own.hp = 50;
    const e1 = unit(sc, 'h_engineer', 0, 24.5, 25.5);
    const e2 = unit(sc, 'h_engineer', 0, 10.5, 25.5);
    const e3 = unit(sc, 'h_engineer', 0, 14.5, 25.5);
    const soldier = unit(sc, 'h_warden', 0, 26.5, 33.5); // out of weapon reach
    own.rally = null;
    run(sc, 1, [
      { type: 'capture', player: 0, ids: [e1.id, soldier.id], targetId: plant.id },
      { type: 'capture', player: 0, ids: [e2.id], targetId: own.id },
    ]);
    expect(soldier.order).toBeNull(); // not an engineer
    expect(runUntil(sc, 400, () => !alive(sc, e1) && !alive(sc, e2))).toBe(true);
    expect(plant.owner).toBe(0);
    expect(sc.events.some((e) => e.type === 'buildingCaptured' && e.id === plant.id && e.from === 1 && e.to === 0)).toBe(true);
    expect(own.hp).toBe(own.maxHp);
    run(sc, 2);
    expect(sc.world.players[0].powerProduced).toBe(120 + 90);
    expect(sc.world.players[1].powerProduced).toBe(20);
    // an undamaged friendly building does not consume the engineer
    run(sc, 50, [{ type: 'capture', player: 0, ids: [e3.id], targetId: own.id }]);
    expect(alive(sc, e3)).toBe(true);
    expect(e3.order).toBeNull();
  });
});

describe('support powers', () => {
  it('recon sweep charges, pauses in low power, and reveals fog for its duration', () => {
    const sc = scenario();
    const p = sc.world.players[0];
    building(sc, 'h_nexus', 0, 6, 6);
    building(sc, 'h_power', 0, 10, 6);
    const radar = building(sc, 'h_radar', 0, 10, 9);
    run(sc, 10);
    const st = p.powers.find((s) => s.id === 'recon_sweep')!;
    expect(st.sourceId).toBe(radar.id);
    expect(st.chargeMax).toBe(secToTicks(SUPPORT_POWERS.recon_sweep.recharge));
    expect(st.charge).toBe(10);
    expect(p.hasRadar).toBe(true);
    // not ready yet → ignored
    run(sc, 1, [{ type: 'usePower', player: 0, power: 'recon_sweep', x: 30, y: 30 }]);
    expect(has(sc, 'powerUsed')).toBe(false);
    // low power pauses charging
    const drain = building(sc, 'h_lab', 0, 14, 6);
    const drain2 = building(sc, 'h_lab', 0, 14, 9);
    run(sc, 5);
    const c = st.charge;
    run(sc, 20);
    expect(st.charge).toBe(c);
    run(sc, 1, [{ type: 'sell', player: 0, buildingId: drain.id }, { type: 'sell', player: 0, buildingId: drain2.id }]);
    st.charge = st.chargeMax - 3;
    run(sc, 5);
    expect(st.ready).toBe(true);
    expect(sc.events.some((e) => e.type === 'powerReady' && e.power === 'recon_sweep')).toBe(true);
    const idx = 30 * 40 + 30;
    expect(p.visible[idx]).toBe(0);
    expect(p.explored[idx]).toBe(0);
    run(sc, 1, [{ type: 'usePower', player: 0, power: 'recon_sweep', x: 30, y: 30 }]);
    expect(has(sc, 'powerUsed') && has(sc, 'powerImpact')).toBe(true);
    expect(st.ready).toBe(false);
    expect(st.charge).toBeLessThan(5);
    expect(p.visible[idx]).toBe(1);
    run(sc, 100);
    expect(p.visible[idx]).toBe(1);
    run(sc, secToTicks(SUPPORT_POWERS.recon_sweep.duration));
    expect(p.visible[idx]).toBe(0);
    expect(p.explored[idx]).toBe(1);
    // power disappears with its building
    run(sc, 2, [{ type: 'sell', player: 0, buildingId: radar.id }]);
    expect(p.powers.length).toBe(0);
    expect(p.hasRadar).toBe(false);
  });

  it('orbital lance hits everything in radius after its delay, with falloff', () => {
    const sc = scenario();
    const p = sc.world.players[0];
    building(sc, 'h_nexus', 0, 6, 6);
    for (let i = 0; i < 3; i++) building(sc, 'h_power', 0, 10 + i * 2, 6);
    building(sc, 'h_uplink', 0, 10, 9);
    run(sc, 2);
    const st = p.powers.find((s) => s.id === 'orbital_lance')!;
    st.charge = st.chargeMax - 1;
    run(sc, 2);
    expect(st.ready).toBe(true);
    const centre = unit(sc, 'f_hammer', 1, 28.5, 28.5);
    const inf = unit(sc, 'f_militia', 1, 29.5, 28.5);
    const air = unit(sc, 'f_vulture', 1, 28.5, 29.5);
    const edge = building(sc, 'f_power', 1, 31, 28); // near edge of radius 3.5
    const outside = unit(sc, 'f_hammer', 1, 28.5, 34.5);
    for (const u of [centre, inf, air, outside]) u.order = { type: 'guard' };
    run(sc, 1, [{ type: 'usePower', player: 0, power: 'orbital_lance', x: 28.5, y: 28.5 }]);
    expect(has(sc, 'powerUsed')).toBe(true);
    expect(has(sc, 'powerImpact')).toBe(false);
    run(sc, secToTicks(SUPPORT_POWERS.orbital_lance.delay) - 2);
    expect(alive(sc, centre)).toBe(true);
    run(sc, 3);
    expect(has(sc, 'powerImpact')).toBe(true);
    expect(alive(sc, centre)).toBe(false);
    expect(alive(sc, inf)).toBe(false);
    expect(alive(sc, air)).toBe(false);
    expect(edge.hp).toBeLessThan(edge.maxHp);
    expect(edge.hp).toBeGreaterThan(0);
    expect(outside.hp).toBe(outside.maxHp);
    expect(p.stats.kills).toBe(3);
  });

  it('tremor only hurts buildings and ground vehicles', () => {
    const sc = scenario();
    const p = sc.world.players[1];
    building(sc, 'f_core', 1, 30, 30);
    for (let i = 0; i < 3; i++) building(sc, 'f_power', 1, 26 + i * 2, 34);
    building(sc, 'f_drill', 1, 34, 30);
    run(sc, 2);
    const st = p.powers.find((s) => s.id === 'tremor')!;
    st.charge = st.chargeMax;
    run(sc, 2);
    const tank = unit(sc, 'h_javelin', 0, 12.5, 12.5);
    const inf = unit(sc, 'h_warden', 0, 13.5, 12.5);
    const air = unit(sc, 'h_kestrel', 0, 12.5, 13.5);
    const bld = building(sc, 'h_power', 0, 10, 14);
    run(sc, 1 + secToTicks(SUPPORT_POWERS.tremor.delay), [{ type: 'usePower', player: 1, power: 'tremor', x: 12.5, y: 12.5 }]);
    expect(alive(sc, tank)).toBe(false);
    expect(inf.hp).toBe(inf.maxHp);
    expect(air.hp).toBe(air.maxHp);
    expect(bld.hp).toBeLessThan(bld.maxHp);
  });
});
