// Everything the AI knows about a faction is derived from src/data — no hard-coded unit or building ids.
import type { ArmorType, BuildingDef, Difficulty, FactionId, UnitDef, WeaponDef } from '../core/types';
import { BUILDINGS, FACTIONS, SUPPORT_POWERS, UNITS, WARHEADS, WEAPONS } from '../data';

export const ARMORS: ArmorType[] = ['infantry', 'light', 'heavy', 'building', 'air'];

export interface UnitInfo {
  def: UnitDef;
  /** Damage per second against each armour class (0 when the unit cannot target it). */
  dps: Record<ArmorType, number>;
  /** Can hurt things on the ground at all. */
  antiGround: boolean;
  antiAir: boolean;
  /** Longest weapon range. */
  range: number;
  /** Long-range bombardment unit (outranges static defences). */
  siege: boolean;
  isAir: boolean;
}

export interface FactionInfo {
  faction: FactionId;
  conyard: BuildingDef;
  baseVehicle: UnitDef;
  /** Buildable power plants, best value first. */
  power: BuildingDef[];
  refinery: BuildingDef;
  harvester: UnitDef;
  barracks?: BuildingDef;
  factory?: BuildingDef;
  airpad?: BuildingDef;
  radar?: BuildingDef;
  /** Pure tech-unlock buildings (labs), cheapest first. */
  tech: BuildingDef[];
  superweapon?: BuildingDef;
  groundDefenses: BuildingDef[];
  airDefenses: BuildingDef[];
  /** Armed, non-utility units. */
  combat: UnitInfo[];
  engineer?: UnitDef;
  /** Cheap fast armed unit for scouting. */
  scout?: UnitDef;
}

function weaponDps(w: WeaponDef, armor: ArmorType): number {
  const targets = armor === 'air' ? w.targetsAir : w.targetsGround;
  if (!targets) return 0;
  return ((w.damage * (w.burst ?? 1)) / w.cooldown) * WARHEADS[w.warhead][armor];
}

export function describeUnit(def: UnitDef): UnitInfo {
  const weapons = [def.weapon, def.secondary].filter((id): id is string => !!id).map((id) => WEAPONS[id]).filter(Boolean);
  const dps = { infantry: 0, light: 0, heavy: 0, building: 0, air: 0 } as Record<ArmorType, number>;
  let range = 0;
  let siege = false;
  for (const w of weapons) {
    for (const a of ARMORS) dps[a] += weaponDps(w, a);
    range = Math.max(range, w.range);
    if (w.targetsGround && w.range >= 9) siege = true;
  }
  return {
    def,
    dps,
    antiGround: weapons.some((w) => w.targetsGround),
    antiAir: weapons.some((w) => w.targetsAir),
    range,
    siege,
    isAir: def.movement === 'air',
  };
}

const infoCache = new Map<FactionId, FactionInfo>();

export function factionInfo(faction: FactionId): FactionInfo {
  const cached = infoCache.get(faction);
  if (cached) return cached;
  const f = FACTIONS[faction];
  const blds = Object.values(BUILDINGS).filter((b) => b.faction === faction);
  const units = Object.values(UNITS).filter((u) => u.faction === faction);
  const buildable = blds.filter((b) => b.buildable && !b.wall);
  const structures = buildable.filter((b) => b.category === 'structure');
  const produces = (cat: 'infantry' | 'vehicle' | 'aircraft'): BuildingDef | undefined =>
    structures.filter((b) => b.produces?.includes(cat)).sort((a, b) => a.cost - b.cost)[0];
  const allPrereqs = new Set<string>();
  for (const d of [...blds, ...units]) for (const p of d.prereqs) allPrereqs.add(p);

  const power = structures.filter((b) => b.power > 0).sort((a, b) => b.power / b.cost - a.power / a.cost);
  const refinery = structures.find((b) => b.refinery)!;
  const harvester = units.find((u) => u.harvester)!;
  const superweapon = structures.find((b) => b.supportPower && SUPPORT_POWERS[b.supportPower].damage > 0);
  const radar = structures.find((b) => b.radar);
  const tech = structures
    .filter((b) => b.power <= 0 && !b.refinery && !b.produces && !b.radar && !b.supportPower && allPrereqs.has(b.id))
    .sort((a, b) => a.cost - b.cost);
  const defenses = buildable.filter((b) => b.category === 'defense' && b.weapon && WEAPONS[b.weapon]);
  const combat = units.filter((u) => u.weapon && !u.harvester && !u.deploysTo && !u.engineer).map(describeUnit);
  const scout = combat
    .filter((u) => u.antiGround && !u.isAir && u.def.cost <= 700)
    .sort((a, b) => b.def.speed - a.def.speed || a.def.cost - b.def.cost)[0]?.def;

  const info: FactionInfo = {
    faction,
    conyard: BUILDINGS[f.conyard],
    baseVehicle: UNITS[f.baseVehicle],
    power,
    refinery,
    harvester,
    barracks: produces('infantry'),
    factory: produces('vehicle'),
    airpad: produces('aircraft'),
    radar,
    tech,
    superweapon,
    groundDefenses: defenses.filter((b) => WEAPONS[b.weapon!].targetsGround).sort((a, b) => a.cost - b.cost),
    airDefenses: defenses.filter((b) => WEAPONS[b.weapon!].targetsAir).sort((a, b) => a.cost - b.cost),
    combat,
    engineer: units.find((u) => u.engineer),
    scout,
  };
  infoCache.set(faction, info);
  return info;
}

const unitInfoCache = new Map<string, UnitInfo | null>();
/** Combat description of any unit def id (null for buildings / unknown ids). */
export function unitInfo(defId: string): UnitInfo | null {
  let v = unitInfoCache.get(defId);
  if (v === undefined) {
    const d = UNITS[defId];
    v = d ? describeUnit(d) : null;
    unitInfoCache.set(defId, v);
  }
  return v;
}

/** How much the AI wants a given enemy building dead (higher = sooner). */
export function buildingPriority(def: BuildingDef): number {
  if (def.refinery) return 10;
  if (def.supportPower && SUPPORT_POWERS[def.supportPower].damage > 0) return 9;
  if (def.power > 0 && !def.conyard) return 8;
  if (def.produces && !def.conyard) return 7;
  if (def.conyard) return 6.5;
  if (def.radar) return 6;
  if (def.category === 'defense') return def.wall ? 0.5 : 4;
  return 5;
}

// ───────────────────────────── difficulty ─────────────────────────────

export interface Params {
  /** Ticks between world scans / military decisions. */
  scanEvery: number;
  /** Ticks between economy decisions. */
  econEvery: number;
  /** Seconds of deliberate idling after each structure is placed. */
  structureGapSec: number;
  /** Seconds of deliberate idling in each unit queue after an item is queued. */
  unitGapSec: number;
  /** 1 = up to radar, 2 = + airfield and lab, 3 = everything. */
  tech: number;
  superweapon: boolean;
  harvPerRefinery: number;
  maxRefineries: number;
  maxHarvesters: number;
  /** Ground defences wanted early, and the cap they grow to. */
  groundDefBase: number;
  groundDefMax: number;
  airDefMax: number;
  firstAttackSec: number;
  /** Wave strength threshold in credits of army value: base + growth per minute, capped. */
  waveBase: number;
  waveGrowthPerMin: number;
  waveMax: number;
  waveCooldownSec: number;
  /** Stop building army beyond this value. */
  maxArmyValue: number;
  retreat: boolean;
  focusFire: boolean;
  multiProng: boolean;
  harass: boolean;
  /** May assume enemies sit on the map's start positions before scouting them. */
  assumeStarts: boolean;
  queueDepth: number;
  aircraftMax: number;
  extraFactories: number;
  /** Keep (produced - consumed) at least this high after any new building. */
  powerMargin: number;
  /** Fraction of the pool kept home when a wave leaves. */
  homeGuard: number;
  /** A wave only leaves when it is at least this multiple of the largest enemy force seen. */
  launchRatio: number;
  /** Assumed enemy army value per minute of game time when we have not seen better (0 = trust only what was seen). */
  enemyPriorPerMin: number;
  enemyPriorMax: number;
}

export const PARAMS: Record<Difficulty, Params> = {
  easy: {
    scanEvery: 20,
    econEvery: 40,
    structureGapSec: 14,
    unitGapSec: 26,
    tech: 1,
    superweapon: false,
    harvPerRefinery: 1,
    maxRefineries: 2,
    maxHarvesters: 3,
    groundDefBase: 1,
    groundDefMax: 2,
    airDefMax: 1,
    firstAttackSec: 420,
    waveBase: 1300,
    waveGrowthPerMin: 120,
    waveMax: 3200,
    waveCooldownSec: 150,
    maxArmyValue: 4200,
    retreat: false,
    focusFire: false,
    multiProng: false,
    harass: false,
    assumeStarts: false,
    queueDepth: 1,
    aircraftMax: 0,
    extraFactories: 0,
    powerMargin: 0,
    homeGuard: 0.3,
    launchRatio: 0,
    enemyPriorPerMin: 0,
    enemyPriorMax: 0,
  },
  normal: {
    scanEvery: 10,
    econEvery: 20,
    structureGapSec: 0,
    unitGapSec: 0,
    tech: 3,
    superweapon: true,
    harvPerRefinery: 2,
    maxRefineries: 3,
    maxHarvesters: 6,
    groundDefBase: 2,
    groundDefMax: 5,
    airDefMax: 3,
    firstAttackSec: 300,
    waveBase: 3600,
    waveGrowthPerMin: 450,
    waveMax: 11000,
    waveCooldownSec: 60,
    maxArmyValue: 26000,
    retreat: true,
    focusFire: false,
    multiProng: false,
    harass: false,
    assumeStarts: false,
    queueDepth: 1,
    aircraftMax: 3,
    extraFactories: 1,
    powerMargin: 0,
    homeGuard: 0.15,
    launchRatio: 1.15,
    enemyPriorPerMin: 0,
    enemyPriorMax: 0,
  },
  hard: {
    scanEvery: 10,
    econEvery: 10,
    structureGapSec: 0,
    unitGapSec: 0,
    tech: 3,
    superweapon: true,
    harvPerRefinery: 2.5,
    maxRefineries: 4,
    maxHarvesters: 7,
    groundDefBase: 3,
    groundDefMax: 8,
    airDefMax: 4,
    firstAttackSec: 285,
    waveBase: 5200,
    waveGrowthPerMin: 750,
    waveMax: 16000,
    waveCooldownSec: 30,
    maxArmyValue: 42000,
    retreat: true,
    focusFire: true,
    multiProng: true,
    harass: true,
    assumeStarts: true,
    queueDepth: 2,
    aircraftMax: 6,
    extraFactories: 2,
    powerMargin: 15,
    homeGuard: 0.1,
    launchRatio: 1.3,
    enemyPriorPerMin: 1100,
    enemyPriorMax: 9000,
  },
};
