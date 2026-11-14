// Shared data — ids and schema are frozen; the sim session may tune numbers for balance.
import type { UnitDef } from '../core/types';

type U = Omit<UnitDef, 'kind'>;
const inf = { category: 'infantry', movement: 'foot', armor: 'infantry', radius: 0.18, turret: false, turnRate: 12 } as const;
const veh = { category: 'vehicle', armor: 'heavy', radius: 0.42, turret: true } as const;

const list: U[] = [
  // ══════════ Helion Accord 赫利昂協約 — precise, mobile, energy weapons ══════════
  { ...inf, id: 'h_warden', name: '衛士', nameEn: 'Warden', desc: '基礎步兵,對付步兵有效。', faction: 'helion', cost: 120, buildTime: 4, hp: 110, speed: 1.5, sight: 6, weapon: 'h_rifle', prereqs: ['h_barracks'] },
  { ...inf, id: 'h_breacher', name: '破甲兵', nameEn: 'Breacher', desc: '肩射飛彈,可攻擊載具與飛行器。', faction: 'helion', cost: 300, buildTime: 7, hp: 100, speed: 1.3, sight: 6, weapon: 'h_rocket', prereqs: ['h_barracks'] },
  { ...inf, id: 'h_engineer', name: '工程師', nameEn: 'Engineer', desc: '進入敵方建築將其佔領,或瞬間修復己方建築。', faction: 'helion', cost: 500, buildTime: 9, hp: 75, speed: 1.4, sight: 5, prereqs: ['h_barracks'], engineer: true },
  { ...veh, id: 'h_harvester', name: '採晶車', nameEn: 'Prospector', desc: '採集晶礦並運回精煉廠。', faction: 'helion', cost: 1400, buildTime: 16, hp: 900, speed: 1.6, turnRate: 3, sight: 5, movement: 'track', prereqs: ['h_factory', 'h_refinery'], radius: 0.48, turret: false, crusher: true, harvester: { capacity: 20 } },
  { ...veh, id: 'h_ranger', name: '遊騎', nameEn: 'Ranger', desc: '高速偵察車,機槍壓制步兵。', faction: 'helion', cost: 500, buildTime: 8, hp: 260, armor: 'light', speed: 3.4, turnRate: 5, sight: 9, weapon: 'h_ranger_mg', movement: 'wheel', prereqs: ['h_factory'], radius: 0.36 },
  { ...veh, id: 'h_javelin', name: '標槍坦克', nameEn: 'Javelin Tank', desc: '均衡的主戰坦克。', faction: 'helion', cost: 800, buildTime: 12, hp: 420, speed: 2.2, turnRate: 3.2, sight: 7, weapon: 'h_javelin_cannon', movement: 'track', prereqs: ['h_factory'], crusher: true },
  { ...veh, id: 'h_skyveil', name: '天幕', nameEn: 'Skyveil', desc: '機動防空飛彈車,只能對空。', faction: 'helion', cost: 700, buildTime: 10, hp: 300, armor: 'light', speed: 2.6, turnRate: 4, sight: 8, weapon: 'h_skyveil', movement: 'wheel', prereqs: ['h_factory', 'h_radar'] },
  { ...veh, id: 'h_farstrike', name: '遠雷', nameEn: 'Farstrike', desc: '遠程自走砲,近身無力。', faction: 'helion', cost: 1100, buildTime: 15, hp: 240, armor: 'light', speed: 1.7, turnRate: 2.4, sight: 7, weapon: 'h_howitzer', movement: 'track', prereqs: ['h_factory', 'h_radar'], turret: false },
  { ...veh, id: 'h_arbiter', name: '裁決者', nameEn: 'Arbiter', desc: '磁軌砲獵殺者,遠距離一擊重創裝甲。', faction: 'helion', cost: 1500, buildTime: 18, hp: 380, speed: 2.0, turnRate: 2.8, sight: 9, weapon: 'h_rail', movement: 'track', prereqs: ['h_factory', 'h_lab'], crusher: true },
  { ...veh, id: 'h_crawler', name: '中樞車', nameEn: 'Nexus Crawler', desc: '展開成為指揮中樞。', faction: 'helion', cost: 3000, buildTime: 30, hp: 1000, speed: 1.3, turnRate: 2, sight: 6, movement: 'track', prereqs: ['h_factory', 'h_lab'], radius: 0.5, turret: false, crusher: true, deploysTo: 'h_nexus' },
  { id: 'h_kestrel', name: '紅隼', nameEn: 'Kestrel', desc: '垂直起降砲艇,機動支援。', faction: 'helion', category: 'aircraft', cost: 1200, buildTime: 15, hp: 280, armor: 'air', speed: 4.2, turnRate: 4, sight: 9, weapon: 'h_kestrel_cannon', movement: 'air', prereqs: ['h_airpad'], radius: 0.4, turret: false, altitude: 2.2 },

  // ══════════ Ferrum Syndicate 鐵燼辛迪加 — heavy armour, fire, brute force ══════════
  { ...inf, id: 'f_militia', name: '民兵', nameEn: 'Militia', desc: '廉價步兵,以量取勝。', faction: 'ferrum', cost: 90, buildTime: 3.5, hp: 95, speed: 1.5, sight: 6, weapon: 'f_smg', prereqs: ['f_barracks'] },
  { ...inf, id: 'f_grenadier', name: '擲彈兵', nameEn: 'Grenadier', desc: '拋射榴彈,對建築與輕甲有效。', faction: 'ferrum', cost: 260, buildTime: 6.5, hp: 110, speed: 1.3, sight: 6, weapon: 'f_grenade', prereqs: ['f_barracks'] },
  { ...inf, id: 'f_scorcher', name: '灼燒兵', nameEn: 'Scorcher', desc: '火焰噴射器,近距離清掃步兵與建築。', faction: 'ferrum', cost: 350, buildTime: 7, hp: 140, speed: 1.3, sight: 5, weapon: 'f_flamer', prereqs: ['f_barracks', 'f_radar'] },
  { ...inf, id: 'f_sapper', name: '工兵', nameEn: 'Sapper', desc: '進入敵方建築將其佔領,或瞬間修復己方建築。', faction: 'ferrum', cost: 500, buildTime: 9, hp: 75, speed: 1.4, sight: 5, prereqs: ['f_barracks'], engineer: true },
  { ...veh, id: 'f_hauler', name: '運礦車', nameEn: 'Hauler', desc: '採集晶礦並運回熔煉廠,皮糙肉厚。', faction: 'ferrum', cost: 1400, buildTime: 16, hp: 1100, speed: 1.4, turnRate: 2.8, sight: 5, movement: 'track', prereqs: ['f_factory', 'f_refinery'], radius: 0.48, turret: false, crusher: true, harvester: { capacity: 24 } },
  { ...veh, id: 'f_jackal', name: '豺狼', nameEn: 'Jackal', desc: '輕型突擊車,便宜、快速。', faction: 'ferrum', cost: 450, buildTime: 7, hp: 240, armor: 'light', speed: 3.2, turnRate: 5, sight: 8, weapon: 'f_bunker', movement: 'wheel', prereqs: ['f_factory'], radius: 0.36 },
  { ...veh, id: 'f_hammer', name: '鐵鎚坦克', nameEn: 'Hammer Tank', desc: '厚重的主戰坦克,火力強但行動遲緩。', faction: 'ferrum', cost: 950, buildTime: 13, hp: 560, speed: 1.8, turnRate: 2.6, sight: 7, weapon: 'f_hammer_cannon', movement: 'track', prereqs: ['f_factory'], crusher: true },
  { ...veh, id: 'f_flakcrawler', name: '高射履帶車', nameEn: 'Flak Crawler', desc: '機動防空砲,只能對空。', faction: 'ferrum', cost: 650, buildTime: 10, hp: 340, armor: 'light', speed: 2.3, turnRate: 3.6, sight: 8, weapon: 'f_flak', movement: 'track', prereqs: ['f_factory', 'f_radar'] },
  { ...veh, id: 'f_salamander', name: '火蜥', nameEn: 'Salamander', desc: '噴火坦克,焚毀步兵與建築。', faction: 'ferrum', cost: 900, buildTime: 12, hp: 450, speed: 2.1, turnRate: 3, sight: 6, weapon: 'f_salamander', movement: 'track', prereqs: ['f_factory', 'f_radar'], crusher: true },
  { ...veh, id: 'f_hailstorm', name: '雹暴', nameEn: 'Hailstorm', desc: '多管火箭砲,遠程覆蓋轟炸。', faction: 'ferrum', cost: 1150, buildTime: 15, hp: 230, armor: 'light', speed: 1.8, turnRate: 2.6, sight: 7, weapon: 'f_hailstorm', movement: 'wheel', prereqs: ['f_factory', 'f_radar'] },
  { ...veh, id: 'f_colossus', name: '巨像', nameEn: 'Colossus', desc: '超重型坦克,雙聯主砲並附防空飛彈。', faction: 'ferrum', cost: 1900, buildTime: 22, hp: 950, speed: 1.3, turnRate: 1.8, sight: 8, weapon: 'f_colossus_cannon', secondary: 'f_colossus_aa', movement: 'track', prereqs: ['f_factory', 'f_lab'], radius: 0.55, crusher: true },
  { ...veh, id: 'f_crawler', name: '熔核車', nameEn: 'Core Crawler', desc: '展開成為熔爐核心。', faction: 'ferrum', cost: 3000, buildTime: 30, hp: 1100, speed: 1.2, turnRate: 2, sight: 6, movement: 'track', prereqs: ['f_factory', 'f_lab'], radius: 0.5, turret: false, crusher: true, deploysTo: 'f_core' },
  { id: 'f_vulture', name: '禿鷲', nameEn: 'Vulture', desc: '重型轟炸艇,飛臨目標上空投彈。', faction: 'ferrum', category: 'aircraft', cost: 1400, buildTime: 17, hp: 380, armor: 'air', speed: 3.4, turnRate: 3, sight: 8, weapon: 'f_vulture_bomb', movement: 'air', prereqs: ['f_airpad'], radius: 0.45, turret: false, altitude: 2.4 },
];

export const UNITS: Record<string, UnitDef> = Object.fromEntries(list.map((u) => [u.id, { kind: 'unit', ...u }]));
