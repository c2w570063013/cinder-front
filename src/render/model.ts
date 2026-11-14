// Tiny flat-shaded "iso solid" modeller. Every sprite in the game (units, buildings, props, icons)
// is built from convex lofts (two parallel rings of 3D points) and rasterised to a cached canvas.
// Local model space: tile units, +x = forward, +z = up. Rotation is about the z axis.
import { TILE_H, TILE_W } from '../core/constants';

/** Screen pixels (at zoom 1) per tile of height. */
export const ZPX = 36;
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;

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
// Direction toward the camera.
const VX = 1, VY = 1, VZ = HW / ZPX;
// Ground shadow direction per tile of height (world x, y).
export const SHX = 0.5, SHY = -0.22;

// scratch buffers (grown on demand)
let W = new Float32Array(4096);
let S = new Float32Array(4096);

function partOrder(m: Model, ca: number, sa: number): number[] {
  const P = m.parts;
  const n = P.length;
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
  /** 1 = i must be drawn before j, -1 = after, 0 = unknown */
  const rel = (i: number, j: number): number => {
    const A = P[i], B = P[j];
    if (A.layer !== B.layer) return A.layer < B.layer ? 1 : -1;
    if (A.z1 <= B.z0 + e) return 1;
    if (B.z1 <= A.z0 + e) return -1;
    if (Math.abs(su) > 0.02) {
      if (A.lx1 <= B.lx0 + e) return su > 0 ? 1 : -1;
      if (B.lx1 <= A.lx0 + e) return su > 0 ? -1 : 1;
    }
    if (Math.abs(sv) > 0.02) {
      if (A.ly1 <= B.ly0 + e) return sv > 0 ? 1 : -1;
      if (B.ly1 <= A.ly0 + e) return sv > 0 ? -1 : 1;
    }
    if (bb[i * 4 + 1] <= bb[j * 4] + e) return 1;
    if (bb[j * 4 + 1] <= bb[i * 4] + e) return -1;
    if (bb[i * 4 + 3] <= bb[j * 4 + 2] + e) return 1;
    if (bb[j * 4 + 3] <= bb[i * 4 + 2] + e) return -1;
    return 0;
  };
  const done = new Uint8Array(n);
  const out: number[] = [];
  for (let step = 0; step < n; step++) {
    let best = -1, fallback = -1;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if (fallback < 0 || key[i] < key[fallback]) fallback = i;
      let free = true;
      for (let j = 0; j < n; j++) {
        if (j === i || done[j]) continue;
        const r = rel(j, i);
        if (r === 1) { free = false; break; }
      }
      if (free && (best < 0 || key[i] < key[best])) best = i;
    }
    const pick = best >= 0 ? best : fallback;
    done[pick] = 1;
    out.push(pick);
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
        const sx = (wx - wy) * HW, sy = (wx + wy) * HH - wz * ZPX;
        if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
        if (withShadow) {
          const gx = wx + wz * SHX, gy = wy + wz * SHY;
          const tx = (gx - gy) * HW, ty = (gx + gy) * HH;
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

/**
 * Draw a model at the context's origin. `sc` = backing pixels per iso px (the context is expected to be unscaled,
 * the caller translates to the anchor).
 */
export function drawModel(ctx: CanvasRenderingContext2D, m: Model, ang: number, sc: number): void {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const order = partOrder(m, ca, sa);
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
        S[vi * 2] = (wx - wy) * HW * sc; S[vi * 2 + 1] = ((wx + wy) * HH - wz * ZPX) * sc;
        ccx += wx; ccy += wy; ccz += wz;
      }
    }
    ccx /= 2 * n; ccy /= 2 * n; ccz /= 2 * n;
    const emis = p.emis && !m.unlit;
    const base: RGB = p.emis && m.unlit ? [38, 44, 52] : p.col;
    if (p.alpha < 1) ctx.globalAlpha = p.alpha;
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
      if (emis) {
        const fill = css(col, 1);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = fill; ctx.lineWidth = 0.7; ctx.stroke();
        continue;
      }
      const lit = Math.max(0, nx * LX + ny * LY + nz * LZ);
      const br = 0.5 + 0.6 * lit;
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
    if (p.alpha < 1) ctx.globalAlpha = 1;
  }
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
        hull.push((gx - gy) * HW * sc, (gx + gy) * HH * sc);
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
  /** Extra models drawn into the same sprite after the main one: [model, ang, offsetX, offsetY, offsetZ]. */
  pad?: number;
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
