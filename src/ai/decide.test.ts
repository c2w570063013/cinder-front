import { describe, expect, it } from 'vitest';
import type { FactionId } from '../core/types';
import { BUILDINGS, UNITS, WEAPONS } from '../data';
import { chooseDefense, chooseStructure, chooseUnit, emptyMix, unitValue, waveThreshold, type BuildState } from './decide';
import { buildingPriority, factionInfo, PARAMS, unitInfo } from './knowledge';

const FACTIONS: FactionId[] = ['helion', 'ferrum'];

function state(faction: FactionId, owned: Record<string, number>, over: Partial<BuildState> = {}): BuildState {
  const info = factionInfo(faction);
  // Everything whose prerequisites are owned is available (a conyard is assumed).
  const available = (id: string): boolean => {
    const d = BUILDINGS[id];
    return !!d && d.buildable && d.prereqs.every((p) => (owned[p] ?? 0) > 0);
  };
  let power = 0;
  for (const [id, n] of Object.entries(owned)) power += (BUILDINGS[id]?.power ?? 0) * n;
  return {
    info,
    P: PARAMS.normal,
    have: (id) => owned[id] ?? 0,
    available,
    credits: 10000,
    powerNet: power,
    minutes: 3,
    wantRefineries: 2,
    harvesters: 2,
    canBuildHarvester: true,
    superweaponsAllowed: true,
    enemyAirSeen: 0,
    underAttack: false,
    armyValue: 20000,
    ...over,
  };
}

describe('faction knowledge is derived from data', () => {
  for (const f of FACTIONS) {
    it(`${f}: finds every role`, () => {
      const info = factionInfo(f);
      expect(info.conyard.conyard).toBe(true);
      expect(info.baseVehicle.deploysTo).toBe(info.conyard.id);
      expect(info.power.length).toBeGreaterThan(0);
      expect(info.power.every((p) => p.power > 0 && p.buildable)).toBe(true);
      expect(info.refinery.refinery).toBe(true);
      expect(info.harvester.harvester).toBeTruthy();
      expect(info.barracks?.produces).toContain('infantry');
      expect(info.factory?.produces).toContain('vehicle');
      expect(info.airpad?.produces).toContain('aircraft');
      expect(info.radar?.radar).toBe(true);
      expect(info.tech.length).toBeGreaterThan(0);
      expect(info.superweapon?.supportPower).toBeTruthy();
      expect(info.groundDefenses.length).toBeGreaterThan(0);
      expect(info.airDefenses.length).toBeGreaterThan(0);
      expect(info.airDefenses.every((d) => WEAPONS[d.weapon!].targetsAir)).toBe(true);
      expect(info.engineer?.engineer).toBe(true);
      expect(info.scout && info.scout.speed >= 3).toBe(true);
      // Utility units are never treated as army.
      expect(info.combat.every((u) => u.def.weapon && !u.def.harvester && !u.def.deploysTo && !u.def.engineer)).toBe(true);
      expect(info.combat.some((u) => u.siege)).toBe(true);
      expect(info.combat.some((u) => u.antiAir)).toBe(true);
    });
  }
  it('describes weapons: anti-air only units cannot hit ground', () => {
    const aaOnly = Object.values(UNITS).filter((u) => u.weapon && !WEAPONS[u.weapon].targetsGround && !u.secondary);
    expect(aaOnly.length).toBeGreaterThan(0);
    for (const u of aaOnly) {
      const i = unitInfo(u.id)!;
      expect(i.antiGround).toBe(false);
      expect(i.antiAir).toBe(true);
      expect(i.dps.heavy).toBe(0);
    }
  });
  it('ranks economy and production above walls', () => {
    for (const f of FACTIONS) {
      const info = factionInfo(f);
      const wall = Object.values(BUILDINGS).find((b) => b.faction === f && b.wall)!;
      expect(buildingPriority(info.refinery)).toBeGreaterThan(buildingPriority(info.groundDefenses[0]));
      expect(buildingPriority(info.power[0])).toBeGreaterThan(buildingPriority(wall));
    }
  });
});

describe('chooseStructure', () => {
  for (const f of FACTIONS) {
    const info = factionInfo(f);
    const cy = info.conyard.id;

    it(`${f}: opening order is power → refinery → barracks → factory → second refinery`, () => {
      const owned: Record<string, number> = { [cy]: 1 };
      const order: string[] = [];
      for (let i = 0; i < 12 && order.length < 6; i++) {
        const pick = chooseStructure(state(f, owned, { armyValue: 0 })).defId;
        if (!pick) break;
        order.push(pick);
        owned[pick] = (owned[pick] ?? 0) + 1;
      }
      const core = order.filter((id) => id !== info.power[0].id);
      expect(order[0]).toBe(info.power[0].id);
      expect(core.slice(0, 4)).toEqual([info.refinery.id, info.barracks!.id, info.factory!.id, info.refinery.id]);
    });

    it(`${f}: never lets the projected power balance go negative`, () => {
      const owned: Record<string, number> = { [cy]: 1 };
      for (let i = 0; i < 40; i++) {
        const s = state(f, owned);
        const pick = chooseStructure(s).defId;
        if (!pick) break;
        owned[pick] = (owned[pick] ?? 0) + 1;
        let power = 0;
        for (const [id, n] of Object.entries(owned)) power += BUILDINGS[id].power * n;
        expect(power).toBeGreaterThanOrEqual(0);
      }
      // With money and army it techs all the way up.
      expect(owned[info.radar!.id]).toBe(1);
      expect(owned[info.airpad!.id]).toBe(1);
      expect(owned[info.tech[0].id]).toBe(1);
      expect(owned[info.superweapon!.id]).toBe(1);
    });

    it(`${f}: builds a plant first when already in low power`, () => {
      const pick = chooseStructure(state(f, { [cy]: 1, [info.power[0].id]: 1, [info.refinery.id]: 1 }, { powerNet: -20 }));
      expect(pick.defId).toBe(info.power[0].id);
    });

    it(`${f}: easy stops at limited tech and never builds the superweapon`, () => {
      const owned: Record<string, number> = { [cy]: 1 };
      for (let i = 0; i < 40; i++) {
        const pick = chooseStructure(state(f, owned, { P: PARAMS.easy, minutes: 30 })).defId;
        if (!pick) break;
        owned[pick] = (owned[pick] ?? 0) + 1;
      }
      expect(owned[info.superweapon!.id]).toBeUndefined();
      expect(owned[info.airpad!.id]).toBeUndefined();
      expect(owned[info.tech[0].id]).toBeUndefined();
      expect(owned[info.factory!.id]).toBe(1);
    });

    it(`${f}: respects the superweapons-off game option`, () => {
      const owned: Record<string, number> = { [cy]: 1 };
      for (let i = 0; i < 40; i++) {
        const pick = chooseStructure(state(f, owned, { superweaponsAllowed: false })).defId;
        if (!pick) break;
        owned[pick] = (owned[pick] ?? 0) + 1;
      }
      expect(owned[info.superweapon!.id]).toBeUndefined();
    });

    it(`${f}: tech waits for an army, and saves money instead of idling forever`, () => {
      const owned = { [cy]: 1, [info.power[0].id]: 2, [info.refinery.id]: 2, [info.barracks!.id]: 1, [info.factory!.id]: 1 };
      expect(chooseStructure(state(f, owned, { armyValue: 0 })).defId).toBeNull();
      expect(chooseStructure(state(f, owned, { armyValue: 2000 })).defId).toBe(info.radar!.id);
      const poor = chooseStructure(state(f, owned, { armyValue: 2000, credits: 50 }));
      expect(poor.defId).toBeNull();
      expect(poor.reserve).toBeGreaterThan(0);
    });

    it(`${f}: a lost harvester with no factory is replaced by building a refinery`, () => {
      const owned = { [cy]: 1, [info.power[0].id]: 1, [info.refinery.id]: 1 };
      const pick = chooseStructure(state(f, owned, { harvesters: 0, canBuildHarvester: false }));
      expect(pick.defId).toBe(info.refinery.id);
    });
  }
});

describe('chooseDefense', () => {
  for (const f of FACTIONS) {
    const info = factionInfo(f);
    const base = { [info.conyard.id]: 1, [info.power[0].id]: 3, [info.refinery.id]: 1, [info.barracks!.id]: 1, [info.factory!.id]: 1, [info.radar!.id]: 1 };
    it(`${f}: ground defence once established, anti-air when aircraft are seen`, () => {
      expect(chooseDefense(state(f, { [info.conyard.id]: 1 })).defId).toBeNull();
      const g = chooseDefense(state(f, base));
      expect(info.groundDefenses.map((d) => d.id)).toContain(g.defId);
      const a = chooseDefense(state(f, base, { enemyAirSeen: 3 }));
      expect(info.airDefenses.map((d) => d.id)).toContain(a.defId);
      expect(a.antiAir).toBe(true);
    });
    it(`${f}: holds back and reports a power shortfall instead of browning out`, () => {
      const res = chooseDefense(state(f, base, { enemyAirSeen: 3, powerNet: 0 }));
      expect(res.defId).toBeNull();
      expect(res.powerShort).toBeGreaterThan(0);
    });
    it(`${f}: does not starve the economy for turrets`, () => {
      expect(chooseDefense(state(f, base, { credits: 300 })).defId).toBeNull();
    });
  }
});

describe('chooseUnit', () => {
  for (const f of FACTIONS) {
    const info = factionInfo(f);
    const vehicles = info.combat.filter((u) => u.def.category === 'vehicle');
    const pick = (mix = emptyMix(), counts: Record<string, number> = {}, antiAirOwned = 0, frontline = 6): string | null =>
      chooseUnit({ options: vehicles, counts: (id) => counts[id] ?? 0, mix, antiAirOwned, frontline, rand: () => 0.5 });

    it(`${f}: never picks anti-air-only units without enemy aircraft`, () => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 30; i++) {
        const id = pick(emptyMix(), counts)!;
        expect(unitInfo(id)!.antiGround).toBe(true);
        counts[id] = (counts[id] ?? 0) + 1;
      }
      expect(Object.keys(counts).length).toBeGreaterThan(1); // a mixed force, not one unit type
    });
    it(`${f}: answers enemy aircraft with anti-air first`, () => {
      const id = pick({ ...emptyMix(), air: 4 })!;
      expect(unitInfo(id)!.antiAir).toBe(true);
      // ...but not forever.
      const later = pick({ ...emptyMix(), air: 4 }, {}, 10)!;
      expect(unitInfo(later)!.antiGround).toBe(true);
    });
    it(`${f}: brings more artillery against static defences`, () => {
      const run = (defenses: number): number => {
        const counts: Record<string, number> = {};
        let siege = 0;
        for (let i = 0; i < 40; i++) {
          const id = pick({ ...emptyMix(), defenses }, counts)!;
          counts[id] = (counts[id] ?? 0) + 1;
          if (unitInfo(id)!.siege) siege++;
        }
        return siege;
      };
      expect(run(6)).toBeGreaterThan(run(0));
    });
    it(`${f}: artillery waits for a frontline to hide behind`, () => {
      for (let i = 0; i < 5; i++) expect(unitInfo(pick({ ...emptyMix(), defenses: 6 }, {}, 0, 0)!)!.siege).toBe(false);
    });
    it(`${f}: prefers anti-armour against tanks and anti-infantry against infantry`, () => {
      const vsTanks = { ...emptyMix(), heavy: 12 };
      const vsInf = { ...emptyMix(), infantry: 12 };
      const best = (mix: typeof vsTanks): string => [...vehicles].filter((u) => u.antiGround && !u.siege).sort((a, b) => unitValue(b, mix) - unitValue(a, mix))[0].def.id;
      expect(unitInfo(best(vsTanks))!.dps.heavy).toBeGreaterThan(unitInfo(best(vsInf))!.dps.heavy);
      expect(unitInfo(best(vsInf))!.dps.infantry).toBeGreaterThan(0);
    });
  }
  it('returns null with nothing to build', () => {
    expect(chooseUnit({ options: [], counts: () => 0, mix: emptyMix(), antiAirOwned: 0, frontline: 0, rand: () => 0 })).toBeNull();
  });
});

describe('difficulty scaling', () => {
  it('waves grow over time and are larger on higher difficulties', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const P = PARAMS[d];
      expect(waveThreshold(P, 30)).toBeGreaterThan(waveThreshold(P, P.firstAttackSec / 60));
      expect(waveThreshold(P, 500)).toBe(P.waveMax);
    }
    expect(waveThreshold(PARAMS.easy, 15)).toBeLessThan(waveThreshold(PARAMS.normal, 15));
    expect(waveThreshold(PARAMS.normal, 15)).toBeLessThan(waveThreshold(PARAMS.hard, 15));
  });
  it('easy is slower, smaller and blinder; only hard assumes start positions', () => {
    expect(PARAMS.easy.econEvery).toBeGreaterThan(PARAMS.normal.econEvery);
    expect(PARAMS.easy.maxArmyValue).toBeLessThan(PARAMS.normal.maxArmyValue);
    expect(PARAMS.easy.superweapon).toBe(false);
    expect(PARAMS.easy.assumeStarts || PARAMS.normal.assumeStarts).toBe(false);
    expect(PARAMS.hard.assumeStarts && PARAMS.hard.multiProng && PARAMS.hard.harass).toBe(true);
  });
});
