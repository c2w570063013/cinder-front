// Building placement search: score candidate tiles near the base, then ask the sim for the best ones.
import type { SimApi } from '../core/api';
import { Terrain, type Entity, type PlayerId, type Vec2, type World } from '../core/types';
import { BUILDINGS } from '../data';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Needs extra room around it (production exits, refinery docks). */
  roomy: boolean;
}

export function rectOf(e: Entity): Rect {
  const def = BUILDINGS[e.defId];
  const w = def?.footprint.w ?? 1;
  const h = def?.footprint.h ?? 1;
  return { x: Math.round(e.x - w / 2), y: Math.round(e.y - h / 2), w, h, roomy: !!def && (!!def.produces || !!def.refinery) };
}

/** Empty tiles between two rects (Chebyshev); negative when they overlap. */
export function rectGap(a: Rect, b: Rect): number {
  const gx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
  const gy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.max(gx, gy);
}

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - x0) * vx + (py - y0) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t));
}

export interface Lane {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlaceRequest {
  world: World;
  sim: SimApi;
  player: PlayerId;
  defId: string;
  /** Footprints of all own buildings. */
  own: Rect[];
  /** Where we would like the building's centre to be. */
  anchor: Vec2;
  /** Harvester routes (refinery → ore) that must stay open. */
  lanes: Lane[];
  /** Keep the footprint at least this many tiles from any ore. */
  oreClearance: number;
  /** Same-purpose buildings to spread away from (e.g. other turrets), with the minimum spacing. */
  spreadFrom?: Rect[];
  spreadDist?: number;
  /** Skip this many of the best candidates (they failed before). */
  skip: number;
  /** Max canPlaceBuilding calls this invocation. */
  maxChecks: number;
  /** How far beyond the anchor to look when it is outside the base. */
  maxAnchorDist?: number;
}

export interface PlaceResult {
  tx: number;
  ty: number;
}

const blocksBuilding = (t: number): boolean => t === Terrain.Water || t === Terrain.Rock || t === Terrain.Tree;

/**
 * Find a tile for `defId`. Returns null when nothing among the examined candidates works; the
 * caller should retry later with a larger `skip`. `examined` reports how many candidates existed.
 */
export function findPlacement(req: PlaceRequest): { place: PlaceResult | null; candidates: number } {
  const def = BUILDINGS[req.defId];
  const map = req.world.map;
  if (!def || req.own.length === 0) return { place: null, candidates: 0 };
  const fw = def.footprint.w;
  const fh = def.footprint.h;
  const roomy = !!def.produces || !!def.refinery;
  const isDefense = def.category === 'defense';

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of req.own) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  minX = Math.max(1, minX - 4 - fw);
  minY = Math.max(1, minY - 4 - fh);
  maxX = Math.min(map.width - 1 - fw, maxX + 4);
  maxY = Math.min(map.height - 1 - fh, maxY + 4);

  const cands: { tx: number; ty: number; score: number }[] = [];
  const rect: Rect = { x: 0, y: 0, w: fw, h: fh, roomy };
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      rect.x = tx;
      rect.y = ty;
      // Spacing to our own buildings: never touching, close enough to satisfy adjacency.
      let nearest = Infinity;
      let bad = false;
      for (const o of req.own) {
        const g = rectGap(rect, o);
        if (g < (roomy || o.roomy ? 2 : 1)) {
          bad = true;
          break;
        }
        if (g < nearest) nearest = g;
      }
      if (bad || nearest > 3) continue;
      if (req.spreadFrom && req.spreadDist) {
        for (const o of req.spreadFrom) {
          if (rectGap(rect, o) < req.spreadDist) {
            bad = true;
            break;
          }
        }
        if (bad) continue;
      }
      // Footprint terrain and ore clearance.
      const c = req.oreClearance;
      for (let y = ty - c; y < ty + fh + c && !bad; y++) {
        for (let x = tx - c; x < tx + fw + c; x++) {
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          const i = y * map.width + x;
          const inside = x >= tx && x < tx + fw && y >= ty && y < ty + fh;
          if (map.ore[i] > 0 || (inside && blocksBuilding(map.terrain[i]))) {
            bad = true;
            break;
          }
        }
      }
      if (bad) continue;
      // Don't wedge into trees/cliffs: most of the surrounding ring must be walkable.
      let ring = 0;
      let open = 0;
      for (let y = ty - 1; y <= ty + fh; y++) {
        for (let x = tx - 1; x <= tx + fw; x++) {
          if (x >= tx && x < tx + fw && y >= ty && y < ty + fh) continue;
          ring++;
          if (x >= 0 && y >= 0 && x < map.width && y < map.height && !blocksBuilding(map.terrain[y * map.width + x])) open++;
        }
      }
      if (open < ring * 0.65) continue;

      const cx = tx + fw / 2;
      const cy = ty + fh / 2;
      let score = -Math.hypot(cx - req.anchor.x, cy - req.anchor.y) - 0.25 * (nearest - 1);
      if (!isDefense) {
        for (const l of req.lanes) {
          if (distToSegment(cx, cy, l.x0, l.y0, l.x1, l.y1) < 1.8 + Math.max(fw, fh) / 2) score -= 40;
        }
      }
      cands.push({ tx, ty, score });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.ty - b.ty || a.tx - b.tx);
  const end = Math.min(cands.length, req.skip + req.maxChecks);
  for (let i = req.skip; i < end; i++) {
    const cnd = cands[i];
    if (req.sim.canPlaceBuilding(req.world, req.player, req.defId, cnd.tx, cnd.ty).ok) return { place: { tx: cnd.tx, ty: cnd.ty }, candidates: cands.length };
  }
  return { place: null, candidates: cands.length };
}

// ───────────────────────────── ore knowledge ─────────────────────────────

export interface OreCell {
  /** Total ore units in the cell. */
  ore: number;
  /** Ore-weighted centre (world coords). */
  x: number;
  y: number;
  /** Richest tile in the cell. */
  tx: number;
  ty: number;
}

/** Coarse summary of where the (known) ore is; rebuilt every few seconds. */
export class OreGrid {
  static readonly CELL = 6;
  cells: OreCell[] = [];

  /** `explored` = fog mask limiting knowledge, or null to see all ore. */
  update(world: World, explored: Uint8Array | null): void {
    const map = world.map;
    const S = OreGrid.CELL;
    const cols = Math.ceil(map.width / S);
    const rows = Math.ceil(map.height / S);
    const acc = new Float64Array(cols * rows * 3);
    const best = new Int32Array(cols * rows).fill(-1);
    for (let ty = 0; ty < map.height; ty++) {
      const row = ty * map.width;
      const cyi = Math.floor(ty / S) * cols;
      for (let tx = 0; tx < map.width; tx++) {
        const o = map.ore[row + tx];
        if (!o || (explored && !explored[row + tx])) continue;
        const ci = cyi + Math.floor(tx / S);
        acc[ci * 3] += o;
        acc[ci * 3 + 1] += o * (tx + 0.5);
        acc[ci * 3 + 2] += o * (ty + 0.5);
        if (best[ci] < 0 || o > map.ore[best[ci]]) best[ci] = row + tx;
      }
    }
    this.cells = [];
    for (let ci = 0; ci < cols * rows; ci++) {
      const ore = acc[ci * 3];
      if (ore <= 0) continue;
      const b = best[ci];
      this.cells.push({ ore, x: acc[ci * 3 + 1] / ore, y: acc[ci * 3 + 2] / ore, tx: b % map.width, ty: Math.floor(b / map.width) });
    }
  }

  /** Total known ore within `r` tiles of a point. */
  sumWithin(x: number, y: number, r: number): number {
    let sum = 0;
    for (const c of this.cells) if (Math.hypot(c.x - x, c.y - y) <= r) sum += c.ore;
    return sum;
  }

  /** Nearest cell holding at least `minOre`, optionally filtered. */
  nearest(x: number, y: number, minOre: number, accept?: (c: OreCell) => boolean): OreCell | null {
    let best: OreCell | null = null;
    let bestD = Infinity;
    for (const c of this.cells) {
      if (c.ore < minOre || (accept && !accept(c))) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
