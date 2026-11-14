// Shared data — ids and schema are frozen; the sim session may tune numbers for balance.
import type { ArmorType, WarheadId, WeaponDef } from '../core/types';

/** Damage multiplier: WARHEADS[warhead][armor]. */
export const WARHEADS: Record<WarheadId, Record<ArmorType, number>> = {
  bullet: { infantry: 1.0, light: 0.55, heavy: 0.2, building: 0.25, air: 0.5 },
  ap: { infantry: 0.3, light: 0.9, heavy: 1.0, building: 0.65, air: 0.6 },
  he: { infantry: 1.0, light: 0.8, heavy: 0.55, building: 1.0, air: 0.2 },
  flame: { infantry: 1.3, light: 0.7, heavy: 0.25, building: 1.1, air: 0.0 },
  energy: { infantry: 0.8, light: 1.0, heavy: 1.0, building: 0.8, air: 0.8 },
  flak: { infantry: 0.3, light: 0.3, heavy: 0.1, building: 0.1, air: 1.0 },
};

const G = { targetsGround: true, targetsAir: false };
const A = { targetsGround: false, targetsAir: true };
const GA = { targetsGround: true, targetsAir: true };

const list: WeaponDef[] = [
  // ── Helion Accord ──
  { id: 'h_rifle', damage: 12, range: 4.5, cooldown: 0.6, projectile: 'tracer', warhead: 'bullet', ...G, color: '#bfe6ff' },
  { id: 'h_rocket', damage: 42, range: 6, cooldown: 2.2, projectile: 'missile', projectileSpeed: 9, splash: 0.3, warhead: 'ap', ...GA, color: '#9fd4ff' },
  { id: 'h_ranger_mg', damage: 14, range: 5, cooldown: 0.4, projectile: 'tracer', warhead: 'bullet', ...G, color: '#bfe6ff' },
  { id: 'h_javelin_cannon', damage: 55, range: 5.5, cooldown: 1.8, projectile: 'shell', projectileSpeed: 16, splash: 0.3, warhead: 'ap', ...G, color: '#ffe9a8' },
  { id: 'h_rail', damage: 150, range: 8, cooldown: 3.5, projectile: 'beam', warhead: 'energy', ...G, color: '#6ff3ff' },
  { id: 'h_howitzer', damage: 120, range: 13, minRange: 3, cooldown: 5, projectile: 'arc', projectileSpeed: 7, splash: 1.5, warhead: 'he', ...G, color: '#ffd27a' },
  { id: 'h_skyveil', damage: 36, range: 8, cooldown: 1.0, projectile: 'missile', projectileSpeed: 14, warhead: 'flak', ...A, color: '#9fd4ff' },
  { id: 'h_kestrel_cannon', damage: 24, range: 5, cooldown: 0.5, projectile: 'tracer', warhead: 'ap', ...G, color: '#bfe6ff' },
  { id: 'h_sentry', damage: 18, range: 6, cooldown: 0.35, projectile: 'tracer', warhead: 'bullet', ...G, color: '#bfe6ff' },
  { id: 'h_railturret', damage: 170, range: 8.5, cooldown: 3.2, projectile: 'beam', warhead: 'energy', ...G, color: '#6ff3ff' },
  { id: 'h_skyshield', damage: 50, range: 10, cooldown: 1.2, projectile: 'missile', projectileSpeed: 15, warhead: 'flak', ...A, color: '#9fd4ff' },

  // ── Ferrum Syndicate ──
  { id: 'f_smg', damage: 10, range: 4, cooldown: 0.5, projectile: 'tracer', warhead: 'bullet', ...G, color: '#ffd9a0' },
  { id: 'f_flamer', damage: 9, range: 2.6, cooldown: 0.15, projectile: 'flame', splash: 0.6, warhead: 'flame', ...G, color: '#ff8a3c' },
  { id: 'f_grenade', damage: 46, range: 5, cooldown: 2.4, projectile: 'arc', projectileSpeed: 7, splash: 0.8, warhead: 'he', ...G, color: '#ffb35c' },
  { id: 'f_hammer_cannon', damage: 78, range: 5.5, cooldown: 2.2, projectile: 'shell', projectileSpeed: 14, splash: 0.35, warhead: 'ap', ...G, color: '#ffcf8a' },
  { id: 'f_colossus_cannon', damage: 105, range: 6, cooldown: 2.6, burst: 2, projectile: 'shell', projectileSpeed: 14, splash: 0.5, warhead: 'ap', ...G, color: '#ffcf8a' },
  { id: 'f_colossus_aa', damage: 30, range: 7, cooldown: 1.6, projectile: 'missile', projectileSpeed: 13, warhead: 'flak', ...A, color: '#ffb35c' },
  { id: 'f_salamander', damage: 16, range: 3.2, cooldown: 0.15, projectile: 'flame', splash: 0.8, warhead: 'flame', ...G, color: '#ff7a2a' },
  { id: 'f_hailstorm', damage: 44, range: 12, minRange: 3, cooldown: 6, burst: 4, projectile: 'missile', projectileSpeed: 9, splash: 1.2, warhead: 'he', ...G, color: '#ffb35c' },
  { id: 'f_flak', damage: 30, range: 8, cooldown: 0.7, projectile: 'flakburst', splash: 0.8, warhead: 'flak', ...A, color: '#ffe0b0' },
  { id: 'f_vulture_bomb', damage: 150, range: 1.2, cooldown: 3, projectile: 'bomb', projectileSpeed: 6, splash: 1.5, warhead: 'he', ...G, color: '#ffb35c' },
  { id: 'f_bunker', damage: 20, range: 6, cooldown: 0.35, projectile: 'tracer', warhead: 'bullet', ...G, color: '#ffd9a0' },
  { id: 'f_siege', damage: 135, range: 9, cooldown: 3, projectile: 'shell', projectileSpeed: 15, splash: 0.6, warhead: 'ap', ...G, color: '#ffcf8a' },
  { id: 'f_flaknest', damage: 45, range: 10, cooldown: 0.9, projectile: 'flakburst', splash: 1.0, warhead: 'flak', ...A, color: '#ffe0b0' },
];

export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries(list.map((w) => [w.id, w]));
