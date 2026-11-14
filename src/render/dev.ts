// Renderer dev page (dev/render.html). A hand-made, animated FAKE world — no sim required — that
// exercises every def, state and effect the renderer has to draw. Scenes: gallery | heavy | sim.
// Query: ?scene= ?size= ?seed= ?fog=1 ?zoom= ?gen=0 ?labels=0 ?panel=0 ?pause=1 ?jump=<spot> ?x=&y=
import type { PlacementCheck, MapInfo, Renderer, SimApi, ViewState } from '../core/api';
import { ORE_TILE_MAX, ORE_UNIT_VALUE, TICK_MS, TICK_RATE, secToTicks } from '../core/constants';
import { makeRng } from '../core/rng';
import { Terrain } from '../core/types';
import type {
  Entity, EntityDef, EntityId, FactionId, GameMap, GameSetup, Order, Player, PlayerId, Projectile, ProjectileKind,
  ProductionQueue, SimEvent, SupportPowerId, TerrainId, UnitDef, Vec2, WeaponDef, World,
} from '../core/types';
import { BUILDINGS, FACTIONS, SUPPORT_POWERS, UNITS, WARHEADS, WEAPONS, getDef } from '../data';
import { createRenderer } from './index';

// ───────────────────────────── params / utils ─────────────────────────────

type SceneName = 'gallery' | 'heavy' | 'sim';
const Q = new URLSearchParams(location.search);
const qNum = (k: string, d: number) => {
  const v = Q.get(k);
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
const qFlag = (k: string, d: boolean) => {
  const v = Q.get(k);
  return v === null ? d : v !== '0' && v !== 'false';
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
const angDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const turnTo = (cur: number, want: number, max: number) => {
  const d = angDiff(want, cur);
  return Math.abs(d) <= max ? want : cur + Math.sign(d) * max;
};

const SIZE = clamp(Math.round(qNum('size', 128)), 64, 256);
const SEED = qNum('seed', 20261114) | 0;
const KINDS: ProjectileKind[] = ['tracer', 'beam', 'shell', 'arc', 'missile', 'flame', 'flakburst', 'bomb'];
const POWER_IDS: SupportPowerId[] = ['recon_sweep', 'orbital_lance', 'tremor'];
const PLAYER_DEFS: [string, FactionId, string, number, 'human' | 'ai'][] = [
  ['P0 Helion', 'helion', '#3fa7ff', 0, 'human'],
  ['P1 Ferrum', 'ferrum', '#ff8a2a', 1, 'ai'],
  ['P2 Helion', 'helion', '#b08cff', 0, 'ai'],
  ['P3 Ferrum', 'ferrum', '#e5484d', 1, 'ai'],
];
const ownerOf = (f: FactionId): PlayerId => (f === 'helion' ? 0 : 1);

const state = {
  scene: 'gallery' as SceneName,
  fog: qFlag('fog', false),
  gen: qFlag('gen', true),
  labels: qFlag('labels', true),
  paused: qFlag('pause', false),
  placeDef: '',
  power: '' as SupportPowerId | '',
  icons: false,
  iconsAlt: false,
};
const stats = { fps: 0, renderAvg: 0, renderMax: 0, entities: 0, projectiles: 0, backing: '', dpr: 1, tick: 0, frames: 0, fx: '' };

// ───────────────────────────── DOM / error box ─────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> | null, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props) Object.assign(e, props);
  parent?.appendChild(e);
  return e;
}
const canvas = $<HTMLCanvasElement>('game');
const labelCanvas = $<HTMLCanvasElement>('labels');
const lctx = labelCanvas.getContext('2d')!;
const errBox = $<HTMLPreElement>('err');
const panel = $<HTMLDivElement>('panel');
const statsEl = $<HTMLPreElement>('stats');

const errs = new Map<string, { msg: string; n: number }>();
let errDirty = false;
function report(where: string, e: unknown) {
  const short = e instanceof Error ? e.message : String(e);
  const cur = errs.get(where + '|' + short);
  if (cur) cur.n++;
  else {
    const full = e instanceof Error ? (e.stack ?? e.message).split('\n').slice(0, 6).join('\n') : short;
    errs.set(where + '|' + short, { msg: `[${where}] ${full}`, n: 1 });
    console.error(`[render dev] ${where}`, e);
  }
  errDirty = true;
}
function flushErrors() {
  if (!errDirty) return;
  errDirty = false;
  errBox.hidden = errs.size === 0;
  errBox.textContent = [...errs.values()].map((v) => `${v.msg}${v.n > 1 ? `\n  (×${v.n})` : ''}`).join('\n\n') + '\n\n(click to clear)';
}
errBox.addEventListener('click', () => {
  errs.clear();
  errDirty = true;
  flushErrors();
});
function safe<T>(where: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    report(where, e);
    return undefined;
  }
}
const guard = <A extends unknown[]>(where: string, fn: (...a: A) => void) => (...a: A) => void safe(where, () => fn(...a));

let R: Renderer;
try {
  R = createRenderer(canvas);
} catch (e) {
  report('createRenderer', e);
  flushErrors();
  throw e;
}

// ───────────────────────────── fake world state ─────────────────────────────

interface Label { x: number; y: number; text: string | (() => string); title: boolean }
interface Slot { w: WeaponDef; cd: number; burst: number; tgt: Entity | null }
interface Harvest { state: 'toOre' | 'mine' | 'toDock' | 'unload'; tx: number; ty: number; dock: Vec2; refinery: Entity; field: [number, number, number, number]; snap: number[]; t: number; load: number }
interface Agent {
  e: Entity; def: EntityDef; air: boolean; team: number;
  mode: 'static' | 'loop' | 'wander' | 'circle' | 'harvest';
  speed: number; turn: number; // per tick
  path: Vec2[]; wp: number;
  cx: number; cy: number; r: number; ang: number; dir: number;
  slots: Slot[]; engage: number; holdoff: number;
  mortal: boolean; respawn: boolean; dead: boolean; hv: Harvest | null;
}
interface ProjMeta { w: WeaponDef; speed: number; sz: number; tz: number; dist: number; h: number; vz: number; tgt: Entity | null }

let world: World;
const view: ViewState = { viewer: 0, selection: new Set(), hoverId: null, placement: null, dragRect: null, powerTarget: null, showAllHealth: false, markers: [], time: 0 };
let rng = makeRng(SEED ^ 0x5eed);
let timers: { at: number; fn: () => void }[] = [];
let tweens: (() => boolean)[] = [];
let agents: Agent[] = [];
let agentsDirty = false;
let agentOf = new Map<EntityId, Agent>();
let labels: Label[] = [];
let spots: Record<string, Vec2> = {};
let projMeta = new WeakMap<Projectile, ProjMeta>();
let nextProjId = 1;
let reveals: { x: number; y: number; r: number; until: number; team: number }[] = [];
let fxPairs: Partial<Record<ProjectileKind, { src: Entity; tgt: Entity }>> = {};
let fxStep = 0;
let fxNextAt = 0;
let fogOpen = false; // arrays currently filled with 1 (fog off)
let simApi: Pick<SimApi, 'createWorld' | 'step'> | null = null;

const ev = (e: SimEvent) => void world.events.push(e);
const alive = (e: Entity | null): e is Entity => e !== null && world.entities.has(e.id);
const later = (ticks: number, fn: () => void) => void timers.push({ at: world.tick + ticks, fn });
const label = (x: number, y: number, text: Label['text'], title = false) => void labels.push({ x, y, text, title });

// ───────────────────────────── test map ─────────────────────────────

function makeMap(size: number, seed: number): { map: GameMap; spots: Record<string, Vec2> } {
  const r = makeRng(seed);
  const W = size, H = size;
  const terrain = new Uint8Array(W * H), ore = new Uint8Array(W * H), variant = new Uint8Array(W * H);
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const put = (x: number, y: number, t: TerrainId) => {
    x = Math.floor(x); y = Math.floor(y);
    if (inMap(x, y)) terrain[y * W + x] = t;
  };
  const noise = (cell: number) => {
    const gw = Math.ceil(W / cell) + 2;
    const g = new Float32Array(gw * gw);
    for (let i = 0; i < g.length; i++) g[i] = r.next();
    return (x: number, y: number) => {
      const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const u = (fx - x0) * (fx - x0) * (3 - 2 * (fx - x0)), v = (fy - y0) * (fy - y0) * (3 - 2 * (fy - y0));
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  };
  const blob = (cx: number, cy: number, rad: number, t: TerrainId, jag = 0.35, density = 1) => {
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++)
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad * (1 - jag * r.next()) && r.next() < density) put(x, y, t);
  };
  const ridge = (x: number, y: number, len: number) => {
    let a = r.range(0, TAU);
    for (let i = 0; i < len; i++) {
      blob(x, y, r.range(0.9, 1.7), Terrain.Rock, 0.3);
      a += r.range(-0.5, 0.5);
      x += Math.cos(a) * 1.2; y += Math.sin(a) * 1.2;
    }
  };
  const oreField = (cx: number, cy: number, rad: number, rich: number) => {
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= rad || !inMap(x, y) || !r.chance(0.92)) continue;
        const t = terrain[y * W + x];
        if (t !== Terrain.Ground && t !== Terrain.Rough) continue;
        ore[y * W + x] = clamp(Math.round(ORE_TILE_MAX * rich * (1 - d / rad) ** 0.6 * r.range(0.7, 1.2)), 1, ORE_TILE_MAX);
      }
  };
  const road = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const wide = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
      put(x, y, Terrain.Road);
      put(wide ? x : x + 1, wide ? y + 1 : y, Terrain.Road);
    }
  };

  // noise regions: rough ground, dense forest patches, scattered single trees
  const nA = noise(9), nA2 = noise(4), nB = noise(8);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (0.7 * nA(x, y) + 0.3 * nA2(x, y) > 0.6) terrain[i] = Terrain.Rough;
      if (nB(x, y) > 0.74 ? r.chance(0.85) : r.chance(0.012)) terrain[i] = Terrain.Tree;
    }
  const forest = { x: 0.62 * size, y: 0.72 * size }, rocks = { x: 0.8 * size, y: 0.5 * size }, lake = { x: 0.72 * size, y: 0.26 * size };
  blob(forest.x, forest.y, 0.07 * size, Terrain.Tree, 0.4, 0.9);
  ridge(rocks.x, rocks.y, 22);
  for (let i = 0; i < 3; i++) ridge(r.range(8, W - 8), r.range(8, H - 8), r.int(12, 24));
  for (let i = 0; i < 6; i++) blob(r.range(4, W - 4), r.range(4, H - 4), r.range(1.5, 3), Terrain.Rock, 0.45);
  // lake (noise-shaped) and a meandering river running from it to the south edge
  const nL = noise(5), lr = 0.075 * size;
  for (let y = Math.floor(lake.y - lr * 1.4); y <= lake.y + lr * 1.4; y++)
    for (let x = Math.floor(lake.x - lr * 1.4); x <= lake.x + lr * 1.4; x++)
      if (inMap(x, y) && Math.hypot(x + 0.5 - lake.x, y + 0.5 - lake.y) <= lr * (0.7 + 0.7 * nL(x, y))) put(x, y, Terrain.Water);
  const riverX = (y: number) => lake.x + 5 * Math.sin((y - lake.y) * 0.16) + 3 * Math.sin((y - lake.y) * 0.05 + 1);
  for (let y = lake.y; y < H; y += 0.5) blob(riverX(y), y, 1.3, Terrain.Water, 0);
  // ore fields of varying richness (outer map)
  const fields: [number, number, number, number][] = [[0.56, 0.4, 5, 1], [0.86, 0.8, 6, 0.7], [0.25, 0.72, 5, 0.45], [0.5, 0.9, 4, 1], [0.9, 0.1, 4, 0.6]];
  for (const [fx, fy, rad, rich] of fields) oreField(fx * size, fy * size, rad, rich);

  // reserved clear zone for gallery / living area / fx range
  for (let y = 4; y <= 62 && y < H; y++) for (let x = 4; x <= 62 && x < W; x++) { terrain[y * W + x] = Terrain.Ground; ore[y * W + x] = 0; }
  road(0, 42, W - 1, 42);
  road(37, 44, 37, H - 1);
  if (size >= 100) road(63, 44, W - 10, H - 24);
  // small features inside the living area (also the terrain jump targets on small maps)
  for (let x = 13; x <= 16; x++) for (let y = 48; y <= 49; y++) if (r.chance(0.85)) put(x, y, Terrain.Tree);
  for (let x = 28; x <= 30; x++) for (let y = 49; y <= 50; y++) put(x, y, Terrain.Rock);
  blob(40.5, 47.5, 2.2, Terrain.Water, 0.2);
  blob(40.5, 53, 1.6, Terrain.Rock, 0.3);
  blob(40.5, 58.5, 2.2, Terrain.Tree, 0.3, 0.9);
  for (const [x, y] of [[5, 45], [6, 53], [36, 45], [36, 55], [5, 60], [23, 56]]) put(x, y, Terrain.Tree);
  for (const [x, y] of [[11, 55], [12, 55], [12, 56], [30, 55], [31, 55], [31, 56], [22, 60], [23, 60]]) put(x, y, Terrain.Rough);
  for (const x0 of [13, 24])
    for (let x = x0; x <= x0 + 5; x++)
      for (let y = 57; y <= 61; y++) {
        const d = Math.hypot(x + 0.5 - (x0 + 3), y + 0.5 - 59.5);
        ore[y * W + x] = clamp(Math.round(ORE_TILE_MAX * (1.1 - d / 3.6)), 1, ORE_TILE_MAX);
      }
  for (let i = 0; i < W * H; i++) {
    if (terrain[i] !== Terrain.Ground && terrain[i] !== Terrain.Rough) ore[i] = 0;
    variant[i] = r.int(0, 255);
  }
  const big = size >= 100;
  const sp: Record<string, Vec2> = {
    buildings: { x: 30, y: 12 }, units: { x: 30, y: 36.5 }, construction: { x: 30, y: 21 }, walls: { x: 28, y: 29.5 },
    living: { x: 21, y: 50 }, fx: { x: 52, y: 52 },
    lake: big ? lake : { x: 40.5, y: 47.5 },
    river: big ? { x: riverX(0.6 * size), y: 0.6 * size } : { x: 40.5, y: 47.5 },
    forest: big ? forest : { x: 40.5, y: 58.5 },
    rocks: big ? rocks : { x: 40.5, y: 53 },
    ore: big ? { x: 0.86 * size, y: 0.8 * size } : { x: 16, y: 59.5 },
    road: { x: 37.5, y: 43 },
  };
  const starts: Vec2[] = [{ x: 10, y: 10 }, { x: W - 10, y: H - 10 }, { x: W - 10, y: 10 }, { x: 10, y: H - 10 }];
  return { map: { id: 'render_dev', name: 'Render test range', width: W, height: H, terrain, ore, variant, starts }, spots: sp };
}

function makeWorld(): World {
  const g = makeMap(SIZE, SEED);
  spots = g.spots;
  const n = SIZE * SIZE;
  const q = (): ProductionQueue => ({ items: [], paused: false, ready: false });
  const players: Player[] = PLAYER_DEFS.map(([name, faction, color, team, controller], id) => ({
    id, name, faction, color, team, controller, difficulty: 'normal', credits: 5000, powerProduced: 400, powerConsumed: 250, lowPower: false, hasRadar: true,
    queues: { structure: q(), defense: q(), infantry: q(), vehicle: q(), aircraft: q() }, powers: [],
    explored: new Uint8Array(n).fill(1), visible: new Uint8Array(n).fill(1), defeated: false,
    stats: { unitsBuilt: 0, unitsLost: 0, buildingsBuilt: 0, buildingsLost: 0, kills: 0, oreHarvested: 0, creditsSpent: 0 },
  }));
  const setup: GameSetup = {
    map: g.map, seed: SEED, startingCredits: 5000, options: { fog: state.fog, shortGame: false, superweapons: true },
    players: PLAYER_DEFS.map(([name, faction, color, team, controller], i) => ({ name, faction, color, team, controller, difficulty: 'normal', startIndex: i })),
  };
  return { tick: 0, rngState: SEED, setup, map: g.map, players, entities: new Map(), nextEntityId: 1, projectiles: [], events: [], winnerTeam: null };
}

// ───────────────────────────── entities ─────────────────────────────

function spawn(defId: string, owner: PlayerId, x: number, y: number, o: Partial<Entity> = {}): Entity {
  const def = getDef(defId);
  const e: Entity = {
    id: world.nextEntityId++, defId, kind: def.kind, owner, x, y, px: x, py: y, facing: 0, turretFacing: 0,
    altitude: def.kind === 'unit' ? (def.altitude ?? 0) : 0, hp: def.hp, maxHp: def.hp, rank: 0, kills: 0,
    action: 'idle', order: null, queue: [], targetId: null, lastFireTick: -1, lastHitTick: -1, cargo: 0,
    buildProgress: 1, rally: null, primary: false, repairing: false, powered: true, ...o,
  };
  world.entities.set(e.id, e);
  return e;
}
/** Building by top-left tile. */
function spawnB(defId: string, owner: PlayerId, tx: number, ty: number, o: Partial<Entity> = {}): Entity {
  const f = BUILDINGS[defId].footprint;
  return spawn(defId, owner, tx + f.w / 2, ty + f.h / 2, o);
}
/** Unit at (x,y), or building whose footprint is centred as near (x,y) as the grid allows. */
function spawnAt(defId: string, owner: PlayerId, x: number, y: number, o: Partial<Entity> = {}): Entity {
  const d = getDef(defId);
  return d.kind === 'building' ? spawnB(defId, owner, Math.round(x - d.footprint.w / 2), Math.round(y - d.footprint.h / 2), o) : spawn(defId, owner, x, y, o);
}
function removeEntity(e: Entity) {
  world.entities.delete(e.id);
  view.selection.delete(e.id);
  if (view.hoverId === e.id) view.hoverId = null;
  const a = agentOf.get(e.id);
  if (a) { a.dead = true; agentOf.delete(e.id); agentsDirty = true; }
}
function growBuilding(e: Entity, ticks: number, done?: () => void) {
  e.buildProgress = 0;
  e.action = 'construct';
  ev({ type: 'buildingPlaced', id: e.id, defId: e.defId, owner: e.owner, x: e.x, y: e.y });
  tweens.push(() => {
    if (!alive(e)) return false;
    e.buildProgress = Math.min(1, e.buildProgress + 1 / ticks);
    if (e.buildProgress < 1) return true;
    e.action = 'idle';
    ev({ type: 'buildingComplete', id: e.id, defId: e.defId, owner: e.owner });
    done?.();
    return false;
  });
}

// ───────────────────────────── weapons / projectiles ─────────────────────────────

function applyHit(w: WeaponDef, sourceId: EntityId, tgt: Entity | null) {
  if (!alive(tgt)) return;
  const amount = Math.round(w.damage * WARHEADS[w.warhead][getDef(tgt.defId).armor]);
  if (amount <= 0) return;
  tgt.lastHitTick = world.tick;
  ev({ type: 'entityDamaged', id: tgt.id, owner: tgt.owner, amount, x: tgt.x, y: tgt.y });
  const ta = agentOf.get(tgt.id);
  if (!ta) return; // gallery items / fx dummies keep their hp
  if (!ta.mortal) { tgt.hp = Math.max(tgt.maxHp * 0.3, tgt.hp - amount * 0.4); return; }
  tgt.hp -= amount * 0.4;
  if (tgt.hp > 0) return;
  const src = world.entities.get(sourceId);
  ev({ type: 'entityDestroyed', id: tgt.id, defId: tgt.defId, kind: tgt.kind, owner: tgt.owner, killer: src ? src.owner : null, x: tgt.x, y: tgt.y });
  removeEntity(tgt);
  if (src && src.kind === 'unit') {
    src.kills++;
    if ((src.kills === 3 && src.rank === 0) || (src.kills === 7 && src.rank === 1)) {
      src.rank = src.rank === 0 ? 1 : 2;
      ev({ type: 'unitPromoted', id: src.id, owner: src.owner, rank: src.rank });
    }
  }
  if (ta.respawn) { const f = getDef(tgt.defId).faction; later(20, () => heavyUnit(f, true)); }
}

function fire(src: Entity, w: WeaponDef, tgt: Entity | null, tx: number, ty: number, tz: number) {
  const sd = getDef(src.defId);
  const kind = w.projectile;
  const a = Math.atan2(ty - src.y, tx - src.x);
  const reach = kind === 'bomb' ? 0 : sd.kind === 'unit' ? sd.radius : 0.3;
  const sx = src.x + Math.cos(a) * reach, sy = src.y + Math.sin(a) * reach;
  const sz = src.altitude + (sd.kind === 'building' ? 0.7 : sd.category === 'infantry' ? 0.3 : sd.category === 'aircraft' ? -0.1 : 0.4);
  src.lastFireTick = world.tick;
  src.targetId = tgt ? tgt.id : null;
  ev({ type: 'weaponFired', sourceId: src.id, weaponId: w.id, kind, x: sx, y: sy, z: sz, tx, ty, tz });
  if (kind === 'tracer' || kind === 'beam' || kind === 'flame' || kind === 'flakburst') {
    ev({ type: 'impact', weaponId: w.id, kind, x: tx, y: ty, z: tz, splash: w.splash ?? 0 });
    applyHit(w, src.id, tgt);
    return;
  }
  const dist = Math.max(0.001, Math.hypot(tx - sx, ty - sy));
  const p: Projectile = { id: nextProjId++, weaponId: w.id, kind, owner: src.owner, sourceId: src.id, x: sx, y: sy, z: sz, px: sx, py: sy, pz: sz, tx, ty, targetId: kind === 'missile' && tgt ? tgt.id : null };
  projMeta.set(p, { w, speed: (w.projectileSpeed ?? 10) / TICK_RATE, sz, tz, dist, h: Math.max(1, dist * 0.28), vz: 0, tgt });
  world.projectiles.push(p);
}

function stepProjectiles() {
  const ps = world.projectiles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i], m = projMeta.get(p);
    if (!m) { ps.splice(i, 1); continue; }
    p.px = p.x; p.py = p.y; p.pz = p.z;
    if (p.kind === 'missile' && m.tgt) {
      if (alive(m.tgt)) { p.tx = m.tgt.x; p.ty = m.tgt.y; m.tz = m.tgt.altitude; }
      else { m.tgt = null; p.targetId = null; }
    }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    let hit = false;
    if (p.kind === 'bomb') {
      m.vz = Math.min(m.speed, m.vz + m.speed * 0.12);
      p.z -= m.vz; p.x += dx * 0.2; p.y += dy * 0.2;
      hit = p.z <= m.tz;
    } else if (p.kind === 'missile') {
      const dz = m.tz + 0.15 - p.z, d3 = Math.hypot(d, dz);
      if (d3 <= m.speed) hit = true;
      else { p.x += (dx / d3) * m.speed; p.y += (dy / d3) * m.speed; p.z += (dz / d3) * m.speed; }
    } else if (d <= m.speed) hit = true;
    else {
      p.x += (dx / d) * m.speed; p.y += (dy / d) * m.speed;
      const t = clamp(1 - (d - m.speed) / m.dist, 0, 1);
      p.z = m.sz + (m.tz - m.sz) * t + (p.kind === 'arc' ? 4 * m.h * t * (1 - t) : 0);
    }
    if (!hit) continue;
    ev({ type: 'impact', weaponId: p.weaponId, kind: p.kind, x: p.tx, y: p.ty, z: m.tz, splash: m.w.splash ?? 0 });
    applyHit(m.w, p.sourceId, m.tgt);
    ps.splice(i, 1);
  }
}

// ───────────────────────────── agents (fake unit AI) ─────────────────────────────

function makeAgent(e: Entity, mode: Agent['mode'], o: Partial<Agent> = {}): Agent {
  const def = getDef(e.defId);
  const slots: Slot[] = [];
  for (const id of def.kind === 'unit' ? [def.weapon, def.secondary] : [def.weapon]) if (id) slots.push({ w: WEAPONS[id], cd: rng.int(0, 30), burst: 0, tgt: null });
  const a: Agent = {
    e, def, air: def.kind === 'unit' && def.movement === 'air', team: world.players[e.owner].team, mode,
    speed: def.kind === 'unit' ? def.speed / TICK_RATE : 0, turn: def.kind === 'unit' ? def.turnRate / TICK_RATE : 0,
    path: [], wp: 0, cx: e.x, cy: e.y, r: 1, ang: 0, dir: 1, slots, engage: 0, holdoff: rng.int(0, 80),
    mortal: false, respawn: false, dead: false, hv: null, ...o,
  };
  agents.push(a);
  agentOf.set(e.id, a);
  return a;
}

function driveTo(a: Agent, tx: number, ty: number): boolean {
  const e = a.e, dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 0.05) return true;
  const want = Math.atan2(dy, dx);
  e.facing = turnTo(e.facing, want, a.turn);
  const sp = Math.min(d, a.speed * (Math.abs(angDiff(want, e.facing)) < 0.6 ? 1 : 0.2));
  e.x += (dx / d) * sp; e.y += (dy / d) * sp;
  e.action = 'move';
  return d - sp < 0.05;
}

const HR = [20, 11.5, 46, 35.5] as const; // heavy scene battle rect
function pickWander(a: Agent) {
  if (a.air && rng.chance(0.7))
    for (let k = 0; k < 6; k++) {
      const b = agents[rng.int(0, agents.length - 1)];
      if (b.team !== a.team && !b.air && !b.dead) { a.cx = clamp(b.e.x, HR[0], HR[2]); a.cy = clamp(b.e.y, HR[1], HR[3]); return; }
    }
  a.cx = rng.range(HR[0], HR[2]); a.cy = rng.range(HR[1], HR[3]);
}

function pickOre(a: Agent): boolean {
  const h = a.hv!, W = world.map.width, ore = world.map.ore, [x0, y0, x1, y1] = h.field;
  for (let pass = 0; pass < 2; pass++) {
    let best = -1, bd = 1e9;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!ore[y * W + x]) continue;
        const d = Math.hypot(x + 0.5 - a.e.x, y + 0.5 - a.e.y);
        if (d < bd) { bd = d; best = y * W + x; }
      }
    if (best >= 0) { h.tx = best % W; h.ty = Math.floor(best / W); return true; }
    let k = 0; // field exhausted → regrow it from the snapshot
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ore[y * W + x] = h.snap[k++];
  }
  return false;
}

function harvestStep(a: Agent) {
  const e = a.e, h = a.hv!, W = world.map.width, ore = world.map.ore;
  const cap = (a.def as UnitDef).harvester?.capacity ?? 20;
  const i = h.ty * W + h.tx;
  if (h.state === 'toOre') {
    if (!ore[i]) pickOre(a);
    e.order = { type: 'harvest', tx: h.tx, ty: h.ty };
    if (driveTo(a, h.tx + 0.5, h.ty + 0.5)) { h.state = 'mine'; h.t = 0; }
  } else if (h.state === 'mine') {
    e.action = 'harvest';
    if (e.cargo >= cap) h.state = 'toDock';
    else if (!ore[i]) h.state = 'toOre';
    else if (++h.t % 8 === 0) { ore[i]--; e.cargo++; }
  } else if (h.state === 'toDock') {
    e.order = { type: 'dock', targetId: h.refinery.id };
    if (driveTo(a, h.dock.x, h.dock.y)) { h.state = 'unload'; h.t = 0; h.load = e.cargo; }
  } else {
    e.action = 'unload';
    e.facing = turnTo(e.facing, Math.atan2(h.refinery.y - e.y, h.refinery.x - e.x), a.turn);
    if (++h.t % 2 === 0 && e.cargo > 0) e.cargo--;
    if (e.cargo === 0) {
      const credits = h.load * ORE_UNIT_VALUE;
      world.players[e.owner].credits += credits;
      world.players[e.owner].stats.oreHarvested += credits;
      ev({ type: 'harvesterUnloaded', id: e.id, owner: e.owner, credits });
      pickOre(a);
      h.state = 'toOre';
    }
  }
  e.turretFacing = e.facing;
}

function moveAgent(a: Agent) {
  const e = a.e;
  if (!a.mortal && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.002);
  if (a.mode === 'static') return;
  if (a.mode === 'harvest') return harvestStep(a);
  if (a.mode === 'circle') {
    a.ang += (a.dir * a.speed) / a.r;
    e.x = a.cx + Math.cos(a.ang) * a.r; e.y = a.cy + Math.sin(a.ang) * a.r;
    e.facing = a.ang + (a.dir * Math.PI) / 2;
    e.action = 'move';
    return;
  }
  if (a.engage > 0) {
    if (--a.engage === 0) a.holdoff = 60 + rng.int(0, 80);
    return;
  }
  if (a.mode === 'loop') {
    const p = a.path[a.wp];
    if (driveTo(a, p.x, p.y)) a.wp = (a.wp + 1) % a.path.length;
  } else if (driveTo(a, a.cx, a.cy)) pickWander(a);
}

function findTarget(a: Agent, w: WeaponDef): Entity | null {
  let best: Entity | null = null, bd = w.range * w.range;
  const min2 = (w.minRange ?? 0) ** 2;
  for (const b of agents) {
    if (b.team === a.team || b.dead || (b.air ? !w.targetsAir : !w.targetsGround)) continue;
    const dx = b.e.x - a.e.x, dy = b.e.y - a.e.y, d = dx * dx + dy * dy;
    if (d <= bd && d >= min2) { bd = d; best = b.e; }
  }
  return best;
}

function combatAgent(a: Agent) {
  const e = a.e;
  if (!a.slots.length) return;
  if (a.holdoff > 0) a.holdoff--;
  const mobileGround = !a.air && a.mode !== 'static';
  const hasTurret = a.def.turret === true;
  let aim: Entity | null = null;
  for (const s of a.slots) {
    if (s.cd > 0) s.cd--;
    if (s.tgt && (!alive(s.tgt) || Math.hypot(s.tgt.x - e.x, s.tgt.y - e.y) > s.w.range + 0.75)) s.tgt = null;
    if (!s.tgt && (world.tick + e.id) % 6 === 0) s.tgt = findTarget(a, s.w);
    if (s.tgt && !aim) aim = s.tgt;
  }
  let aligned = true;
  if (aim) {
    const want = Math.atan2(aim.y - e.y, aim.x - e.x);
    if (mobileGround && a.engage <= 0 && a.holdoff <= 0) a.engage = 40 + rng.int(0, 50);
    if (hasTurret) {
      e.turretFacing = turnTo(e.turretFacing, want, 0.3);
      aligned = Math.abs(angDiff(want, e.turretFacing)) < 0.2;
    } else if (mobileGround) {
      if (a.engage > 0) { e.facing = turnTo(e.facing, want, a.turn); aligned = Math.abs(angDiff(want, e.facing)) < 0.3; }
      else aligned = false;
    }
  } else {
    if (a.engage > 0) { a.engage = 0; a.holdoff = 30 + rng.int(0, 60); }
    if (hasTurret && a.def.kind === 'unit') e.turretFacing = turnTo(e.turretFacing, e.facing, 0.15);
  }
  if (!hasTurret) e.turretFacing = e.facing;
  for (let i = 0; i < a.slots.length; i++) {
    const s = a.slots[i];
    if (s.cd > 0) continue;
    if (!s.tgt) {
      if (s.w.projectile === 'bomb' && a.air) { fire(e, s.w, null, e.x, e.y, 0); s.cd = secToTicks(s.w.cooldown * 1.5); }
      continue;
    }
    if (i === 0 && !aligned) continue;
    fire(e, s.w, s.tgt, s.tgt.x, s.tgt.y, s.tgt.altitude);
    if (s.burst === 0) s.burst = s.w.burst ?? 1;
    s.burst--;
    s.cd = s.burst > 0 ? 3 : secToTicks(s.w.cooldown);
  }
  e.targetId = aim ? aim.id : null;
  const recent = e.lastFireTick >= 0 && world.tick - e.lastFireTick < 10;
  if (a.mode === 'static') e.action = recent ? 'attack' : 'idle';
  else if (a.engage > 0 || (recent && a.air)) e.action = 'attack';
}

// ───────────────────────────── scene: gallery (+ living area + fx range) ─────────────────────────────

const FACINGS = [0.25 * Math.PI, 0.75 * Math.PI, Math.PI, 1.5 * Math.PI];
const rectLoop = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** Row of buildings by top-left tile; `each` may tweak the entity and return a label suffix. */
function rowB(ids: string[], x0: number, ty: number, gap: number, each?: (e: Entity, i: number) => string | void, withLabels = true): Entity[] {
  let x = x0;
  return ids.map((id, i) => {
    const d = BUILDINGS[id];
    const e = spawnB(id, ownerOf(d.faction), x, ty);
    const extra = each?.(e, i);
    if (withLabels) label(x + d.footprint.w, ty + d.footprint.h, `${id} ${d.name}${extra ? ' ' + extra : ''}`);
    x += d.footprint.w + gap;
    return e;
  });
}

function onLoop(ids: string[], owner: PlayerId, path: Vec2[]) {
  const segs = path.map((p, i) => Math.hypot(path[(i + 1) % path.length].x - p.x, path[(i + 1) % path.length].y - p.y));
  const total = segs.reduce((s, v) => s + v, 0);
  ids.forEach((id, k) => {
    let d = (k / ids.length) * total, i = 0;
    while (d > segs[i] && i < segs.length - 1) { d -= segs[i]; i++; }
    const p = path[i], q = path[(i + 1) % path.length], t = segs[i] ? d / segs[i] : 0, f = Math.atan2(q.y - p.y, q.x - p.x);
    makeAgent(spawn(id, owner, p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, { facing: f, turretFacing: f }), 'loop', { path, wp: (i + 1) % path.length });
  });
}

function buildGallery() {
  const B = Object.values(BUILDINGS), U = Object.values(UNITS);
  const spinners: Entity[] = [];
  // rows 1-2 (y 8..10, 13..15): every building of each faction, 2-tile gaps
  for (const [f, ty] of [['helion', 8], ['ferrum', 13]] as [FactionId, number][]) {
    label(6.5, ty + 1.5, `${FACTIONS[f].name} buildings`, true);
    for (const e of rowB(B.filter((b) => b.faction === f).map((b) => b.id), 8, ty, 2)) if (BUILDINGS[e.defId].turret) spinners.push(e);
  }
  // row 3 (y 18..20): construction loop x 8..36 | unpowered x 40..57
  label(6.5, 19.5, 'construction loop', true);
  const loopers = rowB(['h_nexus', 'h_power', 'h_sentry', 'h_wall', 'f_core', 'f_airpad', 'f_siege', 'f_wall'], 8, 18, 2, () => '(building)');
  tweens.push(() => {
    loopers.forEach((e, i) => {
      e.buildProgress = Math.min(1, ((world.tick + i * 23) % 170) / 120);
      e.action = e.buildProgress < 1 ? 'construct' : 'idle';
    });
    return true;
  });
  label(39, 18.5, 'powered = false', true);
  rowB(['h_skyshield', 'h_railturret', 'f_flaknest', 'f_siege', 'h_radar', 'f_radar'], 40, 18, 2, (e) => { e.powered = false; return '(no power)'; });
  // row 4 (y 23..25): damaged pairs, hp 45% and 20%
  label(6.5, 24.5, 'damaged 45% / 20%', true);
  const dmg = ['h_refinery', 'f_factory', 'h_power', 'f_radar', 'h_railturret', 'f_bunker'].flatMap((id) => [id, id]);
  rowB(dmg, 8, 23, 2, (e, i) => { const f = i % 2 ? 0.2 : 0.45; e.hp = Math.round(e.maxHp * f); return `${f * 100}%`; });
  // row 5 (y 28..30): wall shapes — line, L, T, + (helion x 8..27, ferrum x 31..50)
  label(6.5, 29.5, 'walls', true);
  const shapes: [string, number, number[][]][] = [
    ['line', 5, [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]],
    ['L', 3, [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]],
    ['T', 3, [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]]],
    ['+', 3, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]],
  ];
  ['h_wall', 'f_wall'].forEach((id, fi) => {
    let x = 8 + fi * 23;
    for (const [name, w, cells] of shapes) {
      for (const [dx, dy] of cells) spawnB(id, ownerOf(BUILDINGS[id].faction), x + dx, 28 + dy);
      label(x + w, 31, `${id} ${name}`);
      x += w + 2;
    }
  });
  // unit rows (y 32.5 / 34.5 helion, 36.5 / 38.5 ferrum): each def × 4 facings
  const unitRow = (defs: UnitDef[], y: number) =>
    defs.forEach((d, c) => {
      const x0 = 8.5 + c * 7.4;
      FACINGS.forEach((f, k) => {
        const e = spawn(d.id, ownerOf(d.faction), x0 + k * 1.5, y, { facing: f, turretFacing: f });
        if (d.turret) spinners.push(e);
      });
      label(x0 + 2.85, y + 0.6, `${d.id} ${d.name}`);
    });
  const hU = U.filter((u) => u.faction === 'helion'), fU = U.filter((u) => u.faction === 'ferrum');
  label(6.5, 33.5, `${FACTIONS.helion.name} units`, true);
  unitRow(hU.slice(0, 6), 32.5); unitRow(hU.slice(6), 34.5);
  label(6.5, 37.5, `${FACTIONS.ferrum.name} units`, true);
  unitRow(fU.slice(0, 7), 36.5); unitRow(fU.slice(7), 38.5);
  tweens.push(() => { for (const e of spinners) e.turretFacing = (e.turretFacing + 0.035) % TAU; return true; });
  // extras row (y 40.5): harvester cargo, ranks, low hp
  let x = 8.5;
  const one = (id: string, o: Partial<Entity>) => { const e = spawn(id, ownerOf(UNITS[id].faction), x, 40.5, { facing: FACINGS[0], turretFacing: FACINGS[0], ...o }); x += 1.6; return e; };
  for (const id of ['h_harvester', 'f_hauler']) {
    const cap = UNITS[id].harvester?.capacity ?? 20, x0 = x;
    for (const f of [0, 1 / 3, 2 / 3, 1]) one(id, { cargo: Math.round(cap * f) });
    label(x0 + 3, 41.1, `${id} cargo 0/33/66/100%`);
    x += 1.2;
  }
  for (const id of ['h_javelin', 'f_hammer', 'h_warden', 'f_vulture']) {
    const x0 = x;
    one(id, { rank: 1, kills: 3 }); one(id, { rank: 2, kills: 8 });
    label(x0 + 1.4, 41.1, `${id} rank 1/2`);
    x += 0.8;
  }
  for (const [id, f] of [['h_javelin', 0.3], ['f_colossus', 0.15], ['h_warden', 0.25], ['f_militia', 0.1], ['h_kestrel', 0.2]] as [string, number][]) {
    const e = one(id, {});
    e.hp = Math.max(1, Math.round(e.maxHp * f));
    label(e.x + 0.6, 41.1, `hp ${f * 100}%`);
  }
  buildLiving();
  buildFxRange();
}

function buildLiving() {
  label(21, 44.2, 'living area', true);
  onLoop(['h_javelin', 'h_ranger', 'h_arbiter', 'h_javelin', 'h_skyveil', 'h_farstrike', 'h_ranger', 'h_javelin'], 0, rectLoop(8.5, 45.5, 22.5, 52.5));
  onLoop(['h_warden', 'h_warden', 'h_breacher', 'h_warden', 'h_breacher', 'h_engineer'], 0, rectLoop(10.5, 47.5, 20.5, 50.5).reverse());
  onLoop(['f_hammer', 'f_jackal', 'f_colossus', 'f_salamander', 'f_hailstorm', 'f_flakcrawler', 'f_jackal', 'f_hammer'], 1, rectLoop(24.5, 46.5, 35.5, 53.5).reverse());
  onLoop(['f_militia', 'f_militia', 'f_grenadier', 'f_scorcher', 'f_militia', 'f_sapper'], 1, rectLoop(26.5, 48.5, 33.5, 51.5));
  ['h_skyshield', 'h_railturret', 'h_sentry'].forEach((id, i) => makeAgent(spawnB(id, 0, 17 + i * 2, 54), 'static'));
  ['f_bunker', 'f_siege', 'f_flaknest'].forEach((id, i) => makeAgent(spawnB(id, 1, 25 + i * 2, 44), 'static'));
  const air = (id: string, owner: PlayerId, cx: number, cy: number, r: number, ang: number, dir: number) =>
    makeAgent(spawn(id, owner, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r), 'circle', { cx, cy, r, ang, dir });
  air('h_kestrel', 0, 30, 50, 5, 0, 1); air('h_kestrel', 0, 30, 50, 5, Math.PI, 1);
  air('f_vulture', 1, 15.5, 49, 4.5, 1, -1); air('f_vulture', 1, 15.5, 49, 4.5, 1 + Math.PI, -1);
  // harvesters cycling ore field ↔ refinery
  const W = world.map.width;
  const harv = (unit: string, ref: string, owner: PlayerId, rtx: number, dockX: number, fx0: number) => {
    const refinery = spawnB(ref, owner, rtx, 57);
    makeAgent(refinery, 'static');
    const field: Harvest['field'] = [fx0, 57, fx0 + 5, 61];
    const snap: number[] = [];
    for (let y = 57; y <= 61; y++) for (let x = fx0; x <= fx0 + 5; x++) snap.push(world.map.ore[y * W + x]);
    const a = makeAgent(spawn(unit, owner, dockX, 58.5), 'harvest');
    a.hv = { state: 'toOre', tx: fx0, ty: 57, dock: { x: dockX, y: 58.5 }, refinery, field, snap, t: 0, load: 0 };
    pickOre(a);
  };
  harv('h_harvester', 'h_refinery', 0, 7, 10.8, 13);
  harv('f_hauler', 'f_refinery', 1, 33, 32.2, 24);
}

// ───────────────────────────── fx demos + synthetic event generator ─────────────────────────────

const KIND_DEMO: Record<ProjectileKind, { src: string; weapon: string; tgt: string }> = {
  tracer: { src: 'h_warden', weapon: 'h_rifle', tgt: 'f_militia' },
  beam: { src: 'h_arbiter', weapon: 'h_rail', tgt: 'f_hammer' },
  shell: { src: 'f_hammer', weapon: 'f_hammer_cannon', tgt: 'h_javelin' },
  arc: { src: 'h_farstrike', weapon: 'h_howitzer', tgt: 'f_bunker' },
  missile: { src: 'h_breacher', weapon: 'h_rocket', tgt: 'f_jackal' },
  flame: { src: 'f_salamander', weapon: 'f_salamander', tgt: 'h_warden' },
  flakburst: { src: 'f_flakcrawler', weapon: 'f_flak', tgt: 'h_kestrel' },
  bomb: { src: 'f_vulture', weapon: 'f_vulture_bomb', tgt: 'h_sentry' },
};

function makePair(kind: ProjectileKind, tx: number, ty: number) {
  const cfg = KIND_DEMO[kind], w = WEAPONS[cfg.weapon];
  const tgt = spawnAt(cfg.tgt, ownerOf(getDef(cfg.tgt).faction), tx, ty, { facing: Math.PI, turretFacing: Math.PI });
  const d = kind === 'bomb' ? 0 : Math.min(w.range * 0.85, 5);
  const src = spawn(cfg.src, ownerOf(getDef(cfg.src).faction), tgt.x - d, tgt.y);
  return { src, tgt };
}

function fxWeapon(kind: ProjectileKind, x: number, y: number, onRange: boolean) {
  const w = WEAPONS[KIND_DEMO[kind].weapon];
  let pair = onRange ? fxPairs[kind] : undefined;
  if (!pair || !alive(pair.src) || !alive(pair.tgt)) {
    pair = makePair(kind, onRange ? x : x + 2, y);
    if (onRange) fxPairs[kind] = pair;
    else { const p = pair; later(90, () => { removeEntity(p.src); removeEntity(p.tgt); }); }
  }
  const { src, tgt } = pair;
  const cd = secToTicks(w.cooldown), shots = clamp(Math.floor(36 / cd), 1, 10);
  for (let i = 0; i < shots; i++)
    later(i * cd, () => {
      if (!alive(src) || !alive(tgt)) return;
      src.action = 'attack';
      fire(src, w, tgt, tgt.x, tgt.y, tgt.altitude);
    });
  later(shots * cd + 10, () => { if (alive(src)) { src.action = 'idle'; src.targetId = null; } });
}

function fxImpact(splash: number, x: number, y: number) {
  const [weaponId, kind]: [string, ProjectileKind] = splash === 0 ? ['h_rifle', 'tracer'] : splash < 1 ? ['f_colossus_cannon', 'shell'] : ['h_howitzer', 'arc'];
  ev({ type: 'impact', weaponId, kind, x, y, z: 0, splash });
}

function fxDestroy(defId: string, x: number, y: number) {
  const e = spawnAt(defId, ownerOf(getDef(defId).faction), x, y, { facing: 0.8, turretFacing: 0.8 });
  ev({ type: 'entityCreated', id: e.id, defId, owner: e.owner, x: e.x, y: e.y });
  later(25, () => {
    if (!alive(e)) return;
    ev({ type: 'entityDestroyed', id: e.id, defId, kind: e.kind, owner: e.owner, killer: e.owner === 0 ? 1 : 0, x: e.x, y: e.y });
    removeEntity(e);
  });
}

function fxBuild(x: number, y: number) {
  const e = spawnAt('h_factory', 0, x, y);
  growBuilding(e, 50, () => later(30, () => removeEntity(e)));
}
function fxSold(x: number, y: number) {
  const e = spawnAt('f_refinery', 1, x, y);
  later(22, () => {
    if (!alive(e)) return;
    ev({ type: 'buildingSold', id: e.id, defId: e.defId, owner: e.owner, x: e.x, y: e.y });
    removeEntity(e);
  });
}
function fxCapture(x: number, y: number) {
  const e = spawnAt('f_barracks', 1, x, y);
  later(25, () => {
    if (!alive(e)) return;
    e.owner = 0;
    ev({ type: 'buildingCaptured', id: e.id, defId: e.defId, from: 1, to: 0 });
  });
  later(72, () => removeEntity(e));
}
function fxDeploy(x: number, y: number) {
  const u = spawn('h_crawler', 0, x, y, { facing: FACINGS[0], turretFacing: FACINGS[0] });
  later(18, () => { if (alive(u)) u.action = 'deploy'; });
  later(32, () => {
    if (!alive(u)) return;
    removeEntity(u);
    const b = spawnAt('h_nexus', 0, x, y);
    ev({ type: 'unitDeployed', unitId: u.id, buildingId: b.id, owner: 0 });
    growBuilding(b, 45, () => later(40, () => removeEntity(b)));
  });
}
function fxPromote(x: number, y: number) {
  const u = spawn('h_javelin', 0, x, y, { facing: FACINGS[0], turretFacing: FACINGS[0] });
  for (const [t, rank] of [[15, 1], [38, 2]] as [number, 1 | 2][])
    later(t, () => { if (alive(u)) { u.rank = rank; u.kills = rank * 4; ev({ type: 'unitPromoted', id: u.id, owner: u.owner, rank }); } });
  later(66, () => removeEntity(u));
}
function fxPower(id: SupportPowerId, x: number, y: number) {
  const p = SUPPORT_POWERS[id], player = view.viewer, team = world.players[player].team;
  ev({ type: 'powerUsed', player, power: id, x, y });
  const impact = () => {
    ev({ type: 'powerImpact', player, power: id, x, y, radius: p.radius });
    if (id === 'recon_sweep') reveals.push({ x, y, r: p.radius, until: world.tick + secToTicks(p.duration), team });
  };
  if (p.delay > 0) later(secToTicks(p.delay), impact);
  else impact();
}

interface Fx { id: string; label: string; dur: number; at: Vec2; run: (x: number, y: number, onRange: boolean) => void }
const FX: Fx[] = [
  ...KINDS.map((k, i): Fx => ({ id: `fire_${k}`, label: `weaponFired+impact ${k}`, dur: 44, at: { x: 51.5, y: 45.5 + i * 2 }, run: (x, y, r) => fxWeapon(k, x, y, r) })),
  ...[0, 0.5, 1.5].map((s): Fx => ({ id: `impact_${s}`, label: `impact splash ${s}`, dur: 22, at: { x: 55.5, y: 45.5 }, run: (x, y) => fxImpact(s, x, y) })),
  ...(['f_militia', 'h_javelin', 'f_vulture', 'f_core'] as const).map((d): Fx => ({ id: `destroy_${d}`, label: `entityDestroyed ${d}`, dur: 46, at: { x: 55.5, y: 49.5 }, run: (x, y) => fxDestroy(d, x, y) })),
  { id: 'build', label: 'buildingPlaced → buildingComplete', dur: 90, at: { x: 55.5, y: 54.5 }, run: fxBuild },
  { id: 'sold', label: 'buildingSold', dur: 46, at: { x: 55.5, y: 54.5 }, run: fxSold },
  { id: 'capture', label: 'buildingCaptured', dur: 80, at: { x: 59, y: 59 }, run: fxCapture },
  { id: 'deploy', label: 'unitDeployed', dur: 125, at: { x: 55.5, y: 58.5 }, run: fxDeploy },
  { id: 'promote', label: 'unitPromoted 1 → 2', dur: 72, at: { x: 59.5, y: 46.5 }, run: fxPromote },
  ...POWER_IDS.map((p): Fx => ({ id: `power_${p}`, label: `powerUsed → powerImpact ${p}`, dur: secToTicks(SUPPORT_POWERS[p].delay) + 50, at: { x: 52, y: 52 }, run: (x, y) => fxPower(p, x, y) })),
];

function buildFxRange() {
  label(48, 44.4, () => `FX range — ${stats.fx || 'generator off'}`, true);
  KINDS.forEach((k, i) => {
    fxPairs[k] = makePair(k, 51.5, 45.5 + i * 2);
    label(52.3, 46.3 + i * 2, k);
  });
  label(56, 46.2, 'impacts'); label(57, 51.2, 'destroy'); label(57, 56.2, 'build / sell'); label(57, 60.2, 'deploy');
  label(60, 60.2, 'capture'); label(60, 47.2, 'promote');
}

function stepGenerator() {
  if (!state.gen || state.scene !== 'gallery') { stats.fx = ''; return; }
  if (world.tick < fxNextAt) return;
  const f = FX[fxStep++ % FX.length];
  stats.fx = f.label;
  fxNextAt = world.tick + f.dur;
  f.run(f.at.x, f.at.y, true);
}
/** Trigger one fx demo at the camera centre (queued so its events land inside the next tick). */
function triggerFx(id: string) {
  const f = FX.find((v) => v.id === id);
  if (!f || state.scene === 'sim') return;
  later(0, () => f.run(Math.floor(R.camera.x) + 0.5, Math.floor(R.camera.y) + 0.5, false));
}

// ───────────────────────────── scene: heavy ─────────────────────────────

const heavyPool: Record<FactionId, string[]> = { helion: [], ferrum: [] };
for (const u of Object.values(UNITS)) {
  const n = !u.weapon ? 1 : u.category === 'infantry' ? 5 : 3;
  for (let i = 0; i < n; i++) heavyPool[u.faction].push(u.id);
}
function heavyUnit(faction: FactionId, respawn: boolean) {
  if (state.scene !== 'heavy') return;
  const top = faction === 'helion';
  const owner = top ? (rng.chance(0.75) ? 0 : 2) : rng.chance(0.75) ? 1 : 3;
  const y = respawn ? (top ? HR[1] : HR[3]) : top ? rng.range(HR[1], 23) : rng.range(24, HR[3]);
  const f = top ? Math.PI / 2 : -Math.PI / 2;
  const e = spawn(rng.pick(heavyPool[faction]), owner, rng.range(HR[0], HR[2]), y, { facing: f, turretFacing: f });
  pickWander(makeAgent(e, 'wander', { mortal: true, respawn: true }));
}
function buildHeavy() {
  spots.battle = { x: 33, y: 23.5 };
  const stat = (es: Entity[], alt: PlayerId) => es.forEach((e, i) => { if (i % 4 === 3) e.owner = alt; makeAgent(e, 'static'); });
  stat(rowB(['h_nexus', 'h_power', 'h_refinery', 'h_barracks', 'h_factory', 'h_radar', 'h_airpad', 'h_lab'], 20, 6, 1, undefined, false), 2);
  stat(rowB(['f_core', 'f_power', 'f_refinery', 'f_barracks', 'f_factory', 'f_radar', 'f_airpad', 'f_lab'], 20, 38, 1, undefined, false), 3);
  stat([spawnB('h_uplink', 0, 15, 11), spawnB('h_power', 0, 15, 15), spawnB('h_barracks', 0, 15, 18), spawnB('h_power', 0, 15, 21)], 2);
  stat([spawnB('f_drill', 1, 48, 33), spawnB('f_power', 1, 48, 30), spawnB('f_barracks', 1, 48, 27), spawnB('f_power', 1, 48, 24)], 3);
  ['h_sentry', 'h_railturret', 'h_skyshield', 'h_sentry', 'h_railturret', 'h_skyshield', 'h_sentry', 'h_railturret'].forEach((id, i) => makeAgent(spawnB(id, 0, 21 + i * 3, 10), 'static'));
  ['f_bunker', 'f_siege', 'f_flaknest', 'f_bunker', 'f_siege', 'f_flaknest', 'f_bunker', 'f_siege'].forEach((id, i) => makeAgent(spawnB(id, 1, 21 + i * 3, 36), 'static'));
  for (let i = 0; i < 150; i++) { heavyUnit('helion', false); heavyUnit('ferrum', false); }
}

// ───────────────────────────── scene: sim (optional, lazy) ─────────────────────────────

const simLoaders = import.meta.glob('../sim/index.ts');
const mapLoaders = import.meta.glob('../maps/index.ts');
const simAvailable = Object.keys(simLoaders).length > 0 && Object.keys(mapLoaders).length > 0;

async function startSim() {
  const sm = (await Object.values(simLoaders)[0]()) as Partial<SimApi> & { sim?: Partial<SimApi> };
  const mm = (await Object.values(mapLoaders)[0]()) as { MAPS?: MapInfo[] };
  const api = sm.sim ?? sm;
  if (!api.createWorld || !api.step || !mm.MAPS?.length) throw new Error('sim scene: src/sim or src/maps does not export createWorld / step / MAPS yet');
  const map = mm.MAPS[0].generate(SEED);
  const setup: GameSetup = {
    map, seed: SEED, startingCredits: 10000, options: { fog: true, shortGame: false, superweapons: true },
    players: PLAYER_DEFS.slice(0, 2).map(([name, faction, color, team, controller], i) => ({ name, faction, color, team, controller, difficulty: 'normal', startIndex: i })),
  };
  const w = api.createWorld(setup);
  resetFake();
  world = w;
  simApi = { createWorld: api.createWorld.bind(api), step: api.step.bind(api) };
  state.scene = 'sim';
  state.fog = true;
  view.viewer = 0;
  spots = { start0: map.starts[0], start1: map.starts[1] ?? map.starts[0], centre: { x: map.width / 2, y: map.height / 2 } };
  afterSceneChange('start0');
}

function resetFake() {
  rng = makeRng(SEED ^ 0x5eed);
  timers = []; tweens = []; agents = []; agentsDirty = false; agentOf = new Map(); labels = []; reveals = [];
  projMeta = new WeakMap(); fxPairs = {}; fxStep = 0; fxNextAt = 20; stats.fx = ''; simApi = null;
  view.selection.clear(); view.hoverId = null; view.placement = null; view.dragRect = null; view.markers.length = 0;
}

function setScene(name: SceneName) {
  if (name === 'sim') {
    if (simAvailable) startSim().catch((e) => report('sim scene', e));
    return;
  }
  resetFake();
  state.scene = name;
  world = makeWorld();
  if (name === 'heavy') buildHeavy();
  else buildGallery();
  afterSceneChange(name === 'heavy' ? 'battle' : 'buildings');
}

function afterSceneChange(spot: string) {
  fogOpen = false;
  if (state.scene !== 'sim') { fogOpen = !state.fog; if (state.fog) for (const p of world.players) { p.visible.fill(0); p.explored.fill(0); } }
  updateFog();
  rebuildJumps();
  jump(spot);
}

// ───────────────────────────── fog / placement ─────────────────────────────

function stampSight(vis: Uint8Array, exp: Uint8Array, cx: number, cy: number, r: number) {
  const W = world.map.width, H = world.map.height;
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.floor(cy + r));
  for (let ty = y0; ty <= y1; ty++) {
    const dy = ty + 0.5 - cy, s = r * r - dy * dy;
    if (s < 0) continue;
    const dx = Math.sqrt(s);
    const x0 = Math.max(0, Math.ceil(cx - dx - 0.5)), x1 = Math.min(W - 1, Math.floor(cx + dx - 0.5));
    if (x1 < x0) continue;
    vis.fill(1, ty * W + x0, ty * W + x1 + 1);
    exp.fill(1, ty * W + x0, ty * W + x1 + 1);
  }
}
function updateFog() {
  world.setup.options.fog = state.fog;
  if (state.scene === 'sim') return; // the real sim owns visible/explored
  if (!state.fog) {
    if (!fogOpen) { for (const p of world.players) { p.visible.fill(1); p.explored.fill(1); } fogOpen = true; }
    return;
  }
  if (fogOpen) { for (const p of world.players) { p.visible.fill(0); p.explored.fill(0); } fogOpen = false; }
  const p = world.players[view.viewer];
  p.visible.fill(0);
  for (const e of world.entities.values()) if (world.players[e.owner].team === p.team) stampSight(p.visible, p.explored, e.x, e.y, getDef(e.defId).sight);
  reveals = reveals.filter((v) => v.until > world.tick);
  for (const v of reveals) if (v.team === p.team) stampSight(p.visible, p.explored, v.x, v.y, v.r);
}

function placementCheck(defId: string, tx: number, ty: number): PlacementCheck {
  const { w, h } = BUILDINGS[defId].footprint, m = world.map;
  const occ = new Set<number>();
  for (const e of world.entities.values()) {
    const d = getDef(e.defId);
    if (d.kind === 'unit') { if (e.altitude === 0) occ.add(Math.floor(e.y) * m.width + Math.floor(e.x)); continue; }
    const bx = Math.round(e.x - d.footprint.w / 2), by = Math.round(e.y - d.footprint.h / 2);
    for (let y = by; y < by + d.footprint.h; y++) for (let x = bx; x < bx + d.footprint.w; x++) occ.add(y * m.width + x);
  }
  const cells: PlacementCheck['cells'] = [];
  let ok = true;
  for (let y = ty; y < ty + h; y++)
    for (let x = tx; x < tx + w; x++) {
      const i = y * m.width + x, t = m.terrain[i];
      const good = x >= 0 && y >= 0 && x < m.width && y < m.height && (t === Terrain.Ground || t === Terrain.Rough || t === Terrain.Road) && m.ore[i] === 0 && !occ.has(i);
      if (!good) ok = false;
      cells.push({ tx: x, ty: y, ok: good });
    }
  return { ok, cells };
}

// ───────────────────────────── camera / input ─────────────────────────────

let cssW = 0, cssH = 0, dpr = 0;
function checkResize() {
  const w = window.innerWidth, h = window.innerHeight, d = window.devicePixelRatio || 1;
  if (w === cssW && h === cssH && d === dpr) return;
  cssW = w; cssH = h; dpr = d;
  safe('resize', () => R.resize(w, h, d));
  labelCanvas.width = Math.round(w * d); labelCanvas.height = Math.round(h * d);
  labelsDrawn = true;
  safe('clampCamera', () => R.clampCamera(world));
}
function panScreen(dx: number, dy: number) {
  const a = R.screenToWorld(cssW / 2, cssH / 2), b = R.screenToWorld(cssW / 2 + dx, cssH / 2 + dy);
  R.camera.x += b.x - a.x; R.camera.y += b.y - a.y;
  R.clampCamera(world);
}
function setZoom(z: number, sx = cssW / 2, sy = cssH / 2) {
  const before = R.screenToWorld(sx, sy);
  R.camera.zoom = clamp(z, 0.5, 2);
  const after = R.screenToWorld(sx, sy);
  R.camera.x += before.x - after.x; R.camera.y += before.y - after.y;
  R.clampCamera(world);
}
function jump(spot: string | number, y?: number) {
  const p = typeof spot === 'number' ? { x: spot, y: y ?? spot } : spots[spot];
  if (!p) return;
  safe('jump', () => { R.camera.x = p.x; R.camera.y = p.y; R.clampCamera(world); });
}

const keys = new Set<string>();
const mouse = { x: 0, y: 0, inside: false };
let hoverDirty = false, ticked = false, placeKey = '', markIdx = 0;
let drag: { button: number; sx: number; sy: number; moved: boolean; anchor: Vec2 } | null = null;
const MARKS = ['move', 'attack', 'rally'] as const;

function decorate(e: Entity) {
  if (state.scene === 'sim') return;
  const d = getDef(e.defId);
  if (d.kind === 'unit') {
    if (!e.order) e.order = { type: 'move', x: e.x + 3, y: e.y + 2 };
    if (!e.queue.length) e.queue = [{ type: 'attackMove', x: e.x + 6, y: e.y - 1 }, { type: 'move', x: e.x + 8, y: e.y + 3 }];
  } else if (d.produces && !e.rally) e.rally = { x: e.x + d.footprint.w / 2 + 2, y: e.y + d.footprint.h / 2 + 2 };
}
function select(ids: EntityId[], add: boolean) {
  if (!add) view.selection.clear();
  for (const id of ids) {
    view.selection.add(id);
    const e = world.entities.get(id);
    if (e) decorate(e);
  }
}
function leftClick(x: number, y: number, shift: boolean) {
  const w = R.screenToWorld(x, y);
  if (state.scene !== 'sim' && state.power) { const id = state.power; later(0, () => fxPower(id, w.x, w.y)); return; }
  if (state.scene !== 'sim' && view.placement) {
    const pl = view.placement;
    if (pl.check.ok) later(0, () => growBuilding(spawnB(pl.defId, view.viewer, pl.tx, pl.ty), 60));
    return;
  }
  const id = R.pickEntity(world, x, y, view.viewer);
  select(id === null ? [] : [id], shift);
}
function rightClick(x: number, y: number, shift: boolean) {
  const w = R.screenToWorld(x, y), kind = MARKS[markIdx++ % MARKS.length];
  view.markers.push({ x: w.x, y: w.y, kind, at: performance.now() });
  if (state.scene === 'sim') return;
  const hit = R.pickEntity(world, x, y, view.viewer);
  for (const id of view.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind === 'building') { if (BUILDINGS[e.defId].produces) e.rally = { x: w.x, y: w.y }; continue; }
    const o: Order = kind === 'attack' ? (hit !== null && hit !== id ? { type: 'attack', targetId: hit } : { type: 'attackMove', x: w.x, y: w.y }) : { type: 'move', x: w.x, y: w.y };
    if (shift && e.order) e.queue.push(o);
    else { e.order = o; e.queue = []; }
  }
}

const evPos = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerenter', () => { mouse.inside = true; });
canvas.addEventListener('pointerleave', () => { mouse.inside = false; view.hoverId = null; });
canvas.addEventListener('pointerdown', guard('pointerdown', (e: PointerEvent) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const p = evPos(e);
  drag = { button: e.button, sx: p.x, sy: p.y, moved: false, anchor: R.screenToWorld(p.x, p.y) };
}));
canvas.addEventListener('pointermove', guard('pointermove', (e: PointerEvent) => {
  const p = evPos(e);
  mouse.x = p.x; mouse.y = p.y; mouse.inside = true; hoverDirty = true;
  if (!drag) return;
  if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) drag.moved = true;
  if (!drag.moved) return;
  if (drag.button === 0) view.dragRect = { x0: drag.sx, y0: drag.sy, x1: p.x, y1: p.y };
  else {
    const w = R.screenToWorld(p.x, p.y);
    R.camera.x += drag.anchor.x - w.x; R.camera.y += drag.anchor.y - w.y;
    R.clampCamera(world);
  }
}));
const endDrag = guard('pointerup', (e: PointerEvent) => {
  const d = drag;
  drag = null;
  view.dragRect = null;
  if (!d || e.type === 'pointercancel') return;
  const p = evPos(e);
  if (d.button === 0) {
    if (d.moved) select(R.entitiesInRect(world, Math.min(d.sx, p.x), Math.min(d.sy, p.y), Math.max(d.sx, p.x), Math.max(d.sy, p.y), view.viewer), e.shiftKey);
    else leftClick(p.x, p.y, e.shiftKey);
  } else if (d.button === 2 && !d.moved) rightClick(p.x, p.y, e.shiftKey);
});
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', guard('wheel', (e: WheelEvent) => {
  e.preventDefault();
  const p = evPos(e);
  setZoom(R.camera.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
}), { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
  keys.add(e.code);
  if (e.code === 'Space') { state.paused = !state.paused; e.preventDefault(); }
  else if (e.code === 'KeyH') panel.classList.toggle('hidden');
  else if (e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function updateCursor() {
  if (!mouse.inside) { view.placement = null; view.powerTarget = null; placeKey = ''; return; }
  const w = R.screenToWorld(mouse.x, mouse.y);
  if (state.placeDef) {
    const f = BUILDINGS[state.placeDef].footprint, tx = Math.round(w.x - f.w / 2), ty = Math.round(w.y - f.h / 2);
    const key = `${state.placeDef}:${tx}:${ty}:${world.tick}`;
    if (key !== placeKey) { placeKey = key; view.placement = { defId: state.placeDef, tx, ty, check: placementCheck(state.placeDef, tx, ty) }; }
  } else { view.placement = null; placeKey = ''; }
  view.powerTarget = state.power ? { power: state.power, x: w.x, y: w.y } : null;
  if (hoverDirty || ticked) { view.hoverId = R.pickEntity(world, mouse.x, mouse.y, view.viewer); hoverDirty = false; }
}

// ───────────────────────────── control panel ─────────────────────────────

const body = $<HTMLDivElement>('panelBody');
const syncs: (() => void)[] = [];
function section(title: string, open = true): HTMLDivElement {
  const d = el('details', { open }, body);
  el('summary', { textContent: title }, d);
  return el('div', { className: 'row' }, d);
}
function btn(parent: HTMLElement, text: string, fn: () => void, isOn?: () => boolean): HTMLButtonElement {
  const b = el('button', { textContent: text }, parent);
  b.addEventListener('click', () => { safe(`button ${text}`, fn); b.blur(); });
  if (isOn) syncs.push(() => b.classList.toggle('on', isOn()));
  return b;
}
function chk(parent: HTMLElement, text: string, get: () => boolean, set: (v: boolean) => void) {
  const l = el('label', null, parent);
  const i = el('input', { type: 'checkbox', checked: get() }, l);
  l.append(text);
  i.addEventListener('change', () => { safe(`toggle ${text}`, () => set(i.checked)); i.blur(); });
  syncs.push(() => { if (i.checked !== get()) i.checked = get(); });
}
function sel(parent: HTMLElement, text: string, options: [string, string][], set: (v: string) => void) {
  const l = el('label', { className: 'wide' }, parent);
  l.append(text);
  const s = el('select', null, l);
  for (const [value, textContent] of options) el('option', { value, textContent }, s);
  s.addEventListener('change', () => { safe(`select ${text}`, () => set(s.value)); s.blur(); });
  return s;
}

$('panelHead').addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  $('panelHint').textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
});
if (!qFlag('panel', true)) panel.classList.add('hidden');

let sRow = section('scene 場景');
btn(sRow, 'gallery', () => setScene('gallery'), () => state.scene === 'gallery');
btn(sRow, 'heavy', () => setScene('heavy'), () => state.scene === 'heavy');
btn(sRow, 'sim', () => setScene('sim'), () => state.scene === 'sim').hidden = !simAvailable;
chk(sRow, 'pause', () => state.paused, (v) => { state.paused = v; });
btn(sRow, 'step', () => { state.paused = true; tick(); });
sel(sRow, 'viewer', [['0', 'player 0'], ['1', 'player 1']], (v) => { view.viewer = Number(v); view.selection.clear(); fogOpen = false; updateFog(); });

sRow = section('camera 鏡頭');
for (const z of [0.5, 1, 2]) btn(sRow, `×${z}`, () => setZoom(z), () => Math.abs(R.camera.zoom - z) < 0.01);
const jumpRow = el('div', { className: 'row' }, sRow.parentElement!);
function rebuildJumps() {
  jumpRow.textContent = '';
  for (const k of Object.keys(spots)) btn(jumpRow, k, () => jump(k));
}

sRow = section('toggles 開關');
chk(sRow, 'fog', () => state.fog, (v) => { state.fog = v; updateFog(); });
chk(sRow, 'all health', () => view.showAllHealth, (v) => { view.showAllHealth = v; });
chk(sRow, 'labels', () => state.labels, (v) => { state.labels = v; });
chk(sRow, 'event gen', () => state.gen, (v) => { state.gen = v; });
chk(sRow, 'icon sheet', () => state.icons, (v) => { state.icons = v; drawIconSheet(); });
chk(sRow, 'alt colours', () => state.iconsAlt, (v) => { state.iconsAlt = v; drawIconSheet(); });
sel(sRow, 'placement', [['', '— off —'], ...Object.values(BUILDINGS).map((b): [string, string] => [b.id, `${b.id} ${b.name}`])], (v) => { state.placeDef = v; });
sel(sRow, 'power target', [['', '— off —'], ...POWER_IDS.map((p): [string, string] => [p, `${p} ${SUPPORT_POWERS[p].name}`])], (v) => { state.power = v as SupportPowerId | ''; });

sRow = section('fx at camera centre 特效', false);
for (const f of FX) btn(sRow, f.id.replace('fire_', '').replace('power_', '').replace('destroy_', '✕ ').replace('impact_', 'splash '), () => triggerFx(f.id)).title = f.label;

sRow = section('minimap 小地圖');
const mm = el('canvas', { id: 'minimap' }, sRow);
const mctx = mm.getContext('2d')!;
const MM = 220;
let mmDown = false, mmVisible = true;
const mmGo = guard('minimap', (e: PointerEvent) => {
  const r = mm.getBoundingClientRect();
  const w = R.minimapToWorld(world, ((e.clientX - r.left) / r.width) * MM, ((e.clientY - r.top) / r.height) * MM, MM, MM);
  R.camera.x = w.x; R.camera.y = w.y;
  R.clampCamera(world);
});
mm.addEventListener('pointerdown', (e) => { mmDown = true; mm.setPointerCapture(e.pointerId); mmGo(e); });
mm.addEventListener('pointermove', (e) => { if (mmDown) mmGo(e); });
mm.addEventListener('pointerup', () => { mmDown = false; });
mm.addEventListener('pointercancel', () => { mmDown = false; });
el('div', { className: 'help', textContent: 'WASD/arrows or middle/right-drag: pan · wheel: zoom · left: select (shift adds, drag = box) · right-click: marker + order/rally · Space: pause · H: hide panel' }, section('help', false));

function drawMinimap() {
  if (!mmVisible) return;
  const px = Math.round(MM * dpr);
  if (mm.width !== px) { mm.width = px; mm.height = px; }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, MM, MM);
  safe('drawMinimap', () => R.drawMinimap(mctx, world, view, MM, MM));
}

// ───────────────────────────── labels / icon sheet / stats ─────────────────────────────

let labelsDrawn = false;
function drawLabels() {
  if (!state.labels || !labels.length) {
    if (labelsDrawn) { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height); labelsDrawn = false; }
    return;
  }
  labelsDrawn = true;
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lctx.clearRect(0, 0, cssW, cssH);
  lctx.textAlign = 'center'; lctx.textBaseline = 'top'; lctx.lineJoin = 'round'; lctx.lineWidth = 3; lctx.strokeStyle = 'rgba(0,0,0,0.8)';
  const small = R.camera.zoom < 0.75;
  safe('labels', () => {
    for (const l of labels) {
      const s = R.worldToScreen(l.x, l.y);
      if (s.x < -120 || s.y < -20 || s.x > cssW + 120 || s.y > cssH + 20) continue;
      let t = typeof l.text === 'string' ? l.text : l.text();
      if (small && !l.title) t = t.split(' ')[0];
      lctx.font = l.title ? '600 13px -apple-system, "PingFang TC", sans-serif' : '11px -apple-system, "PingFang TC", sans-serif';
      lctx.fillStyle = l.title ? '#f0b65a' : '#e8e6e1';
      lctx.strokeText(t, s.x, s.y + 3);
      lctx.fillText(t, s.x, s.y + 3);
    }
  });
}

function drawIconSheet() {
  const box = $<HTMLDivElement>('icons'), sheet = $<HTMLCanvasElement>('iconSheet');
  box.hidden = !state.icons;
  if (!state.icons) return;
  const COLS = 10, CW = 88, CH = 98, HEAD = 24, d = window.devicePixelRatio || 1;
  const groups = (['helion', 'ferrum'] as FactionId[]).map((f) => ({
    f, color: world.players[Math.min(world.players.length - 1, ownerOf(f) + (state.iconsAlt ? 2 : 0))].color,
    defs: [...Object.values(BUILDINGS), ...Object.values(UNITS)].filter((v: EntityDef) => v.faction === f) as EntityDef[],
  }));
  const hCss = groups.reduce((s, g) => s + HEAD + Math.ceil(g.defs.length / COLS) * CH, 0);
  sheet.width = Math.round(COLS * CW * d); sheet.height = Math.round(hCss * d);
  sheet.style.width = `${COLS * CW}px`; sheet.style.height = `${hCss}px`;
  const c = sheet.getContext('2d')!;
  c.setTransform(d, 0, 0, d, 0, 0);
  c.textBaseline = 'top';
  let y = 0;
  for (const g of groups) {
    c.textAlign = 'left'; c.font = '600 13px -apple-system, "PingFang TC", sans-serif'; c.fillStyle = g.color;
    c.fillText(`${FACTIONS[g.f].name} ${FACTIONS[g.f].nameEn}  ${g.color}`, 4, y + 5);
    y += HEAD;
    g.defs.forEach((def, i) => {
      const x = (i % COLS) * CW, yy = y + Math.floor(i / COLS) * CH;
      const icon = safe('getIcon', () => R.getIcon(def.id, g.color, 128));
      if (icon) c.drawImage(icon, x + (CW - 64) / 2, yy, 64, 64);
      else { c.strokeStyle = '#e5484d'; c.strokeRect(x + (CW - 64) / 2 + 0.5, yy + 0.5, 63, 63); }
      c.textAlign = 'center';
      c.font = '11px -apple-system, "PingFang TC", sans-serif'; c.fillStyle = '#e8e6e1';
      c.fillText(def.name, x + CW / 2, yy + 66, CW - 4);
      c.font = '9px ui-monospace, Menlo, monospace'; c.fillStyle = '#8fa3b8';
      c.fillText(def.id, x + CW / 2, yy + 80, CW - 4);
    });
    y += Math.ceil(g.defs.length / COLS) * CH;
  }
}

const RING = 120;
const frameMs = new Float32Array(RING), renderMs = new Float32Array(RING);
let ringI = 0, ringN = 0, lastStatsAt = 0;
function updateStats() {
  let fs = 0, rs = 0, rm = 0;
  for (let i = 0; i < ringN; i++) { fs += frameMs[i]; rs += renderMs[i]; if (renderMs[i] > rm) rm = renderMs[i]; }
  stats.fps = ringN && fs > 0 ? (1000 * ringN) / fs : 0;
  stats.renderAvg = ringN ? rs / ringN : 0;
  stats.renderMax = rm;
  stats.entities = world.entities.size;
  stats.projectiles = world.projectiles.length;
  stats.backing = `${canvas.width}×${canvas.height}`;
  stats.dpr = dpr;
  stats.tick = world.tick;
  const h = view.hoverId !== null ? world.entities.get(view.hoverId) : undefined;
  statsEl.textContent =
    `fps ${stats.fps.toFixed(1)}  render ${stats.renderAvg.toFixed(2)} avg ${stats.renderMax.toFixed(2)} max ms\n` +
    `ent ${stats.entities}  proj ${stats.projectiles}  tick ${stats.tick}${state.paused ? ' ⏸' : ''}\n` +
    `backing ${stats.backing} @${dpr}x  zoom ${R.camera.zoom.toFixed(2)}\n` +
    `cam ${R.camera.x.toFixed(1)}, ${R.camera.y.toFixed(1)}  ${state.scene} ${world.map.width}×${world.map.height}\n` +
    `sel ${view.selection.size}  hover ${h ? `#${h.id} ${h.defId}` : '—'}\n` +
    `fx ${stats.fx || '—'}`;
  for (const s of syncs) s();
  mmVisible = mm.offsetParent !== null;
  flushErrors();
}

// ───────────────────────────── loop ─────────────────────────────

function runTimers() {
  for (let i = 0; i < timers.length; ) {
    if (timers[i].at <= world.tick) timers.splice(i, 1)[0].fn();
    else i++;
  }
}

/** One 20 Hz tick. Same convention as the real sim: tick++ and a fresh events array first, so a shot fired this tick has lastFireTick === world.tick. */
function tick() {
  if (state.scene === 'sim') {
    world.setup.options.fog = state.fog;
    safe('sim.step', () => simApi?.step(world, []));
  } else {
    world.tick++;
    world.events = [];
    for (const e of world.entities.values()) { e.px = e.x; e.py = e.y; }
    runTimers();
    for (let i = tweens.length - 1; i >= 0; i--) if (!tweens[i]()) tweens.splice(i, 1);
    stepGenerator();
    for (const a of agents) if (!a.dead) moveAgent(a);
    for (const a of agents) if (!a.dead) combatAgent(a);
    stepProjectiles();
    if (agentsDirty) { agents = agents.filter((a) => !a.dead); agentsDirty = false; }
    updateFog();
  }
  ticked = true;
  safe('handleEvents', () => R.handleEvents(world.events, world));
}

let acc = 0, lastFrame = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(250, Math.max(0, now - lastFrame));
  lastFrame = now;
  checkResize();
  const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const ky = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  if (kx || ky) {
    const sp = ((keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2400 : 1000) * dt) / 1000;
    safe('pan', () => panScreen(kx * sp, ky * sp));
  }
  if (!state.paused) {
    acc += dt;
    for (let n = 0; acc >= TICK_MS; n++) {
      if (n >= 4) { acc = 0; break; }
      tick();
      acc -= TICK_MS;
    }
  }
  const alpha = clamp(acc / TICK_MS, 0, 0.999);
  view.time = performance.now();
  if (view.markers.length && view.time - view.markers[0].at > 2000) view.markers = view.markers.filter((m) => view.time - m.at <= 2000);
  safe('cursor', updateCursor);
  ticked = false;
  const t0 = performance.now();
  safe('render', () => R.render(world, view, alpha));
  renderMs[ringI] = performance.now() - t0;
  frameMs[ringI] = dt;
  ringI = (ringI + 1) % RING;
  ringN = Math.min(RING, ringN + 1);
  stats.frames++;
  drawLabels();
  drawMinimap();
  if (now - lastStatsAt > 250) { lastStatsAt = now; updateStats(); }
}

// ───────────────────────────── boot ─────────────────────────────

const dev = {
  renderer: R, view, stats, state, FX, setScene, jump, setZoom, triggerFx, tick, spawn, spawnB, removeEntity,
  get world() { return world; },
  set world(w: World) { world = w; },
  get spots() { return spots; },
  get agents() { return agents; },
};
(window as unknown as { __dev: typeof dev }).__dev = dev;

world = makeWorld(); // placeholder so `world` is always defined, then the requested scene replaces it
checkResize();
const wantScene = Q.get('scene');
setScene('gallery');
if (wantScene === 'heavy') setScene('heavy');
else if (wantScene === 'sim') setScene('sim');
safe('initial camera', () => {
  R.camera.zoom = clamp(qNum('zoom', 1), 0.5, 2);
  const j = Q.get('jump');
  if (j) jump(j);
  if (Q.has('x') || Q.has('y')) jump(qNum('x', R.camera.x), qNum('y', R.camera.y));
  R.clampCamera(world);
});
requestAnimationFrame(frame);
