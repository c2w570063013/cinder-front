// FROZEN CONTRACT — owned by the commander session. See CLAUDE.md.
// Everything in here is plain serialisable data (no classes, no functions) so the
// world can be hashed, snapshotted and read by render / ui / ai without touching sim internals.

export type EntityId = number;
export type PlayerId = number;
export type FactionId = 'helion' | 'ferrum';

export interface Vec2 {
  x: number;
  y: number;
}

// ───────────────────────────── Map ─────────────────────────────

export const Terrain = {
  Ground: 0, // normal speed
  Rough: 1, // passable, slower for wheels
  Road: 2, // passable, slightly faster
  Water: 3, // impassable to ground units; aircraft only
  Rock: 4, // impassable cliff / boulders, blocks building
  Tree: 5, // impassable, blocks building
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  /** TerrainId per tile, index = ty * width + tx. */
  terrain: Uint8Array;
  /** Ore units remaining per tile (0..ORE_TILE_MAX). Ore only sits on Ground/Rough. Mutated by the sim. */
  ore: Uint8Array;
  /** Random byte per tile, for visual variety only (never read by the sim). */
  variant: Uint8Array;
  /** Candidate start positions (tile coords), at least `maxPlayers` of them. */
  starts: Vec2[];
}

// ───────────────────────────── Data definitions ─────────────────────────────

export type ArmorType = 'infantry' | 'light' | 'heavy' | 'building' | 'air';
export type WarheadId = 'bullet' | 'ap' | 'he' | 'flame' | 'energy' | 'flak';
/**
 * tracer: instant hit, drawn as a tracer line.   beam: instant hit, drawn as an energy beam.
 * shell: fast straight projectile.               arc: lobbed ballistic projectile (ignores obstacles).
 * missile: homing projectile.                    flame: short instant cone/stream.
 * flakburst: instant hit, drawn as an airburst.  bomb: dropped straight down from an aircraft.
 */
export type ProjectileKind = 'tracer' | 'beam' | 'shell' | 'arc' | 'missile' | 'flame' | 'flakburst' | 'bomb';

export interface WeaponDef {
  id: string;
  damage: number;
  /** Max range in tiles (centre to target edge). */
  range: number;
  minRange?: number;
  /** Seconds between shots (or between bursts). */
  cooldown: number;
  /** Shots per burst (default 1); burst shots are 0.15 s apart. */
  burst?: number;
  projectile: ProjectileKind;
  /** Tiles per second; ignored for instant kinds. */
  projectileSpeed?: number;
  /** Splash radius in tiles (0 / undefined = single target). Damage falls off linearly to 25% at the edge. */
  splash?: number;
  warhead: WarheadId;
  targetsGround: boolean;
  targetsAir: boolean;
  /** Visual tint hint for the renderer (CSS colour). */
  color?: string;
}

export type MovementType = 'foot' | 'wheel' | 'track' | 'air';
export type QueueCategory = 'structure' | 'defense' | 'infantry' | 'vehicle' | 'aircraft';
export type SupportPowerId = 'recon_sweep' | 'orbital_lance' | 'tremor';

export interface UnitDef {
  kind: 'unit';
  id: string;
  /** Display name (Traditional Chinese) and English name. */
  name: string;
  nameEn: string;
  desc: string;
  faction: FactionId;
  category: 'infantry' | 'vehicle' | 'aircraft';
  cost: number;
  /** Seconds to produce at full power. */
  buildTime: number;
  hp: number;
  armor: ArmorType;
  /** Tiles per second on Ground. */
  speed: number;
  /** Hull turn rate, radians per second. */
  turnRate: number;
  /** Sight radius in tiles. */
  sight: number;
  weapon?: string;
  /** Optional second weapon (e.g. anti-air launcher). */
  secondary?: string;
  movement: MovementType;
  /** Building def ids the owner must have (all of them, operational). */
  prereqs: string[];
  /** Collision radius in tiles. */
  radius: number;
  /** Has an independently rotating turret. */
  turret: boolean;
  /** Vehicles with this flag crush enemy infantry they drive over. */
  crusher?: boolean;
  harvester?: { capacity: number }; // capacity in ore units
  /** Deploys into this building def (mobile base vehicle). */
  deploysTo?: string;
  /** Can capture enemy buildings / instantly repair own buildings by entering them. Consumed on use. */
  engineer?: boolean;
  /** Cruise altitude in tiles for aircraft (visual + targeting). */
  altitude?: number;
}

export interface BuildingDef {
  kind: 'building';
  id: string;
  name: string;
  nameEn: string;
  desc: string;
  faction: FactionId;
  category: 'structure' | 'defense';
  cost: number;
  buildTime: number;
  hp: number;
  armor: ArmorType;
  /** Footprint in tiles. Entity x,y is the footprint centre; top-left tile = (x - w/2, y - h/2). */
  footprint: { w: number; h: number };
  /** Positive = produces, negative = consumes. */
  power: number;
  sight: number;
  weapon?: string;
  /** Defences flagged here stop firing when the owner is in low power. */
  needsPower?: boolean;
  turret?: boolean;
  prereqs: string[];
  /** False for buildings that only come from deploying a base vehicle. */
  buildable: boolean;
  /** Which production queue this building enables and where its units spawn. */
  produces?: QueueCategory[];
  /** Deployed base: enables 'structure' + 'defense' queues. Undeploy is not supported in v1. */
  conyard?: boolean;
  refinery?: boolean;
  /** Unit def id spawned for free when this building completes (refinery → harvester). */
  freeUnit?: string;
  /** Enables the minimap for the owner. */
  radar?: boolean;
  /** Grants this support power while operational and powered. */
  supportPower?: SupportPowerId;
  wall?: boolean;
}

export type EntityDef = UnitDef | BuildingDef;

export interface SupportPowerDef {
  id: SupportPowerId;
  name: string;
  nameEn: string;
  desc: string;
  /** Seconds to recharge. */
  recharge: number;
  /** Effect radius in tiles. */
  radius: number;
  /** Total damage at the centre (0 for non-damaging powers). */
  damage: number;
  /** Seconds between activation and impact / or duration of a reveal. */
  delay: number;
  duration: number;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  nameEn: string;
  desc: string;
  /** Default team colours offered in the lobby. */
  colors: string[];
  /** Base vehicle unit id the player starts with. */
  baseVehicle: string;
  conyard: string;
  /** Extra units spawned at game start, def ids. */
  startingUnits: string[];
}

// ───────────────────────────── World state ─────────────────────────────

export type Order =
  | { type: 'move'; x: number; y: number }
  | { type: 'attack'; targetId: EntityId }
  /** Move to a point, engaging enemies met on the way. */
  | { type: 'attackMove'; x: number; y: number }
  /** Harvester: gather at/near this tile (null = auto-pick nearest ore), then cycle refinery ↔ ore. */
  | { type: 'harvest'; tx: number | null; ty: number | null }
  /** Harvester: go unload at this refinery, then resume harvesting. */
  | { type: 'dock'; targetId: EntityId }
  /** Engineer: enter target building (capture enemy / repair own). */
  | { type: 'capture'; targetId: EntityId }
  /** Base vehicle: deploy in place. */
  | { type: 'deploy' }
  /** Hold position and engage enemies in range (default idle behaviour is also to auto-acquire). */
  | { type: 'guard' };

/** Coarse presentation state; the sim sets it every tick so render/audio can animate. */
export type EntityAction = 'idle' | 'move' | 'attack' | 'harvest' | 'unload' | 'deploy' | 'construct';

export interface Entity {
  id: EntityId;
  defId: string;
  kind: 'unit' | 'building';
  owner: PlayerId;

  /** Position in world tile units (centre). */
  x: number;
  y: number;
  /** Position at the previous tick — render interpolates px→x by alpha. */
  px: number;
  py: number;
  /** Hull facing, radians in world space (atan2(dy,dx)). */
  facing: number;
  /** Turret facing, radians in world space. Equals `facing` for turretless entities. */
  turretFacing: number;
  /** Height above ground in tiles (aircraft). 0 for everything else. */
  altitude: number;

  hp: number;
  maxHp: number;
  /** 0 = rookie, 1 = veteran, 2 = elite. */
  rank: 0 | 1 | 2;
  kills: number;

  action: EntityAction;
  /** Current order and queued follow-ups (shift-queue). */
  order: Order | null;
  queue: Order[];
  /** Entity currently being shot at, if any. */
  targetId: EntityId | null;
  /** Tick of the last shot (-1 = never) — for muzzle flash / recoil. */
  lastFireTick: number;
  /** Tick this entity last took damage (-1 = never). */
  lastHitTick: number;

  // ── unit-only (zero / null on buildings) ──
  /** Ore units carried (harvesters). */
  cargo: number;

  // ── building-only (defaults on units) ──
  /** 0..1 — placement animation; the building is operational at 1. */
  buildProgress: number;
  /** Where produced units gather. */
  rally: Vec2 | null;
  /** Primary factory for its category (units exit here). */
  primary: boolean;
  /** Player toggled repair on (drains credits, restores hp). */
  repairing: boolean;
  /** False when this building needs power and the owner is in low power. */
  powered: boolean;
}

export interface Projectile {
  id: number;
  weaponId: string;
  kind: ProjectileKind;
  owner: PlayerId;
  sourceId: EntityId;
  /** Current and previous-tick position; z is height in tiles. */
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  /** Where it is headed (ground point), and homing target if any. */
  tx: number;
  ty: number;
  targetId: EntityId | null;
}

export interface ProductionItem {
  defId: string;
  /** 0..1 */
  progress: number;
  /** Credits already paid toward this item (cost is drained as it builds). */
  paid: number;
}

export interface ProductionQueue {
  /** items[0] is the one in progress. */
  items: ProductionItem[];
  paused: boolean;
  /** structure/defense only: items[0] is finished and waiting for a `placeBuilding` command. */
  ready: boolean;
}

export interface SupportPowerState {
  id: SupportPowerId;
  /** Building providing it. */
  sourceId: EntityId;
  /** Ticks charged so far. */
  charge: number;
  /** Ticks needed. */
  chargeMax: number;
  ready: boolean;
}

export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  buildingsBuilt: number;
  buildingsLost: number;
  kills: number;
  oreHarvested: number; // credits
  creditsSpent: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  faction: FactionId;
  /** CSS hex colour, e.g. '#3fa7ff'. */
  color: string;
  /** Players with the same team are allies. */
  team: number;
  controller: 'human' | 'ai';
  difficulty: Difficulty;
  credits: number;
  powerProduced: number;
  powerConsumed: number;
  lowPower: boolean;
  hasRadar: boolean;
  queues: Record<QueueCategory, ProductionQueue>;
  powers: SupportPowerState[];
  /** Fog of war, index = ty * width + tx. 1 = ever seen. */
  explored: Uint8Array;
  /** >0 = currently in sight of one of this player's (or allies') entities. */
  visible: Uint8Array;
  defeated: boolean;
  stats: PlayerStats;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface GameOptions {
  /** False = whole map revealed and always visible. */
  fog: boolean;
  /** True = a player is defeated when all their buildings are gone (units don't count). */
  shortGame: boolean;
  /** False = superweapon buildings cannot be built. */
  superweapons: boolean;
}

export interface PlayerSetup {
  name: string;
  faction: FactionId;
  color: string;
  team: number;
  controller: 'human' | 'ai';
  difficulty: Difficulty;
  /** Index into map.starts. */
  startIndex: number;
}

export interface GameSetup {
  map: GameMap;
  seed: number;
  players: PlayerSetup[];
  startingCredits: number;
  options: GameOptions;
}

export interface World {
  tick: number;
  /** Seeded RNG state (see core/rng.ts). The sim must use only this for randomness. */
  rngState: number;
  setup: GameSetup;
  map: GameMap;
  players: Player[];
  entities: Map<EntityId, Entity>;
  nextEntityId: number;
  projectiles: Projectile[];
  /** Events emitted during the most recent `step`. Cleared at the start of each step. */
  events: SimEvent[];
  /** Set when the game has ended. */
  winnerTeam: number | null;
}

// ───────────────────────────── Commands (input → sim) ─────────────────────────────

/** All player intent enters the sim through these. `queue: true` = shift-queue after current orders. */
export type Command =
  | { type: 'move'; player: PlayerId; ids: EntityId[]; x: number; y: number; queue?: boolean }
  | { type: 'attack'; player: PlayerId; ids: EntityId[]; targetId: EntityId; queue?: boolean }
  | { type: 'attackMove'; player: PlayerId; ids: EntityId[]; x: number; y: number; queue?: boolean }
  | { type: 'stop'; player: PlayerId; ids: EntityId[] }
  | { type: 'guard'; player: PlayerId; ids: EntityId[] }
  | { type: 'harvest'; player: PlayerId; ids: EntityId[]; tx: number; ty: number }
  | { type: 'dock'; player: PlayerId; ids: EntityId[]; targetId: EntityId }
  | { type: 'capture'; player: PlayerId; ids: EntityId[]; targetId: EntityId }
  | { type: 'deploy'; player: PlayerId; ids: EntityId[] }
  /** Append one item to the category queue of `defId`. */
  | { type: 'produce'; player: PlayerId; defId: string }
  /** First call pauses the active item if it is `defId`; cancelling a paused/queued item removes it and refunds what was paid. */
  | { type: 'cancelProduction'; player: PlayerId; defId: string }
  | { type: 'resumeProduction'; player: PlayerId; category: QueueCategory }
  /** Place the finished structure/defense. (tx,ty) = top-left tile of the footprint. */
  | { type: 'placeBuilding'; player: PlayerId; defId: string; tx: number; ty: number }
  | { type: 'sell'; player: PlayerId; buildingId: EntityId }
  | { type: 'toggleRepair'; player: PlayerId; buildingId: EntityId }
  | { type: 'setRally'; player: PlayerId; buildingId: EntityId; x: number; y: number }
  | { type: 'setPrimary'; player: PlayerId; buildingId: EntityId }
  | { type: 'usePower'; player: PlayerId; power: SupportPowerId; x: number; y: number }
  | { type: 'surrender'; player: PlayerId };

// ───────────────────────────── Events (sim → presentation) ─────────────────────────────

export type SimEvent =
  | { type: 'entityCreated'; id: EntityId; defId: string; owner: PlayerId; x: number; y: number }
  /** A unit rolled out of a factory. */
  | { type: 'unitReady'; id: EntityId; defId: string; owner: PlayerId }
  /** A structure/defense finished in the queue and awaits placement. */
  | { type: 'constructionReady'; defId: string; owner: PlayerId }
  | { type: 'buildingPlaced'; id: EntityId; defId: string; owner: PlayerId; x: number; y: number }
  /** Placement animation finished; building operational. */
  | { type: 'buildingComplete'; id: EntityId; defId: string; owner: PlayerId }
  | { type: 'weaponFired'; sourceId: EntityId; weaponId: string; kind: ProjectileKind; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  /** A projectile / instant shot landed here. */
  | { type: 'impact'; weaponId: string; kind: ProjectileKind; x: number; y: number; z: number; splash: number }
  | { type: 'entityDamaged'; id: EntityId; owner: PlayerId; amount: number; x: number; y: number }
  | { type: 'entityDestroyed'; id: EntityId; defId: string; kind: 'unit' | 'building'; owner: PlayerId; killer: PlayerId | null; x: number; y: number }
  /** Rate-limited by the sim (at most once per ~10 s per player per area). */
  | { type: 'underAttack'; player: PlayerId; x: number; y: number; base: boolean }
  | { type: 'buildingSold'; id: EntityId; defId: string; owner: PlayerId; x: number; y: number }
  | { type: 'buildingCaptured'; id: EntityId; defId: string; from: PlayerId; to: PlayerId }
  | { type: 'unitDeployed'; unitId: EntityId; buildingId: EntityId; owner: PlayerId }
  | { type: 'unitPromoted'; id: EntityId; owner: PlayerId; rank: 1 | 2 }
  | { type: 'harvesterUnloaded'; id: EntityId; owner: PlayerId; credits: number }
  | { type: 'insufficientFunds'; player: PlayerId }
  | { type: 'lowPower'; player: PlayerId; low: boolean }
  | { type: 'cannotPlace'; player: PlayerId }
  | { type: 'powerReady'; player: PlayerId; power: SupportPowerId }
  /** Fired at activation; impact follows after the power's delay. */
  | { type: 'powerUsed'; player: PlayerId; power: SupportPowerId; x: number; y: number }
  | { type: 'powerImpact'; player: PlayerId; power: SupportPowerId; x: number; y: number; radius: number }
  | { type: 'playerDefeated'; player: PlayerId }
  | { type: 'gameOver'; winnerTeam: number };
