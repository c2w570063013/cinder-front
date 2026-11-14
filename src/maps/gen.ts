// Map generation toolkit: symmetric noise, shape painting, ore fields, connectivity repair.
// Everything is deterministic given the seed (no Math.random, no Date).
import { ORE_TILE_MAX } from '../core/constants';
import { makeRng } from '../core/rng';
import { Terrain, type GameMap, type TerrainId, type Vec2 } from '../core/types';
import { erodedMask, floodFill, isPassableTerrain } from './analysis';

export type Rng = ReturnType<typeof makeRng>;

export interface Canvas {
  w: number;
  h: number;
  terrain: Uint8Array;
  ore: Uint8Array;
}

export function newCanvas(w: number, h: number, fill: TerrainId = Terrain.Ground): Canvas {
  return { w, h, terrain: new Uint8Array(w * h).fill(fill), ore: new Uint8Array(w * h) };
}

// ───────────────────────────── symmetry ─────────────────────────────

/**
 * A symmetry group acting on the map. `point` maps a continuous world point (tile centre = tx+0.5)
 * under group element k; `offset` rotates an offset vector the same way (integers stay integers
 * only for tile-exact groups).
 */
export interface Sym {
  /** Number of group elements (= number of equivalent start positions). */
  n: number;
  /** True when every element maps the tile lattice exactly onto itself. */
  exact: boolean;
  point(k: number, x: number, y: number): [number, number];
  offset(k: number, dx: number, dy: number): [number, number];
}

/** 180° rotation about the map centre (2 players). */
export function rot2(w: number, h: number): Sym {
  return {
    n: 2,
    exact: true,
    point: (k, x, y) => (k % 2 === 0 ? [x, y] : [w - x, h - y]),
    offset: (k, dx, dy) => (k % 2 === 0 ? [dx, dy] : [-dx, -dy]),
  };
}

/** 90° rotations about the centre of a square map (4 players). */
export function rot4(size: number): Sym {
  return {
    n: 4,
    exact: true,
    point: (k, x, y) => {
      for (let i = 0; i < k % 4; i++) [x, y] = [size - y, x];
      return [x, y];
    },
    offset: (k, dx, dy) => {
      for (let i = 0; i < k % 4; i++) [dx, dy] = [-dy, dx];
      return [dx, dy];
    },
  };
}

/** 120° rotations about the centre (3 players). Not tile-exact: shapes are re-rasterised per copy. */
export function rot3(w: number, h: number): Sym {
  const cx = w / 2;
  const cy = h / 2;
  const cs = [1, Math.cos((2 * Math.PI) / 3), Math.cos((4 * Math.PI) / 3)];
  const sn = [0, Math.sin((2 * Math.PI) / 3), Math.sin((4 * Math.PI) / 3)];
  return {
    n: 3,
    exact: false,
    point: (k, x, y) => {
      const i = k % 3;
      const dx = x - cx;
      const dy = y - cy;
      return [cx + dx * cs[i] - dy * sn[i], cy + dx * sn[i] + dy * cs[i]];
    },
    offset: (k, dx, dy) => {
      const i = k % 3;
      return [dx * cs[i] - dy * sn[i], dx * sn[i] + dy * cs[i]];
    },
  };
}

/** Start tiles: the orbit of one canonical start tile. */
export function orbitTiles(sym: Sym, tx: number, ty: number): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < sym.n; k++) {
    const [x, y] = sym.point(k, tx + 0.5, ty + 0.5);
    out.push({ x: Math.floor(x), y: Math.floor(y) });
  }
  return out;
}

// ───────────────────────────── noise ─────────────────────────────

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    x *= 2;
    y *= 2;
  }
  return sum / norm;
}

/**
 * Symmetric fractal noise over the whole map, normalised to [0,1].
 * Symmetry comes from averaging the noise over the group orbit of every tile, so the field is
 * continuous everywhere (no mirror seams) and identical for every player.
 */
export function noiseField(c: Canvas, sym: Sym, seed: number, scale: number, octaves = 3): Float32Array {
  const { w, h } = c;
  const f = new Float32Array(w * h);
  let lo = Infinity;
  let hi = -Infinity;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      let v = 0;
      for (let k = 0; k < sym.n; k++) {
        const [x, y] = sym.point(k, tx + 0.5, ty + 0.5);
        v += fbm(x / scale, y / scale, seed, octaves);
      }
      v /= sym.n;
      f[ty * w + tx] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const span = hi - lo || 1;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / span;
  return f;
}

/** Value below which a fraction `q` of the field lies. */
export function quantile(field: Float32Array, q: number): number {
  const s = Float32Array.from(field).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

// ───────────────────────────── painting ─────────────────────────────

export type PaintRule = TerrainId | ((current: TerrainId) => TerrainId);

function put(c: Canvas, tx: number, ty: number, rule: PaintRule): void {
  if (tx < 0 || ty < 0 || tx >= c.w || ty >= c.h) return;
  const i = ty * c.w + tx;
  c.terrain[i] = typeof rule === 'function' ? rule(c.terrain[i] as TerrainId) : rule;
}

/** Filled disc (continuous centre/radius), painted for every group element. */
export function disc(c: Canvas, sym: Sym, px: number, py: number, r: number, rule: PaintRule): void {
  for (let k = 0; k < sym.n; k++) {
    const [cx, cy] = sym.point(k, px, py);
    const x0 = Math.floor(cx - r - 1);
    const x1 = Math.ceil(cx + r + 1);
    const y0 = Math.floor(cy - r - 1);
    const y1 = Math.ceil(cy + r + 1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx + 0.5 - cx;
        const dy = ty + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) put(c, tx, ty, rule);
      }
    }
  }
}

export function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - x0) * vx + (py - y0) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (x0 + vx * t);
  const dy = py - (y0 + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Thick line segment, painted for every group element. */
export function segment(c: Canvas, sym: Sym, x0: number, y0: number, x1: number, y1: number, halfWidth: number, rule: PaintRule): void {
  for (let k = 0; k < sym.n; k++) {
    const [ax, ay] = sym.point(k, x0, y0);
    const [bx, by] = sym.point(k, x1, y1);
    const minX = Math.floor(Math.min(ax, bx) - halfWidth - 1);
    const maxX = Math.ceil(Math.max(ax, bx) + halfWidth + 1);
    const minY = Math.floor(Math.min(ay, by) - halfWidth - 1);
    const maxY = Math.ceil(Math.max(ay, by) + halfWidth + 1);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (distToSegment(tx + 0.5, ty + 0.5, ax, ay, bx, by) <= halfWidth) put(c, tx, ty, rule);
      }
    }
  }
}

/** Paint every tile from a function of its centre; return -1 to leave the tile alone. */
export function paintEach(c: Canvas, fn: (px: number, py: number, i: number, current: TerrainId) => number): void {
  for (let ty = 0; ty < c.h; ty++) {
    for (let tx = 0; tx < c.w; tx++) {
      const i = ty * c.w + tx;
      const t = fn(tx + 0.5, ty + 0.5, i, c.terrain[i] as TerrainId);
      if (t >= 0) c.terrain[i] = t;
    }
  }
}

/** Scatter terrain where a noise field exceeds its `q` quantile, only over tiles matching `over`. */
export function scatter(c: Canvas, field: Float32Array, q: number, terrain: TerrainId, over: (t: TerrainId) => boolean): void {
  const th = quantile(field, q);
  for (let i = 0; i < field.length; i++) {
    if (field[i] > th && over(c.terrain[i] as TerrainId)) c.terrain[i] = terrain;
  }
}

export const onGround = (t: TerrainId): boolean => t === Terrain.Ground;
export const onLand = (t: TerrainId): boolean => t !== Terrain.Water && t !== Terrain.Road;

// ───────────────────────────── starts ─────────────────────────────

/** Half-width of the square around a start that is guaranteed pure Ground with no ore (15×15). */
export const START_CLEAR = 7;
/** Radius around a start inside which all obstacles are flattened so a base fits. */
export const START_FLAT_RADIUS = 13;

export function clearStarts(c: Canvas, starts: Vec2[]): void {
  for (const s of starts) {
    for (let ty = s.y - START_FLAT_RADIUS; ty <= s.y + START_FLAT_RADIUS; ty++) {
      for (let tx = s.x - START_FLAT_RADIUS; tx <= s.x + START_FLAT_RADIUS; tx++) {
        if (tx < 0 || ty < 0 || tx >= c.w || ty >= c.h) continue;
        const dx = tx - s.x;
        const dy = ty - s.y;
        const inSquare = Math.abs(dx) <= START_CLEAR + 2 && Math.abs(dy) <= START_CLEAR + 2;
        if (!inSquare && dx * dx + dy * dy > START_FLAT_RADIUS * START_FLAT_RADIUS) continue;
        const i = ty * c.w + tx;
        // Roads may run up to the base, but the core square is plain buildable ground.
        if (inSquare || c.terrain[i] !== Terrain.Road) c.terrain[i] = Terrain.Ground;
        c.ore[i] = 0;
      }
    }
  }
}

// ───────────────────────────── ore ─────────────────────────────

const ORE_EDGE_MARGIN = 4;

/**
 * Stamp one ore field (and its symmetric copies) holding exactly `target` ore units per copy
 * (unless copies overlap each other, e.g. at the map centre). Every copy has an identical shape and
 * tile amounts, so all players get exactly the same field.
 */
export function oreField(c: Canvas, sym: Sym, starts: Vec2[], px: number, py: number, target: number, rng: Rng, compact = false): void {
  const shapeSeed = rng.int(1, 0x7ffffff);
  const centres: [number, number][] = [];
  for (let k = 0; k < sym.n; k++) {
    const [x, y] = sym.point(k, Math.floor(px) + 0.5, Math.floor(py) + 0.5);
    centres.push([Math.floor(x), Math.floor(y)]);
  }
  const want = Math.ceil(target / 8.6);
  const r0 = Math.sqrt(want / Math.PI);
  const maxR = compact ? Math.ceil(r0 * 1.5) : Math.ceil(r0 * 2.2) + 1;

  const valid = (tx: number, ty: number): boolean => {
    if (tx < ORE_EDGE_MARGIN || ty < ORE_EDGE_MARGIN || tx >= c.w - ORE_EDGE_MARGIN || ty >= c.h - ORE_EDGE_MARGIN) return false;
    const t = c.terrain[ty * c.w + tx];
    if (t === Terrain.Water || t === Terrain.Road) return false;
    for (const s of starts) {
      if (Math.abs(tx - s.x) <= START_CLEAR && Math.abs(ty - s.y) <= START_CLEAR) return false;
    }
    return true;
  };

  // Each copy picks its tiles from the same shape function evaluated in its own rotated frame.
  // For tile-exact groups the copies are exact images of each other; otherwise they are the same
  // shape re-rasterised, and still hold exactly `target` units each.
  const copies: { i: number; amount: number }[][] = [];
  for (let k = 0; k < sym.n; k++) {
    const inv = (sym.n - k) % sym.n;
    const cand: { i: number; u: number; v: number; nd: number }[] = [];
    for (let oy = -maxR; oy <= maxR; oy++) {
      for (let ox = -maxR; ox <= maxR; ox++) {
        const tx = centres[k][0] + ox;
        const ty = centres[k][1] + oy;
        if (!valid(tx, ty)) continue;
        const [u, v] = sym.offset(inv, ox, oy);
        const d = Math.sqrt(u * u + v * v);
        if (d > maxR) continue;
        // Low-frequency wobble makes the outline irregular without scattering single tiles.
        const wob = 0.75 + 0.5 * valueNoise(u / 2.5 + 31.7, v / 2.5 + 17.3, shapeSeed);
        cand.push({ i: ty * c.w + tx, u, v, nd: d * wob + hash2(Math.round(u), Math.round(v), shapeSeed) * 0.35 });
      }
    }
    cand.sort((p, q) => p.nd - q.nd || p.v - q.v || p.u - q.u);
    const chosen = cand.slice(0, want);
    if (chosen.length === 0) continue;

    // Rich in the middle, thin at the rim; then nudge to hit the target total exactly.
    const ndMax = chosen[chosen.length - 1].nd || 1;
    const weights = chosen.map((o) => 1 - 0.55 * (o.nd / ndMax));
    const wSum = weights.reduce((x, y) => x + y, 0);
    const amounts = weights.map((wt) => Math.max(1, Math.min(ORE_TILE_MAX, Math.round((wt / wSum) * target))));
    let total = amounts.reduce((x, y) => x + y, 0);
    for (let guard = 0; guard < 40 && total !== target; guard++) {
      let changed = false;
      for (let j = 0; j < amounts.length && total !== target; j++) {
        if (total < target && amounts[j] < ORE_TILE_MAX) {
          amounts[j]++;
          total++;
          changed = true;
        } else if (total > target && amounts[j] > 1) {
          amounts[j]--;
          total--;
          changed = true;
        }
      }
      if (!changed) break;
    }
    copies.push(chosen.map((o, j) => ({ i: o.i, amount: amounts[j] })));
  }
  for (const copy of copies) {
    for (const { i, amount } of copy) {
      if (c.terrain[i] !== Terrain.Rough) c.terrain[i] = Terrain.Ground;
      if (amount > c.ore[i]) c.ore[i] = amount;
    }
  }
}

// ───────────────────────────── connectivity ─────────────────────────────

/** Tiny binary heap keyed by cost (deterministic tie-break on insertion order). */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let ch = 2 * i + 1;
        if (ch >= n) break;
        if (ch + 1 < n && k[ch + 1] < k[ch]) ch++;
        if (k[ch] >= lastK) break;
        k[i] = k[ch];
        v[i] = v[ch];
        i = ch;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

/**
 * Make sure every start can reach every other start through corridors at least 3 tiles wide.
 * Where that fails, the cheapest route is carved open (water → road ford, rock/trees → ground),
 * symmetrically for every player.
 */
export function ensureConnected(c: Canvas, sym: Sym, starts: Vec2[]): void {
  const { w, h } = c;
  for (let pass = 0; pass < 6; pass++) {
    const wide = erodedMask(c.terrain, w, h);
    const reach = floodFill(wide, w, h, starts[0].x, starts[0].y);
    const missing = starts.filter((s) => !reach[s.y * w + s.x]);
    if (missing.length === 0) return;

    // Dijkstra from start 0 over everything; obstacles are expensive rather than forbidden.
    const dist = new Float64Array(w * h).fill(Infinity);
    const prev = new Int32Array(w * h).fill(-1);
    const heap = new Heap();
    const s0 = starts[0].y * w + starts[0].x;
    dist[s0] = 0;
    heap.push(0, s0);
    const stepCost = (i: number): number => {
      const tx = i % w;
      const ty = (i - tx) / w;
      if (tx < 3 || ty < 3 || tx >= w - 3 || ty >= h - 3) return 60;
      if (wide[i]) return 1;
      const t = c.terrain[i];
      if (t === Terrain.Water) return 9;
      if (t === Terrain.Rock) return 7;
      if (t === Terrain.Tree) return 4;
      return 2.5;
    };
    while (heap.size > 0) {
      const cur = heap.pop();
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const d0 = dist[cur];
      const nb = [cx > 0 ? cur - 1 : -1, cx < w - 1 ? cur + 1 : -1, cy > 0 ? cur - w : -1, cy < h - 1 ? cur + w : -1];
      for (const n of nb) {
        if (n < 0) continue;
        const nd = d0 + stepCost(n);
        if (nd < dist[n]) {
          dist[n] = nd;
          prev[n] = cur;
          heap.push(nd, n);
        }
      }
    }
    const carve = (t: TerrainId): TerrainId => (t === Terrain.Water ? Terrain.Road : t === Terrain.Rock || t === Terrain.Tree ? Terrain.Ground : t);
    for (const s of missing) {
      for (let i = s.y * w + s.x; i >= 0; i = prev[i]) {
        if (wide[i]) continue;
        const tx = i % w;
        disc(c, sym, tx + 0.5, (i - tx) / w + 0.5, 2.3, carve);
      }
    }
  }
}

// ───────────────────────────── finalise ─────────────────────────────

export function finalize(c: Canvas, id: string, name: string, starts: Vec2[], rng: Rng): GameMap {
  const { w, h } = c;
  // Ore must be harvestable: on open ground, away from the map edge, reachable from the bases.
  const pass = new Uint8Array(w * h);
  for (let i = 0; i < pass.length; i++) pass[i] = isPassableTerrain(c.terrain[i]) ? 1 : 0;
  const reach = floodFill(pass, w, h, starts[0].x, starts[0].y);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      if (!c.ore[i]) continue;
      const t = c.terrain[i];
      const nearEdge = tx < 3 || ty < 3 || tx >= w - 3 || ty >= h - 3;
      if (nearEdge || !reach[i] || (t !== Terrain.Ground && t !== Terrain.Rough)) c.ore[i] = 0;
    }
  }
  const variant = new Uint8Array(w * h);
  for (let i = 0; i < variant.length; i++) variant[i] = rng.int(0, 255);
  return { id, name, width: w, height: h, terrain: c.terrain, ore: c.ore, variant, starts: starts.map((s) => ({ x: s.x, y: s.y })) };
}

/** Pick the starter-field direction: within ±28° of one of the given axis angles (degrees). */
export function starterAngle(rng: Rng, axesDeg: number[]): number {
  return ((rng.pick(axesDeg) + rng.range(-28, 28)) * Math.PI) / 180;
}

/** Stamp the starter field `dist` tiles from every start in the direction chosen for start 0. */
export function starterField(c: Canvas, sym: Sym, starts: Vec2[], angle: number, target: number, rng: Rng, dist = 10.5): void {
  const s = starts[0];
  oreField(c, sym, starts, s.x + 0.5 + Math.cos(angle) * dist, s.y + 0.5 + Math.sin(angle) * dist, target, rng, true);
}
