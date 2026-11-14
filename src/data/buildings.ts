// Shared data — ids and schema are frozen; the sim session may tune numbers for balance.
import type { BuildingDef } from '../core/types';

type B = Omit<BuildingDef, 'kind'>;
const st = { category: 'structure', armor: 'building', buildable: true, sight: 6 } as const;
const df = { category: 'defense', armor: 'building', buildable: true, sight: 8, footprint: { w: 1, h: 1 } } as const;
const fp = (w: number, h: number) => ({ w, h });

const list: B[] = [
  // ══════════ Helion Accord ══════════
  { ...st, id: 'h_nexus', name: '指揮中樞', nameEn: 'Command Nexus', desc: '基地核心,允許建造建築與防禦。', faction: 'helion', cost: 3000, buildTime: 30, hp: 1600, footprint: fp(3, 3), power: 20, prereqs: [], buildable: false, conyard: true, produces: ['structure', 'defense'] },
  { ...st, id: 'h_power', name: '聚變電站', nameEn: 'Fusion Plant', desc: '提供電力。', faction: 'helion', cost: 600, buildTime: 9, hp: 700, footprint: fp(2, 2), power: 120, prereqs: ['h_nexus'] },
  { ...st, id: 'h_refinery', name: '精煉廠', nameEn: 'Refinery', desc: '將晶礦轉為資金,附贈一輛採晶車。', faction: 'helion', cost: 2000, buildTime: 18, hp: 1000, footprint: fp(3, 3), power: -40, prereqs: ['h_power'], refinery: true, freeUnit: 'h_harvester' },
  { ...st, id: 'h_barracks', name: '訓練營', nameEn: 'Training Camp', desc: '訓練步兵。', faction: 'helion', cost: 500, buildTime: 8, hp: 800, footprint: fp(2, 2), power: -15, prereqs: ['h_power'], produces: ['infantry'] },
  { ...st, id: 'h_factory', name: '機械廠', nameEn: 'Vehicle Bay', desc: '生產載具。', faction: 'helion', cost: 2000, buildTime: 18, hp: 1100, footprint: fp(3, 3), power: -30, prereqs: ['h_refinery'], produces: ['vehicle'] },
  { ...st, id: 'h_radar', name: '偵測陣列', nameEn: 'Sensor Array', desc: '啟用雷達小地圖與偵察掃描,解鎖進階單位。', faction: 'helion', cost: 1000, buildTime: 12, hp: 750, footprint: fp(2, 2), power: -50, sight: 10, prereqs: ['h_refinery'], radar: true, supportPower: 'recon_sweep' },
  { ...st, id: 'h_airpad', name: '飛行甲板', nameEn: 'Flight Deck', desc: '生產飛行器。', faction: 'helion', cost: 1200, buildTime: 14, hp: 800, footprint: fp(3, 2), power: -40, prereqs: ['h_radar'], produces: ['aircraft'] },
  { ...st, id: 'h_lab', name: '研究所', nameEn: 'Tech Lab', desc: '解鎖最高階科技。', faction: 'helion', cost: 2000, buildTime: 20, hp: 700, footprint: fp(3, 2), power: -100, prereqs: ['h_radar', 'h_factory'] },
  { ...st, id: 'h_uplink', name: '軌道信標', nameEn: 'Orbital Uplink', desc: '超級武器:召喚天基光矛轟擊目標區域。', faction: 'helion', cost: 5000, buildTime: 40, hp: 1000, footprint: fp(3, 3), power: -200, prereqs: ['h_lab'], supportPower: 'orbital_lance' },
  { ...df, id: 'h_wall', name: '複合護牆', nameEn: 'Composite Wall', desc: '阻擋地面單位。', faction: 'helion', cost: 100, buildTime: 2, hp: 400, power: 0, sight: 1, prereqs: ['h_barracks'], wall: true },
  { ...df, id: 'h_sentry', name: '哨戒機砲', nameEn: 'Sentry Gun', desc: '自動機砲,壓制步兵與輕甲。', faction: 'helion', cost: 500, buildTime: 7, hp: 450, power: -10, weapon: 'h_sentry', turret: true, prereqs: ['h_barracks'] },
  { ...df, id: 'h_skyshield', name: '天盾', nameEn: 'Skyshield', desc: '防空飛彈陣地。', faction: 'helion', cost: 800, buildTime: 9, hp: 500, power: -30, sight: 10, weapon: 'h_skyshield', turret: true, needsPower: true, prereqs: ['h_radar'] },
  { ...df, id: 'h_railturret', name: '磁軌砲塔', nameEn: 'Railgun Turret', desc: '高耗電的反裝甲砲塔,斷電即停擺。', faction: 'helion', cost: 1300, buildTime: 13, hp: 600, power: -70, sight: 9, weapon: 'h_railturret', turret: true, needsPower: true, prereqs: ['h_radar'] },

  // ══════════ Ferrum Syndicate ══════════
  { ...st, id: 'f_core', name: '熔爐核心', nameEn: 'Foundry Core', desc: '基地核心,允許建造建築與防禦。', faction: 'ferrum', cost: 3000, buildTime: 30, hp: 1900, footprint: fp(3, 3), power: 20, prereqs: [], buildable: false, conyard: true, produces: ['structure', 'defense'] },
  { ...st, id: 'f_power', name: '熱能電站', nameEn: 'Thermal Plant', desc: '提供電力,便宜但產能較低。', faction: 'ferrum', cost: 450, buildTime: 8, hp: 800, footprint: fp(2, 2), power: 90, prereqs: ['f_core'] },
  { ...st, id: 'f_refinery', name: '熔煉廠', nameEn: 'Smelter', desc: '將晶礦轉為資金,附贈一輛運礦車。', faction: 'ferrum', cost: 2000, buildTime: 18, hp: 1200, footprint: fp(3, 3), power: -35, prereqs: ['f_power'], refinery: true, freeUnit: 'f_hauler' },
  { ...st, id: 'f_barracks', name: '徵募站', nameEn: 'Muster Hall', desc: '訓練步兵。', faction: 'ferrum', cost: 450, buildTime: 7, hp: 900, footprint: fp(2, 2), power: -10, prereqs: ['f_power'], produces: ['infantry'] },
  { ...st, id: 'f_factory', name: '裝配廠', nameEn: 'Assembly Yard', desc: '生產載具。', faction: 'ferrum', cost: 2000, buildTime: 18, hp: 1300, footprint: fp(3, 3), power: -25, prereqs: ['f_refinery'], produces: ['vehicle'] },
  { ...st, id: 'f_radar', name: '監聽塔', nameEn: 'Watch Spire', desc: '啟用雷達小地圖與偵察掃描,解鎖進階單位。', faction: 'ferrum', cost: 1000, buildTime: 12, hp: 850, footprint: fp(2, 2), power: -40, sight: 10, prereqs: ['f_refinery'], radar: true, supportPower: 'recon_sweep' },
  { ...st, id: 'f_airpad', name: '起降場', nameEn: 'Launch Yard', desc: '生產飛行器。', faction: 'ferrum', cost: 1200, buildTime: 14, hp: 900, footprint: fp(3, 2), power: -35, prereqs: ['f_radar'], produces: ['aircraft'] },
  { ...st, id: 'f_lab', name: '重工局', nameEn: 'Heavy Bureau', desc: '解鎖最高階科技。', faction: 'ferrum', cost: 2000, buildTime: 20, hp: 850, footprint: fp(3, 2), power: -90, prereqs: ['f_radar', 'f_factory'] },
  { ...st, id: 'f_drill', name: '震地鑽井', nameEn: 'Seismic Drill', desc: '超級武器:引發地震波摧毀目標區域的建築與載具。', faction: 'ferrum', cost: 5000, buildTime: 40, hp: 1200, footprint: fp(3, 3), power: -180, prereqs: ['f_lab'], supportPower: 'tremor' },
  { ...df, id: 'f_wall', name: '鋼筋路障', nameEn: 'Rebar Barrier', desc: '阻擋地面單位。', faction: 'ferrum', cost: 100, buildTime: 2, hp: 500, power: 0, sight: 1, prereqs: ['f_barracks'], wall: true },
  { ...df, id: 'f_bunker', name: '機槍碉堡', nameEn: 'Gun Bunker', desc: '不需電力的堅固機槍陣地。', faction: 'ferrum', cost: 450, buildTime: 7, hp: 650, power: 0, weapon: 'f_bunker', prereqs: ['f_barracks'] },
  { ...df, id: 'f_flaknest', name: '高射砲巢', nameEn: 'Flak Nest', desc: '防空砲陣地。', faction: 'ferrum', cost: 750, buildTime: 9, hp: 600, power: -20, sight: 10, weapon: 'f_flaknest', turret: true, needsPower: true, prereqs: ['f_radar'] },
  { ...df, id: 'f_siege', name: '攻城砲台', nameEn: 'Siege Battery', desc: '重型反裝甲砲台。', faction: 'ferrum', cost: 1200, buildTime: 13, hp: 800, power: -50, sight: 9, weapon: 'f_siege', turret: true, needsPower: true, prereqs: ['f_radar'] },
];

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(list.map((b) => [b.id, { kind: 'building', ...b }]));
