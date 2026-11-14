// Sim-internal state. Everything here lives under `world.sim` (and as extra fields on entities /
// projectiles) so that `step(world, cmds)` stays a pure function of its arguments.
import { TICK_RATE } from '../core/constants';
import { Terrain } from '../core/types';
import type {
  ArmorType,
  BuildingDef,
  Entity,
  EntityId,
  MovementType,
  PlayerId,
  Projectile,
  QueueCategory,
  SupportPowerId,
  UnitDef,
  World,
} from '../core/types';
import { BUILDINGS, UNITS } from '../data';

export const DT = 1 / TICK_RATE;
/** Spatial hash cell size in tiles. */
export const CELL = 2;

/** Balance / behaviour knobs that are not part of the shared data defs. */
export const TUNE = {
  buildRiseSec: 3,
  wallRiseSec: 0.8,
  deployRiseSec: 2,
  factoryBonus: 0.5,
  factoryBonusCap: 2.5,
  harvestTicks: 8, // ticks per ore unit gathered
  unloadTicks: 2, // ticks per ore unit unloaded
  repairSec: 20, // seconds for a full 0→100% repair
  repairCostFactor: 0.25, // fraction of cost for a full repair
  rankXp: [3, 7], // × own cost in kill value
  rankDamage: [1, 1.15, 1.3],
  eliteRegenPerSec: 0.01, // fraction of maxHp
  turretRate: 5, // rad/s
  burstGapTicks: 3,
  pathNodeBudget: 6000, // A* node expansions per tick
  fogPeriod: 4,
  alertCooldown: 200,
  alertCell: 16,
  oreGrowPeriod: 100,
  idleAcquireExtra: 2,
  attackMoveAcquireExtra: 2.5,
  leash: 5,
  maxOrderQueue: 16,
} as const;

export const MV_FOOT = 0;
export const MV_WHEEL = 1;
export const MV_TRACK = 2;
export const MV_AIR = 3;
export function mvIndex(m: MovementType): number {
  return m === 'foot' ? MV_FOOT : m === 'wheel' ? MV_WHEEL : m === 'track' ? MV_TRACK : MV_AIR;
}
/** Speed multiplier by [movement][terrain]. */
export const TERRAIN_SPEED: number[][] = [
  [1, 0.85, 1.1, 0, 0, 0],
  [1, 0.6, 1.3, 0, 0, 0],
  [1, 0.8, 1.15, 0, 0, 0],
  [1, 1, 1, 1, 1, 1],
];

export interface SimEntity extends Entity {
  dead: boolean;
  air: boolean;
  /** Collision radius (0 for buildings). */
  r: number;
  armor: ArmorType;
  mvType: number;
  // ── movement ──
  mv: boolean;
  /** Resolved goal (what the path leads to) and requested goal. */
  gx: number;
  gy: number;
  rx: number;
  ry: number;
  path: number[] | null;
  pi: number;
  pathPending: boolean;
  stuck: number;
  sx: number;
  sy: number;
  repaths: number;
  moved: boolean;
  /** Order progress: 0 = fresh, 1 = under way, 2 = interrupted by an engagement. */
  os: number;
  // ── combat ──
  cd0: number;
  cd1: number;
  b0: number;
  b1: number;
  /** Secondary weapon's own target. */
  tgt1: EntityId | null;
  /** `targetId` was auto-acquired (vs. an explicit attack order). */
  auto: boolean;
  scanAt: number;
  /** Last enemy entity that damaged us (0 = none). */
  aggro: EntityId;
  chaseAt: number;
  xp: number;
  /** Idle anchor (where the unit returns after an idle chase). */
  ax: number;
  ay: number;
  leash: boolean;
  // ── harvester ──
  hs: number;
  ht: number;
  htx: number;
  hty: number;
  href: EntityId;
  hsum: number;
  // ── building ──
  repairAcc: number;
  /** Footprint rect in tiles (buildings). */
  fx: number;
  fy: number;
  fw: number;
  fh: number;
}

export interface SimProjectile extends Projectile {
  sx: number;
  sy: number;
  sz: number;
  tz: number;
  /** Progress 0..1 for ballistic kinds. */
  t: number;
  dist0: number;
  speed: number;
  mul: number;
  homing: boolean;
}

export interface PlayerInfo {
  /** Operational building count per def id. */
  have: Map<string, number>;
  /** Operational producing buildings per category. */
  producers: Record<QueueCategory, number>;
  /** Building units of the category exit from (primary flag, else lowest id). 0 = none. */
  exitId: Record<QueueCategory, EntityId>;
  /** Lowest-id operational building providing each support power. */
  powerSrc: Map<SupportPowerId, EntityId>;
  buildings: number;
  units: number;
  deployables: number;
  radar: boolean;
}

export interface PlayerSim {
  stalled: Record<QueueCategory, boolean>;
  /** Last underAttack tick per coarse area. */
  alertAt: number[];
  teamIdx: number;
  info: PlayerInfo;
}

export interface PendingPower {
  player: PlayerId;
  power: SupportPowerId;
  x: number;
  y: number;
  at: number;
}

export interface Reveal {
  team: number;
  x: number;
  y: number;
  r: number;
  until: number;
}

export interface SimState {
  w: number;
  h: number;
  /** Building entity id per tile (0 = none). */
  bld: Int32Array;
  /** 1 = impassable for ground movement (terrain or building). */
  blocked: Uint8Array;
  /** Connected component id per passable tile (0 on blocked tiles). */
  region: Int32Array;
  regionDirty: boolean;
  /** Path cost per tile per ground movement type (1 / speed multiplier). */
  moveCost: Float32Array[];
  // spatial hash (rebuilt each tick)
  gw: number;
  gh: number;
  cellHead: Int32Array;
  cellNext: Int32Array;
  list: SimEntity[];
  // pathing
  pathQueue: EntityId[];
  pathBudget: number;
  aGen: number;
  aG: Float32Array;
  aParent: Int32Array;
  aSeen: Uint32Array;
  aClosed: Uint32Array;
  heapN: Int32Array;
  heapF: Float32Array;
  stack: Int32Array;
  shareTick: number;
  sharePath: number[] | null;
  shareSx: number;
  shareSy: number;
  // players / teams
  pl: PlayerSim[];
  teams: number[];
  teamVis: Uint8Array[];
  teamExp: Uint8Array[];
  multiTeam: boolean;
  pending: PendingPower[];
  reveals: Reveal[];
  nextProjId: number;
  deaths: number;
}

export type SimWorld = World & { sim: SimState };

const CATS: QueueCategory[] = ['structure', 'defense', 'infantry', 'vehicle', 'aircraft'];
export { CATS };

export function unitDef(e: Entity): UnitDef {
  return UNITS[e.defId];
}
export function buildingDef(e: Entity): BuildingDef {
  return BUILDINGS[e.defId];
}

export function terrainBlocks(t: number): boolean {
  return t === Terrain.Water || t === Terrain.Rock || t === Terrain.Tree;
}

export function emptyInfo(): PlayerInfo {
  return {
    have: new Map(),
    producers: { structure: 0, defense: 0, infantry: 0, vehicle: 0, aircraft: 0 },
    exitId: { structure: 0, defense: 0, infantry: 0, vehicle: 0, aircraft: 0 },
    powerSrc: new Map(),
    buildings: 0,
    units: 0,
    deployables: 0,
    radar: false,
  };
}

/** Fill in sim-internal fields on an entity (also upgrades hand-made plain entities). */
export function initSimFields(ent: Entity): SimEntity {
  const e = ent as SimEntity;
  if (e.cd0 !== undefined) return e;
  const ud = UNITS[e.defId];
  const bd = BUILDINGS[e.defId];
  e.dead = false;
  e.air = !!ud && ud.movement === 'air';
  e.r = ud ? ud.radius : 0;
  e.armor = ud ? ud.armor : bd ? bd.armor : 'building';
  e.mvType = ud ? mvIndex(ud.movement) : MV_TRACK;
  e.mv = false;
  e.gx = e.x;
  e.gy = e.y;
  e.rx = e.x;
  e.ry = e.y;
  e.path = null;
  e.pi = 0;
  e.pathPending = false;
  e.stuck = 0;
  e.sx = e.x;
  e.sy = e.y;
  e.repaths = 0;
  e.moved = false;
  e.os = 0;
  e.cd0 = 0;
  e.cd1 = 0;
  e.b0 = 0;
  e.b1 = 0;
  e.tgt1 = null;
  e.auto = true;
  e.scanAt = 0;
  e.aggro = 0;
  e.chaseAt = 0;
  e.xp = 0;
  e.ax = e.x;
  e.ay = e.y;
  e.leash = false;
  e.hs = 0;
  e.ht = 0;
  e.htx = -1;
  e.hty = -1;
  e.href = 0;
  e.hsum = 0;
  e.repairAcc = 0;
  if (bd) {
    e.fw = bd.footprint.w;
    e.fh = bd.footprint.h;
    e.fx = Math.round(e.x - e.fw / 2);
    e.fy = Math.round(e.y - e.fh / 2);
  } else {
    e.fx = 0;
    e.fy = 0;
    e.fw = 0;
    e.fh = 0;
  }
  return e;
}

/** Build the sim state for a world (used by createWorld, and lazily for hand-made worlds). */
export function attachSim(world: World): SimState {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  const n = w * h;
  const blocked = new Uint8Array(n);
  const moveCost = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const t = map.terrain[i];
    blocked[i] = terrainBlocks(t) ? 1 : 0;
    for (let m = 0; m < 3; m++) moveCost[m][i] = blocked[i] ? 1 : 1 / TERRAIN_SPEED[m][t];
  }
  const gw = Math.ceil(w / CELL);
  const gh = Math.ceil(h / CELL);
  const teams: number[] = [];
  for (const p of world.players) if (!teams.includes(p.team)) teams.push(p.team);
  teams.sort((a, b) => a - b);
  const alertCells = Math.ceil(w / TUNE.alertCell) * Math.ceil(h / TUNE.alertCell);
  const S: SimState = {
    w,
    h,
    bld: new Int32Array(n),
    blocked,
    region: new Int32Array(n),
    regionDirty: true,
    moveCost,
    gw,
    gh,
    cellHead: new Int32Array(gw * gh).fill(-1),
    cellNext: new Int32Array(64),
    list: [],
    pathQueue: [],
    pathBudget: 0,
    aGen: 0,
    aG: new Float32Array(n),
    aParent: new Int32Array(n),
    aSeen: new Uint32Array(n),
    aClosed: new Uint32Array(n),
    heapN: new Int32Array(n * 8 + 16),
    heapF: new Float32Array(n * 8 + 16),
    stack: new Int32Array(n),
    shareTick: -1,
    sharePath: null,
    shareSx: 0,
    shareSy: 0,
    pl: world.players.map((p) => ({
      stalled: { structure: false, defense: false, infantry: false, vehicle: false, aircraft: false },
      alertAt: new Array<number>(alertCells).fill(-100000),
      teamIdx: teams.indexOf(p.team),
      info: emptyInfo(),
    })),
    teams,
    teamVis: teams.map((t) => world.players.find((p) => p.team === t)!.visible),
    teamExp: teams.map((t) => world.players.find((p) => p.team === t)!.explored),
    multiTeam: teams.length > 1,
    pending: [],
    reveals: [],
    nextProjId: 1,
    deaths: 0,
  };
  (world as SimWorld).sim = S;
  for (const ent of world.entities.values()) {
    const e = initSimFields(ent);
    if (e.kind === 'building') stampBuilding(S, e, e.id);
  }
  rebuildHash(world, S);
  return S;
}

export function getSim(world: World): SimState {
  return (world as SimWorld).sim ?? attachSim(world);
}

export function stampBuilding(S: SimState, e: SimEntity, id: number): void {
  for (let ty = e.fy; ty < e.fy + e.fh; ty++) {
    if (ty < 0 || ty >= S.h) continue;
    for (let tx = e.fx; tx < e.fx + e.fw; tx++) {
      if (tx < 0 || tx >= S.w) continue;
      const i = ty * S.w + tx;
      S.bld[i] = id;
      S.blocked[i] = id !== 0 ? 1 : 0;
    }
  }
  S.regionDirty = true;
}

/** Rebuild the spatial hash from world.entities (ascending id order). */
export function rebuildHash(world: World, S: SimState): void {
  const list = S.list;
  list.length = 0;
  for (const ent of world.entities.values()) {
    const e = ent as SimEntity;
    if (e.cd0 === undefined) {
      // entity added by hand (dev pages / tests building a World manually)
      initSimFields(e);
      if (e.kind === 'building') stampBuilding(S, e, e.id);
    }
    list.push(e);
  }
  if (S.cellNext.length < list.length) S.cellNext = new Int32Array(list.length * 2);
  const head = S.cellHead;
  const next = S.cellNext;
  head.fill(-1);
  const gw = S.gw;
  const gh = S.gh;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    let cx = (e.x / CELL) | 0;
    let cy = (e.y / CELL) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= gw) cx = gw - 1;
    if (cy < 0) cy = 0;
    else if (cy >= gh) cy = gh - 1;
    const c = cy * gw + cx;
    next[i] = head[c];
    head[c] = i;
  }
}

/**
 * Collect live entities whose hash cell overlaps the circle (x,y,r) into `out`; returns the count.
 * Callers must still do exact distance tests. Buildings are stored by centre — pad r by ~2.2 to catch them.
 */
export function queryNear(S: SimState, x: number, y: number, r: number, out: SimEntity[]): number {
  let x0 = ((x - r) / CELL) | 0;
  let y0 = ((y - r) / CELL) | 0;
  let x1 = ((x + r) / CELL) | 0;
  let y1 = ((y + r) / CELL) | 0;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 >= S.gw) x1 = S.gw - 1;
  if (y1 >= S.gh) y1 = S.gh - 1;
  let n = 0;
  const head = S.cellHead;
  const next = S.cellNext;
  const list = S.list;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      for (let i = head[cy * S.gw + cx]; i >= 0; i = next[i]) {
        const e = list[i];
        if (!e.dead) out[n++] = e;
      }
    }
  }
  return n;
}

export function blockedAt(S: SimState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= S.w || y >= S.h) return true;
  return S.blocked[(y | 0) * S.w + (x | 0)] !== 0;
}

export function isEnemyP(world: World, a: PlayerId, b: PlayerId): boolean {
  const pa = world.players[a];
  const pb = world.players[b];
  if (!pa || !pb) return false;
  return pa.team !== pb.team;
}

export function angleDiff(to: number, from: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function normAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Rotate `from` toward `to` by at most `maxStep`; returns the new angle. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(to, from);
  if (d > maxStep) return normAngle(from + maxStep);
  if (d < -maxStep) return normAngle(from - maxStep);
  return to;
}
