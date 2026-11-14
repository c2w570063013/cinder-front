// Shared data — ids and schema are frozen; the sim session may tune numbers for balance.
import type { EntityDef, FactionDef, FactionId, QueueCategory, SupportPowerDef, SupportPowerId } from '../core/types';
import { BUILDINGS } from './buildings';
import { UNITS } from './units';

export { WARHEADS, WEAPONS } from './weapons';
export { UNITS } from './units';
export { BUILDINGS } from './buildings';

export const GAME_TITLE = '燼原戰線';
export const GAME_TITLE_EN = 'Cinder Front';

export const FACTIONS: Record<FactionId, FactionDef> = {
  helion: {
    id: 'helion',
    name: '赫利昂協約',
    nameEn: 'Helion Accord',
    desc: '精準、機動、能量武器。單位較脆但射程與速度佔優。',
    colors: ['#3fa7ff', '#35d6c4', '#b08cff', '#f2f2f2'],
    baseVehicle: 'h_crawler',
    conyard: 'h_nexus',
    startingUnits: ['h_warden', 'h_warden', 'h_warden', 'h_javelin'],
  },
  ferrum: {
    id: 'ferrum',
    name: '鐵燼辛迪加',
    nameEn: 'Ferrum Syndicate',
    desc: '重甲、烈焰、蠻力。單位便宜耐打,但行動遲緩。',
    colors: ['#ff8a2a', '#e5484d', '#e6c229', '#7bd148'],
    baseVehicle: 'f_crawler',
    conyard: 'f_core',
    startingUnits: ['f_militia', 'f_militia', 'f_militia', 'f_militia', 'f_hammer'],
  },
};

export const SUPPORT_POWERS: Record<SupportPowerId, SupportPowerDef> = {
  recon_sweep: { id: 'recon_sweep', name: '偵察掃描', nameEn: 'Recon Sweep', desc: '暫時揭露目標區域的戰爭迷霧。', recharge: 120, radius: 9, damage: 0, delay: 0, duration: 15 },
  orbital_lance: { id: 'orbital_lance', name: '天基光矛', nameEn: 'Orbital Lance', desc: '短暫延遲後,軌道光束貫穿目標區域。', recharge: 420, radius: 3.5, damage: 1100, delay: 4, duration: 2 },
  tremor: { id: 'tremor', name: '地震波', nameEn: 'Tremor', desc: '震波重創大範圍內的建築與載具,對步兵與飛行器無效。', recharge: 420, radius: 5, damage: 800, delay: 4, duration: 2 },
};

/** Look up any unit or building def by id. Throws on unknown ids. */
export function getDef(defId: string): EntityDef {
  const d = UNITS[defId] ?? BUILDINGS[defId];
  if (!d) throw new Error(`Unknown def id: ${defId}`);
  return d;
}

export function queueCategoryOf(defId: string): QueueCategory {
  return getDef(defId).category;
}

/** All defs of a faction in sidebar display order. */
export function factionDefs(faction: FactionId): EntityDef[] {
  return [...Object.values(BUILDINGS), ...Object.values(UNITS)].filter((d) => d.faction === faction);
}
