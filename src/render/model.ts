// Tiny flat-shaded "iso solid" modeller. Every sprite in the game (units, buildings, props, icons)
// is built from convex lofts (two parallel rings of 3D points) and rasterised to a cached canvas.
// Local model space: tile units, +x = forward, +z = up. Rotation is about the z axis.
import { TILE_H, TILE_W } from '../core/constants';

/** Screen pixels (at zoom 1) per tile of height. */
export const ZPX = 36;
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;

/**
 * Projection used by the modeller (iso px per tile along the two ground axes and per tile of height).
 * It equals the in-game camera except while a portrait is being painted (`withProjection`).
 */
export const PJ = { hw: HW, hh: HH, z: ZPX };
export function withProjection<T>(hw: number, hh: number, z: number, fn: () => T): T {
  const a = PJ.hw, b = PJ.hh, c = PJ.z;
  PJ.hw = hw; PJ.hh = hh; PJ.z = z;
  try { return fn(); } finally { PJ.hw = a; PJ.hh = b; PJ.z = c; }
}

export type RGB = readonly [number, number, number];

export function hex(c: string): RGB {
  let s = c.trim();
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [200, 200, 200];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function mul(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}
const WHITE: RGB = [255, 255, 255];
/** Brightness-scaled css colour; values above 1 push toward white instead of clipping. */
export function css(c: RGB, b = 1, a = 1): string {
  let r = c[0] * b;
  let g = c[1] * b;
  let bl = c[2] * b;
  if (b > 1) {
    const t = Math.min(1, (b - 1) * 0.9);
    r = c[0] + (255 - c[0]) * t;
    g = c[1] + (255 - c[1]) * t;
    bl = c[2] + (255 - c[2]) * t;
  }
  r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  bl = bl < 0 ? 0 : bl > 255 ? 255 : bl | 0;
  return a >= 1 ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${a})`;
}
export function lum(c: RGB): number {
  return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;
}

export interface Opt {
  /** Scale of the far/top ring relative to the near/base ring (number or [x, y]). */
  taper?: number | [number, number];
  /** Offset of the top ring (local x, y). */
  shift?: [number, number];
  /** Rotation of the part about its own centre (z axis), radians. */
  rot?: number;
  sides?: number;
  /** Unshaded, glowing. Rendered dark when the model is built `unlit`. */
  emis?: boolean;
  /** Draw order override: higher layers are always drawn later. */
  layer?: number;
  /** Colour override for the top / far cap. */
  top?: RGB;
  alpha?: number;
  /** Skip the light rim stroke on upward faces. */
  noRim?: boolean;
  /**
   * Surface detail painted onto the part's quad faces when the sprite is baked:
   * panel | plate | corr | slats | brick | conc | hazard | win | glass | mesh | chev. Append "+" to also detail the top cap.
   */
  tex?: string;
  /** Texture colour (lit windows, stripes). */
  tc?: RGB;
  /** Texture density multiplier (>1 = finer). */
  ts?: number;
}

interface Part {
  a: Float32Array; // ring A, xyz triples
  b: Float32Array; // ring B
  n: number;
  col: RGB;
  top: RGB | null;
  emis: boolean;
  layer: number;
  alpha: number;
  rim: boolean;
  tex: string;
  tc: RGB | null;
  ts: number;
  // local-frame bounds (for separating-plane ordering)
  lx0: number; lx1: number; ly0: number; ly1: number; z0: number; z1: number;
  cx: number; cy: number; cz: number;
}

export class Model {
  parts: Part[] = [];
  /** When true, emissive parts are rendered as dead dark panels (unpowered buildings). */
  unlit = false;
  /** Sub-assembly offset applied to everything added while set. */
  ox = 0;
  oy = 0;
  oz = 0;

  at(x: number, y: number, z = 0): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    return this;
  }

  loft(a: number[], b: number[], col: RGB, o?: Opt): this {
    const n = a.length / 3;
    const A = new Float32Array(a.length);
    const B = new Float32Array(b.length);
    let lx0 = 1e9, lx1 = -1e9, ly0 = 1e9, ly1 = -1e9, z0 = 1e9, z1 = -1e9, cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 2; k++) {
      const src = k ? b : a;
      const dst = k ? B : A;
      for (let i = 0; i < n; i++) {
        const x = src[i * 3] + this.ox, y = src[i * 3 + 1] + this.oy, z = src[i * 3 + 2] + this.oz;
        dst[i * 3] = x; dst[i * 3 + 1] = y; dst[i * 3 + 2] = z;
        if (x < lx0) lx0 = x; if (x > lx1) lx1 = x;
        if (y < ly0) ly0 = y; if (y > ly1) ly1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
        cx += x; cy += y; cz += z;
      }
    }
    const inv = 1 / (2 * n);
    this.parts.push({
      a: A, b: B, n, col, top: o?.top ?? null, emis: !!o?.emis, layer: o?.layer ?? 0, alpha: o?.alpha ?? 1, rim: !o?.noRim,
      tex: o?.tex ?? '', tc: o?.tc ?? null, ts: o?.ts ?? 1,
      lx0, lx1, ly0, ly1, z0, z1, cx: cx * inv, cy: cy * inv, cz: cz * inv,
    });
    return this;
  }

  /** Vertical extrusion of a convex polygon [x,y,...] (local), base at z, height h. */
  poly(pts: number[], z: number, h: number, col: RGB, o?: Opt): this {
    const n = pts.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
    cx /= n; cy /= n;
    const tx = o?.taper === undefined ? 1 : typeof o.taper === 'number' ? o.taper : o.taper[0];
    const ty = o?.taper === undefined ? 1 : typeof o.taper === 'number' ? o.taper : o.taper[1];
    const sx = o?.shift ? o.shift[0] : 0, sy = o?.shift ? o.shift[1] : 0;
    const rc = o?.rot ? Math.cos(o.rot) : 1, rs = o?.rot ? Math.sin(o.rot) : 0;
    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < n; i++) {
      const dx = pts[i * 2] - cx, dy = pts[i * 2 + 1] - cy;
      const ex = dx * tx + sx, ey = dy * ty + sy;
      a.push(cx + dx * rc - dy * rs, cy + dx * rs + dy * rc, z);
      b.push(cx + ex * rc - ey * rs, cy + ex * rs + ey * rc, z + h);
    }
    return this.loft(a, b, col, o);
  }

  /** Box centred on (x,y), base at z. lx along local x, ly along local y. */
  box(x: number, y: number, z: number, lx: number, ly: number, h: number, col: RGB, o?: Opt): this {
    const hx = lx / 2, hy = ly / 2;
    return this.poly([x - hx, y - hy, x + hx, y - hy, x + hx, y + hy, x - hx, y + hy], z, h, col, o);
  }

  /** Vertical n-gon cylinder / frustum / cone. */
  cyl(x: number, y: number, z: number, r: number, h: number, col: RGB, o?: Opt): this {
    const n = o?.sides ?? 10;
    const pts: number[] = [];
    const off = n % 2 === 0 ? Math.PI / n : 0;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    return this.poly(pts, z, h, col, o);
  }

  /**
   * Tapered column split into stacked segments so bands / collars sort correctly.
   * bands: [zOffset, height, colour, widen?, emissive?] measured from the column base.
   */
  column(x: number, y: number, z: number, r: number, h: number, col: RGB, taper: number, sides: number, bands: [number, number, RGB, number?, boolean?][]): this {
    const rad = (zz: number): number => r * (1 + (taper - 1) * (zz / h));
    const seg = (z0: number, z1: number, c: RGB, widen: number, emis: boolean): void => {
      if (z1 - z0 < 0.002) return;
      this.cyl(x, y, z + z0, rad(z0) * widen, z1 - z0, c, { sides, taper: rad(z1) / rad(z0), emis });
    };
    const bs = bands.slice().sort((a, b) => a[0] - b[0]);
    let cur = 0;
    for (const b of bs) {
      seg(cur, b[0], col, 1, false);
      seg(b[0], b[0] + b[1], b[2], b[3] ?? 1.07, !!b[4]);
      cur = b[0] + b[1];
    }
    seg(cur, h, col, 1, false);
    return this;
  }

  /** Dome: stacked frustums. */
  dome(x: number, y: number, z: number, r: number, h: number, col: RGB, o?: Opt): this {
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * (Math.PI / 2), a1 = ((i + 1) / steps) * (Math.PI / 2);
      const r0 = Math.cos(a0) * r, r1 = Math.max(0.001, Math.cos(a1) * r);
      this.cyl(x, y, z + Math.sin(a0) * h, r0, (Math.sin(a1) - Math.sin(a0)) * h, col, { ...o, taper: r1 / r0, noRim: true });
    }
    return this;
  }

  /** Surface of revolution: `prof` = [z, r, z, r, ...] (relative to z, ascending). `cols[i]` colours segment i (default `col`). */
  lathe(x: number, y: number, z: number, prof: number[], col: RGB, sides = 12, o?: Opt, cols?: (RGB | null | undefined)[], em?: (boolean | undefined)[]): this {
    for (let i = 0; i + 3 < prof.length; i += 2) {
      const z0 = prof[i], r0 = Math.max(0.002, prof[i + 1]), z1 = prof[i + 2], r1 = Math.max(0.002, prof[i + 3]);
      if (z1 - z0 < 0.001) continue;
      const e = em?.[i >> 1];
      this.cyl(x, y, z + z0, r0, z1 - z0, cols?.[i >> 1] ?? col, { noRim: true, ...o, sides, taper: r1 / r0, emis: e ?? o?.emis, tex: e ? '' : o?.tex });
    }
    return this;
  }

  /** Sphere centred at (x, y, z). */
  sphere(x: number, y: number, z: number, r: number, col: RGB, o?: Opt, sides = 12, steps = 6): this {
    const prof: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (i / steps) * Math.PI;
      prof.push(Math.sin(a) * r, Math.max(0.004, Math.cos(a) * r));
    }
    return this.lathe(x, y, z, prof, col, sides, o);
  }

  /** Polyline of rods through [x,y,z, x,y,z, ...]. */
  path(pts: number[], r: number, col: RGB, o?: Opt): this {
    for (let i = 0; i + 5 < pts.length; i += 3) this.bar(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5], r, col, o);
    return this;
  }

  /** Rod between two 3D points (barrels, struts, masts). */
  bar(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, col: RGB, o?: Opt): this {
    const n = o?.sides ?? 4;
    let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    // two perpendicular axes
    let ux: number, uy: number, uz: number;
    if (Math.abs(dz) > 0.9) { ux = 1; uy = 0; uz = 0; } else { ux = -dy; uy = dx; uz = 0; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const tp = o?.taper === undefined ? 1 : typeof o.taper === 'number' ? o.taper : o.taper[0];
    const a: number[] = [], b: number[] = [];
    const off = Math.PI / n;
    for (let i = 0; i < n; i++) {
      const an = off + (i / n) * Math.PI * 2;
      const c = Math.cos(an) * r, s = Math.sin(an) * r;
      a.push(x0 + ux * c + vx * s, y0 + uy * c + vy * s, z0 + uz * c + vz * s);
      b.push(x1 + (ux * c + vx * s) * tp, y1 + (uy * c + vy * s) * tp, z1 + (uz * c + vz * s) * tp);
    }
    return this.loft(a, b, col, o);
  }

  /** Extrude a convex [x,z,...] side profile along local y from y0 to y1. */
  exY(profile: number[], y0: number, y1: number, col: RGB, o?: Opt): this {
    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < profile.length; i += 2) {
      a.push(profile[i], y0, profile[i + 1]);
      b.push(profile[i], y1, profile[i + 1]);
    }
    return this.loft(a, b, col, o);
  }

  /** Extrude a convex [y,z,...] profile along local x from x0 to x1. */
  exX(profile: number[], x0: number, x1: number, col: RGB, o?: Opt): this {
    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < profile.length; i += 2) {
      a.push(x0, profile[i], profile[i + 1]);
      b.push(x1, profile[i], profile[i + 1]);
    }
    return this.loft(a, b, col, o);
  }

  /** Highest z of any part (tiles). */
  height(): number {
    let h = 0;
    for (const p of this.parts) if (p.z1 > h) h = p.z1;
    return h;
  }
  /** Max horizontal extent from the origin. */
  extent(): number {
    let r = 0;
    for (const p of this.parts) r = Math.max(r, Math.abs(p.lx0), Math.abs(p.lx1), Math.abs(p.ly0), Math.abs(p.ly1));
    return r;
  }
}

export interface Sprite {
  c: HTMLCanvasElement;
  /** Anchor (model origin) inside the sprite, and size — all in iso px at zoom 1. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Backing pixels per iso px. */
  s: number;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// Light: from the upper-left of the screen and above. +y faces (screen lower-left) are lit, +x faces shaded.
const LX = 0.18, LY = 0.5, LZ = 0.847;
// Direction toward the camera (z component follows the active projection).
const VX = 1, VY = 1;
// Ground shadow direction per tile of height (world x, y).
export const SHX = 0.5, SHY = -0.22;

// scratch buffers (grown on demand)
let W = new Float32Array(4096);
let S = new Float32Array(4096);

function partOrder(m: Model, ca: number, sa: number): number[] {
  const P = m.parts;
  const n = P.length;
  const VZ = (2 * PJ.hh) / PJ.z;
  const key = new Float32Array(n);
  // world AABBs
  const bb = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = P[i];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < 2; k++) {
      const r = k ? p.b : p.a;
      for (let j = 0; j < p.n; j++) {
        const x = r[j * 3] * ca - r[j * 3 + 1] * sa, y = r[j * 3] * sa + r[j * 3 + 1] * ca;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    bb[i * 4] = x0; bb[i * 4 + 1] = x1; bb[i * 4 + 2] = y0; bb[i * 4 + 3] = y1;
    const wx = p.cx * ca - p.cy * sa, wy = p.cx * sa + p.cy * ca;
    key[i] = wx + wy + p.cz * VZ;
  }
  // sign of local axes toward the camera
  const su = ca + sa; // local +x · view
  const sv = -sa + ca; // local +y · view
  const e = 0.0015;
  /** true = i must be drawn before j */
  const before = (i: number, j: number): boolean => {
    const A = P[i], B = P[j];
    if (A.layer !== B.layer) return A.layer < B.layer;
    if (A.z1 <= B.z0 + e) return true;
    if (B.z1 <= A.z0 + e) return false;
    if (Math.abs(su) > 0.02) {
      if (A.lx1 <= B.lx0 + e) return su > 0;
      if (B.lx1 <= A.lx0 + e) return su < 0;
    }
    if (Math.abs(sv) > 0.02) {
      if (A.ly1 <= B.ly0 + e) return sv > 0;
      if (B.ly1 <= A.ly0 + e) return sv < 0;
    }
    if (bb[i * 4 + 1] <= bb[j * 4] + e) return true;
    if (bb[j * 4 + 1] <= bb[i * 4] + e) return false;
    if (bb[i * 4 + 3] <= bb[j * 4 + 2] + e) return true;
    return false;
  };
  // Kahn's algorithm over the "must precede" relation; ties and cycles fall back to the depth key.
  const adj = new Uint8Array(n * n);
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && before(i, j)) { adj[i * n + j] = 1; indeg[j]++; }
    }
  }
  const done = new Uint8Array(n);
  const out: number[] = [];
  for (let step = 0; step < n; step++) {
    let best = -1, fallback = -1;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if (fallback < 0 || key[i] < key[fallback]) fallback = i;
      if (indeg[i] === 0 && (best < 0 || key[i] < key[best])) best = i;
    }
    const pick = best >= 0 ? best : fallback;
    done[pick] = 1;
    out.push(pick);
    const row = pick * n;
    for (let j = 0; j < n; j++) if (adj[row + j]) indeg[j]--;
  }
  return out;
}

function ensure(n: number): void {
  if (W.length < n * 3) { W = new Float32Array(n * 3 * 2); S = new Float32Array(n * 3 * 2); }
}

/** Screen-space bounds [x0,y0,x1,y1] of a model at rotation `ang`, in iso px at zoom 1 (includes ground shadow). */
export function modelBounds(m: Model, ang: number, withShadow: boolean): [number, number, number, number] {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of m.parts) {
    for (let k = 0; k < 2; k++) {
      const r = k ? p.b : p.a;
      for (let j = 0; j < p.n; j++) {
        const wx = r[j * 3] * ca - r[j * 3 + 1] * sa, wy = r[j * 3] * sa + r[j * 3 + 1] * ca, wz = r[j * 3 + 2];
        const sx = (wx - wy) * PJ.hw, sy = (wx + wy) * PJ.hh - wz * PJ.z;
        if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
        if (withShadow) {
          const gx = wx + wz * SHX, gy = wy + wz * SHY;
          const tx = (gx - gy) * PJ.hw, ty = (gx + gy) * PJ.hh;
          if (tx < x0) x0 = tx; if (tx > x1) x1 = tx; if (ty < y0) y0 = ty; if (ty > y1) y1 = ty;
        }
      }
    }
  }
  if (x0 > x1) return [0, 0, 1, 1];
  return [x0, y0, x1, y1];
}

function facePath(ctx: CanvasRenderingContext2D, idx: number[], cnt: number): void {
  ctx.beginPath();
  ctx.moveTo(S[idx[0] * 2], S[idx[0] * 2 + 1]);
  for (let i = 1; i < cnt; i++) ctx.lineTo(S[idx[i] * 2], S[idx[i] * 2 + 1]);
  ctx.closePath();
}

const fidx: number[] = [];

// ───────────────────────────── surface detail ─────────────────────────────
// A quad face is parametrised as P(s,t): s runs along its base edge (q0→q1), t from the base edge to the far edge (q3→q2).
const Q = new Float64Array(8);
let qx = 0, qy = 0;
function qp(s: number, t: number): void {
  const ax = Q[0] + (Q[2] - Q[0]) * s, ay = Q[1] + (Q[3] - Q[1]) * s;
  const bx = Q[6] + (Q[4] - Q[6]) * s, by = Q[7] + (Q[5] - Q[7]) * s;
  qx = ax + (bx - ax) * t; qy = ay + (by - ay) * t;
}
function qline(ctx: CanvasRenderingContext2D, s0: number, t0: number, s1: number, t1: number): void {
  qp(s0, t0); ctx.moveTo(qx, qy);
  qp(s1, t1); ctx.lineTo(qx, qy);
}
function qquad(ctx: CanvasRenderingContext2D, s0: number, t0: number, s1: number, t1: number, skew = 0): void {
  qp(s0, t0); ctx.moveTo(qx, qy);
  qp(s1, t0); ctx.lineTo(qx, qy);
  qp(s1 + skew, t1); ctx.lineTo(qx, qy);
  qp(s0 + skew, t1); ctx.lineTo(qx, qy);
  ctx.closePath();
}

/**
 * Paint a texture onto the current quad (Q). `wl`/`hl` = world size (tiles) along s / t, `br` = face brightness,
 * `seed` varies per face. In `emisOnly` mode only light-emitting detail is drawn.
 */
function faceTex(ctx: CanvasRenderingContext2D, tex: string, wl: number, hl: number, col: RGB, tc: RGB | null, ts: number, br: number, sc: number, seed: number, unlit: boolean, emisOnly: boolean): void {
  const lw = Math.max(0.6, sc * 0.5);
  ctx.lineCap = 'butt';
  if (tex === 'win') {
    // window grid: lit panes glow, dark panes are glass
    const cols = Math.max(1, Math.round((wl / 0.17) * ts)), rows = Math.max(1, Math.round((hl / 0.2) * ts));
    const lit = css(tc ?? [255, 214, 140], 1), off = css([24, 30, 40], 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = !unlit && hash2(seed * 7 + c, r * 13 + seed) < 0.72;
        if (emisOnly && !on) continue;
        ctx.beginPath();
        qquad(ctx, (c + 0.2) / cols, (r + 0.24) / rows, (c + 0.8) / cols, (r + 0.76) / rows);
        ctx.fillStyle = on ? lit : off;
        ctx.fill();
      }
    }
    return;
  }
  if (emisOnly) return;
  const dark = (a: number): string => `rgba(8,10,14,${a})`;
  const light = (a: number): string => `rgba(255,255,255,${a * Math.min(1, br)})`;
  if (tex === 'panel') {
    const cols = Math.max(1, Math.round((wl / 0.42) * ts)), rows = Math.max(1, Math.round((hl / 0.3) * ts));
    if (cols < 2 && rows < 2) return;
    ctx.lineWidth = lw;
    ctx.strokeStyle = dark(0.2);
    ctx.beginPath();
    for (let c = 1; c < cols; c++) qline(ctx, c / cols, 0, c / cols, 1);
    for (let r = 1; r < rows; r++) qline(ctx, 0, r / rows, 1, r / rows);
    ctx.stroke();
    ctx.strokeStyle = light(0.3);
    ctx.beginPath();
    const d = 0.012 / Math.max(0.1, hl);
    for (let r = 1; r < rows; r++) qline(ctx, 0, r / rows + d, 1, r / rows + d);
    ctx.stroke();
  } else if (tex === 'plate') {
    const cols = Math.max(1, Math.round((wl / 0.36) * ts)), rows = Math.max(1, Math.round((hl / 0.3) * ts));
    // rust streaks running down from the top edge
    const ns = Math.max(1, Math.round(wl * 5));
    for (let k = 0; k < ns; k++) {
      const h1 = hash2(seed + k * 3, 11), h2 = hash2(seed + k * 5, 23), h3 = hash2(seed + k, 31);
      if (h3 < 0.45) continue;
      const s0 = h1, w = (0.02 + h2 * 0.05) / Math.max(0.2, wl), len = 0.3 + h2 * 0.65;
      ctx.beginPath();
      qquad(ctx, s0, 1, s0 + w, 1 - len);
      ctx.fillStyle = h3 > 0.75 ? 'rgba(120,58,26,0.26)' : 'rgba(16,12,10,0.2)';
      ctx.fill();
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = dark(0.34);
    ctx.beginPath();
    for (let c = 1; c < cols; c++) qline(ctx, c / cols, 0, c / cols, 1);
    for (let r = 1; r < rows; r++) qline(ctx, 0, r / rows, 1, r / rows);
    ctx.stroke();
    // rivets along the horizontal seams and the top edge
    if (sc >= 1.5) {
      const nr = Math.max(2, Math.round(wl / 0.1));
      const rr = Math.max(0.5, sc * 0.42);
      ctx.fillStyle = dark(0.42);
      ctx.beginPath();
      for (let r = 1; r <= rows; r++) {
        const t = r / rows - 0.035 / Math.max(0.12, hl);
        for (let k = 0; k < nr; k++) { qp((k + 0.5) / nr, t); ctx.moveTo(qx + rr, qy); ctx.arc(qx, qy, rr, 0, 6.3); }
      }
      ctx.fill();
      ctx.fillStyle = light(0.26);
      ctx.beginPath();
      for (let r = 1; r <= rows; r++) {
        const t = r / rows - 0.035 / Math.max(0.12, hl);
        for (let k = 0; k < nr; k++) { qp((k + 0.5) / nr, t); ctx.moveTo(qx - rr * 0.4 + rr * 0.5, qy - rr * 0.5); ctx.arc(qx - rr * 0.4, qy - rr * 0.5, rr * 0.5, 0, 6.3); }
      }
      ctx.fill();
    }
  } else if (tex === 'corr' || tex === 'slats') {
    const vertical = tex === 'corr';
    const n = Math.max(2, Math.round(((vertical ? wl : hl) / 0.075) * ts));
    ctx.lineWidth = lw;
    ctx.strokeStyle = dark(0.26);
    ctx.beginPath();
    for (let k = 1; k < n; k++) { if (vertical) qline(ctx, k / n, 0, k / n, 1); else qline(ctx, 0, k / n, 1, k / n); }
    ctx.stroke();
    ctx.strokeStyle = light(0.14);
    ctx.beginPath();
    for (let k = 0; k < n; k++) { const u = (k + 0.5) / n; if (vertical) qline(ctx, u, 0, u, 1); else qline(ctx, 0, u, 1, u); }
    ctx.stroke();
  } else if (tex === 'brick') {
    const rows = Math.max(2, Math.round((hl / 0.085) * ts)), cols = Math.max(2, Math.round((wl / 0.19) * ts));
    ctx.lineWidth = lw * 0.9;
    ctx.strokeStyle = dark(0.24);
    ctx.beginPath();
    for (let r = 1; r < rows; r++) qline(ctx, 0, r / rows, 1, r / rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const u = (c + (r & 1 ? 0.5 : 0)) / cols; if (u > 0.01 && u < 0.99) qline(ctx, u, r / rows, u, (r + 1) / rows); }
    ctx.stroke();
    // a few odd-coloured bricks
    for (let k = 0; k < rows * cols * 0.14; k++) {
      const r = (hash2(seed + k, 5) * rows) | 0, c = (hash2(seed + k, 9) * (cols - 1)) | 0, o = r & 1 ? 0.5 : 0;
      ctx.beginPath();
      qquad(ctx, (c + o) / cols, r / rows, Math.min(1, (c + o + 1) / cols), (r + 1) / rows);
      ctx.fillStyle = hash2(seed + k, 3) < 0.5 ? dark(0.16) : light(0.1);
      ctx.fill();
    }
  } else if (tex === 'conc') {
    // pour lines + stains
    const rows = Math.max(1, Math.round((hl / 0.34) * ts));
    ctx.lineWidth = lw * 0.9;
    ctx.strokeStyle = dark(0.14);
    ctx.beginPath();
    for (let r = 1; r < rows; r++) qline(ctx, 0, r / rows, 1, r / rows);
    ctx.stroke();
    const ns = Math.max(1, Math.round(wl * 4));
    for (let k = 0; k < ns; k++) {
      const h1 = hash2(seed + k * 3, 41), h2 = hash2(seed + k * 7, 43);
      if (h2 < 0.4) continue;
      const w = (0.03 + h2 * 0.06) / Math.max(0.2, wl);
      ctx.beginPath();
      qquad(ctx, h1, 1, h1 + w, 1 - (0.25 + h2 * 0.6));
      ctx.fillStyle = dark(0.13);
      ctx.fill();
    }
  } else if (tex === 'hazard' || tex === 'chev') {
    // diagonal warning stripes in the texture colour (default black)
    const n = Math.max(2, Math.round((wl / 0.14) * ts));
    ctx.save();
    ctx.beginPath(); qquad(ctx, 0, 0, 1, 1); ctx.clip();
    ctx.fillStyle = css(tc ?? [22, 20, 18], Math.min(1, br + 0.1));
    ctx.beginPath();
    const skew = Math.min(0.6, (hl / Math.max(0.05, wl)) * 0.9);
    for (let k = -1; k < n + 1; k++) {
      if (tex === 'chev') {
        const u = (k + 0.25) / n, w = 0.5 / n;
        qp(u, 0); ctx.moveTo(qx, qy); qp(u + w, 0); ctx.lineTo(qx, qy); qp(u + w + skew / 2, 0.5); ctx.lineTo(qx, qy);
        qp(u + w, 1); ctx.lineTo(qx, qy); qp(u, 1); ctx.lineTo(qx, qy); qp(u + skew / 2, 0.5); ctx.lineTo(qx, qy); ctx.closePath();
      } else qquad(ctx, k / n, 0, (k + 0.5) / n, 1, skew);
    }
    ctx.fill();
    ctx.restore();
  } else if (tex === 'glass') {
    // mullions + diagonal reflections
    const cols = Math.max(1, Math.round((wl / 0.24) * ts)), rows = Math.max(1, Math.round((hl / 0.24) * ts));
    ctx.save();
    ctx.beginPath(); qquad(ctx, 0, 0, 1, 1); ctx.clip();
    ctx.fillStyle = light(0.2);
    ctx.beginPath();
    qquad(ctx, 0.08, 0, 0.26, 1, 0.3);
    qquad(ctx, 0.5, 0, 0.56, 1, 0.3);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = lw;
    ctx.strokeStyle = css(tc ?? [226, 236, 244], 0.9 * Math.min(1, br + 0.15), 0.75);
    ctx.beginPath();
    for (let c = 1; c < cols; c++) qline(ctx, c / cols, 0, c / cols, 1);
    for (let r = 1; r < rows; r++) qline(ctx, 0, r / rows, 1, r / rows);
    ctx.stroke();
  } else if (tex === 'mesh') {
    const cols = Math.max(2, Math.round((wl / 0.09) * ts)), rows = Math.max(2, Math.round((hl / 0.09) * ts));
    ctx.lineWidth = lw * 0.8;
    ctx.strokeStyle = dark(0.4);
    ctx.beginPath();
    for (let c = 1; c < cols; c++) qline(ctx, c / cols, 0, c / cols, 1);
    for (let r = 1; r < rows; r++) qline(ctx, 0, r / rows, 1, r / rows);
    ctx.stroke();
  }
  void col;
}

/**
 * Draw a model at the context's origin. `sc` = backing pixels per iso px (the context is expected to be unscaled,
 * the caller translates to the anchor). With `emisOnly`, only the light-emitting surfaces that are actually visible
 * are left on the canvas (everything else erases what is behind it) — used to bake a bloom layer.
 */
export function drawModel(ctx: CanvasRenderingContext2D, m: Model, ang: number, sc: number, emisOnly = false): void {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const order = partOrder(m, ca, sa);
  const hw = PJ.hw, hh = PJ.hh, zp = PJ.z;
  const VZ = (2 * hh) / zp;
  ctx.lineJoin = 'round';
  for (const pi of order) {
    const p = m.parts[pi];
    const n = p.n;
    ensure(n * 2);
    // world + screen coords: ring A = verts 0..n-1, ring B = n..2n-1
    let ccx = 0, ccy = 0, ccz = 0;
    for (let k = 0; k < 2; k++) {
      const r = k ? p.b : p.a;
      for (let j = 0; j < n; j++) {
        const wx = r[j * 3] * ca - r[j * 3 + 1] * sa, wy = r[j * 3] * sa + r[j * 3 + 1] * ca, wz = r[j * 3 + 2];
        const vi = k * n + j;
        W[vi * 3] = wx; W[vi * 3 + 1] = wy; W[vi * 3 + 2] = wz;
        S[vi * 2] = (wx - wy) * hw * sc; S[vi * 2 + 1] = ((wx + wy) * hh - wz * zp) * sc;
        ccx += wx; ccy += wy; ccz += wz;
      }
    }
    ccx /= 2 * n; ccy /= 2 * n; ccz /= 2 * n;
    const emis = p.emis && !m.unlit;
    const base: RGB = p.emis && m.unlit ? [38, 44, 52] : p.col;
    const texTop = p.tex.endsWith('+');
    const tex = texTop ? p.tex.slice(0, -1) : p.tex;
    if (emisOnly && p.alpha < 0.9 && !emis) continue; // glass does not hide what glows behind it
    if (p.alpha < 1 && !emisOnly) ctx.globalAlpha = p.alpha;
    // faces: n side quads, cap A, cap B
    for (let f = 0; f < n + 2; f++) {
      let cnt: number;
      if (f < n) {
        const j2 = (f + 1) % n;
        fidx[0] = f; fidx[1] = j2; fidx[2] = n + j2; fidx[3] = n + f; cnt = 4;
      } else if (f === n) {
        for (let j = 0; j < n; j++) fidx[j] = j;
        cnt = n;
      } else {
        for (let j = 0; j < n; j++) fidx[j] = n + j;
        cnt = n;
      }
      // Newell normal + centroid
      let nx = 0, ny = 0, nz = 0, fx = 0, fy = 0, fz = 0;
      for (let i = 0; i < cnt; i++) {
        const a = fidx[i] * 3, b = fidx[(i + 1) % cnt] * 3;
        nx += (W[a + 1] - W[b + 1]) * (W[a + 2] + W[b + 2]);
        ny += (W[a + 2] - W[b + 2]) * (W[a] + W[b]);
        nz += (W[a] - W[b]) * (W[a + 1] + W[b + 1]);
        fx += W[a]; fy += W[a + 1]; fz += W[a + 2];
      }
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9) continue;
      nx /= nl; ny /= nl; nz /= nl;
      fx /= cnt; fy /= cnt; fz /= cnt;
      if (nx * (fx - ccx) + ny * (fy - ccy) + nz * (fz - ccz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (nx * VX + ny * VY + nz * VZ <= 0.0005) continue;
      const col = f === n + 1 && p.top ? (m.unlit && p.emis ? base : p.top) : base;
      facePath(ctx, fidx, cnt);
      const wantTex = tex !== '' && cnt === 4 && (f < n || texTop);
      if (emisOnly) {
        if (emis) {
          ctx.globalCompositeOperation = 'source-over';
          const fill = css(col, 1);
          ctx.fillStyle = fill; ctx.fill();
        } else {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = '#000'; ctx.fill();
          ctx.strokeStyle = '#000'; ctx.lineWidth = 0.7; ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (emis) {
        const fill = css(col, 1);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = fill; ctx.lineWidth = 0.7; ctx.stroke();
        continue;
      }
      const lit = Math.max(0, nx * LX + ny * LY + nz * LZ);
      const br = 0.5 + 0.6 * lit;
      if (!emisOnly) {
        if (nz < 0.35) {
          // near-vertical face: darker toward the ground (cheap ambient occlusion)
          let ymin = 1e9, ymax = -1e9;
          for (let i = 0; i < cnt; i++) { const y = S[fidx[i] * 2 + 1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
          if (ymax - ymin > 3) {
            const g = ctx.createLinearGradient(0, ymin, 0, ymax);
            g.addColorStop(0, css(col, br * 1.04));
            g.addColorStop(1, css(col, br * 0.8));
            ctx.fillStyle = g;
          } else ctx.fillStyle = css(col, br);
          ctx.fill();
          ctx.strokeStyle = css(col, br * 0.9); ctx.lineWidth = 0.7; ctx.stroke();
        } else {
          const fill = css(col, br);
          ctx.fillStyle = fill; ctx.fill();
          if (p.rim && nz > 0.6) {
            ctx.strokeStyle = css(col, br * 1.22, 0.75); ctx.lineWidth = Math.max(0.8, sc * 0.45);
          } else {
            ctx.strokeStyle = fill; ctx.lineWidth = 0.7;
          }
          ctx.stroke();
        }
      }
      if (wantTex && !emis) {
        // orient the quad so t runs upward (side faces) / away from the first edge (caps)
        const i0 = fidx[0], i1 = fidx[1], i2 = fidx[2], i3 = fidx[3];
        Q[0] = S[i0 * 2]; Q[1] = S[i0 * 2 + 1]; Q[2] = S[i1 * 2]; Q[3] = S[i1 * 2 + 1];
        Q[4] = S[i2 * 2]; Q[5] = S[i2 * 2 + 1]; Q[6] = S[i3 * 2]; Q[7] = S[i3 * 2 + 1];
        const wl = Math.hypot(W[i1 * 3] - W[i0 * 3], W[i1 * 3 + 1] - W[i0 * 3 + 1], W[i1 * 3 + 2] - W[i0 * 3 + 2]);
        const hl = Math.hypot(W[i3 * 3] - W[i0 * 3], W[i3 * 3 + 1] - W[i0 * 3 + 1], W[i3 * 3 + 2] - W[i0 * 3 + 2]);
        if (wl * hw * sc > 5 && hl * zp * sc > 4) faceTex(ctx, tex, wl, hl, col, p.tc, p.ts, br, sc, pi * 31 + f * 7, m.unlit, emisOnly);
      }
    }
    if (p.alpha < 1) ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Fill the model's ground shadow (projected along the light) into the context as one opaque shape. */
export function drawModelShadow(ctx: CanvasRenderingContext2D, m: Model, ang: number, sc: number): void {
  modelShadowPath(ctx, m, ang, sc);
  ctx.fill('nonzero');
}

/** Build (but do not fill) the path of the model's projected ground shadow. */
export function modelShadowPath(ctx: CanvasRenderingContext2D, m: Model, ang: number, sc: number): void {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  ctx.beginPath();
  const hull: number[] = [];
  for (const p of m.parts) {
    if (p.alpha < 0.9) continue;
    hull.length = 0;
    for (let k = 0; k < 2; k++) {
      const r = k ? p.b : p.a;
      for (let j = 0; j < p.n; j++) {
        const wx = r[j * 3] * ca - r[j * 3 + 1] * sa, wy = r[j * 3] * sa + r[j * 3 + 1] * ca, wz = r[j * 3 + 2];
        const gx = wx + wz * SHX, gy = wy + wz * SHY;
        hull.push((gx - gy) * PJ.hw * sc, (gx + gy) * PJ.hh * sc);
      }
    }
    const h = convexHull(hull);
    if (h.length < 6) continue;
    ctx.moveTo(h[0], h[1]);
    for (let i = 2; i < h.length; i += 2) ctx.lineTo(h[i], h[i + 1]);
    ctx.closePath();
  }
}

function convexHull(p: number[]): number[] {
  const n = p.length / 2;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => p[a * 2] - p[b * 2] || p[a * 2 + 1] - p[b * 2 + 1]);
  const cross = (o: number, a: number, b: number) => (p[a * 2] - p[o * 2]) * (p[b * 2 + 1] - p[o * 2 + 1]) - (p[a * 2 + 1] - p[o * 2 + 1]) * (p[b * 2] - p[o * 2]);
  const lo: number[] = [];
  for (const i of idx) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
  const up: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], i) <= 0) up.pop(); up.push(i); }
  lo.pop(); up.pop();
  const out: number[] = [];
  for (const i of lo.concat(up)) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

export interface SpriteOpts {
  /** Dark silhouette outline alpha (0 = none). */
  outline?: number;
  /** Bake the projected ground shadow into the sprite with this alpha. */
  shadow?: number;
  /** Transparent margin around the model, iso px. */
  pad?: number;
  /** Strength of the baked glow around light-emitting surfaces (0 = none). */
  bloom?: number;
  /** Weathering: 0 none … 1 heavy soot streaks and grime (drawn only on the silhouette). */
  grime?: number;
}

const scratchC: (HTMLCanvasElement | null)[] = [null, null];
/** Shared, cleared scratch canvas at least w×h (avoids allocating temporaries per sprite). */
function scratch(i: number, w: number, h: number): HTMLCanvasElement {
  let c = scratchC[i];
  if (!c || c.width < w || c.height < h) {
    c = makeCanvas(Math.max(w, c ? c.width : 64), Math.max(h, c ? c.height : 64));
    scratchC[i] = c;
  } else {
    const x = c.getContext('2d')!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, w + 2, h + 2);
  }
  return c;
}

/** Rasterise a model into a trimmed sprite canvas. `sc` = backing px per iso px. */
export function renderSprite(m: Model, ang: number, sc: number, o?: SpriteOpts): Sprite {
  const sh = o?.shadow ?? 0;
  const b = modelBounds(m, ang, sh > 0);
  const pad = (o?.pad ?? 2) + (o?.outline ? 1 : 0);
  const ox = Math.ceil(-b[0] + pad), oy = Math.ceil(-b[1] + pad);
  const w = Math.ceil(b[2] + pad) + ox, h = Math.ceil(b[3] + pad) + oy;
  const c = makeCanvas(w * sc, h * sc);
  const ctx = c.getContext('2d')!;
  ctx.translate(ox * sc, oy * sc);
  if (sh > 0) {
    ctx.fillStyle = `rgba(8,10,16,${sh})`;
    drawModelShadow(ctx, m, ang, sc);
  }
  if (o?.outline) {
    // draw body to a scratch canvas, stamp a dark silhouette around it, then the body on top
    const pw = c.width, ph = c.height;
    const t = scratch(0, pw, ph);
    const tc = t.getContext('2d')!;
    tc.setTransform(1, 0, 0, 1, ox * sc, oy * sc);
    drawModel(tc, m, ang, sc);
    const sil = scratch(1, pw, ph);
    const sctx = sil.getContext('2d')!;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.drawImage(t, 0, 0, pw, ph, 0, 0, pw, ph);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#0b0e14';
    sctx.fillRect(0, 0, pw, ph);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = o.outline;
    const d = Math.max(1, Math.round(sc * 0.6));
    ctx.drawImage(sil, 0, 0, pw, ph, -d, 0, pw, ph); ctx.drawImage(sil, 0, 0, pw, ph, d, 0, pw, ph);
    ctx.drawImage(sil, 0, 0, pw, ph, 0, -d, pw, ph); ctx.drawImage(sil, 0, 0, pw, ph, 0, d, pw, ph);
    ctx.globalAlpha = 1;
    ctx.drawImage(t, 0, 0, pw, ph, 0, 0, pw, ph);
  } else {
    drawModel(ctx, m, ang, sc);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pw = c.width, ph = c.height;
  if (o?.grime) {
    // grounding shade toward the base + soot streaks, only where the sprite already has pixels
    ctx.globalCompositeOperation = 'source-atop';
    const yb = (oy + b[3] - (sh > 0 ? 0 : 0)) * sc, yt = Math.max(0, yb - 46 * sc);
    const g = ctx.createLinearGradient(0, yt, 0, yb);
    g.addColorStop(0, 'rgba(10,10,14,0)'); g.addColorStop(1, `rgba(10,10,14,${0.1 + 0.14 * o.grime})`);
    ctx.fillStyle = g; ctx.fillRect(0, yt, pw, yb - yt);
    if (o.grime > 0.6) {
      const n = Math.round((pw / sc) * 0.16);
      for (let i = 0; i < n; i++) {
        const x = hash2(i, m.parts.length) * pw, y = hash2(i, 7) * ph * 0.8, len = (10 + hash2(i, 13) * 34) * sc, wd = (1 + hash2(i, 19) * 3.5) * sc;
        const sg = ctx.createLinearGradient(0, y, 0, y + len);
        const warm = hash2(i, 29) > 0.6;
        sg.addColorStop(0, warm ? 'rgba(96,44,18,0.16)' : 'rgba(12,10,9,0.13)'); sg.addColorStop(1, 'rgba(12,10,9,0)');
        ctx.fillStyle = sg; ctx.fillRect(x, y, wd, len);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  if (o?.bloom && m.parts.some((p) => p.emis || p.tex.startsWith('win'))) {
    // visible emissive surfaces → blurred by down/up-sampling → added back as a soft halo
    const e = scratch(0, pw, ph);
    const ec = e.getContext('2d')!;
    ec.setTransform(1, 0, 0, 1, ox * sc, oy * sc);
    drawModel(ec, m, ang, sc, true);
    const k = 5;
    const sw = Math.max(2, Math.ceil(pw / k)), shh = Math.max(2, Math.ceil(ph / k));
    const sm = scratch(1, sw + 2, shh + 2);
    const smc = sm.getContext('2d')!;
    smc.setTransform(1, 0, 0, 1, 0, 0);
    smc.imageSmoothingEnabled = true;
    smc.drawImage(e, 0, 0, pw, ph, 1, 1, sw, shh);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = o.bloom;
    ctx.drawImage(sm, 1, 1, sw, shh, 0, 0, pw, ph);
    ctx.globalAlpha = o.bloom * 0.6;
    ctx.drawImage(sm, 1, 1, sw, shh, -sc * 2, -sc * 2, pw + sc * 4, ph + sc * 4);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  return { c, ox, oy, w, h, s: sc };
}

/** Cheap deterministic hash → [0,1). */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1). */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export { WHITE };
