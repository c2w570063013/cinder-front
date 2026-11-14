// Pure decision functions (no world access) so they can be unit-tested with fabricated inputs.
import type { ArmorType, BuildingDef } from '../core/types';
import { WEAPONS } from '../data';
import type { FactionInfo, Params, UnitInfo } from './knowledge';

export interface BuildState {
  info: FactionInfo;
  P: Params;
  /** Own buildings of this def, including ones still rising. */
  have(defId: string): number;
  /** Can be queued right now (prerequisites met and a producer exists). */
  available(defId: string): boolean;
  credits: number;
  /** Projected power balance: produced − consumed, counting buildings still under construction / queued. */
  powerNet: number;
  minutes: number;
  /** Refineries the economy logic currently wants. */
  wantRefineries: number;
  harvesters: number;
  canBuildHarvester: boolean;
  superweaponsAllowed: boolean;
  enemyAirSeen: number;
  underAttack: boolean;
  /** Credits' worth of armed units we own — tech waits until the army can protect it. */
  armyValue: number;
}

export interface StructureChoice {
  /** Def to queue now, if any. */
  defId: string | null;
  /** Credits the unit queues should leave alone because we are saving for something. */
  reserve: number;
}

/** Next building for the structure queue, in build-order priority. */
export function chooseStructure(s: BuildState): StructureChoice {
  const { info, P } = s;
  const plant = info.power.find((p) => s.available(p.id));
  // Never sit in (projected) low power.
  if (s.powerNet < 0 && plant) return { defId: plant.id, reserve: 0 };

  // [building, wanted count, fraction of its cost we must hold before queueing it, army value required first]
  const goals: [BuildingDef | undefined, number, number, number][] = [];
  goals.push([info.power[0], 1, 0, 0], [info.refinery, 1, 0, 0]);
  // No harvesters and no way to build one: a new refinery brings a free one.
  if (s.harvesters === 0 && !s.canBuildHarvester && s.have(info.refinery.id) >= 1) {
    goals.push([info.refinery, s.have(info.refinery.id) + 1, 1, 0]);
  }
  goals.push([info.barracks, 1, 0, 0], [info.factory, 1, 0, 0]);
  goals.push([info.refinery, Math.min(2, P.maxRefineries), 0.3, 0]);
  if (P.tech >= 1) goals.push([info.radar, 1, 0.4, 1600]);
  if (P.tech >= 2) {
    for (const t of info.tech) goals.push([t, 1, 0.6, 3500]);
    goals.push([info.airpad, P.aircraftMax > 0 ? 1 : 0, 0.6, 4500]);
  }
  goals.push([info.refinery, Math.min(s.wantRefineries, P.maxRefineries), 0.5, 2500]);
  if (P.tech >= 3 && P.superweapon && s.superweaponsAllowed) goals.push([info.superweapon, 1, 0.9, 9000]);
  if (P.extraFactories > 0 && s.minutes > 6) {
    goals.push([info.factory, 1 + Math.min(P.extraFactories, Math.floor((s.minutes - 2) / 5)), 1.5, 4000]);
    goals.push([info.barracks, 2, 2.5, 6000]);
  }

  let reserve = 0;
  for (const [def, count, hold, minArmy] of goals) {
    if (!def || count <= 0 || s.have(def.id) >= count) continue;
    if (!s.available(def.id)) continue; // prerequisite missing — an earlier goal covers it
    if (s.armyValue < minArmy) continue; // army first; cheaper goals further down may still apply
    // Build the plant first if this would brown us out.
    if (def.power < 0 && s.powerNet + def.power < P.powerMargin && plant) return { defId: plant.id, reserve: 0 };
    if (s.credits < def.cost * hold) {
      reserve = Math.max(reserve, def.cost * hold * 0.5);
      continue;
    }
    return { defId: def.id, reserve: 0 };
  }
  // Nothing on the list: spare plant when the margin is thin.
  if (plant && s.powerNet < P.powerMargin + 20 && s.credits > plant.cost * 2) return { defId: plant.id, reserve: 0 };
  return { defId: null, reserve };
}

export interface DefenseChoice {
  defId: string | null;
  /** The pick was held back only because of power; a plant should come first. */
  powerShort: number;
  antiAir: boolean;
}

/** Next item for the defence queue. */
export function chooseDefense(s: BuildState): DefenseChoice {
  const { info, P } = s;
  const none: DefenseChoice = { defId: null, powerShort: 0, antiAir: false };
  // Economy and a factory come first, unless someone is already shooting at the base.
  const established = !!info.factory && s.have(info.factory.id) >= 1 && s.have(info.refinery.id) >= 1;
  if (!established && !(s.underAttack && s.have(info.refinery.id) >= 1)) return none;

  const ground = info.groundDefenses.filter((d) => s.available(d.id));
  const air = info.airDefenses.filter((d) => s.available(d.id));
  const groundHave = info.groundDefenses.reduce((n, d) => n + s.have(d.id), 0);
  const airHave = info.airDefenses.reduce((n, d) => n + s.have(d.id), 0);
  const groundWant = Math.min(P.groundDefMax, P.groundDefBase + Math.floor(s.minutes / 5));
  const airWant = s.enemyAirSeen > 0 ? Math.min(P.airDefMax, 1 + Math.ceil(s.enemyAirSeen / 2)) : s.minutes > 10 && P.tech >= 2 ? 1 : 0;

  let pick: BuildingDef | undefined;
  let antiAir = false;
  if (air.length && airHave < airWant && (s.enemyAirSeen > 0 || groundHave >= groundWant)) {
    pick = air[0];
    antiAir = true;
  } else if (ground.length && groundHave < groundWant) {
    // Mostly cheap anti-infantry posts, with a heavy anti-armour battery every third slot.
    const cheap = ground[0];
    const heavy = ground[ground.length - 1];
    pick = heavy !== cheap && s.have(heavy.id) * 2 < s.have(cheap.id) ? heavy : cheap;
  }
  if (!pick) return none;
  const margin = s.underAttack ? 0 : 400;
  if (s.credits < pick.cost + margin) return none;
  if (pick.power < 0 && s.powerNet + pick.power < P.powerMargin) return { defId: null, powerShort: -pick.power, antiAir };
  return { defId: pick.id, powerShort: 0, antiAir };
}

// ───────────────────────────── army composition ─────────────────────────────

/** What we have seen of the enemy: rough counts per armour class, plus static defences. */
export interface EnemyMix {
  infantry: number;
  light: number;
  heavy: number;
  air: number;
  defenses: number;
}

export const emptyMix = (): EnemyMix => ({ infantry: 0, light: 0, heavy: 0, air: 0, defenses: 0 });

/**
 * How useful a unit is against the observed enemy mix: damage-per-second weighted by what the enemy
 * fields, times staying power, per credit.
 */
export function unitValue(u: UnitInfo, mix: EnemyMix): number {
  const seen = mix.infantry + mix.light + mix.heavy;
  // Before contact assume a bit of everything.
  const w: Record<ArmorType, number> =
    seen < 3
      ? { infantry: 0.3, light: 0.2, heavy: 0.3, building: 0.2, air: 0 }
      : {
          infantry: (0.8 * mix.infantry) / seen + 0.05,
          light: (0.8 * mix.light) / seen + 0.05,
          heavy: (0.8 * mix.heavy) / seen + 0.05,
          building: 0.15,
          air: 0,
        };
  let dps = 0;
  for (const a of ['infantry', 'light', 'heavy', 'building'] as ArmorType[]) dps += w[a] * u.dps[a];
  return (dps * Math.sqrt(u.def.hp)) / u.def.cost;
}

export interface UnitPickState {
  /** Combat units that can be queued right now in this category. */
  options: UnitInfo[];
  /** Own unit counts by def id (alive + queued). */
  counts(defId: string): number;
  mix: EnemyMix;
  /** Own units able to shoot aircraft (all categories). */
  antiAirOwned: number;
  /** Own non-siege frontline ground units (all categories). */
  frontline: number;
  /** Uniform random in [0,1) for variety. */
  rand(): number;
}

/** Pick the next unit to queue so the army drifts toward the best composition for what we have seen. */
export function chooseUnit(s: UnitPickState): string | null {
  const opts = s.options;
  if (opts.length === 0) return null;

  // Enemy aircraft: get enough anti-air first.
  const aaWanted = s.mix.air > 0 ? Math.ceil(s.mix.air * 0.8) + 1 : 0;
  if (s.antiAirOwned < aaWanted) {
    const aa = opts.filter((u) => u.antiAir).sort((a, b) => b.dps.air / b.def.cost - a.dps.air / a.def.cost)[0];
    if (aa) return aa.def.id;
  }

  const usable = opts.filter((u) => u.antiGround);
  if (usable.length === 0) return null;
  const total = usable.reduce((n, u) => n + s.counts(u.def.id), 0);
  const siegeShare = Math.min(0.35, 0.08 + 0.05 * s.mix.defenses);

  let best: string | null = null;
  let bestScore = -Infinity;
  let valueSum = 0;
  const values = usable.map((u) => {
    let v = unitValue(u, s.mix);
    if (u.siege) v = s.frontline >= 4 ? v : 0; // artillery needs a screen
    valueSum += v;
    return v;
  });
  for (let i = 0; i < usable.length; i++) {
    const u = usable[i];
    if (values[i] <= 0) continue;
    // Desired share: proportional to value squared (favour the good counters), artillery by need.
    let share = valueSum > 0 ? values[i] / valueSum : 0;
    if (u.siege) share = siegeShare / Math.max(1, usable.filter((x) => x.siege).length);
    const current = total > 0 ? s.counts(u.def.id) / total : 0;
    const score = share - current + s.rand() * 0.08;
    if (score > bestScore) {
      bestScore = score;
      best = u.def.id;
    }
  }
  return best;
}

/** Wave strength (credits of army value) required before attacking at a given game time. */
export function waveThreshold(P: Params, minutes: number): number {
  return Math.min(P.waveMax, P.waveBase + P.waveGrowthPerMin * Math.max(0, minutes - P.firstAttackSec / 60));
}

/** Range of a defence building's weapon (0 if unarmed). */
export function defenseRange(def: BuildingDef): number {
  return def.weapon ? (WEAPONS[def.weapon]?.range ?? 0) : 0;
}
