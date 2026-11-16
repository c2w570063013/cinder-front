// Procedural models + animated overlays for every building def. Original designs.
// Local space: origin = footprint centre on the ground; +x faces screen lower-right, +y screen lower-left.
// The camera sees the +x (shaded) and +y (lit) faces; units and harvesters arrive at the middle of the +y edge,
// so every door, gate and unloading bay opens toward +y.
import { Model, PJ, type RGB, css, hex, mix, mul } from './model';
import { F, H, ORE, ORE_L, type Pal } from './art-units';

export interface LiveCtx {
  /** Translated so (0,0) is the building's ground centre; 1 unit = 1 iso px. */
  ctx: CanvasRenderingContext2D;
  /** Seconds. */
  t: number;
  /** Complete and powered. */
  on: boolean;
  /** Queue an additive glow at a local 3D point (tiles); r in iso px. */
  glow(x: number, y: number, z: number, r: number, col: string, a: number): void;
  P: Pal;
  /** Support-power charge 0..1 (1 = ready). */
  charge: number;
  /** 0..1 recent activity (unloading, producing). */
  active: number;
  /** Stable per-entity phase offset. */
  seed: number;
  /** 0..1 how far the exit door is open (a unit has just rolled out). */
  door: number;
  /** True with probability rate·dt this frame (particle pacing). Always false in portraits. */
  chance(rate: number): boolean;
  /** Emit a puff at a local point (tiles). kind: 0 grey smoke, 1 white steam, 2 black smoke. */
  puff(x: number, y: number, z: number, kind: number, size: number): void;
  /** Emit `n` sparks / embers at a local point. */
  spark(x: number, y: number, z: number, col: string, n: number): void;
}

export interface BuildingArt {
  /** `mask` = wall neighbour bits: 1 = -y (NE), 2 = +x (SE), 4 = +y (SW), 8 = -x (NW). */
  build: (m: Model, P: Pal, mask: number) => void;
  turret?: (m: Model, P: Pal) => void;
  pivot?: [number, number, number];
  muzzles?: number[][];
  recoil?: number;
  flash?: number;
  live?: (g: LiveCtx) => void;
  /** Chimney tops that emit smoke while operating: [x, y, z, kind?, size?] (kind as in LiveCtx.puff). */
  smoke?: number[][];
}

const X = (x: number, y: number): number => (x - y) * PJ.hw;
const Y = (x: number, y: number, z: number): number => (x + y) * PJ.hh - z * PJ.z;

const CYAN = '#74f4ff';
const ORANGE = '#ffa640';
const YELLOW = '#ffd76a';
const MAGENTA = '#ff7fe0';
const RED = '#ff5a3c';
const WHITE = '#ffffff';

// ───────────────────────────── materials ─────────────────────────────

// Helion Accord: white composite plating, pale grey structure, deep-blue glass, cyan light.
const HWHITE = hex('#f1f5f9');
const HPAD = hex('#7d8998');
const HDECK = hex('#98a5b4');
const GLASS = hex('#2f6a9c');
const GLASS_L = hex('#58a8dc');
const HGLOW_SOFT = hex('#b9f7ff');
const GOLD = hex('#dcb65a');
const HSLATE = hex('#55667c');
const HSILO = mix(hex('#f1f5f9'), hex('#e554bb'), 0.17);
// Ferrum Syndicate: rusted plate, soot-black iron, brick, stained concrete, furnace light.
const RUST = hex('#a35a36');
const RUST_D = hex('#7c4229');
const BRICK = hex('#99523d');
const SOOT = hex('#2b2623');
const FCONC = hex('#a0968a');
const FPAD = hex('#6b655d');
const MOLTEN = hex('#ffd27a');
const FWIN = hex('#ffbf5e');
const FSTEEL = hex('#a3a9a8');
const BRASS = hex('#c99b45');
const FSLATE = hex('#55525a');
const WALL_D = hex('#2a313b');
const WALL_F = hex('#3b322c');
// lighter Ferrum structure tones so the buildings do not sink into the ground
const FIRON = hex('#8a7f73');
const FSHED = hex('#75695e');

// ───────────────────────────── modelling helpers ─────────────────────────────

/** Emissive panel on a +x face at x. */
function winX(m: Model, x: number, y: number, z: number, ly: number, h: number, col: RGB): void {
  m.box(x + 0.007, y, z, 0.014, ly, h, col, { emis: true });
}
/** Emissive panel on a +y face at y. */
function winY(m: Model, x: number, y: number, z: number, lx: number, h: number, col: RGB): void {
  m.box(x, y + 0.007, z, lx, 0.014, h, col, { emis: true });
}
/** Grid of lit windows on a +x face. */
function gridX(m: Model, x: number, y: number, z: number, ly: number, h: number, tc: RGB, ts = 1, wall: RGB = WALL_D): void {
  m.box(x + 0.007, y, z, 0.014, ly, h, wall, { tex: 'win', tc, ts });
}
/** Grid of lit windows on a +y face. */
function gridY(m: Model, x: number, y: number, z: number, lx: number, h: number, tc: RGB, ts = 1, wall: RGB = WALL_D): void {
  m.box(x, y + 0.007, z, lx, 0.014, h, wall, { tex: 'win', tc, ts });
}
/** Convex arch profile [u, z, ...] for exX / exY: flat base, straight sides to `zs`, half-ellipse up to `zp`. */
function arch(c: number, hw: number, z0: number, zs: number, zp: number, n = 7, k = 1): number[] {
  const p = [c - hw * k, z0, c + hw * k, z0];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    p.push(c + Math.cos(a) * hw * k, z0 + (zs - z0 + Math.sin(a) * (zp - zs)) * k);
  }
  return p;
}
/** Regular polygon profile [u, z, ...] centred at (c, zc) for horizontal drums. */
function ngon(c: number, zc: number, r: number, n = 8): number[] {
  const p: number[] = [];
  for (let i = 0; i < n; i++) { const a = Math.PI / n + (i / n) * Math.PI * 2; p.push(c + Math.cos(a) * r, zc + Math.sin(a) * r); }
  return p;
}

function hPad(m: Model, w: number, h: number): void {
  m.box(0, 0, 0, w - 0.08, h - 0.08, 0.06, HPAD, { tex: 'panel+', ts: 0.7 });
  m.box(0, 0, 0.06, w - 0.34, h - 0.34, 0.02, HDECK, { tex: 'panel+', ts: 0.6 });
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1]]) m.box(sx * (w / 2 - 0.13), sy * (h / 2 - 0.13), 0.06, 0.07, 0.07, 0.035, H.glow, { emis: true });
}
/** Thin mast with a lamp on top. */
function mast(m: Model, x: number, y: number, z: number, h: number, col: RGB, lamp: RGB): void {
  m.bar(x, y, z, x, y, z + h, 0.014, col);
  m.box(x, y, z + h, 0.05, 0.05, 0.05, lamp, { emis: true });
}
/** Helion silo: ore-tinted drum with a glowing ore ring, player band and domed cap. */
function hSilo(m: Model, P: Pal, x: number, y: number, r: number, h: number): void {
  m.lathe(x, y, 0.08, [0, r * 1.08, 0.1, r * 1.08, 0.12, r, h * 0.5, r, h * 0.5 + 0.16, r, h * 0.76, r, h * 0.76 + 0.1, r * 1.04, h * 0.76 + 0.11, r, h, r], HSILO, 12, { tex: 'panel' },
    [H.mid, null, null, ORE, null, P.p, null, null], [false, false, false, true]);
  m.dome(x, y, 0.08 + h, r, r * 0.55, mix(H.mid, ORE, 0.3), { sides: 12 });
  m.cyl(x, y, 0.08 + h + r * 0.5, r * 0.2, 0.08, H.dark, { sides: 6 });
}

function fPad(m: Model, w: number, h: number): void {
  m.box(0, 0, 0, w - 0.06, h - 0.06, 0.07, FPAD, { tex: 'conc+' });
  m.box(0, h / 2 - 0.1, 0.07, w - 0.36, 0.09, 0.008, F.hazard, { tex: 'hazard+' });
  m.box(w / 2 - 0.1, 0, 0.07, 0.09, h - 0.36, 0.008, F.hazard, { tex: 'hazard+' });
}
/** Brick smokestack with pale bands and a sooty lip. */
function stack(m: Model, x: number, y: number, z: number, r: number, h: number, col: RGB = BRICK): void {
  m.lathe(x, y, z, [0, r * 1.3, 0.12, r * 1.3, 0.16, r * 1.08, h * 0.55, r * 0.95, h * 0.55 + 0.09, r * 0.94, h * 0.74, r * 0.9, h * 0.74 + 0.09, r * 0.89, h - 0.08, r * 0.86, h - 0.07, r, h, r], col, 8,
    { tex: 'brick', ts: 0.8 }, [F.dark, null, null, F.steel, null, F.steel, null, null, SOOT]);
  m.cyl(x, y, z + h, r * 0.8, 0.012, hex('#120f0d'), { sides: 8 });
}
/** Ferrum silo with a conical cap and a painted player band; `ore` swaps the lower collar for a glowing ore gauge ring. */
function fSilo(m: Model, P: Pal, x: number, y: number, r: number, h: number, col: RGB = RUST, ore = false): void {
  m.lathe(x, y, 0.07, [0, r, h * 0.42, r, h * 0.42 + 0.14, r * 1.02, h * 0.42 + 0.15, r, h * 0.7, r, h * 0.7 + 0.16, r * 1.03, h * 0.7 + 0.17, r, h, r, h + r * 0.45, r * 0.25, h + r * 0.45 + 0.08, r * 0.25], col, 10,
    { tex: 'plate' }, [null, ore ? ORE : F.dark, null, null, P.p, null, null, F.dark, F.black], [false, ore]);
}
function crate(m: Model, x: number, y: number, z: number, s: number, col: RGB): void {
  m.box(x, y, z, s, s, s * 0.8, col, { tex: 'slats', ts: 0.5 });
}
/** Four-legged lattice tower from z0 to z1 (half-width r0 at the base, r1 at the top). */
function lattice(m: Model, x: number, y: number, z0: number, z1: number, r0: number, r1: number, col: RGB, rings: number, t = 0.03): void {
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.bar(x + sx * r0, y + sy * r0, z0, x + sx * r1, y + sy * r1, z1, t, col);
  for (let i = 1; i <= rings; i++) {
    const k = i / (rings + 1), z = z0 + (z1 - z0) * k, r = r0 + (r1 - r0) * k;
    m.bar(x - r, y + r, z, x + r, y + r, z, t * 0.6, col); m.bar(x + r, y - r, z, x + r, y + r, z, t * 0.6, col);
    m.bar(x - r, y - r, z, x + r, y - r, z, t * 0.6, col); m.bar(x - r, y - r, z, x - r, y + r, z, t * 0.6, col);
  }
  // diagonal bracing on the two faces the camera sees
  for (let i = 0; i <= rings; i++) {
    const k0 = i / (rings + 1), k1 = (i + 1) / (rings + 1);
    const za = z0 + (z1 - z0) * k0, zb = z0 + (z1 - z0) * k1, ra = r0 + (r1 - r0) * k0, rb = r0 + (r1 - r0) * k1;
    const s = i & 1 ? 1 : -1;
    m.bar(x + s * ra, y + ra, za, x - s * rb, y + rb, zb, t * 0.5, col);
    m.bar(x + ra, y + s * ra, za, x + rb, y - s * rb, zb, t * 0.5, col);
  }
}

// ───────────────────────────── live-overlay helpers ─────────────────────────────

function flicker(t: number, seed: number): number {
  return 0.72 + 0.18 * Math.sin(t * 9 + seed) + 0.1 * Math.sin(t * 23.7 + seed * 3.1);
}
function lightsBlink(g: LiveCtx, pts: number[][], col: string, speed: number, r = 9): void {
  if (!g.on) return;
  for (let i = 0; i < pts.length; i++) {
    const a = 0.5 + 0.5 * Math.sin(g.t * speed + i * 1.7 + g.seed);
    if (a > 0.45) g.glow(pts[i][0], pts[i][1], pts[i][2], r, col, (a - 0.45) * 1.6);
  }
}
/** Lights lit one after another along a list of points. */
function chase(g: LiveCtx, pts: number[][], col: string, speed: number, r = 8): void {
  if (!g.on) return;
  const n = pts.length;
  const head = (g.t * speed + g.seed) % n;
  for (let i = 0; i < n; i++) {
    let d = head - i; if (d < 0) d += n;
    const a = d < 2 ? 1 - d / 2 : 0;
    if (a > 0.02) g.glow(pts[i][0], pts[i][1], pts[i][2], r, col, a);
  }
}
/** Waving banner flying to screen-right from a pole; (x, y, z) = top of the hoist, w × h in iso px. */
function flag(g: LiveCtx, x: number, y: number, z: number, w: number, h: number, col: RGB): void {
  const c = g.ctx;
  const x0 = X(x, y), y0 = Y(x, y, z);
  const n = 7;
  const wave = (u: number): number => Math.sin(g.t * 5.2 + g.seed - u * 5.5) * h * 0.16 * u + u * h * 0.14;
  c.beginPath();
  c.moveTo(x0, y0);
  for (let i = 1; i <= n; i++) { const u = i / n; c.lineTo(x0 + u * w, y0 + wave(u)); }
  for (let i = n; i >= 0; i--) { const u = i / n; c.lineTo(x0 + u * w, y0 + wave(u) + h * (1 - 0.12 * u)); }
  c.closePath();
  c.fillStyle = css(col, 1); c.fill();
  // folds
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n;
    const s = Math.cos(g.t * 5.2 + g.seed - (u0 + u1) * 2.75);
    c.fillStyle = s > 0 ? `rgba(255,255,255,${0.2 * s})` : `rgba(0,0,0,${-0.28 * s})`;
    c.beginPath();
    c.moveTo(x0 + u0 * w, y0 + wave(u0)); c.lineTo(x0 + u1 * w, y0 + wave(u1));
    c.lineTo(x0 + u1 * w, y0 + wave(u1) + h * (1 - 0.12 * u1)); c.lineTo(x0 + u0 * w, y0 + wave(u0) + h * (1 - 0.12 * u0));
    c.closePath(); c.fill();
  }
  c.strokeStyle = 'rgba(10,12,16,0.55)'; c.lineWidth = 0.8;
  c.beginPath(); c.moveTo(x0, y0);
  for (let i = 1; i <= n; i++) { const u = i / n; c.lineTo(x0 + u * w, y0 + wave(u)); }
  c.stroke();
}
/** Horizontal spinning fan / rotor disc. */
function fan(g: LiveCtx, x: number, y: number, z: number, r: number, speed: number, blades = 3): void {
  const c = g.ctx;
  const cx = X(x, y), cy = Y(x, y, z);
  const rx = r * PJ.hw * 1.41, ry = rx * (PJ.hh / PJ.hw);
  c.fillStyle = 'rgba(14,16,20,0.75)';
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 6.3); c.fill();
  const a0 = g.on ? g.t * speed + g.seed : g.seed;
  c.strokeStyle = 'rgba(190,200,210,0.75)'; c.lineWidth = Math.max(1.2, rx * 0.22);
  c.beginPath();
  for (let i = 0; i < blades; i++) {
    const a = a0 + (i / blades) * Math.PI * 2;
    c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * rx * 0.92, cy + Math.sin(a) * ry * 0.92);
  }
  c.stroke();
  c.strokeStyle = 'rgba(8,10,12,0.8)'; c.lineWidth = 1;
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 6.3); c.stroke();
}
/** Small rotating scanner bar on a roof. */
function spinner(g: LiveCtx, x: number, y: number, z: number, r: number, speed: number, col: RGB): void {
  const c = g.ctx;
  const a = g.on ? g.t * speed + g.seed : g.seed;
  const ux = Math.cos(a) * r, uy = Math.sin(a) * r;
  c.strokeStyle = css(mul(col, 0.45), 1); c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(X(0 + x, y), Y(x, y, z - 0.12)); c.lineTo(X(x, y), Y(x, y, z)); c.stroke();
  c.strokeStyle = css(col, 1); c.lineWidth = 3;
  c.beginPath(); c.moveTo(X(x - ux, y - uy), Y(x - ux, y - uy, z)); c.lineTo(X(x + ux, y + uy), Y(x + ux, y + uy, z)); c.stroke();
}
/** Quad on a +y wall plane (y = yy) between x0..x1 and z0..z1. */
function wallQuadY(c: CanvasRenderingContext2D, yy: number, x0: number, x1: number, z0: number, z1: number): void {
  c.beginPath();
  c.moveTo(X(x0, yy), Y(x0, yy, z0)); c.lineTo(X(x1, yy), Y(x1, yy, z0));
  c.lineTo(X(x1, yy), Y(x1, yy, z1)); c.lineTo(X(x0, yy), Y(x0, yy, z1));
  c.closePath();
}
/** Roll-up door on a +y wall: fully covers the opening at open = 0. */
function rollDoor(g: LiveCtx, yy: number, x0: number, x1: number, z0: number, z1: number, col: RGB, edge: RGB): void {
  const c = g.ctx;
  const zb = z0 + (z1 - z0) * Math.min(0.93, g.door);
  wallQuadY(c, yy, x0, x1, zb, z1);
  c.fillStyle = css(col, 0.92); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.38)'; c.lineWidth = 0.8;
  c.beginPath();
  for (let z = z1 - 0.07; z > zb + 0.02; z -= 0.07) { c.moveTo(X(x0, yy), Y(x0, yy, z)); c.lineTo(X(x1, yy), Y(x1, yy, z)); }
  c.stroke();
  wallQuadY(c, yy, x0, x1, zb, Math.min(z1, zb + 0.06));
  c.fillStyle = css(edge, 1); c.fill();
}
/** Sliding two-leaf door on a +y wall. */
function splitDoor(g: LiveCtx, yy: number, x0: number, x1: number, z0: number, z1: number, col: RGB, edge: RGB): void {
  const c = g.ctx;
  const xm = (x0 + x1) / 2, half = (x1 - x0) / 2, o = half * Math.min(0.92, g.door);
  for (const s of [-1, 1]) {
    const a = s < 0 ? x0 : xm + o, b = s < 0 ? xm - o : x1;
    wallQuadY(c, yy, a, b, z0, z1);
    c.fillStyle = css(col, 0.95); c.fill();
    c.strokeStyle = 'rgba(20,40,60,0.35)'; c.lineWidth = 0.8;
    c.beginPath();
    for (let k = 1; k < 3; k++) { const z = z0 + ((z1 - z0) * k) / 3; c.moveTo(X(a, yy), Y(a, yy, z)); c.lineTo(X(b, yy), Y(b, yy, z)); }
    c.stroke();
    const e0 = s < 0 ? b - 0.04 : a, e1 = s < 0 ? b : a + 0.04;
    wallQuadY(c, yy, e0, e1, z0, z1);
    c.fillStyle = css(edge, 1); c.fill();
  }
}
/** Jagged energy arc between two local points. */
function bolt(g: LiveCtx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: string, a: number, w = 1.4): void {
  const c = g.ctx;
  const ax = X(x0, y0), ay = Y(x0, y0, z0), bx = X(x1, y1), by = Y(x1, y1, z1);
  const k = Math.floor(g.t * 18 + g.seed * 7);
  c.strokeStyle = col; c.globalAlpha = a; c.lineWidth = w; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(ax, ay);
  const n = 5, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < n; i++) {
    const u = i / n, j = (Math.sin(k * 12.9898 + i * 78.233) * 43758.5453) % 1;
    c.lineTo(ax + dx * u - (dy / len) * j * len * 0.16, ay + dy * u + (dx / len) * j * len * 0.16);
  }
  c.lineTo(bx, by); c.stroke();
  c.globalAlpha = 1;
}
/** Tilted rotating dish. Returns nothing; draws the reflector, rim and feed. */
function dish(g: LiveCtx, z: number, R: number, speed: number, face: RGB, back: RGB, rim: RGB, glowCol: string): void {
  const c = g.ctx;
  const th = g.on ? g.t * speed + g.seed : g.seed;
  const ph = 0.62;
  const nx = Math.cos(th) * Math.cos(ph), ny = Math.sin(th) * Math.cos(ph), nz = Math.sin(ph);
  const ux = -Math.sin(th), uy = Math.cos(th);
  const vx = -Math.cos(th) * Math.sin(ph), vy = -Math.sin(th) * Math.sin(ph), vz = Math.cos(ph);
  const front = nx + ny + nz * ((2 * PJ.hh) / PJ.z) > 0;
  const pt = (a: number, k: number, d: number): [number, number] => {
    const x = (Math.cos(a) * ux + Math.sin(a) * vx) * R * k + nx * d, y = (Math.cos(a) * uy + Math.sin(a) * vy) * R * k + ny * d, zz = z + Math.sin(a) * vz * R * k + nz * d;
    return [X(x, y), Y(x, y, zz)];
  };
  // yoke
  c.strokeStyle = css(back, 0.8); c.lineWidth = 3;
  c.beginPath(); c.moveTo(X(0, 0), Y(0, 0, z - 0.3)); c.lineTo(X(0, 0), Y(0, 0, z)); c.stroke();
  const depth = -R * 0.3;
  const ring = (k: number, d: number): void => {
    c.beginPath();
    for (let i = 0; i <= 16; i++) { const p = pt((i / 16) * Math.PI * 2, k, d); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
    c.closePath();
  };
  const lit = Math.max(0, nx * 0.18 + ny * 0.5 + nz * 0.85);
  if (front) {
    ring(1, 0); c.fillStyle = css(face, 0.6 + 0.42 * lit); c.fill();
    ring(0.62, depth * 0.55); c.fillStyle = css(face, 0.5 + 0.36 * lit); c.fill();
    ring(0.26, depth); c.fillStyle = css(face, 0.42 + 0.3 * lit); c.fill();
    // ribs
    c.strokeStyle = css(back, 0.9, 0.6); c.lineWidth = 0.9;
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const p = pt(a, 1, 0), q = pt(a, 0.26, depth); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
    c.stroke();
    ring(1, 0); c.strokeStyle = css(rim, 1); c.lineWidth = 2.4; c.stroke();
    // feed horn on a tripod
    const f = pt(0, 0, R * 0.55);
    c.strokeStyle = css(back, 0.7); c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < 3; i++) { const p = pt((i / 3) * Math.PI * 2 + 0.5, 0.8, 0); c.moveTo(p[0], p[1]); c.lineTo(f[0], f[1]); }
    c.stroke();
    c.fillStyle = css(back, 0.6); c.beginPath(); c.arc(f[0], f[1], 2.6, 0, 6.3); c.fill();
    if (g.on) g.glow(nx * R * 0.55, ny * R * 0.55, z + nz * R * 0.55, 9, glowCol, 0.8);
  } else {
    // back shell with a hub
    ring(1, 0); c.fillStyle = css(back, 0.75 + 0.3 * lit); c.fill();
    ring(0.55, depth * 0.7); c.fillStyle = css(back, 0.9 + 0.2 * lit); c.fill();
    c.strokeStyle = 'rgba(10,14,20,0.35)'; c.lineWidth = 0.9;
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const p = pt(a, 1, 0), q = pt(a, 0.55, depth * 0.7); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
    c.stroke();
    ring(1, 0); c.strokeStyle = css(rim, 0.8); c.lineWidth = 2; c.stroke();
  }
}
/** Dashed ellipse lying flat at height z (energy ring / halo). */
function halo(g: LiveCtx, x: number, y: number, z: number, r: number, col: string, a: number, w: number, spin: number, dash: number[] = [8, 7]): void {
  const c = g.ctx;
  const rx = r * PJ.hw * 1.41, ry = rx * (PJ.hh / PJ.hw);
  c.strokeStyle = col; c.globalAlpha = a; c.lineWidth = w;
  c.setLineDash(dash); c.lineDashOffset = -g.t * spin;
  c.beginPath(); c.ellipse(X(x, y), Y(x, y, z), rx, ry, 0, 0, Math.PI * 2); c.stroke();
  c.setLineDash([]); c.globalAlpha = 1;
}

export const BUILDING_ART: Record<string, BuildingArt> = {
  // ══════════════════════════════ Helion Accord ══════════════════════════════

  // Command Nexus — tiered command drum with a tall beacon spire, a fabrication bay and two assembler arms.
  h_nexus: {
    build: (m, P) => {
      hPad(m, 3, 3);
      const cx = -0.4, cy = -0.45;
      // command drum
      m.lathe(cx, cy, 0.08, [0, 1.0, 0.5, 0.96, 0.58, 0.99, 0.66, 0.99], HWHITE, 12, { tex: 'panel' }, [null, P.p, P.p]);
      m.cyl(cx, cy, 0.74, 0.88, 0.26, hex('#1c2a3a'), { sides: 12, tex: 'win', tc: HGLOW_SOFT, ts: 1.3, noRim: true });
      m.lathe(cx, cy, 1.0, [0, 0.94, 0.08, 0.9, 0.44, 0.66, 0.5, 0.72, 0.57, 0.66], HWHITE, 12, { tex: 'panel' }, [H.mid, null, GOLD, GOLD]);
      // spire
      m.lathe(cx, cy, 1.55, [0, 0.3, 0.5, 0.22, 0.56, 0.26, 0.62, 0.22, 1.0, 0.15, 1.05, 0.18, 1.1, 0.15, 1.5, 0.05], HWHITE, 8, undefined,
        [null, H.glow, null, null, H.glow, null, GOLD], [false, true, false, false, true, false, false]);
      // fabrication bay on the right flank, opening toward +y
      m.exY(arch(0.95, 0.5, 0.08, 0.42, 0.72), -1.3, 0.25, HWHITE, { tex: 'panel' });
      m.exY(arch(0.95, 0.5, 0.08, 0.42, 0.72, 7, 1.03), -0.75, -0.45, P.p);
      m.box(0.95, 0.257, 0.08, 0.7, 0.014, 0.42, hex('#16202c'));
      winY(m, 0.95, 0.262, 0.1, 0.6, 0.06, H.glow);
      winY(m, 0.95, 0.262, 0.52, 0.5, 0.06, H.glow);
      // build pad with projector ring
      m.cyl(0.5, 0.95, 0.08, 0.5, 0.05, H.deep, { sides: 10 });
      m.cyl(0.5, 0.95, 0.13, 0.42, 0.012, H.glow, { sides: 10, emis: true });
      m.cyl(0.5, 0.95, 0.142, 0.34, 0.008, H.deep, { sides: 10 });
      // assembler arms reaching over the pad
      for (const s of [-1, 1]) {
        const bx = 0.5 + s * 0.78, by = 0.95 - s * 0.05;
        m.cyl(bx, by, 0.08, 0.13, 0.2, H.mid, { sides: 8 });
        m.path([bx, by, 0.28, bx, by, 0.95, bx - s * 0.3, by, 1.22, bx - s * 0.62, by, 1.08], 0.05, HWHITE);
        m.box(bx - s * 0.62, by, 1.0, 0.1, 0.1, 0.08, H.glow, { emis: true });
        m.box(bx, by, 0.6, 0.13, 0.13, 0.1, P.p);
      }
      // banner pylons on the lit corner
      m.box(-1.22, 1.2, 0.08, 0.2, 0.2, 1.0, H.mid, { taper: 0.6 });
      m.box(-1.22, 1.2, 1.08, 0.08, 0.08, 0.06, H.glow, { emis: true });
      m.box(-1.22, 1.31, 0.4, 0.26, 0.02, 0.5, P.p);
      // rear comms mast
      mast(m, -1.25, -0.2, 0.08, 1.1, H.dark, H.glow);
      m.box(-0.5, 0.55, 0.08, 0.5, 0.3, 0.26, H.mid, { tex: 'panel' });
      winY(m, -0.5, 0.7, 0.14, 0.36, 0.1, H.glow);
    },
    live: (g) => {
      const c = g.ctx;
      const cx = -0.4, cy = -0.45;
      // floating beacon crystal + halo above the spire
      const bob = Math.sin(g.t * 1.5 + g.seed) * 0.05;
      const px = X(cx, cy), py = Y(cx, cy, 3.4 + bob);
      c.fillStyle = g.on ? '#d5fcff' : '#56616e';
      c.beginPath(); c.moveTo(px, py - 15); c.lineTo(px - 7, py); c.lineTo(px, py + 12); c.closePath(); c.fill();
      c.fillStyle = g.on ? '#4fc9dc' : '#3a434e';
      c.beginPath(); c.moveTo(px, py - 15); c.lineTo(px + 7, py); c.lineTo(px, py + 12); c.closePath(); c.fill();
      flag(g, -1.22, 1.2, 1.9, 22, 13, g.P.p);
      c.strokeStyle = css(H.dark, 1); c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(X(-1.22, 1.2), Y(-1.22, 1.2, 1.1)); c.lineTo(X(-1.22, 1.2), Y(-1.22, 1.2, 1.92)); c.stroke();
      if (!g.on) return;
      halo(g, cx, cy, 3.35 + bob, 0.34, 'rgba(116,244,255,1)', 0.6, 1.3, 16);
      halo(g, cx, cy, 2.2, 0.5, 'rgba(116,244,255,1)', 0.35, 1, -10, [5, 9]);
      g.glow(cx, cy, 3.4 + bob, 26, CYAN, 0.5 + 0.15 * Math.sin(g.t * 3));
      g.glow(cx, cy, 1.0, 46, CYAN, 0.16);
      // hologram on the build pad: a slowly turning wireframe block, brighter while the yard is busy
      const a = g.t * 0.9 + g.seed, s = 0.2, k = 0.35 + 0.4 * g.active + 0.1 * Math.sin(g.t * 4);
      c.strokeStyle = `rgba(150,248,255,${k})`; c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a0 = a + (i / 4) * Math.PI * 2, a1 = a + ((i + 1) / 4) * Math.PI * 2;
        const x0 = 0.5 + Math.cos(a0) * s, y0 = 0.95 + Math.sin(a0) * s, x1 = 0.5 + Math.cos(a1) * s, y1 = 0.95 + Math.sin(a1) * s;
        c.moveTo(X(x0, y0), Y(x0, y0, 0.3)); c.lineTo(X(x1, y1), Y(x1, y1, 0.3));
        c.moveTo(X(x0, y0), Y(x0, y0, 0.62)); c.lineTo(X(x1, y1), Y(x1, y1, 0.62));
        c.moveTo(X(x0, y0), Y(x0, y0, 0.3)); c.lineTo(X(x0, y0), Y(x0, y0, 0.62));
      }
      c.stroke();
      g.glow(0.5, 0.95, 0.4, 22, CYAN, 0.2 + 0.3 * g.active);
      for (const s2 of [-1, 1]) {
        const bx = 0.5 + s2 * 0.16;
        c.strokeStyle = `rgba(160,250,255,${0.25 + 0.45 * g.active})`; c.lineWidth = 1;
        c.beginPath(); c.moveTo(X(bx, 0.95), Y(bx, 0.95, 1.0)); c.lineTo(X(0.5, 0.95), Y(0.5, 0.95, 0.5 + 0.1 * Math.sin(g.t * 7 + s2))); c.stroke();
        g.glow(bx, 0.95, 1.0, 7, CYAN, 0.6);
      }
      if (g.active > 0 && g.chance(6)) g.spark(0.5, 0.95, 0.45, CYAN, 1);
    },
  },

  // Fusion Plant — a glowing plasma orb held inside a upright containment ring.
  h_power: {
    build: (m, P) => {
      hPad(m, 2, 2);
      m.lathe(0, 0, 0.08, [0, 0.8, 0.14, 0.8, 0.14, 0.84, 0.22, 0.84, 0.22, 0.62, 0.36, 0.44], H.mid, 12, { tex: 'panel' }, [null, null, P.p, null, HWHITE]);
      const cz = 1.02, R = 0.66;
      // containment ring in the plane facing the camera
      const k = Math.SQRT1_2;
      const N = 18;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2;
        if (Math.sin(a0) < -0.86 && Math.sin(a1) < -0.86) continue; // swallowed by the plinth
        const top = Math.sin((a0 + a1) / 2) > 0.8;
        m.bar(Math.cos(a0) * R * k, -Math.cos(a0) * R * k, cz + Math.sin(a0) * R, Math.cos(a1) * R * k, -Math.cos(a1) * R * k, cz + Math.sin(a1) * R, top ? 0.075 : 0.06, top ? P.p : HWHITE, { sides: 6 });
      }
      // field magnets on the ring's shoulders
      for (const s of [-1, 1]) {
        m.box(s * R * k, -s * R * k, cz - 0.11, 0.2, 0.2, 0.22, H.mid);
        m.box(s * R * k * 0.84, -s * R * k * 0.84, cz - 0.05, 0.08, 0.08, 0.1, H.glow, { emis: true });
      }
      // plasma orb
      m.sphere(0, 0, cz, 0.43, hex('#55c2e0'), { noRim: true }, 12, 6);
      m.cyl(0, 0, cz - 0.015, 0.436, 0.03, hex('#d8fbff'), { sides: 12, emis: true, layer: 1 });
      // coolant columns behind
      for (const [px, py, h] of [[-0.72, -0.5, 0.8], [-0.5, -0.74, 0.62]]) {
        m.lathe(px, py, 0.08, [0, 0.17, h - 0.16, 0.17, h - 0.16, 0.18, h - 0.08, 0.18, h - 0.08, 0.17, h, 0.13], HWHITE, 8, undefined, [null, null, P.p, null, H.mid]);
        m.cyl(px, py, 0.08 + h, 0.09, 0.03, H.glow, { sides: 8, emis: true });
      }
      m.box(0.66, 0.66, 0.08, 0.3, 0.3, 0.2, H.mid, { tex: 'panel' });
      winY(m, 0.66, 0.81, 0.12, 0.2, 0.08, H.glow);
    },
    live: (g) => {
      if (!g.on) return;
      const cz = 1.02;
      const p = 0.5 + 0.5 * Math.sin(g.t * 2.6 + g.seed);
      g.glow(0, 0, cz, 20 + p * 5, CYAN, 0.16 + p * 0.14);
      g.glow(0, 0, cz, 60, CYAN, 0.09);
      g.glow(0, 0, 0.1, 44, CYAN, 0.1);
      halo(g, 0, 0, cz, 0.47, 'rgba(210,252,255,1)', 0.75, 1.5, 34, [6, 10]);
      halo(g, 0, 0, cz + 0.16, 0.41, 'rgba(160,246,255,1)', 0.4, 1, -22, [4, 9]);
      const k = Math.SQRT1_2 * 0.56;
      const which = Math.floor(g.t * 2.3 + g.seed) % 4;
      if (which < 2) { const s = which ? 1 : -1; bolt(g, s * k, -s * k, cz - 0.02, s * 0.2, -s * 0.2, cz + 0.1, 'rgba(225,253,255,1)', 0.75, 1.2); }
    },
  },

  // Refinery — three white silos with ore sight-glasses behind a processing hall; harvesters unload under the scanner arch.
  h_refinery: {
    build: (m, P) => {
      hPad(m, 3, 3);
      hSilo(m, P, -0.98, -0.95, 0.4, 1.45);
      hSilo(m, P, 0, -1.0, 0.42, 1.85);
      hSilo(m, P, 0.98, -0.95, 0.4, 1.45);
      // catwalk tying the silos together
      m.box(0, -0.97, 1.2, 2.0, 0.12, 0.04, H.dark);
      // processing hall
      m.box(0, -0.12, 0.08, 2.6, 0.8, 0.62, HWHITE, { tex: 'panel' });
      m.box(0, -0.12, 0.7, 2.66, 0.86, 0.05, H.mid);
      m.box(-0.75, -0.12, 0.75, 0.8, 0.56, 0.03, P.p);
      m.box(0.75, -0.12, 0.75, 0.8, 0.56, 0.03, P.p);
      gridX(m, 1.3, -0.12, 0.3, 0.6, 0.24, HGLOW_SOFT);
      gridY(m, -0.95, 0.28, 0.34, 0.5, 0.2, HGLOW_SOFT);
      gridY(m, 0.95, 0.28, 0.34, 0.5, 0.2, HGLOW_SOFT);
      // feed pipes up to the silos
      for (const x of [-0.98, 0, 0.98]) m.path([x * 0.6, -0.2, 0.75, x * 0.6, -0.2, 1.0, x, -0.62, 1.12], 0.045, H.mid);
      m.box(0, -0.12, 0.75, 0.36, 0.36, 0.2, H.mid, { taper: 0.8 });
      // intake mouth on the hall front
      m.box(0, 0.287, 0.08, 0.9, 0.014, 0.42, hex('#141b24'));
      winY(m, 0, 0.292, 0.1, 0.8, 0.05, ORE);
      // scanner arch over the unloading pad
      for (const s of [-1, 1]) {
        m.box(s * 0.82, 0.95, 0.08, 0.2, 0.6, 0.86, HWHITE, { tex: 'panel', taper: [1, 0.8] });
        m.box(s * 0.82, 0.95, 0.94, 0.22, 0.5, 0.05, P.p);
        m.box(s * 0.7, 1.32, 0.1, 0.06, 0.06, 0.04, H.glow, { emis: true });
      }
      m.box(0, 0.95, 0.8, 1.5, 0.22, 0.12, H.mid);
      m.box(0, 0.95, 0.775, 1.2, 0.1, 0.025, ORE, { emis: true });
      // pad
      m.box(0, 0.92, 0.08, 1.36, 1.1, 0.03, H.deep, { tex: 'chev+', tc: hex('#4d5d70'), ts: 0.5 });
    },
    smoke: [[0, -1.0, 2.25, 1, 0.6]],
    live: (g) => {
      if (!g.on) return;
      const p = 0.5 + 0.5 * Math.sin(g.t * 3 + g.seed);
      const a = 0.16 + g.active * 0.6;
      for (const [x, y, z] of [[-0.98, -0.6, 0.9], [0, -0.62, 1.1], [0.98, -0.6, 0.9]]) g.glow(x, y, z, 17, MAGENTA, 0.12 + a + p * 0.08);
      // scanner sweep under the arch
      const sw = Math.sin(g.t * (1.2 + g.active * 5) + g.seed) * 0.5;
      g.glow(sw, 0.95, 0.76, 11 + g.active * 8, MAGENTA, 0.35 + g.active * 0.6);
      g.glow(0, 0.3, 0.2, 20 + g.active * 14, MAGENTA, 0.2 + g.active * 0.55);
      chase(g, [[-0.7, 1.32, 0.12], [-0.7, 0.95, 0.12], [-0.7, 0.6, 0.12], [0.7, 0.6, 0.12], [0.7, 0.95, 0.12], [0.7, 1.32, 0.12]], CYAN, 3 + g.active * 8, 7);
      if (g.active > 0.1) {
        // ore stream climbing the feed pipes
        for (let i = 0; i < 3; i++) {
          const u = (g.t * 1.6 + i / 3) % 1, x = (i - 1) * 0.98;
          g.glow(x * (0.6 + 0.4 * u), -0.2 - 0.42 * u, 0.8 + 0.34 * u, 6, MAGENTA, g.active);
        }
        if (g.chance(10)) g.spark((Math.random() - 0.5) * 0.8, 0.45, 0.2, MAGENTA, 1);
      }
    },
  },

  // Training Camp — angular wedge hall behind a gate flanked by two tall banner pylons, fenced parade yard, flag mast.
  h_barracks: {
    build: (m, P) => {
      hPad(m, 2, 2);
      // wedge hall: the roof climbs from the right eave to a ridge on the left
      const prof = (k = 1): number[] => [-0.8, 0, 0.56, 0, 0.56, 0.34, -0.34, 1.02, -0.8, 0.76].map((v, i) => (i % 2 === 0 ? -0.12 + (v + 0.12) * k : 0.08 + v * k));
      m.exY(prof(), -0.92, 0.36, HWHITE, { tex: 'panel' });
      m.exY(prof(1.03), -0.74, -0.04, P.p);
      m.exY(prof(1.035), 0.24, 0.38, H.dark);
      // gate
      m.box(-0.12, 0.387, 0.08, 0.5, 0.014, 0.44, hex('#12202e'));
      winY(m, -0.12, 0.392, 0.1, 0.4, 0.38, hex('#8fe6f5'));
      m.box(-0.12, 0.42, 0.54, 0.62, 0.1, 0.035, P.p);
      winY(m, -0.3, 0.387, 0.66, 0.5, 0.07, H.glow);
      // banner pylons flanking the gate
      for (const x of [-0.68, 0.44]) {
        m.box(x, 0.64, 0.08, 0.16, 0.16, 1.5, H.mid, { taper: 0.45 });
        m.box(x, 0.64, 1.58, 0.07, 0.07, 0.07, H.glow, { emis: true });
        m.box(x, 0.73, 0.72, 0.22, 0.02, 0.66, P.p);
        m.box(x, 0.735, 0.72, 0.22, 0.012, 0.06, HWHITE);
      }
      // parade yard + fence posts
      m.box(0.02, 0.69, 0.08, 1.74, 0.54, 0.02, H.deep, { tex: 'panel+', ts: 1.6 });
      for (const [px, py] of [[-0.9, 0.94], [0.9, 0.94], [0.9, 0.46]]) {
        m.cyl(px, py, 0.08, 0.035, 0.3, H.mid, { sides: 6 });
        m.box(px, py, 0.38, 0.05, 0.05, 0.04, H.glow, { emis: true });
      }
      // quartermaster annex + flag mast at the back
      m.box(0.76, -0.2, 0.08, 0.36, 0.7, 0.3, H.mid, { tex: 'panel' });
      gridX(m, 0.94, -0.2, 0.14, 0.56, 0.12, HGLOW_SOFT);
      m.cyl(0.76, -0.72, 0.08, 0.08, 0.14, H.mid, { sides: 6 });
      m.bar(0.76, -0.72, 0.22, 0.76, -0.72, 2.05, 0.018, H.dark);
    },
    live: (g) => {
      const c = g.ctx;
      flag(g, 0.76, -0.72, 2.03, 26, 15, g.P.p);
      splitDoor(g, 0.4, -0.32, 0.08, 0.1, 0.48, hex('#cfe9f3'), H.glow);
      if (!g.on) return;
      // energy fence around the yard (gap at the gate)
      c.strokeStyle = 'rgba(116,244,255,0.5)'; c.lineWidth = 1;
      c.setLineDash([3, 3]); c.lineDashOffset = -g.t * 9;
      c.beginPath();
      for (const zz of [0.2, 0.32]) {
        c.moveTo(X(-0.9, 0.94), Y(-0.9, 0.94, zz)); c.lineTo(X(-0.68, 0.94), Y(-0.68, 0.94, zz));
        c.moveTo(X(0.44, 0.94), Y(0.44, 0.94, zz)); c.lineTo(X(0.9, 0.94), Y(0.9, 0.94, zz)); c.lineTo(X(0.9, 0.46), Y(0.9, 0.46, zz));
      }
      c.stroke(); c.setLineDash([]);
      g.glow(-0.12, 0.45, 0.3, 16 + g.door * 12, CYAN, 0.3 + g.door * 0.4);
      lightsBlink(g, [[-0.68, 0.64, 1.64], [0.44, 0.64, 1.64]], CYAN, 3, 8);
    },
  },

  // Vehicle Bay — dark-roofed arched hangar with a wide sliding door, a tall glass control tower, a roof manipulator arm and a gantry over the exit apron.
  h_factory: {
    build: (m, P) => {
      hPad(m, 3, 3);
      const prof = (k = 1): number[] => arch(0, 1.05, 0.08, 0.6, 1.2, 9, k);
      m.exY(prof(), -1.4, 0.7, HSLATE, { tex: 'panel' });
      m.exY(prof(1.02), -1.4, -1.26, HWHITE);
      m.exY(prof(1.02), -0.92, -0.8, HWHITE);
      m.exY(prof(1.025), -0.56, -0.1, P.p);
      m.exY(prof(1.02), 0.14, 0.26, HWHITE);
      m.exY(prof(1.03), 0.54, 0.72, HWHITE);
      // bay opening + header lights
      m.box(0, 0.707, 0.08, 1.5, 0.014, 0.64, hex('#0f1720'));
      winY(m, 0, 0.712, 0.09, 1.4, 0.05, H.glow);
      m.box(0, 0.73, 0.72, 1.66, 0.06, 0.09, P.p);
      winY(m, 0, 0.707, 0.88, 0.9, 0.09, HGLOW_SOFT);
      // exit apron
      m.box(0, 1.1, 0.08, 1.66, 0.76, 0.03, H.deep, { tex: 'chev+', tc: hex('#536478'), ts: 0.45 });
      for (const s of [-1, 1]) for (const y of [0.82, 1.1, 1.38]) m.box(s * 0.86, y, 0.1, 0.06, 0.06, 0.035, H.glow, { emis: true });
      // gantry over the apron
      for (const s of [-1, 1]) {
        m.bar(s * 1.04, 1.36, 0.08, s * 1.04, 1.36, 1.34, 0.05, HWHITE);
        m.bar(s * 1.04, 1.36, 0.95, s * 0.76, 1.36, 1.32, 0.03, H.mid);
      }
      m.box(0, 1.36, 1.3, 2.2, 0.12, 0.12, H.mid);
      m.box(0, 1.36, 1.42, 0.8, 0.14, 0.04, P.p);
      // control tower
      m.box(1.28, -1.0, 0.08, 0.36, 0.5, 1.9, HWHITE, { tex: 'panel' });
      m.box(1.28, -1.0, 0.9, 0.38, 0.52, 0.1, P.p);
      m.box(1.28, -1.0, 1.98, 0.5, 0.64, 0.24, GLASS, { tex: 'glass', taper: 1.14 });
      m.box(1.28, -1.0, 2.22, 0.62, 0.78, 0.05, P.p);
      mast(m, 1.28, -1.0, 2.27, 0.5, H.dark, hex('#ff6a58'));
      // manipulator arm parked on the roof
      m.cyl(-0.55, -0.7, 1.16, 0.14, 0.1, H.dark, { sides: 8 });
      m.path([-0.55, -0.7, 1.26, -0.55, -0.7, 1.72, -0.2, -0.25, 1.95, 0.12, 0.12, 1.62], 0.055, HWHITE);
      m.box(-0.55, -0.7, 1.7, 0.13, 0.13, 0.1, P.p);
      m.box(0.12, 0.12, 1.5, 0.12, 0.12, 0.12, H.glow, { emis: true });
      // coolant annex with capsule tanks
      m.box(1.28, 0.05, 0.08, 0.36, 1.1, 0.4, H.mid, { tex: 'panel' });
      for (const y of [-0.25, 0.3]) {
        m.exX(ngon(y, 0.62, 0.15, 8), 1.12, 1.44, HWHITE);
        m.exX(ngon(y, 0.62, 0.16, 8), 1.24, 1.32, P.p);
      }
      m.box(-1.28, -0.4, 0.08, 0.3, 1.2, 0.3, H.mid, { tex: 'panel' });
    },
    live: (g) => {
      const c = g.ctx;
      splitDoor(g, 0.715, -0.72, 0.72, 0.1, 0.7, hex('#dfe7ee'), H.glow);
      // gantry trolley
      const tx = g.on ? Math.sin(g.t * (0.5 + g.active * 1.4) + g.seed) * 0.7 : 0.3;
      c.fillStyle = css(H.dark, 1);
      c.beginPath(); c.moveTo(X(tx - 0.1, 1.36), Y(tx - 0.1, 1.36, 1.3)); c.lineTo(X(tx + 0.1, 1.36), Y(tx + 0.1, 1.36, 1.3)); c.lineTo(X(tx + 0.1, 1.36), Y(tx + 0.1, 1.36, 1.18)); c.lineTo(X(tx - 0.1, 1.36), Y(tx - 0.1, 1.36, 1.18)); c.closePath(); c.fill();
      if (!g.on) return;
      const p = 0.5 + 0.5 * Math.sin(g.t * 5 + g.seed);
      g.glow(tx, 1.36, 1.14, 7, CYAN, 0.8);
      g.glow(0, 0.75, 0.36, 40, CYAN, 0.1 + g.door * 0.5 + g.active * (0.12 + p * 0.14));
      g.glow(1.28, -1.0, 2.8, 7, RED, 0.3 + p * 0.5);
      g.glow(0.12, 0.12, 1.5, 10, CYAN, 0.4 + 0.4 * g.active * p);
      const lights: number[][] = [];
      for (const y of [0.82, 1.1, 1.38]) lights.push([-0.86, y, 0.13]);
      for (const y of [1.38, 1.1, 0.82]) lights.push([0.86, y, 0.13]);
      chase(g, lights, CYAN, 4 + g.door * 8, 7);
      if (g.active > 0 && g.chance(5)) g.spark((Math.random() - 0.5) * 1.2, 0.74, 0.3 + Math.random() * 0.3, CYAN, 1);
    },
  },

  // Sensor Array — one big tracking dish on a slim mast above a ring of operator windows.
  h_radar: {
    build: (m, P) => {
      hPad(m, 2, 2);
      m.cyl(0, 0, 0.08, 0.7, 0.3, HWHITE, { sides: 12, taper: 0.95, tex: 'panel' });
      m.cyl(0, 0, 0.38, 0.6, 0.18, hex('#1b2836'), { sides: 12, tex: 'win', tc: HGLOW_SOFT, ts: 1.4, noRim: true });
      m.lathe(0, 0, 0.56, [0, 0.7, 0.07, 0.66, 0.14, 0.3, 0.72, 0.2, 0.72, 0.25, 0.82, 0.25, 0.82, 0.18, 1.2, 0.13, 1.26, 0.2], HWHITE, 12, { tex: 'panel' },
        [P.p, H.mid, null, null, P.p, null, null, H.dark]);
      // outriggers with aerials
      for (const [px, py, h] of [[0.72, 0.72, 0.5], [-0.74, 0.72, 0.8], [0.72, -0.74, 0.65]]) {
        m.box(px, py, 0.08, 0.26, 0.26, 0.2, H.mid, { taper: 0.8 });
        mast(m, px, py, 0.28, h, H.dark, H.glow);
      }
    },
    live: (g) => {
      dish(g, 2.02, 0.74, 1.0, HWHITE, H.mid, g.P.p, CYAN);
      if (!g.on) return;
      lightsBlink(g, [[0.72, 0.72, 0.84], [-0.74, 0.72, 1.14], [0.72, -0.74, 0.99]], CYAN, 4, 8);
      g.glow(0, 0, 0.5, 34, CYAN, 0.14);
      // expanding ping
      const u = (g.t * 0.45 + g.seed) % 1;
      halo(g, 0, 0, 0.1, 0.4 + u * 1.3, 'rgba(116,244,255,1)', 0.3 * (1 - u), 1.2, 0, [1, 0]);
    },
  },

  // Flight Deck — raised landing platform with a marked pad, chasing edge lights and a flared control tower.
  h_airpad: {
    build: (m, P) => {
      hPad(m, 3, 2);
      m.box(0.32, 0, 0.08, 2.2, 1.8, 0.2, H.mid, { tex: 'panel', taper: [0.97, 0.96] });
      m.box(0.32, 0, 0.28, 2.08, 1.68, 0.02, H.deep, { tex: 'panel+', ts: 0.5 });
      m.cyl(0.32, 0, 0.3, 0.72, 0.006, P.p, { sides: 14 });
      m.cyl(0.32, 0, 0.306, 0.6, 0.005, H.deep, { sides: 14 });
      m.cyl(0.32, 0, 0.311, 0.2, 0.005, P.p, { sides: 3, rot: 0.26 });
      for (const [px, py] of [[-0.66, -0.78], [0.32, -0.78], [1.3, -0.78], [1.3, 0], [1.3, 0.78], [0.32, 0.78], [-0.66, 0.78]]) m.box(px, py, 0.3, 0.06, 0.06, 0.03, H.glow, { emis: true });
      // tower
      m.box(-1.2, -0.62, 0.08, 0.34, 0.34, 1.12, HWHITE, { tex: 'panel' });
      m.box(-1.2, -0.62, 0.72, 0.36, 0.36, 0.08, P.p);
      m.box(-1.2, -0.62, 1.2, 0.44, 0.44, 0.24, GLASS, { tex: 'glass', taper: 1.3 });
      m.box(-1.2, -0.62, 1.44, 0.64, 0.64, 0.05, P.p);
      m.cyl(-1.2, -0.62, 1.49, 0.06, 0.14, H.dark, { sides: 6 });
      // service block with a charging bay facing the deck
      m.box(-1.2, 0.4, 0.08, 0.44, 0.9, 0.46, H.mid, { tex: 'panel' });
      m.box(-1.2, 0.4, 0.54, 0.34, 0.7, 0.03, P.p);
      winX(m, -0.98, 0.4, 0.14, 0.6, 0.22, hex('#8fe6f5'));
      for (const y of [0.16, 0.64]) m.lathe(-0.88, y, 0.08, [0, 0.07, 0.3, 0.07, 0.3, 0.08, 0.36, 0.08, 0.36, 0.05, 0.42, 0.03], HWHITE, 8, undefined, [null, null, H.glow], [false, false, true]);
    },
    live: (g) => {
      spinner(g, -1.2, -0.62, 1.66, 0.24, 3.2, HWHITE);
      if (!g.on) return;
      chase(g, [[-0.66, -0.78, 0.33], [0.32, -0.78, 0.33], [1.3, -0.78, 0.33], [1.3, 0, 0.33], [1.3, 0.78, 0.33], [0.32, 0.78, 0.33], [-0.66, 0.78, 0.33]], CYAN, 6 + g.door * 6, 8);
      g.glow(-1.2, -0.62, 1.7, 6, RED, 0.4 + 0.4 * Math.sin(g.t * 4));
      g.glow(0.32, 0, 0.32, 40, CYAN, 0.08 + 0.3 * g.door + 0.1 * g.active);
      g.glow(-0.96, 0.4, 0.26, 14, CYAN, 0.35);
    },
  },

  // Tech Lab — one big faceted glass dome over a glowing reactor column, a low research block and a tall antenna farm.
  h_lab: {
    build: (m, P) => {
      hPad(m, 3, 2);
      // research block (kept low so the dome dominates)
      m.box(-1.0, -0.42, 0.08, 0.84, 0.96, 0.58, HWHITE, { tex: 'panel' });
      m.box(-1.0, -0.42, 0.66, 0.9, 1.02, 0.05, H.mid);
      m.box(-1.0, -0.42, 0.71, 0.6, 0.7, 0.03, P.p);
      gridY(m, -1.0, 0.06, 0.2, 0.7, 0.3, HGLOW_SOFT, 1.1);
      mast(m, -1.26, -0.76, 0.74, 1.45, H.dark, H.glow);
      mast(m, -1.02, -0.8, 0.74, 1.0, H.dark, H.glow);
      mast(m, -1.28, -0.46, 0.74, 0.65, H.dark, hex('#ff6a58'));
      m.bar(-1.26, -0.76, 1.7, -1.02, -0.8, 1.5, 0.01, H.dark);
      m.cyl(-0.76, -0.6, 0.74, 0.05, 0.12, H.dark, { sides: 6 });
      m.cyl(-0.76, -0.6, 0.86, 0.07, 0.09, HWHITE, { sides: 8, taper: 2.8 });
      // small observatory dome
      m.cyl(-1.02, 0.62, 0.08, 0.3, 0.2, H.mid, { sides: 10 });
      m.dome(-1.02, 0.62, 0.28, 0.28, 0.28, HWHITE, { sides: 10 });
      // main dome
      const dx = 0.46, dy = 0.02;
      m.lathe(dx, dy, 0.08, [0, 0.96, 0.2, 0.92, 0.2, 0.96, 0.27, 0.96, 0.27, 0.86, 0.31, 0.86], H.mid, 12, { tex: 'panel' }, [null, null, P.p, null, H.glow], [false, false, false, false, true]);
      m.cyl(dx, dy, 0.39, 0.6, 0.02, H.deep, { sides: 12 });
      m.lathe(dx, dy, 0.41, [0, 0.18, 0.08, 0.08, 0.86, 0.08, 0.96, 0.15, 1.0, 0.05], H.mid, 8, undefined, [null, H.glow, null, H.glow], [false, true, false, true]);
      // geodesic glass shell (see-through)
      const steps = 5, R = 0.82, Hh = 1.12;
      for (let i = 0; i < steps; i++) {
        const a0 = (i / steps) * (Math.PI / 2), a1 = ((i + 1) / steps) * (Math.PI / 2);
        const r0 = Math.cos(a0) * R, r1 = Math.max(0.07, Math.cos(a1) * R);
        m.cyl(dx, dy, 0.39 + Math.sin(a0) * Hh, r0, (Math.sin(a1) - Math.sin(a0)) * Hh, GLASS_L, { sides: 12, taper: r1 / r0, alpha: 0.46, tex: 'glass', ts: 0.5, layer: 1, noRim: true });
      }
      m.cyl(dx, dy, 0.39 + Hh, 0.09, 0.06, P.p, { sides: 8, layer: 1 });
    },
    live: (g) => {
      if (!g.on) return;
      const dx = 0.46, dy = 0.02;
      halo(g, dx, dy, 1.76, 0.36, 'rgba(116,244,255,1)', 0.7, 1.4, 22, [10, 6]);
      halo(g, dx, dy, 1.94, 0.22, 'rgba(116,244,255,1)', 0.7, 1.2, -16, [6, 5]);
      const p = 0.5 + 0.5 * Math.sin(g.t * 2.2 + g.seed);
      g.glow(dx, dy, 0.9, 22 + p * 5, CYAN, 0.12 + 0.1 * p);
      g.glow(dx, dy, 0.6, 66, CYAN, 0.1);
      // pulse travelling up the reactor column
      const u = (g.t * 0.8 + g.seed) % 1;
      g.glow(dx, dy, 0.45 + u * 0.9, 9, WHITE, 0.7 * (1 - u));
      lightsBlink(g, [[-1.26, -0.76, 2.24], [-1.02, -0.8, 1.79]], CYAN, 3.4, 7);
      g.glow(-1.28, -0.46, 1.44, 6, RED, 0.3 + 0.5 * Math.sin(g.t * 5 + 1));
    },
  },

  // Orbital Uplink — superweapon: a towering lance spire ringed by four focusing blades; its bands light as it charges.
  h_uplink: {
    build: (m, P) => {
      hPad(m, 3, 3);
      m.lathe(0, 0, 0.08, [0, 1.36, 0.14, 1.32, 0.14, 1.02, 0.3, 0.98, 0.3, 1.04, 0.38, 1.04, 0.38, 0.7, 0.46, 0.6], H.mid, 12, { tex: 'panel' }, [null, null, HWHITE, null, P.p, null, H.dark]);
      m.cyl(0, 0, 0.22, 1.2, 0.012, H.glow, { sides: 12, emis: true });
      m.cyl(0, 0, 0.232, 1.1, 0.008, H.mid, { sides: 12 });
      // lance spire
      m.lathe(0, 0, 0.54, [0, 0.5, 0.5, 0.4, 0.5, 0.44, 0.6, 0.44, 0.6, 0.38, 1.24, 0.3, 1.24, 0.34, 1.34, 0.34, 1.34, 0.28, 1.98, 0.21, 1.98, 0.25, 2.08, 0.25, 2.08, 0.19, 2.7, 0.12, 2.7, 0.15, 2.78, 0.15, 2.78, 0.1, 3.25, 0.02], HWHITE, 10, { tex: 'panel', ts: 0.8 },
        [null, null, H.glow, null, null, null, H.glow, null, null, null, H.glow, null, null, null, H.glow, null, H.mid],
        [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false, false]);
      // focusing blades
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a);
        m.box(cx * 1.14, sy * 1.14, 0.22, 0.34, 0.34, 0.2, H.mid, { rot: a });
        m.bar(cx * 1.14, sy * 1.14, 0.4, cx * 1.1, sy * 1.1, 1.2, 0.13, HWHITE, { taper: 0.85 });
        m.bar(cx * 1.1, sy * 1.1, 1.2, cx * 1.0, sy * 1.0, 1.6, 0.115, P.p, { taper: 0.9 });
        m.bar(cx * 1.0, sy * 1.0, 1.6, cx * 0.72, sy * 0.72, 2.25, 0.1, HWHITE, { taper: 0.7 });
        m.bar(cx * 0.72, sy * 0.72, 2.25, cx * 0.5, sy * 0.5, 2.6, 0.07, H.mid, { taper: 0.5 });
        m.box(cx * 0.5, sy * 0.5, 2.6, 0.08, 0.08, 0.08, H.glow, { emis: true });
      }
    },
    live: (g) => {
      if (!g.on) return;
      const c = g.ctx;
      const ch = g.charge;
      const p = 0.5 + 0.5 * Math.sin(g.t * (2 + ch * 7) + g.seed);
      const bands = [1.09, 1.83, 2.57, 3.28];
      for (let i = 0; i < 4; i++) {
        const lit = ch >= (i + 1) / 4 - 0.02 ? 1 : ch > i / 4 ? 0.35 + 0.4 * p : 0.12;
        g.glow(0, 0, bands[i], 20 - i * 3, CYAN, lit * 0.8);
      }
      g.glow(0, 0, 0.3, 70, CYAN, 0.1 + ch * 0.14);
      halo(g, 0, 0, 0.24, 1.15, 'rgba(116,244,255,1)', 0.25 + ch * 0.4, 1.4, 20 + ch * 60, [14, 10]);
      // rings climbing the spire, faster as it charges
      for (let i = 0; i < 3; i++) {
        const u = (g.t * (0.25 + ch * 0.6) + i / 3 + g.seed) % 1;
        halo(g, 0, 0, 0.7 + u * 2.9, 0.5 - u * 0.36, 'rgba(190,252,255,1)', (0.2 + ch * 0.6) * Math.sin(u * Math.PI), 1.2, 0, [1, 0]);
      }
      if (ch > 0.5) {
        const k = Math.floor(g.t * 6 + g.seed) % 4, a = (k / 4) * Math.PI * 2;
        bolt(g, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 2.68, 0, 0, 3.3 + Math.sin(g.t * 9) * 0.2, 'rgba(215,253,255,1)', (ch - 0.5) * 1.6, 1.3);
      }
      g.glow(0, 0, 3.8, 12 + ch * 30 + p * 6, CYAN, 0.25 + ch * 0.6);
      if (ch >= 1) {
        const gr = c.createLinearGradient(0, Y(0, 0, 3.8), 0, Y(0, 0, 7));
        gr.addColorStop(0, 'rgba(200,253,255,0.8)'); gr.addColorStop(1, 'rgba(200,253,255,0)');
        c.strokeStyle = gr; c.lineWidth = 2.5 + p * 2;
        c.beginPath(); c.moveTo(0, Y(0, 0, 3.8)); c.lineTo(0, Y(0, 0, 7)); c.stroke();
        g.glow(0, 0, 3.8, 50, WHITE, 0.3 + 0.2 * p);
      }
    },
  },

  h_wall: {
    build: (m, P, mask) => {
      const arm = (dx: number, dy: number): void => {
        const lx = dx ? 0.5 : 0.2, ly = dy ? 0.5 : 0.2;
        m.box(dx * 0.26, dy * 0.26, 0, lx, ly, 0.38, HWHITE, { tex: 'panel', ts: 1.4 });
        m.box(dx * 0.26, dy * 0.26, 0.38, dx ? 0.5 : 0.08, dy ? 0.5 : 0.08, 0.025, H.glow, { emis: true });
      };
      if (mask & 1) arm(0, -1);
      if (mask & 2) arm(1, 0);
      if (mask & 4) arm(0, 1);
      if (mask & 8) arm(-1, 0);
      m.cyl(0, 0, 0, 0.23, 0.46, H.mid, { sides: 6, taper: 0.9 });
      m.cyl(0, 0, 0.46, 0.21, 0.05, P.p, { sides: 6, taper: 0.7 });
    },
  },

  // Sentry Gun — squat twin autocannon on a tripod base.
  h_sentry: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.44, 0.08, HPAD, { sides: 6 });
      for (let i = 0; i < 3; i++) { const a = Math.PI / 6 + (i / 3) * Math.PI * 2; m.bar(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.08, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.3, 0.05, H.mid); }
      m.cyl(0, 0, 0.08, 0.22, 0.24, HWHITE, { sides: 8, taper: 0.8 });
      m.cyl(0, 0, 0.32, 0.26, 0.04, P.p, { sides: 8 });
    },
    turret: (m, P) => {
      m.box(-0.02, 0, 0, 0.32, 0.28, 0.16, HWHITE, { taper: [0.8, 0.85] });
      m.box(-0.06, 0, 0.16, 0.16, 0.18, 0.02, P.p);
      m.bar(0.08, -0.08, 0.075, 0.54, -0.08, 0.075, 0.024, H.gun);
      m.bar(0.08, 0.08, 0.075, 0.54, 0.08, 0.075, 0.024, H.gun);
      m.box(0.145, 0, 0.09, 0.012, 0.08, 0.04, H.glow, { emis: true });
      m.box(-0.2, 0, 0.02, 0.08, 0.2, 0.1, H.mid);
    },
    pivot: [0, 0, 0.36], muzzles: [[0.56, -0.08, 0.075], [0.56, 0.08, 0.075]], recoil: 0.03, flash: 9,
  },

  // Skyshield — twin tilted missile racks either side of a tracking pedestal.
  h_skyshield: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.46, 0.08, HPAD, { sides: 8 });
      m.cyl(0, 0, 0.08, 0.36, 0.12, H.mid, { sides: 8, taper: 0.85 });
      m.cyl(0, 0, 0.2, 0.3, 0.035, P.p, { sides: 8 });
      m.cyl(0, 0, 0.235, 0.15, 0.26, HWHITE, { sides: 8, taper: 0.8 });
    },
    turret: (m, P) => {
      m.box(0, 0, 0, 0.16, 0.22, 0.14, H.mid);
      for (const s of [-1, 1]) {
        m.bar(-0.18, s * 0.2, 0.04, 0.16, s * 0.2, 0.34, 0.1, HWHITE, { sides: 4 });
        m.bar(0.16, s * 0.2, 0.34, 0.19, s * 0.2, 0.367, 0.075, H.glow, { sides: 4, emis: true });
        m.box(-0.03, s * 0.2, 0.27, 0.11, 0.11, 0.02, P.p);
      }
      m.bar(0, 0, 0.14, 0, 0, 0.44, 0.012, H.dark);
      m.cyl(0, 0, 0.44, 0.07, 0.03, HWHITE, { sides: 8, taper: 0.3 });
    },
    pivot: [0, 0, 0.5], muzzles: [[0.2, -0.2, 0.37], [0.2, 0.2, 0.37]], recoil: 0.02, flash: 11,
  },

  // Railgun Turret — long twin-rail accelerator on a capacitor drum.
  h_railturret: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.47, 0.08, HPAD, { sides: 8 });
      m.lathe(0, 0, 0.08, [0, 0.42, 0.12, 0.4, 0.12, 0.43, 0.17, 0.43, 0.17, 0.36, 0.34, 0.3, 0.34, 0.33, 0.39, 0.33], HWHITE, 8, undefined, [null, null, H.glow, null, null, null, P.p], [false, false, true]);
      // tall capacitor fins behind the gun
      for (const [px, py] of [[-0.36, -0.14], [-0.14, -0.36]]) {
        m.box(px, py, 0.08, 0.11, 0.11, 0.72, H.mid, { taper: 0.55 });
        m.box(px, py, 0.8, 0.06, 0.06, 0.07, H.glow, { emis: true });
      }
    },
    turret: (m, P) => {
      m.poly([-0.32, -0.19, 0.08, -0.19, 0.2, -0.1, 0.2, 0.1, 0.08, 0.19, -0.32, 0.19], 0, 0.18, HWHITE, { taper: 0.85 });
      m.box(-0.15, 0, 0.18, 0.24, 0.22, 0.02, P.p);
      m.bar(0.12, -0.075, 0.095, 0.96, -0.055, 0.095, 0.03, HWHITE);
      m.bar(0.12, 0.075, 0.095, 0.96, 0.055, 0.095, 0.03, HWHITE);
      m.bar(0.16, 0, 0.095, 0.9, 0, 0.095, 0.016, H.glow, { emis: true });
      m.box(0.46, 0, 0.05, 0.05, 0.19, 0.09, H.dark);
      m.box(0.76, 0, 0.055, 0.04, 0.16, 0.08, H.dark);
      m.box(-0.28, 0, 0.18, 0.08, 0.28, 0.06, H.glow, { emis: true });
    },
    pivot: [0, 0, 0.47], muzzles: [[1.0, 0, 0.095]], recoil: 0.08, flash: 18,
  },

  // ══════════════════════════════ Ferrum Syndicate ══════════════════════════════

  // Foundry Core — blast furnace pouring into a casting pit, three stacks, a machine hall and a slewing tower crane.
  f_core: {
    build: (m, P) => {
      fPad(m, 3, 3);
      const fx = -0.6, fy = -0.6;
      stack(m, -1.25, -0.1, 0.07, 0.15, 2.35);
      stack(m, -0.05, -1.27, 0.07, 0.17, 2.8);
      stack(m, -1.2, -1.2, 0.07, 0.13, 2.0, F.dark);
      // furnace shell
      m.lathe(fx, fy, 0.07, [0, 0.8, 0.24, 0.8, 0.3, 0.72, 0.98, 0.66, 0.98, 0.71, 1.1, 0.71, 1.1, 0.64, 1.5, 0.44, 1.86, 0.36, 1.86, 0.42, 1.98, 0.42], RUST, 10, { tex: 'plate' },
        [F.dark, null, null, null, F.hazard, null, RUST_D, null, null, SOOT]);
      m.cyl(fx, fy, 2.05, 0.34, 0.012, MOLTEN, { sides: 10, emis: true });
      // gas downcomer to the tall stack
      m.path([fx, fy, 2.0, -0.3, -0.95, 2.25, -0.05, -1.27, 2.05], 0.07, F.dark, { sides: 6 });
      // hearth mouth facing the yard
      m.box(fx, 0.2, 0.07, 0.6, 0.3, 0.52, SOOT);
      winY(m, fx, 0.35, 0.14, 0.42, 0.3, MOLTEN);
      m.box(fx, 0.36, 0.5, 0.7, 0.04, 0.08, F.hazard, { tex: 'hazard' });
      // slag runner into the casting pit
      m.box(fx, 0.72, 0.07, 0.14, 0.5, 0.03, MOLTEN, { emis: true });
      m.box(fx, 1.14, 0.07, 0.56, 0.42, 0.1, SOOT);
      m.box(fx, 1.14, 0.17, 0.42, 0.28, 0.012, MOLTEN, { emis: true });
      // machine hall
      m.box(0.86, -0.4, 0.07, 1.06, 1.7, 0.78, FIRON, { tex: 'plate' });
      m.box(0.86, -0.4, 0.85, 1.12, 1.76, 0.05, F.dark);
      m.box(0.86, -0.82, 0.9, 0.76, 0.62, 0.03, P.p);
      m.box(0.86, 0.02, 0.9, 0.76, 0.62, 0.03, P.p);
      gridX(m, 1.39, -0.4, 0.34, 1.4, 0.3, FWIN, 0.9, WALL_F);
      m.box(0.86, 0.457, 0.07, 0.6, 0.014, 0.5, SOOT);
      winY(m, 0.86, 0.462, 0.09, 0.5, 0.1, F.glow);
      m.box(1.4, -1.0, 0.24, 0.02, 0.26, 0.44, P.p);
      m.box(1.4, 0.2, 0.24, 0.02, 0.26, 0.44, P.p);
      // tower crane mast in the yard
      lattice(m, 1.08, 1.1, 0.07, 2.0, 0.11, 0.11, F.hazard, 5, 0.022);
      m.box(1.08, 1.1, 2.0, 0.3, 0.3, 0.14, F.dark);
      m.box(1.08, 1.1, 2.14, 0.22, 0.22, 0.14, RUST);
      winY(m, 1.08, 1.21, 2.17, 0.14, 0.08, FWIN);
      // yard stock
      for (let i = 0; i < 3; i++) m.box(0.25, 0.9 + i * 0.13, 0.07, 0.7, 0.1, 0.07, F.steel);
      m.box(0.25, 0.96, 0.14, 0.7, 0.1, 0.07, F.steel);
      crate(m, 0.2, 1.3, 0.07, 0.24, RUST_D);
      m.cyl(-1.25, 0.6, 0.07, 0.1, 0.24, F.hazard, { sides: 8 });
      m.cyl(-1.25, 0.84, 0.07, 0.1, 0.24, RUST, { sides: 8 });
    },
    smoke: [[-1.25, -0.1, 2.45, 2, 1], [-0.05, -1.27, 2.9, 2, 1.2], [-1.2, -1.2, 2.1, 0, 0.8]],
    live: (g) => {
      const c = g.ctx;
      // slewing crane jib
      const a = g.on ? Math.sin(g.t * 0.22 + g.seed) * 1.5 + 2.4 : 2.2;
      const jx = Math.cos(a), jy = Math.sin(a);
      const bx = 1.08, by = 1.1, bz = 2.3;
      const P3 = (k: number, dz: number): [number, number] => [X(bx + jx * k, by + jy * k), Y(bx + jx * k, by + jy * k, bz + dz)];
      const tip = P3(1.5, 0), tail = P3(-0.55, 0), apex = P3(0, 0.34);
      c.strokeStyle = css(F.hazard, 0.9); c.lineWidth = 2.6;
      c.beginPath(); c.moveTo(tail[0], tail[1]); c.lineTo(tip[0], tip[1]); c.stroke();
      c.strokeStyle = css(F.black, 1); c.lineWidth = 1;
      c.beginPath(); c.moveTo(tail[0], tail[1]); c.lineTo(apex[0], apex[1]); c.lineTo(tip[0], tip[1]);
      const m0 = P3(0, 0); c.moveTo(m0[0], m0[1]); c.lineTo(apex[0], apex[1]);
      // trolley + hook
      const k = 0.9 + 0.4 * Math.sin(g.t * 0.31 + g.seed * 2);
      const h0 = P3(k, 0), h1 = P3(k, -(0.9 + 0.3 * Math.sin(g.t * 0.4 + g.seed)));
      c.moveTo(h0[0], h0[1]); c.lineTo(h1[0], h1[1]);
      c.stroke();
      c.fillStyle = css(F.steel, 0.9); c.fillRect(h1[0] - 4, h1[1], 8, 5);
      c.fillStyle = css(F.dark, 1);
      const cw = P3(-0.5, -0.02); c.fillRect(cw[0] - 5, cw[1], 10, 8);
      flag(g, 1.08, 1.1, 2.86, 22, 13, g.P.p);
      c.strokeStyle = css(F.black, 1); c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(X(bx, by), Y(bx, by, 2.28)); c.lineTo(X(bx, by), Y(bx, by, 2.88)); c.stroke();
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(-0.6, 0.42, 0.3, 30, ORANGE, 0.55 * f);
      g.glow(-0.6, 0.8, 0.1, 16, YELLOW, 0.5 * f);
      g.glow(-0.6, 1.14, 0.2, 26, ORANGE, 0.5 * f);
      g.glow(-0.6, -0.6, 2.1, 30, ORANGE, 0.45 * f);
      g.glow(0.86, 0.5, 0.2, 18, ORANGE, 0.3);
      if (g.chance(5)) g.spark(-0.6, 1.14, 0.2, YELLOW, 1);
      if (g.chance(1.5)) g.spark(-0.6, -0.6, 2.1, ORANGE, 2);
    },
  },

  // Thermal Plant — a waisted concrete cooling tower venting steam beside a boiler house and a thin flue.
  f_power: {
    build: (m, P) => {
      fPad(m, 2, 2);
      const tx = -0.3, ty = -0.3;
      m.lathe(tx, ty, 0.07, [0, 0.68, 0.12, 0.66, 0.5, 0.55, 0.9, 0.47, 0.9, 0.48, 1.2, 0.47, 1.2, 0.46, 1.5, 0.5, 1.72, 0.56, 1.76, 0.57], FCONC, 12, { tex: 'conc' },
        [F.dark, null, null, null, P.p, null, null, null, F.dark]);
      m.cyl(tx, ty, 1.84, 0.5, 0.01, hex('#1a1614'), { sides: 12 });
      // boiler house
      m.box(0.6, 0.0, 0.07, 0.66, 1.56, 0.56, RUST, { tex: 'plate' });
      m.box(0.6, 0.0, 0.63, 0.72, 1.62, 0.05, F.dark);
      m.box(0.6, 0.3, 0.68, 0.46, 0.7, 0.03, P.p);
      gridX(m, 0.93, 0.0, 0.16, 1.3, 0.3, FWIN, 0.7, WALL_F);
      stack(m, 0.6, -0.56, 0.68, 0.1, 1.3, F.dark);
      // boiler drum + furnace door on the lit side
      m.exX(ngon(0.7, 0.34, 0.25, 8), -0.9, 0.2, RUST_D, { tex: 'plate', ts: 0.8 });
      m.exX(ngon(0.7, 0.34, 0.265, 8), -0.66, -0.58, F.dark);
      m.exX(ngon(0.7, 0.34, 0.265, 8), -0.14, -0.06, F.dark);
      m.box(-0.36, 0.7, 0.07, 0.9, 0.26, 0.08, F.dark);
      winX(m, 0.2, 0.7, 0.24, 0.2, 0.2, MOLTEN);
      // steam mains to the tower
      m.path([-0.4, 0.62, 0.58, -0.4, 0.35, 0.86, -0.36, 0.14, 0.86], 0.05, F.steel, { sides: 6 });
      m.path([0.3, -0.05, 0.4, 0.05, -0.12, 0.4], 0.05, F.steel, { sides: 6 });
    },
    smoke: [[-0.3, -0.3, 1.9, 1, 1.5], [0.6, -0.56, 2.02, 2, 0.7]],
    live: (g) => {
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(0.24, 0.7, 0.34, 20, ORANGE, 0.6 * f);
      g.glow(0.95, 0.0, 0.3, 26, ORANGE, 0.22 * f);
      g.glow(-0.3, -0.3, 1.86, 22, ORANGE, 0.12 + 0.06 * f);
    },
  },

  // Smelter — two galvanised silos with glowing ore gauges, fed by a long inclined conveyor from the tipping hopper where haulers unload; a crucible glows on the flank.
  f_refinery: {
    build: (m, P) => {
      fPad(m, 3, 3);
      fSilo(m, P, -0.98, -0.98, 0.45, 1.95, FSTEEL, true);
      fSilo(m, P, 0.0, -1.02, 0.45, 1.5, FSTEEL, true);
      // transfer house bridging the silo tops
      m.box(-0.5, -1.0, 1.86, 0.62, 0.36, 0.34, RUST, { tex: 'plate' });
      m.exX([-1.22, 2.2, -0.78, 2.2, -1.0, 2.42], -0.84, -0.16, F.dark);
      gridY(m, -0.5, -0.82, 1.94, 0.4, 0.14, FWIN, 0.8, WALL_F);
      // crucible furnace
      m.lathe(0.95, -0.55, 0.07, [0, 0.46, 0.46, 0.48, 0.46, 0.52, 0.56, 0.52, 0.56, 0.44, 0.84, 0.34], F.dark, 10, { tex: 'plate' }, [null, null, F.hazard, null, F.iron]);
      m.cyl(0.95, -0.55, 0.91, 0.3, 0.012, MOLTEN, { sides: 10, emis: true });
      // crusher house
      m.box(-0.1, -0.08, 0.07, 2.0, 0.72, 0.62, FIRON, { tex: 'plate' });
      m.box(-0.1, -0.08, 0.69, 2.06, 0.78, 0.05, F.dark);
      m.box(-0.66, -0.08, 0.74, 0.8, 0.5, 0.03, P.p);
      gridY(m, -0.82, 0.28, 0.28, 0.5, 0.2, FWIN, 0.9, WALL_F);
      // tipping hopper heaped with ore against the hall front
      m.box(0, 0.5, 0.07, 1.0, 0.44, 0.4, RUST_D, { tex: 'plate', taper: [1.14, 1.2], top: SOOT });
      m.box(0, 0.5, 0.47, 0.92, 0.38, 0.1, ORE, { taper: 0.55, top: ORE_L });
      m.box(0, 0.76, 0.3, 1.16, 0.04, 0.1, F.hazard, { tex: 'hazard' });
      // long inclined conveyor up to the transfer house
      m.bar(0.42, 0.34, 0.5, -0.32, -0.86, 1.98, 0.085, F.dark, { sides: 4 });
      m.bar(0.2, -0.1, 0.74, 0.2, -0.1, 1.06, 0.03, F.mid);
      m.bar(-0.08, -0.5, 0.74, -0.08, -0.5, 1.5, 0.03, F.mid);
      // dump pad with bollards
      m.box(0, 1.12, 0.07, 1.5, 0.72, 0.03, SOOT, { tex: 'mesh+', ts: 0.6 });
      for (const s of [-1, 1]) {
        m.cyl(s * 0.86, 0.9, 0.07, 0.06, 0.26, F.hazard, { sides: 6 });
        m.cyl(s * 0.86, 1.36, 0.07, 0.06, 0.26, F.hazard, { sides: 6 });
        m.box(s * 0.86, 0.9, 0.33, 0.07, 0.07, 0.04, hex('#ff5a3c'), { emis: true });
      }
      // ore stockpile + drums
      m.box(-1.14, 0.9, 0.07, 0.5, 0.5, 0.2, ORE, { taper: 0.4, top: ORE_L });
      m.cyl(1.22, 0.4, 0.07, 0.1, 0.24, F.hazard, { sides: 8 });
    },
    smoke: [[0.95, -0.55, 1.0, 0, 0.7]],
    live: (g) => {
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(0.95, -0.55, 0.94, 24 + g.active * 12, ORANGE, (0.45 + g.active * 0.4) * f);
      g.glow(0, 0.5, 0.56, 16 + g.active * 16, MAGENTA, 0.25 + g.active * 0.6);
      g.glow(-0.98, -0.55, 1.0, 16, MAGENTA, 0.25 + g.active * 0.4);
      g.glow(0.0, -0.58, 0.8, 16, MAGENTA, 0.25 + g.active * 0.4);
      lightsBlink(g, [[-0.86, 0.9, 0.36], [0.86, 0.9, 0.36]], RED, 3 + g.active * 9, 8);
      // ore riding the conveyor
      const n = g.active > 0.05 ? 6 : 3;
      for (let i = 0; i < n; i++) {
        const u = (g.t * (0.3 + g.active * 0.7) + i / n + g.seed) % 1;
        g.glow(0.42 - 0.74 * u, 0.34 - 1.2 * u, 0.62 + 1.48 * u, 5.5, MAGENTA, 0.4 + 0.5 * g.active);
      }
      if (g.active > 0.1 && g.chance(14)) g.puff((Math.random() - 0.5) * 0.7, 0.5, 0.5, 0, 0.5);
      if (g.chance(1.2 + g.active * 5)) g.spark(0.95, -0.55, 0.94, YELLOW, 1);
    },
  },

  // Muster Hall — brick blockhouse with a guarded gate, sandbagged yard, a watchtower with a searchlight and a war banner.
  f_barracks: {
    build: (m, P) => {
      fPad(m, 2, 2);
      m.box(-0.1, -0.28, 0.07, 1.5, 1.26, 0.6, BRICK, { tex: 'brick' });
      m.box(-0.1, -0.28, 0.67, 1.56, 1.32, 0.05, F.dark);
      for (const x of [-0.72, -0.31, 0.1, 0.51]) m.box(x, 0.3, 0.72, 0.2, 0.1, 0.1, BRICK);
      for (const y of [-0.82, -0.45, -0.08]) m.box(0.61, y, 0.72, 0.1, 0.2, 0.1, BRICK);
      m.box(-0.2, -0.3, 0.72, 0.9, 0.7, 0.03, P.p);
      // gate
      m.box(-0.1, 0.357, 0.07, 0.52, 0.014, 0.42, SOOT);
      m.box(-0.1, 0.38, 0.49, 0.64, 0.06, 0.07, F.hazard, { tex: 'hazard' });
      winY(m, -0.1, 0.357, 0.58, 0.16, 0.06, F.glow);
      m.box(-0.56, 0.36, 0.2, 0.2, 0.02, 0.36, P.p);
      m.box(0.36, 0.36, 0.2, 0.2, 0.02, 0.36, P.p);
      gridX(m, 0.65, -0.28, 0.3, 1.0, 0.14, FWIN, 0.6, WALL_F);
      // watchtower behind
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.bar(-0.56 + sx * 0.2, -0.62 + sy * 0.2, 0.72, -0.56 + sx * 0.17, -0.62 + sy * 0.17, 1.3, 0.025, F.dark);
      m.box(-0.56, -0.62, 1.3, 0.5, 0.5, 0.05, F.mid);
      m.box(-0.56, -0.62, 1.35, 0.46, 0.46, 0.16, F.sand, { tex: 'slats', ts: 0.6 });
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.bar(-0.56 + sx * 0.2, -0.62 + sy * 0.2, 1.5, -0.56 + sx * 0.2, -0.62 + sy * 0.2, 1.74, 0.015, F.dark);
      m.box(-0.56, -0.62, 1.74, 0.6, 0.6, 0.2, P.p, { taper: 0.15 });
      // yard: sandbags, crates, brazier
      m.box(-0.72, 0.84, 0.07, 0.46, 0.2, 0.17, F.sand, { taper: 0.85, tex: 'slats', ts: 0.5 });
      m.box(0.5, 0.84, 0.07, 0.6, 0.2, 0.17, F.sand, { taper: 0.85, tex: 'slats', ts: 0.5 });
      m.box(0.84, 0.5, 0.07, 0.2, 0.5, 0.17, F.sand, { taper: 0.85, tex: 'slats', ts: 0.5 });
      crate(m, 0.84, -0.6, 0.07, 0.24, RUST_D);
      m.cyl(0.52, 0.56, 0.07, 0.085, 0.2, F.dark, { sides: 8 });
      m.cyl(0.52, 0.56, 0.27, 0.07, 0.012, MOLTEN, { sides: 8, emis: true });
      // banner pole on the roof corner
      m.bar(0.52, 0.2, 0.72, 0.52, 0.2, 1.74, 0.018, F.black);
    },
    live: (g) => {
      const c = g.ctx;
      flag(g, 0.52, 0.2, 1.72, 26, 15, g.P.p);
      rollDoor(g, 0.37, -0.34, 0.14, 0.08, 0.48, F.mid, F.hazard);
      if (!g.on) return;
      const f = flicker(g.t * 1.4, g.seed);
      g.glow(0.52, 0.56, 0.36, 15, ORANGE, 0.7 * f);
      g.glow(0.52, 0.56, 0.3, 34, ORANGE, 0.16 * f);
      if (g.chance(7)) g.spark(0.52, 0.56, 0.3, ORANGE, 1);
      if (g.chance(1.4)) g.puff(0.52, 0.56, 0.4, 0, 0.35);
      g.glow(-0.1, 0.4, 0.6, 9, ORANGE, 0.6);
      // searchlight sweeping the yard
      const a = g.t * 0.7 + g.seed, lx = -0.36, ly = -0.42, lz = 1.56;
      const tx = 0.3 + Math.cos(a) * 1.3, ty = 1.3 + Math.sin(a * 0.6) * 0.9;
      const x0 = X(lx, ly), y0 = Y(lx, ly, lz), x1 = X(tx, ty), y1 = Y(tx, ty, 0);
      const gr = c.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(255,236,190,0.34)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1 - 16, y1); c.lineTo(x1 + 16, y1); c.closePath(); c.fill();
      g.glow(lx, ly, lz, 8, YELLOW, 0.9);
    },
  },

  // Assembly Yard — saw-tooth factory hall with a roll-up door, a travelling gantry over the apron and a tall brick stack.
  f_factory: {
    build: (m, P) => {
      fPad(m, 3, 3);
      stack(m, 1.3, -1.22, 0.07, 0.16, 2.6);
      m.box(0, -0.36, 0.07, 2.2, 2.1, 0.86, FSHED, { tex: 'corr', ts: 0.5 });
      // saw-tooth roof: glazed risers face the camera
      for (let i = 0; i < 3; i++) {
        const x0 = -1.1 + i * 0.733;
        m.exY([x0, 0.93, x0 + 0.733, 0.93, x0 + 0.733, 1.5], -1.41, 0.69, i === 1 ? P.p : FSHED, i === 1 ? undefined : { tex: 'corr', ts: 0.6 });
        gridX(m, x0 + 0.733 - 0.004, -0.36, 1.0, 1.9, 0.42, FWIN, 0.8, WALL_F);
      }
      // door frame
      m.box(0, 0.697, 0.07, 1.5, 0.014, 0.68, hex('#17120f'));
      winY(m, 0, 0.702, 0.08, 1.4, 0.06, F.glow);
      m.box(0, 0.72, 0.75, 1.7, 0.06, 0.1, F.hazard, { tex: 'hazard' });
      for (const s of [-1, 1]) m.box(s * 0.8, 0.72, 0.07, 0.1, 0.06, 0.68, F.hazard, { tex: 'hazard', ts: 0.7 });
      m.box(0, 0.705, 0.9, 1.1, 0.02, 0.2, P.p);
      // apron
      m.box(0, 1.1, 0.07, 1.7, 0.76, 0.03, SOOT, { tex: 'chev+', tc: hex('#7a6a2a'), ts: 0.45 });
      // gantry
      for (const s of [-1, 1]) {
        m.bar(s * 1.06, 1.36, 0.07, s * 1.06, 1.36, 1.5, 0.055, F.dark);
        m.bar(s * 1.06, 1.36, 1.0, s * 0.74, 1.36, 1.48, 0.03, F.dark);
      }
      m.box(0, 1.36, 1.46, 2.26, 0.15, 0.14, F.hazard, { tex: 'hazard' });
      // boiler annex + parts shed
      m.box(1.3, -0.55, 0.07, 0.36, 0.8, 0.5, RUST, { tex: 'plate' });
      m.box(1.3, -0.55, 0.57, 0.4, 0.84, 0.04, F.dark);
      m.box(1.3, 0.34, 0.07, 0.36, 0.7, 0.36, F.mid, { tex: 'corr' });
      m.box(1.3, 0.34, 0.43, 0.3, 0.6, 0.03, P.p);
      m.path([1.3, -0.9, 0.57, 1.3, -1.05, 0.9, 1.3, -1.12, 0.9], 0.05, F.steel, { sides: 6 });
      crate(m, -1.26, 0.9, 0.07, 0.26, RUST_D);
      crate(m, -1.26, 1.2, 0.07, 0.2, F.mid);
    },
    smoke: [[1.3, -1.22, 2.72, 2, 1.1]],
    live: (g) => {
      const c = g.ctx;
      rollDoor(g, 0.705, -0.72, 0.72, 0.09, 0.73, hex('#6b4a36'), F.hazard);
      // travelling hoist
      const tx = g.on ? Math.sin(g.t * (0.45 + g.active * 1.2) + g.seed) * 0.75 : -0.4;
      const hz = 0.75 + 0.2 * Math.sin(g.t * 0.9 + g.seed);
      c.fillStyle = css(F.black, 1);
      c.beginPath(); c.moveTo(X(tx - 0.12, 1.36), Y(tx - 0.12, 1.36, 1.46)); c.lineTo(X(tx + 0.12, 1.36), Y(tx + 0.12, 1.36, 1.46)); c.lineTo(X(tx + 0.12, 1.36), Y(tx + 0.12, 1.36, 1.32)); c.lineTo(X(tx - 0.12, 1.36), Y(tx - 0.12, 1.36, 1.32)); c.closePath(); c.fill();
      c.strokeStyle = css(F.black, 1); c.lineWidth = 1;
      c.beginPath(); c.moveTo(X(tx, 1.36), Y(tx, 1.36, 1.32)); c.lineTo(X(tx, 1.36), Y(tx, 1.36, hz)); c.stroke();
      c.fillStyle = css(F.steel, 1); c.fillRect(X(tx, 1.36) - 3.5, Y(tx, 1.36, hz), 7, 5);
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(0, 0.74, 0.36, 40, ORANGE, 0.1 + g.door * 0.5 + g.active * 0.22 * f);
      // welding arcs behind the glazing while a vehicle is on the line
      if (g.active > 0) {
        const k = Math.floor(g.t * 9 + g.seed);
        const w = (Math.sin(k * 12.9898) * 43758.5453) % 1;
        if (w > 0.2) g.glow(-0.7 + Math.abs(w) * 1.4, 0.74, 0.3, 12, '#cfe8ff', 0.8);
        if (g.chance(8)) g.spark(-0.5 + Math.random(), 0.74, 0.25, YELLOW, 1);
      }
      lightsBlink(g, [[-1.06, 1.36, 1.56], [1.06, 1.36, 1.56]], ORANGE, 3 + g.door * 8, 8);
    },
  },

  // Watch Spire — tall lattice mast on a concrete bunker carrying a turning mesh antenna, horns and a pennant.
  f_radar: {
    build: (m, P) => {
      fPad(m, 2, 2);
      m.box(0, 0, 0.07, 1.24, 1.24, 0.38, FCONC, { tex: 'conc', taper: 0.9 });
      m.box(0, 0, 0.45, 1.0, 1.0, 0.04, F.dark);
      m.box(0, 0.57, 0.07, 0.3, 0.02, 0.26, SOOT);
      gridX(m, 0.58, 0, 0.2, 0.6, 0.1, FWIN, 0.6, WALL_F);
      lattice(m, 0, 0, 0.49, 2.0, 0.36, 0.14, F.dark, 3, 0.032);
      // operator cabin
      m.box(0, 0, 2.0, 0.6, 0.6, 0.06, F.mid);
      m.box(0, 0, 2.06, 0.4, 0.4, 0.24, RUST, { tex: 'plate' });
      gridX(m, 0.2, 0, 2.12, 0.3, 0.1, FWIN, 0.6, WALL_F);
      gridY(m, 0, 0.2, 2.12, 0.3, 0.1, FWIN, 0.6, WALL_F);
      m.box(0, 0, 2.3, 0.48, 0.48, 0.05, P.p);
      // horn speakers
      m.bar(0.2, 0.2, 1.5, 0.42, 0.34, 1.56, 0.03, F.steel, { taper: 2.8 });
      m.bar(-0.2, 0.2, 1.5, -0.34, 0.42, 1.56, 0.03, F.steel, { taper: 2.8 });
      // guy anchors, generator, crates
      for (const [px, py] of [[0.86, 0.86], [-0.86, 0.86], [0.86, -0.86]]) {
        m.box(px, py, 0.07, 0.14, 0.14, 0.1, F.dark);
        m.bar(px, py, 0.17, px * 0.2, py * 0.2, 1.62, 0.008, F.black);
      }
      m.box(-0.76, 0.2, 0.07, 0.3, 0.36, 0.26, RUST_D, { tex: 'slats' });
      crate(m, 0.74, -0.3, 0.07, 0.24, F.mid);
    },
    live: (g) => {
      const c = g.ctx;
      const th = g.on ? g.t * 1.3 + g.seed : g.seed;
      const R = 0.72;
      const ux = Math.cos(th) * R, uy = Math.sin(th) * R;
      const z0 = 2.5, z1 = 2.92;
      c.strokeStyle = css(F.black, 1); c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(0, Y(0, 0, 2.34)); c.lineTo(0, Y(0, 0, z1 + 0.1)); c.stroke();
      c.beginPath();
      c.moveTo(X(-ux, -uy), Y(-ux, -uy, z0)); c.lineTo(X(ux, uy), Y(ux, uy, z0));
      c.lineTo(X(ux, uy), Y(ux, uy, z1)); c.lineTo(X(-ux, -uy), Y(-ux, -uy, z1)); c.closePath();
      c.fillStyle = 'rgba(46,40,36,0.72)'; c.fill();
      c.strokeStyle = css(F.steel, 1); c.lineWidth = 1.6; c.stroke();
      c.beginPath();
      for (let i = -3; i <= 3; i++) { const k = i / 4; c.moveTo(X(ux * k, uy * k), Y(ux * k, uy * k, z0)); c.lineTo(X(ux * k, uy * k), Y(ux * k, uy * k, z1)); }
      c.moveTo(X(-ux, -uy), Y(-ux, -uy, (z0 + z1) / 2)); c.lineTo(X(ux, uy), Y(ux, uy, (z0 + z1) / 2));
      c.lineWidth = 0.8; c.stroke();
      // pennant under the antenna
      flag(g, 0, 0, 2.48, 16, 8, g.P.p);
      if (!g.on) return;
      g.glow(0, 0, 3.04, 7, RED, 0.4 + 0.5 * Math.sin(g.t * 5 + g.seed));
      g.glow(0.2, 0.2, 2.16, 13, ORANGE, 0.4);
      const u = (g.t * 0.45 + g.seed) % 1;
      halo(g, 0, 0, 0.1, 0.4 + u * 1.3, 'rgba(255,166,64,1)', 0.28 * (1 - u), 1.2, 0, [1, 0]);
    },
  },

  // Launch Yard — scorched hardstand with a painted landing cross, blast fence, a low ops hut and a tall floodlight mast.
  f_airpad: {
    build: (m, P) => {
      fPad(m, 3, 2);
      m.box(0.3, 0, 0.07, 2.3, 1.78, 0.07, SOOT, { tex: 'conc+', ts: 0.6 });
      m.cyl(0.3, 0, 0.14, 0.7, 0.006, P.p, { sides: 12 });
      m.cyl(0.3, 0, 0.146, 0.56, 0.005, SOOT, { sides: 12 });
      m.box(0.3, 0, 0.151, 0.9, 0.16, 0.005, P.p);
      m.box(0.3, 0, 0.152, 0.16, 0.9, 0.005, P.p);
      m.box(0.3, 0.82, 0.14, 2.1, 0.1, 0.006, F.hazard, { tex: 'hazard+' });
      m.box(1.38, 0, 0.14, 0.1, 1.6, 0.006, F.hazard, { tex: 'hazard+' });
      // blast fence along the back edge
      for (let i = 0; i < 4; i++) m.box(-0.3 + i * 0.5, -0.86, 0.14, 0.44, 0.06, 0.46, F.mid, { tex: 'corr', shift: [0, -0.14] });
      // low ops hut
      m.box(-1.18, -0.56, 0.07, 0.5, 0.66, 0.4, RUST, { tex: 'plate' });
      m.box(-1.18, -0.56, 0.47, 0.56, 0.72, 0.04, F.dark);
      m.box(-1.18, -0.56, 0.51, 0.4, 0.5, 0.03, P.p);
      gridX(m, -0.93, -0.56, 0.2, 0.5, 0.14, FWIN, 0.7, WALL_F);
      // floodlight mast with a lamp bar
      m.box(-1.24, 0.12, 0.07, 0.2, 0.2, 0.12, F.dark);
      m.bar(-1.24, 0.12, 0.19, -1.24, 0.12, 2.0, 0.03, F.dark);
      m.bar(-1.24, 0.12, 0.6, -1.08, 0.12, 0.19, 0.014, F.dark);
      m.bar(-1.24, -0.2, 2.0, -1.24, 0.44, 2.0, 0.035, F.mid);
      for (const y of [-0.16, 0.12, 0.4]) m.box(-1.18, y, 1.88, 0.1, 0.16, 0.12, FWIN, { emis: true });
      // fuel dump
      for (const y of [0.52, 0.8]) {
        m.exX(ngon(y, 0.22, 0.13, 8), -1.42, -0.96, y < 0.6 ? RUST : F.hazard, { tex: 'plate', ts: 0.6 });
        m.exX(ngon(y, 0.22, 0.14, 8), -1.24, -1.16, F.dark);
      }
      // windsock pole on the hut roof
      m.bar(-1.0, -0.82, 0.5, -1.0, -0.82, 1.2, 0.014, F.black);
    },
    live: (g) => {
      const c = g.ctx;
      // windsock
      const x0 = X(-1.0, -0.82), y0 = Y(-1.0, -0.82, 1.18);
      const sway = Math.sin(g.t * 3.1 + g.seed) * 2.5;
      c.beginPath(); c.moveTo(x0, y0 - 4); c.lineTo(x0 + 20, y0 + sway + 1); c.lineTo(x0 + 20, y0 + sway + 4); c.lineTo(x0, y0 + 4); c.closePath();
      c.fillStyle = css(g.P.p, 1); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.beginPath(); c.moveTo(x0 + 7, y0 - 3 + sway * 0.3); c.lineTo(x0 + 12, y0 - 2 + sway * 0.55); c.lineTo(x0 + 12, y0 + 4 + sway * 0.55); c.lineTo(x0 + 7, y0 + 4 + sway * 0.3); c.closePath(); c.fill();
      if (!g.on) return;
      lightsBlink(g, [[-0.8, 0.82, 0.17], [1.38, 0.82, 0.17], [1.38, -0.8, 0.17], [0.3, 0, 0.17]], RED, 4.4 + g.door * 6, 9);
      for (const y of [-0.16, 0.12, 0.4]) g.glow(-1.14, y, 1.9, 9, YELLOW, 0.75);
      g.glow(0.1, 0.1, 0.2, 60, YELLOW, 0.1 + 0.25 * g.door);
    },
  },

  // Heavy Bureau — slate-dark stepped block with brass trim and ranks of lit windows, a central tower under a pointed cap and a great brass gear.
  f_lab: {
    build: (m, P) => {
      fPad(m, 3, 2);
      // tiers
      m.box(-0.05, -0.12, 0.07, 2.6, 1.46, 0.5, FSLATE, { tex: 'conc' });
      m.box(-0.05, -0.12, 0.57, 2.66, 1.52, 0.05, BRASS);
      m.box(-0.2, -0.2, 0.62, 1.9, 1.1, 0.4, FSLATE, { tex: 'conc' });
      m.box(-0.2, -0.2, 1.02, 1.96, 1.16, 0.05, BRASS);
      gridY(m, -0.72, 0.61, 0.18, 0.8, 0.28, FWIN, 1.1, WALL_F);
      gridY(m, 0.72, 0.61, 0.18, 0.7, 0.28, FWIN, 1.1, WALL_F);
      gridX(m, 1.25, -0.12, 0.18, 1.2, 0.28, FWIN, 1.1, WALL_F);
      gridY(m, 0.1, 0.35, 0.72, 1.0, 0.2, FWIN, 1.1, WALL_F);
      gridX(m, 0.75, -0.2, 0.72, 0.9, 0.2, FWIN, 1.1, WALL_F);
      // central tower with a pointed player-colour cap
      const tx = -0.62, ty = -0.3;
      m.box(tx, ty, 1.07, 0.62, 0.62, 1.0, FSLATE, { tex: 'conc', taper: 0.9 });
      m.box(tx, ty, 2.07, 0.66, 0.66, 0.06, BRASS);
      m.box(tx, ty, 2.13, 0.7, 0.7, 0.42, P.p, { taper: 0.1 });
      m.bar(tx, ty, 2.5, tx, ty, 2.8, 0.014, F.black);
      gridY(m, tx, ty + 0.3, 1.3, 0.36, 0.56, FWIN, 1, WALL_F);
      gridX(m, tx + 0.3, ty, 1.3, 0.36, 0.56, FWIN, 1, WALL_F);
      // buttresses + portal
      for (const x of [-1.26, -0.28, 0.28, 1.16]) m.box(x, 0.7, 0.07, 0.16, 0.2, 0.56, F.dark, { taper: [1, 0.4], shift: [0, -0.06] });
      m.box(0, 0.617, 0.07, 0.4, 0.014, 0.42, SOOT);
      winY(m, 0, 0.622, 0.09, 0.3, 0.3, F.glow);
      m.bar(-0.28, 0.72, 0.58, -0.28, 0.86, 0.58, 0.012, F.black);
      m.bar(0.28, 0.72, 0.58, 0.28, 0.86, 0.58, 0.012, F.black);
      // gear cradle on the second tier
      m.box(0.42, 0.26, 1.07, 0.9, 0.12, 0.1, F.dark);
      m.box(0.95, -0.4, 0.62, 0.3, 0.5, 0.2, RUST, { tex: 'slats' });
    },
    live: (g) => {
      const c = g.ctx;
      // hanging banners
      for (const x of [-0.28, 0.28]) {
        const x0 = X(x, 0.86), y0 = Y(x, 0.86, 0.58);
        const sw = Math.sin(g.t * 2 + x * 4 + g.seed) * 1.2;
        c.fillStyle = css(g.P.p, 1);
        c.beginPath(); c.moveTo(x0 - 4.5, y0); c.lineTo(x0 + 4.5, y0); c.lineTo(x0 + 4.5 + sw, y0 + 15); c.lineTo(x0 + sw, y0 + 19); c.lineTo(x0 - 4.5 + sw, y0 + 15); c.closePath(); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x0 - 4.5, y0, 9, 2);
      }
      // the great brass gear, standing on the second tier facing +y
      const gx = 0.42, gy = 0.27, gz = 1.66, R = 0.5;
      const a0 = g.on ? g.t * 0.7 + g.seed : g.seed;
      const pt = (a: number, r: number): [number, number] => [X(gx + Math.cos(a) * r, gy), Y(gx + Math.cos(a) * r, gy, gz + Math.sin(a) * r)];
      c.beginPath();
      const T = 10;
      for (let i = 0; i < T; i++) {
        const a = a0 + (i / T) * Math.PI * 2, d = (Math.PI * 2) / T;
        const p0 = pt(a, R * 0.8), p1 = pt(a + d * 0.12, R), p2 = pt(a + d * 0.42, R), p3 = pt(a + d * 0.54, R * 0.8);
        if (i === 0) c.moveTo(p0[0], p0[1]); else c.lineTo(p0[0], p0[1]);
        c.lineTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.lineTo(p3[0], p3[1]);
      }
      c.closePath();
      c.fillStyle = css(BRASS, 1); c.fill();
      c.strokeStyle = css(F.black, 1); c.lineWidth = 1.2; c.stroke();
      c.beginPath();
      for (let i = 0; i <= 16; i++) { const p = pt((i / 16) * Math.PI * 2, R * 0.52); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
      c.closePath(); c.fillStyle = css(FSLATE, 0.9); c.fill(); c.stroke();
      c.strokeStyle = css(BRASS, 1); c.lineWidth = 3;
      c.beginPath();
      for (let i = 0; i < 3; i++) { const p = pt(a0 + (i / 3) * Math.PI, R * 0.52), q = pt(a0 + (i / 3) * Math.PI + Math.PI, R * 0.52); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
      c.stroke();
      c.fillStyle = css(g.P.p, 1);
      const hub = pt(0, 0); c.beginPath(); c.arc(hub[0], hub[1], 4, 0, 6.3); c.fill();
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(0, 0.66, 0.26, 20, ORANGE, 0.5 * f);
      g.glow(1.28, -0.12, 0.34, 26, ORANGE, 0.2 * f);
      g.glow(-0.62, 0.02, 1.6, 22, ORANGE, 0.18);
      g.glow(-0.62, -0.3, 2.82, 6, RED, 0.4 + 0.5 * Math.sin(g.t * 4 + g.seed));
    },
  },

  // Seismic Drill — superweapon: a huge derrick driving a pile hammer into a glowing shaft, with a flywheel engine house.
  f_drill: {
    build: (m, P) => {
      fPad(m, 3, 3);
      m.box(0, 0, 0.07, 2.4, 2.4, 0.32, FIRON, { tex: 'plate', taper: 0.94 });
      m.box(0, 0, 0.39, 2.1, 2.1, 0.04, F.dark);
      m.box(0, 1.14, 0.3, 2.2, 0.03, 0.09, F.hazard, { tex: 'hazard' });
      m.box(1.14, 0, 0.3, 0.03, 2.2, 0.09, F.hazard, { tex: 'hazard' });
      // shaft collar
      m.cyl(0, 0, 0.43, 0.5, 0.08, SOOT, { sides: 10 });
      m.cyl(0, 0, 0.51, 0.38, 0.012, MOLTEN, { sides: 10, emis: true });
      // derrick
      lattice(m, 0, 0, 0.43, 3.05, 1.0, 0.3, F.dark, 3, 0.06);
      m.box(0, 0, 3.05, 0.76, 0.76, 0.16, F.mid, { tex: 'plate' });
      m.box(0, 0, 3.21, 0.82, 0.82, 0.06, F.hazard, { tex: 'hazard' });
      m.box(0, 0, 3.27, 0.56, 0.56, 0.05, P.p);
      m.box(0.3, 0.3, 3.32, 0.06, 0.06, 0.06, hex('#ff5a3c'), { emis: true });
      // engine house + stack at the back
      m.box(-0.86, -0.86, 0.43, 0.6, 0.6, 0.5, RUST, { tex: 'plate' });
      m.box(-0.86, -0.86, 0.93, 0.66, 0.66, 0.05, F.dark);
      stack(m, -0.86, -0.86, 0.98, 0.11, 1.0, F.dark);
      // flywheel pedestal on the right flank
      m.box(0.86, -0.72, 0.43, 0.34, 0.5, 0.34, F.mid);
      // player banners on the platform faces
      m.box(-0.6, 1.15, 0.12, 0.5, 0.02, 0.2, P.p);
      m.box(1.15, 0.6, 0.12, 0.02, 0.5, 0.2, P.p);
      winX(m, 1.14, -0.5, 0.14, 0.5, 0.12, F.glow);
    },
    smoke: [[-0.86, -0.86, 2.06, 2, 0.9]],
    live: (g) => {
      const c = g.ctx;
      const sp = 2.0 + g.charge * 3.2;
      const ph = g.on ? g.t * sp + g.seed : 1;
      // pile hammer: slow lift, fast drop
      const cyc = (ph / Math.PI) % 1;
      const lift = cyc < 0.75 ? cyc / 0.75 : 1 - (cyc - 0.75) / 0.25;
      const off = lift * 0.95;
      const yb = Y(0, 0, 0.6 + off), yt = Y(0, 0, 1.75 + off);
      const w = 11;
      c.fillStyle = css(F.steel, 0.95); c.fillRect(-w, yt, w, yb - yt);
      c.fillStyle = css(F.steel, 0.62); c.fillRect(0, yt, w, yb - yt);
      c.fillStyle = css(F.hazard, 1); c.fillRect(-w - 1, yb - 12, 2 * w + 2, 6);
      c.fillStyle = css(g.P.p, 1); c.fillRect(-w - 1, yt + 4, 2 * w + 2, 6);
      c.beginPath(); c.moveTo(-w, yb); c.lineTo(0, yb + 15); c.lineTo(w, yb); c.closePath(); c.fillStyle = css(F.dark, 1); c.fill();
      c.strokeStyle = css(F.black, 1); c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(0, yt); c.lineTo(0, Y(0, 0, 3.05)); c.stroke();
      // flywheel
      const fx = 0.86, fy = -0.44, fz = 0.95, R = 0.42;
      const a0 = g.on ? g.t * sp * 1.5 + g.seed : g.seed;
      const pt = (a: number, r: number): [number, number] => [X(fx + Math.cos(a) * r, fy), Y(fx + Math.cos(a) * r, fy, fz + Math.sin(a) * r)];
      c.beginPath();
      for (let i = 0; i <= 18; i++) { const p = pt((i / 18) * Math.PI * 2, R); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
      c.closePath();
      c.strokeStyle = css(F.steel, 1); c.lineWidth = 4; c.stroke();
      c.strokeStyle = css(F.black, 0.9); c.lineWidth = 1; c.stroke();
      c.strokeStyle = css(F.steel, 0.9); c.lineWidth = 1.8;
      c.beginPath();
      for (let i = 0; i < 3; i++) { const p = pt(a0 + (i / 3) * Math.PI, R), q = pt(a0 + (i / 3) * Math.PI + Math.PI, R); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
      c.stroke();
      const hub = pt(0, 0); c.fillStyle = css(F.hazard, 1); c.beginPath(); c.arc(hub[0], hub[1], 3.2, 0, 6.3); c.fill();
      if (!g.on) return;
      const hit = Math.max(0, 1 - off * 5);
      g.glow(0, 0, 0.54, 26 + hit * 22 + g.charge * 18, ORANGE, 0.35 + hit * 0.45 + g.charge * 0.2);
      g.glow(0, 0, 0.3, 80, ORANGE, 0.05 + g.charge * 0.16 + hit * 0.08);
      g.glow(0.3, 0.3, 3.38, 7, RED, 0.4 + 0.5 * Math.sin(g.t * 5));
      if (hit > 0.6 && g.chance(30)) { g.spark((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 0.55, YELLOW, 2); g.puff(0, 0, 0.55, 1, 0.7); }
      if (g.charge > 0.3) {
        // fissures glowing across the platform as the charge builds
        c.strokeStyle = `rgba(255,170,70,${(g.charge - 0.3) * 0.9 * (0.6 + 0.4 * hit)})`; c.lineWidth = 1.3;
        c.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = i * 1.257 + g.seed, r1 = 1.25 + 0.2 * Math.sin(i * 3.1);
          c.moveTo(X(Math.cos(a) * 0.5, Math.sin(a) * 0.5), Y(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.44));
          c.lineTo(X(Math.cos(a + 0.2) * 0.85, Math.sin(a + 0.2) * 0.85), Y(Math.cos(a + 0.2) * 0.85, Math.sin(a + 0.2) * 0.85, 0.44));
          c.lineTo(X(Math.cos(a - 0.1) * r1, Math.sin(a - 0.1) * r1), Y(Math.cos(a - 0.1) * r1, Math.sin(a - 0.1) * r1, 0.08));
        }
        c.stroke();
      }
    },
  },

  f_wall: {
    build: (m, P, mask) => {
      const arm = (dx: number, dy: number): void => {
        m.box(dx * 0.28, dy * 0.28, 0, dx ? 0.46 : 0.3, dy ? 0.46 : 0.3, 0.32, FCONC, { taper: dx ? [1, 0.8] : [0.8, 1], tex: 'conc' });
        m.bar(dx * 0.3, dy * 0.3, 0.32, dx * 0.3, dy * 0.3, 0.48, 0.012, RUST);
      };
      if (mask & 1) arm(0, -1);
      if (mask & 2) arm(1, 0);
      if (mask & 4) arm(0, 1);
      if (mask & 8) arm(-1, 0);
      m.box(0, 0, 0, 0.46, 0.46, 0.42, FCONC, { taper: 0.82, tex: 'conc' });
      m.box(0, 0, 0.42, 0.32, 0.32, 0.03, P.p);
      for (const [px, py] of [[-0.09, -0.09], [0.09, 0.09], [0.09, -0.09], [-0.09, 0.09]]) m.bar(px, py, 0.45, px * 1.2, py * 1.2, 0.6, 0.012, RUST);
    },
  },

  // Gun Bunker — low concrete pillbox ringed with sandbags, firing slits all round.
  f_bunker: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.48, 0.1, F.sand, { sides: 10, taper: 0.9 });
      m.lathe(0, 0, 0.06, [0, 0.42, 0.26, 0.38, 0.26, 0.42, 0.33, 0.4, 0.42, 0.24], FCONC, 8, { tex: 'conc' }, [null, null, F.dark, FCONC]);
      m.cyl(0, 0, 0.48, 0.16, 0.03, P.p, { sides: 8 });
      // firing slits on the two visible flanks
      m.box(0.375, 0, 0.19, 0.02, 0.28, 0.06, SOOT);
      m.box(0, 0.375, 0.19, 0.28, 0.02, 0.06, SOOT);
      m.box(0.27, 0.27, 0.19, 0.22, 0.02, 0.06, SOOT, { rot: -Math.PI / 4 });
      m.box(0.34, -0.3, 0.1, 0.16, 0.16, 0.1, F.sand);
      m.box(-0.3, 0.34, 0.1, 0.16, 0.16, 0.1, F.sand);
    },
    muzzles: [[0.42, 0, 0.21]], flash: 9, recoil: 0,
  },

  // Flak Nest — quad flak cannons in a sandbag ring.
  f_flaknest: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.48, 0.19, F.sand, { sides: 10, taper: 0.92, top: SOOT, tex: 'slats', ts: 0.5 });
      m.cyl(0, 0, 0.19, 0.4, 0.012, SOOT, { sides: 10 });
      m.cyl(0, 0, 0.05, 0.14, 0.22, F.dark, { sides: 6 });
      m.box(0.28, -0.28, 0.19, 0.14, 0.14, 0.1, RUST_D);
    },
    turret: (m, P) => {
      m.box(-0.04, 0, 0, 0.22, 0.28, 0.15, F.mid);
      m.box(0.08, 0, 0, 0.03, 0.48, 0.26, P.p);
      for (const y of [-0.17, -0.075, 0.075, 0.17]) m.bar(0.02, y, 0.13, 0.42, y, 0.56, 0.022, F.gun);
      m.box(-0.19, 0, 0, 0.13, 0.22, 0.11, RUST);
    },
    pivot: [0, 0, 0.29], muzzles: [[0.44, -0.12, 0.58], [0.44, 0.12, 0.58]], recoil: 0.03, flash: 10,
  },

  // Siege Battery — one heavy gun on an armoured plinth.
  f_siege: {
    build: (m, P) => {
      m.box(0, 0, 0, 0.92, 0.92, 0.1, FPAD, { tex: 'conc' });
      m.box(0, 0, 0.1, 0.78, 0.78, 0.22, F.iron, { taper: 0.84, tex: 'plate', ts: 1.4 });
      m.box(0, 0, 0.32, 0.62, 0.62, 0.03, F.hazard, { tex: 'hazard+', ts: 0.7 });
    },
    turret: (m, P) => {
      m.cyl(0, 0, 0, 0.25, 0.06, F.dark, { sides: 8 });
      m.box(-0.04, 0, 0.06, 0.42, 0.44, 0.21, F.mid, { taper: [0.85, 0.85] });
      m.box(-0.06, 0, 0.27, 0.26, 0.32, 0.02, P.p);
      m.box(0.2, 0, 0.08, 0.08, 0.28, 0.18, F.dark);
      m.bar(0.2, 0, 0.175, 0.82, 0, 0.175, 0.064, F.gun, { sides: 6 });
      m.box(0.88, 0, 0.11, 0.13, 0.2, 0.13, F.black);
      m.box(-0.31, 0, 0.06, 0.15, 0.32, 0.15, RUST);
    },
    pivot: [0, 0, 0.35], muzzles: [[0.96, 0, 0.175]], recoil: 0.1, flash: 22,
  },
};

export const BUILDING_FALLBACK: BuildingArt = {
  build: (m, P) => {
    m.box(0, 0, 0, 0.9, 0.9, 0.5, hex('#888888'));
    m.box(0, 0, 0.5, 0.6, 0.6, 0.05, P.p);
  },
};

void mix;
