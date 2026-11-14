// Procedural models + animated overlays for every building def. Original designs.
// Local space: origin = footprint centre on the ground; +x faces screen lower-right, +y screen lower-left.
import { HH, HW, Model, type RGB, ZPX, css, hex, mul } from './model';
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
  /** Chimney tops that emit smoke while operating: [x,y,z]. */
  smoke?: number[][];
}

const X = (x: number, y: number): number => (x - y) * HW;
const Y = (x: number, y: number, z: number): number => (x + y) * HH - z * ZPX;

const CYAN = '#74f4ff';
const ORANGE = '#ffa640';
const MAGENTA = '#ff7fe0';
const RED = '#ff5a3c';

function slab(m: Model, w: number, h: number, col: RGB, z = 0.07): void {
  m.box(0, 0, 0, w - 0.1, h - 0.1, z, col);
}
/** Emissive panel on a +x face at x. */
function winX(m: Model, x: number, y: number, z: number, ly: number, h: number, col: RGB): void {
  m.box(x + 0.007, y, z, 0.014, ly, h, col, { emis: true });
}
/** Emissive panel on a +y face at y. */
function winY(m: Model, x: number, y: number, z: number, lx: number, h: number, col: RGB): void {
  m.box(x, y + 0.007, z, lx, 0.014, h, col, { emis: true });
}
function chimney(m: Model, x: number, y: number, z: number, r: number, h: number): void {
  m.column(x, y, z, r, h, F.dark, 0.8, 8, [[h * 0.62, h * 0.1, F.hazard, 1.05]]);
  m.cyl(x, y, z + h, r * 0.86, 0.05, F.black, { sides: 8, top: hex('#120f0d') });
}
function lightsBlink(g: LiveCtx, pts: number[][], col: string, speed: number): void {
  if (!g.on) return;
  for (let i = 0; i < pts.length; i++) {
    const a = 0.5 + 0.5 * Math.sin(g.t * speed + i * 1.7 + g.seed);
    if (a > 0.45) g.glow(pts[i][0], pts[i][1], pts[i][2], 9, col, (a - 0.45) * 1.6);
  }
}
function flicker(t: number, seed: number): number {
  return 0.72 + 0.18 * Math.sin(t * 9 + seed) + 0.1 * Math.sin(t * 23.7 + seed * 3.1);
}

const hConcrete = hex('#8f9aa8');
const fConcrete = hex('#6e6860');

export const BUILDING_ART: Record<string, BuildingArt> = {
  // ══════════════════════════════ Helion Accord ══════════════════════════════
  h_nexus: {
    build: (m, P) => {
      slab(m, 3, 3, hConcrete);
      m.cyl(0, 0, 0.07, 1.36, 0.12, H.mid, { sides: 6 });
      m.cyl(0, 0, 0.19, 1.0, 0.5, H.hull, { sides: 6, taper: 0.86 });
      m.cyl(0, 0, 0.69, 0.9, 0.1, P.p, { sides: 6 });
      m.cyl(0, 0, 0.79, 0.78, 0.36, H.hull, { sides: 6, taper: 0.74 });
      m.cyl(0, 0, 1.15, 0.56, 0.1, H.glow, { sides: 6, emis: true });
      m.cyl(0, 0, 1.25, 0.6, 0.12, H.mid, { sides: 6, taper: 0.55 });
      m.cyl(0, 0, 1.37, 0.12, 0.2, H.dark, { sides: 6, taper: 0.6 });
      // corner pylons with player-colour caps and lamps
      for (const [px, py] of [[-1.18, -1.18], [1.18, -1.18], [-1.18, 1.18], [1.18, 1.18]]) {
        m.box(px, py, 0.07, 0.34, 0.34, 0.46, H.mid, { taper: 0.7 });
        m.box(px, py, 0.53, 0.26, 0.26, 0.07, P.p);
        m.box(px, py, 0.6, 0.1, 0.1, 0.07, H.glow, { emis: true });
      }
      // entrance ramps toward the two front faces
      m.box(1.12, 0, 0.07, 0.5, 0.6, 0.1, H.dark, { taper: [0.7, 0.9] });
      m.box(0, 1.12, 0.07, 0.6, 0.5, 0.1, H.dark, { taper: [0.9, 0.7] });
      winX(m, 0.86, 0, 0.26, 0.4, 0.24, H.glow);
      winY(m, 0, 0.86, 0.26, 0.4, 0.24, H.glow);
    },
    live: (g) => {
      const c = g.ctx;
      const bob = Math.sin(g.t * 1.5 + g.seed) * 0.05;
      const cy = Y(0, 0, 1.98 + bob);
      // hovering antenna crystal
      c.fillStyle = g.on ? '#c9fbff' : '#56616e';
      c.beginPath(); c.moveTo(0, cy - 15); c.lineTo(-7, cy); c.lineTo(0, cy + 13); c.closePath(); c.fill();
      c.fillStyle = g.on ? '#4fc9dc' : '#3a434e';
      c.beginPath(); c.moveTo(0, cy - 15); c.lineTo(7, cy); c.lineTo(0, cy + 13); c.closePath(); c.fill();
      if (!g.on) return;
      c.strokeStyle = 'rgba(116,244,255,0.55)'; c.lineWidth = 1.2;
      c.setLineDash([7, 9]); c.lineDashOffset = -g.t * 16;
      c.beginPath(); c.ellipse(0, cy + 2, 17, 7.5, 0, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      g.glow(0, 0, 1.98 + bob, 26, CYAN, 0.5 + 0.15 * Math.sin(g.t * 3));
      g.glow(0, 0, 1.2, 40, CYAN, 0.22);
    },
  },
  h_power: {
    build: (m, P) => {
      slab(m, 2, 2, hConcrete);
      m.cyl(0, 0, 0.07, 0.82, 0.18, H.mid, { sides: 6 });
      m.column(0, 0, 0.25, 0.5, 0.73, H.hull, 1, 10, [[0, 0.05, H.glow, 0.62, true], [0.16, 0.17, H.glow, 0.62, true], [0.44, 0.17, H.glow, 0.62, true]]);
      m.cyl(0, 0, 0.98, 0.44, 0.05, P.p, { sides: 10 });
      m.cyl(0, 0, 1.03, 0.36, 0.1, H.mid, { sides: 10, taper: 0.5 });
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
        const cx = Math.cos(a), sy = Math.sin(a);
        m.bar(cx * 0.74, sy * 0.74, 0.25, cx * 0.5, sy * 0.5, 0.98, 0.045, H.dark);
      }
      // coolant fins on the back corners
      for (const [px, py] of [[-0.7, -0.7], [0.72, -0.72], [-0.72, 0.72]]) {
        m.box(px, py, 0.07, 0.32, 0.32, 0.42, H.mid, { taper: 0.75 });
        m.box(px, py, 0.49, 0.24, 0.24, 0.05, P.p);
      }
    },
    live: (g) => {
      if (!g.on) return;
      const p = 0.5 + 0.5 * Math.sin(g.t * 2.6 + g.seed);
      g.glow(0, 0, 0.62, 34 + p * 8, CYAN, 0.38 + p * 0.25);
      g.glow(0, 0, 0.5, 60, CYAN, 0.12);
    },
  },
  h_refinery: {
    build: (m, P) => {
      slab(m, 3, 3, hConcrete);
      // processor block along the back-left
      m.box(-0.8, -0.25, 0.07, 1.15, 2.2, 0.55, H.hull, { taper: [0.9, 0.96] });
      m.box(-0.85, -0.45, 0.62, 0.85, 1.4, 0.26, H.mid, { taper: 0.85 });
      m.box(-0.85, -0.45, 0.88, 0.6, 1.0, 0.03, P.p);
      winX(m, -0.26, -0.3, 0.3, 1.3, 0.1, H.glow);
      // hex silos with ore level windows
      m.column(-0.9, 1.0, 0.07, 0.42, 0.95, H.hull, 1, 6, [[0.53, 0.09, P.p, 1.06]]);
      m.cyl(-0.9, 1.0, 1.02, 0.42, 0.14, H.mid, { sides: 6, taper: 0.6 });
      m.column(0.55, -1.02, 0.07, 0.4, 0.8, H.hull, 1, 6, [[0.43, 0.09, P.p, 1.06]]);
      m.cyl(0.55, -1.02, 0.87, 0.4, 0.13, H.mid, { sides: 6, taper: 0.6 });
      winY(m, -0.9, 1.37, 0.14, 0.14, 0.4, ORE);
      winX(m, 0.9, -1.02, 0.14, 0.14, 0.32, ORE);
      // unloading pad with guide lights
      m.box(0.72, 0.55, 0.07, 1.36, 1.7, 0.035, H.deep);
      m.box(0.72, 0.55, 0.105, 0.9, 1.2, 0.006, H.dark);
      for (const [px, py] of [[0.1, -0.24], [1.34, -0.24], [0.1, 1.34], [1.34, 1.34]]) m.box(px, py, 0.105, 0.08, 0.08, 0.03, H.glow, { emis: true });
      // intake arm reaching over the pad
      m.bar(-0.3, 0.5, 0.56, 0.5, 0.55, 0.62, 0.06, H.dark);
      m.box(0.52, 0.55, 0.5, 0.2, 0.3, 0.14, H.mid);
      m.box(0.52, 0.55, 0.47, 0.12, 0.2, 0.03, ORE, { emis: true });
    },
    live: (g) => {
      if (!g.on) return;
      const p = 0.5 + 0.5 * Math.sin(g.t * 3 + g.seed);
      const a = 0.18 + g.active * 0.55;
      g.glow(-0.9, 1.4, 0.34, 16, MAGENTA, a + p * 0.1);
      g.glow(0.93, -1.02, 0.3, 14, MAGENTA, a + p * 0.1);
      g.glow(0.52, 0.55, 0.45, 12 + g.active * 16, MAGENTA, 0.25 + g.active * 0.6);
    },
  },
  h_barracks: {
    build: (m, P) => {
      slab(m, 2, 2, hConcrete);
      // angular asymmetric hall
      m.exX([-0.72, 0, 0.6, 0, 0.6, 0.4, 0.22, 0.7, -0.46, 0.7, -0.72, 0.44], -0.82, 0.5, H.hull);
      m.box(-0.16, -0.12, 0.7, 1.0, 0.5, 0.03, P.p);
      m.box(0.5, 0.06, 0.07, 0.03, 0.4, 0.38, H.deep);
      winX(m, 0.51, 0.06, 0.5, 0.4, 0.05, H.glow);
      winY(m, -0.5, 0.6, 0.2, 0.3, 0.1, H.glow);
      winY(m, 0.05, 0.6, 0.2, 0.3, 0.1, H.glow);
      // annex + banner pylon
      m.box(0.72, -0.5, 0.07, 0.34, 0.6, 0.3, H.mid, { taper: 0.85 });
      m.bar(0.76, 0.76, 0.07, 0.76, 0.76, 1.0, 0.03, H.dark);
      m.box(0.76, 0.61, 0.66, 0.03, 0.26, 0.3, P.p);
      m.box(0.76, 0.76, 1.0, 0.06, 0.06, 0.06, H.glow, { emis: true });
    },
    live: (g) => {
      if (g.on) g.glow(0.76, 0.76, 1.03, 10, CYAN, 0.5);
    },
  },
  h_factory: {
    build: (m, P) => {
      slab(m, 3, 3, hConcrete);
      // angular hangar, door on the +y face
      m.exY([-1.3, 0, 0.95, 0, 0.95, 0.56, 0.6, 0.98, -0.95, 0.98, -1.3, 0.6], -1.36, 0.86, H.hull);
      m.box(-0.18, -0.25, 0.98, 0.5, 2.1, 0.03, P.p);
      m.box(-0.18, 0.87, 0.07, 1.5, 0.03, 0.62, H.deep);
      m.box(-0.18, 0.885, 0.07, 1.3, 0.012, 0.5, hex('#22303f'));
      winY(m, -0.18, 0.875, 0.74, 1.5, 0.06, H.glow);
      // apron
      m.box(-0.18, 1.16, 0.07, 1.7, 0.5, 0.03, H.deep);
      for (const px of [-0.95, 0.6]) m.box(px, 1.34, 0.1, 0.08, 0.08, 0.03, H.glow, { emis: true });
      // control tower
      m.box(1.18, -0.92, 0.07, 0.5, 0.74, 1.05, H.mid, { taper: 0.84 });
      m.box(1.18, -0.92, 1.12, 0.46, 0.66, 0.14, H.glass);
      m.box(1.18, -0.92, 1.26, 0.5, 0.7, 0.05, P.p);
      m.bar(1.18, -0.92, 1.31, 1.18, -0.92, 1.75, 0.014, H.dark);
      // roof vents
      for (const y of [-1.0, -0.4, 0.2]) m.box(-0.7, y, 0.98, 0.26, 0.3, 0.07, H.dark);
      m.box(1.15, 0.3, 0.07, 0.5, 1.1, 0.3, H.mid, { taper: [0.8, 0.94] });
    },
    live: (g) => {
      if (!g.on) return;
      const p = 0.5 + 0.5 * Math.sin(g.t * 5 + g.seed);
      g.glow(-0.18, 0.9, 0.5, 34, CYAN, 0.12 + g.active * (0.3 + p * 0.3));
      g.glow(1.18, -0.92, 1.76, 7, RED, 0.3 + p * 0.5);
    },
  },
  h_radar: {
    build: (m, P) => {
      slab(m, 2, 2, hConcrete);
      m.cyl(0, 0, 0.07, 0.72, 0.2, H.mid, { sides: 6 });
      m.column(0, 0, 0.27, 0.26, 0.86, H.hull, 0.62, 6, [[0.3, 0.1, P.p, 1.12]]);
      m.cyl(0, 0, 1.13, 0.15, 0.1, H.dark, { sides: 6 });
      for (const [px, py] of [[0.68, 0.68], [-0.68, 0.68], [0.68, -0.68]]) {
        m.box(px, py, 0.07, 0.3, 0.3, 0.24, H.mid, { taper: 0.8 });
        m.box(px, py, 0.31, 0.12, 0.12, 0.04, H.glow, { emis: true });
      }
    },
    live: (g) => {
      const c = g.ctx;
      const th = g.on ? g.t * 1.1 + g.seed : g.seed;
      const ph = 0.6;
      const R = 0.56;
      const nx = Math.cos(th) * Math.cos(ph), ny = Math.sin(th) * Math.cos(ph), nz = Math.sin(ph);
      const ux = -Math.sin(th), uy = Math.cos(th);
      const vx = -Math.cos(th) * Math.sin(ph), vy = -Math.sin(th) * Math.sin(ph), vz = Math.cos(ph);
      const cz = 1.5;
      const front = nx + ny + nz * (HW / ZPX) > 0;
      c.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const x = (Math.cos(a) * ux + Math.sin(a) * vx) * R, y = (Math.cos(a) * uy + Math.sin(a) * vy) * R, z = cz + Math.sin(a) * vz * R;
        if (i === 0) c.moveTo(X(x, y), Y(x, y, z)); else c.lineTo(X(x, y), Y(x, y, z));
      }
      c.closePath();
      const lit = Math.max(0, nx * 0.18 + ny * 0.5 + nz * 0.85);
      c.fillStyle = front ? css(H.hull, 0.62 + 0.4 * lit) : css(H.dark, 0.8);
      c.fill();
      c.strokeStyle = front ? css(g.P.p, 1) : css(H.deep, 1);
      c.lineWidth = 2; c.stroke();
      // mast + feed
      c.strokeStyle = css(H.dark, 1); c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, Y(0, 0, 1.2)); c.lineTo(0, Y(0, 0, cz));
      if (front) { c.moveTo(0, Y(0, 0, cz)); c.lineTo(X(nx * 0.34, ny * 0.34), Y(nx * 0.34, ny * 0.34, cz + nz * 0.34)); }
      c.stroke();
      if (g.on && front) g.glow(nx * 0.34, ny * 0.34, cz + nz * 0.34, 8, CYAN, 0.8);
      if (g.on) lightsBlink(g, [[0.68, 0.68, 0.36], [-0.68, 0.68, 0.36], [0.68, -0.68, 0.36]], CYAN, 4);
    },
  },
  h_airpad: {
    build: (m, P) => {
      slab(m, 3, 2, hConcrete);
      m.box(0.18, 0, 0.07, 2.4, 1.76, 0.2, H.mid, { taper: [0.96, 0.94] });
      m.box(0.18, 0, 0.27, 2.2, 1.56, 0.02, H.deep);
      m.cyl(0.3, 0, 0.29, 0.62, 0.008, P.p, { sides: 6 });
      m.cyl(0.3, 0, 0.298, 0.47, 0.006, H.deep, { sides: 6 });
      m.box(0.3, 0, 0.304, 0.5, 0.1, 0.005, P.p);
      for (const [px, py] of [[-0.8, -0.7], [1.2, -0.7], [-0.8, 0.7], [1.2, 0.7]]) m.box(px, py, 0.29, 0.07, 0.07, 0.03, H.glow, { emis: true });
      // control tower
      m.box(-1.16, -0.58, 0.07, 0.42, 0.52, 0.86, H.hull, { taper: 0.84 });
      m.box(-1.16, -0.58, 0.93, 0.4, 0.5, 0.14, H.glass);
      m.box(-1.16, -0.58, 1.07, 0.44, 0.54, 0.05, P.p);
      m.bar(-1.16, -0.58, 1.12, -1.16, -0.58, 1.5, 0.014, H.dark);
      m.box(-1.16, 0.5, 0.07, 0.4, 0.7, 0.3, H.mid, { taper: 0.85 });
    },
    live: (g) => {
      lightsBlink(g, [[-0.8, -0.7, 0.32], [1.2, -0.7, 0.32], [-0.8, 0.7, 0.32], [1.2, 0.7, 0.32]], CYAN, 5);
      if (g.on) g.glow(-1.16, -0.58, 1.52, 6, RED, 0.4 + 0.4 * Math.sin(g.t * 4));
    },
  },
  h_lab: {
    build: (m, P) => {
      slab(m, 3, 2, hConcrete);
      m.box(-0.82, 0, 0.07, 1.1, 1.66, 0.5, H.hull, { taper: [0.86, 0.9] });
      m.box(-0.82, 0, 0.57, 0.7, 1.1, 0.03, P.p);
      winX(m, -0.3, 0, 0.26, 0.9, 0.1, H.glow);
      winY(m, -0.82, 0.78, 0.26, 0.6, 0.1, H.glow);
      m.box(-0.1, 0, 0.07, 0.5, 0.44, 0.3, H.dark);
      // dome
      m.cyl(0.6, 0, 0.07, 0.68, 0.24, H.mid, { sides: 10 });
      m.cyl(0.6, 0, 0.31, 0.6, 0.05, H.glow, { sides: 10, emis: true });
      m.dome(0.6, 0, 0.36, 0.56, 0.5, H.glass, { sides: 10 });
      // antenna cluster
      m.bar(-1.1, -0.5, 0.57, -1.1, -0.5, 1.15, 0.016, H.dark);
      m.bar(-0.9, -0.6, 0.57, -0.9, -0.6, 0.95, 0.016, H.dark);
      m.box(-1.1, -0.5, 1.15, 0.05, 0.05, 0.05, H.glow, { emis: true });
      m.box(-0.9, -0.6, 0.95, 0.05, 0.05, 0.05, H.glow, { emis: true });
    },
    live: (g) => {
      if (!g.on) return;
      const c = g.ctx;
      const cx = X(0.6, 0), cy = Y(0.6, 0, 1.06);
      c.strokeStyle = 'rgba(116,244,255,0.7)'; c.lineWidth = 1.4;
      c.setLineDash([10, 6]); c.lineDashOffset = -g.t * 22;
      c.beginPath(); c.ellipse(cx, cy, 20, 9, 0, 0, Math.PI * 2); c.stroke();
      c.lineDashOffset = g.t * 16;
      c.beginPath(); c.ellipse(cx, cy - 6, 12, 5.5, 0, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      g.glow(0.6, 0, 0.7, 30, CYAN, 0.25 + 0.1 * Math.sin(g.t * 2.2 + g.seed));
    },
  },
  h_uplink: {
    build: (m, P) => {
      slab(m, 3, 3, hConcrete);
      m.cyl(0, 0, 0.07, 1.3, 0.16, H.mid, { sides: 6 });
      m.cyl(0, 0, 0.23, 0.92, 0.24, H.hull, { sides: 6, taper: 0.84 });
      m.cyl(0, 0, 0.47, 0.5, 0.08, P.p, { sides: 6 });
      m.cyl(0, 0, 0.55, 0.3, 0.2, H.glow, { sides: 8, emis: true, taper: 0.7 });
      // three inward-curving prongs
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 6 + (i / 3) * Math.PI * 2 + Math.PI / 2;
        const cx = Math.cos(a), sy = Math.sin(a);
        m.bar(cx * 1.08, sy * 1.08, 0.2, cx * 0.97, sy * 0.97, 0.84, 0.13, H.hull, { taper: 0.85 });
        m.bar(cx * 0.97, sy * 0.97, 0.84, cx * 0.92, sy * 0.92, 1.08, 0.125, P.p, { taper: 0.92 });
        m.bar(cx * 0.92, sy * 0.92, 1.08, cx * 0.9, sy * 0.9, 1.2, 0.105, H.hull, { taper: 0.92 });
        m.bar(cx * 0.9, sy * 0.9, 1.2, cx * 0.42, sy * 0.42, 2.05, 0.095, H.mid, { taper: 0.6 });
        m.box(cx * 0.42, sy * 0.42, 2.05, 0.09, 0.09, 0.1, H.glow, { emis: true });
      }
    },
    live: (g) => {
      if (!g.on) return;
      const ch = g.charge;
      const p = 0.5 + 0.5 * Math.sin(g.t * (2 + ch * 6) + g.seed);
      g.glow(0, 0, 0.75, 22, CYAN, 0.35);
      g.glow(0, 0, 1.75, 10 + ch * 26 + p * 5, CYAN, 0.3 + ch * 0.5);
      if (ch > 0.02) {
        const c = g.ctx;
        c.strokeStyle = `rgba(160,250,255,${0.25 + ch * 0.5})`; c.lineWidth = 1 + ch * 2;
        c.beginPath(); c.moveTo(0, Y(0, 0, 0.75)); c.lineTo(0, Y(0, 0, 1.75)); c.stroke();
        if (ch >= 1) {
          const gr = c.createLinearGradient(0, Y(0, 0, 1.75), 0, Y(0, 0, 4.4));
          gr.addColorStop(0, 'rgba(190,252,255,0.75)'); gr.addColorStop(1, 'rgba(190,252,255,0)');
          c.strokeStyle = gr; c.lineWidth = 2 + p * 1.5;
          c.beginPath(); c.moveTo(0, Y(0, 0, 1.75)); c.lineTo(0, Y(0, 0, 4.4)); c.stroke();
        }
      }
    },
  },
  h_wall: {
    build: (m, P, mask) => {
      const arm = (dx: number, dy: number): void => {
        const lx = dx ? 0.5 : 0.2, ly = dy ? 0.5 : 0.2;
        m.box(dx * 0.26, dy * 0.26, 0, lx, ly, 0.36, H.mid);
        m.box(dx * 0.26, dy * 0.26, 0.36, dx ? 0.5 : 0.08, dy ? 0.5 : 0.08, 0.025, H.glow, { emis: true });
      };
      if (mask & 1) arm(0, -1);
      if (mask & 2) arm(1, 0);
      if (mask & 4) arm(0, 1);
      if (mask & 8) arm(-1, 0);
      m.cyl(0, 0, 0, 0.22, 0.44, H.hull, { sides: 6, taper: 0.9 });
      m.cyl(0, 0, 0.44, 0.2, 0.05, P.p, { sides: 6, taper: 0.7 });
    },
  },
  h_sentry: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.42, 0.1, hConcrete, { sides: 6 });
      m.cyl(0, 0, 0.1, 0.34, 0.16, H.mid, { sides: 6, taper: 0.8 });
      m.cyl(0, 0, 0.26, 0.28, 0.04, P.p, { sides: 6 });
    },
    turret: (m, P) => {
      m.box(-0.02, 0, 0, 0.3, 0.26, 0.15, H.hull, { taper: [0.8, 0.85] });
      m.box(-0.06, 0, 0.15, 0.14, 0.16, 0.015, P.p);
      m.bar(0.08, -0.07, 0.07, 0.5, -0.07, 0.07, 0.02, H.gun);
      m.bar(0.08, 0.07, 0.07, 0.5, 0.07, 0.07, 0.02, H.gun);
      m.box(0.135, 0, 0.09, 0.012, 0.07, 0.035, H.glow, { emis: true });
    },
    pivot: [0, 0, 0.3], muzzles: [[0.52, -0.07, 0.07], [0.52, 0.07, 0.07]], recoil: 0.03, flash: 9,
  },
  h_skyshield: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.44, 0.1, hConcrete, { sides: 6 });
      m.cyl(0, 0, 0.1, 0.36, 0.14, H.mid, { sides: 6, taper: 0.8 });
      m.cyl(0, 0, 0.24, 0.16, 0.2, H.dark, { sides: 6 });
      m.cyl(0, 0, 0.24, 0.3, 0.03, P.p, { sides: 6 });
    },
    turret: (m, P) => {
      m.box(0, 0, 0, 0.14, 0.2, 0.12, H.mid);
      for (const s of [-1, 1]) {
        m.bar(-0.16, s * 0.19, 0.04, 0.16, s * 0.19, 0.3, 0.095, H.hull, { sides: 4 });
        m.bar(0.16, s * 0.19, 0.3, 0.19, s * 0.19, 0.325, 0.07, H.glow, { sides: 4, emis: true });
        m.box(-0.02, s * 0.19, 0.245, 0.1, 0.1, 0.02, P.p);
      }
      m.bar(0, 0, 0.12, 0, 0, 0.36, 0.012, H.dark);
    },
    pivot: [0, 0, 0.44], muzzles: [[0.2, -0.19, 0.33], [0.2, 0.19, 0.33]], recoil: 0.02, flash: 11,
  },
  h_railturret: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.46, 0.1, hConcrete, { sides: 6 });
      m.cyl(0, 0, 0.1, 0.4, 0.26, H.hull, { sides: 6, taper: 0.76 });
      m.cyl(0, 0, 0.36, 0.3, 0.05, P.p, { sides: 6 });
      m.cyl(0, 0, 0.2, 0.37, 0.04, H.glow, { sides: 6, emis: true });
    },
    turret: (m, P) => {
      m.poly([-0.3, -0.18, 0.08, -0.18, 0.2, -0.09, 0.2, 0.09, 0.08, 0.18, -0.3, 0.18], 0, 0.17, H.mid, { taper: 0.85 });
      m.box(-0.14, 0, 0.17, 0.22, 0.2, 0.02, P.p);
      m.bar(0.12, -0.07, 0.09, 0.9, -0.05, 0.09, 0.028, H.hull);
      m.bar(0.12, 0.07, 0.09, 0.9, 0.05, 0.09, 0.028, H.hull);
      m.bar(0.16, 0, 0.09, 0.84, 0, 0.09, 0.014, H.glow, { emis: true });
      m.box(0.46, 0, 0.05, 0.05, 0.18, 0.08, H.dark);
      m.box(0.74, 0, 0.055, 0.04, 0.15, 0.07, H.dark);
      m.box(-0.26, 0, 0.17, 0.08, 0.26, 0.05, H.glow, { emis: true });
    },
    pivot: [0, 0, 0.42], muzzles: [[0.94, 0, 0.09]], recoil: 0.08, flash: 18,
  },

  // ══════════════════════════════ Ferrum Syndicate ══════════════════════════════
  f_core: {
    build: (m, P) => {
      slab(m, 3, 3, fConcrete);
      m.box(-0.3, -0.3, 0.07, 2.0, 2.0, 0.72, F.iron);
      m.box(-0.3, -0.3, 0.79, 2.08, 2.08, 0.06, F.dark);
      m.box(-0.62, -0.62, 0.85, 1.2, 1.2, 0.4, F.mid);
      m.box(-0.62, -0.62, 1.25, 1.0, 1.0, 0.03, P.p);
      // furnace mouths
      m.box(-0.3, 0.71, 0.14, 0.9, 0.04, 0.5, F.black);
      winY(m, -0.3, 0.73, 0.18, 0.66, 0.36, F.glow);
      m.box(0.71, -0.3, 0.2, 0.04, 0.7, 0.36, F.black);
      winX(m, 0.73, -0.3, 0.24, 0.5, 0.24, F.glow);
      // banner plates
      m.box(0.72, 0.4, 0.44, 0.02, 0.34, 0.26, P.p);
      m.box(0.4, 0.72, 0.44, 0.34, 0.02, 0.26, P.p);
      chimney(m, -1.0, -0.2, 0.85, 0.18, 1.15);
      chimney(m, -0.2, -1.0, 0.85, 0.21, 1.4);
      // yard crane
      m.bar(1.08, 1.08, 0.07, 1.08, 1.08, 1.34, 0.055, F.dark);
      m.bar(1.08, 1.2, 1.3, 1.08, -0.3, 1.3, 0.045, F.hazard);
      m.bar(1.08, 0.1, 1.28, 1.08, 0.1, 0.8, 0.012, F.black);
      m.box(1.08, 0.1, 0.72, 0.12, 0.12, 0.08, F.black);
      // crates
      m.box(0.2, 1.12, 0.07, 0.3, 0.3, 0.24, F.rust);
      m.box(1.1, -1.0, 0.07, 0.34, 0.5, 0.3, F.mid);
    },
    smoke: [[-1.0, -0.2, 2.05], [-0.2, -1.0, 2.3]],
    live: (g) => {
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(-0.3, 0.76, 0.36, 30, ORANGE, 0.45 * f);
      g.glow(0.76, -0.3, 0.36, 24, ORANGE, 0.38 * f);
    },
  },
  f_power: {
    build: (m, P) => {
      slab(m, 2, 2, fConcrete);
      m.box(-0.26, -0.1, 0.07, 1.1, 1.5, 0.58, F.iron);
      m.box(-0.26, -0.1, 0.65, 1.16, 1.56, 0.05, F.dark);
      m.box(-0.2, 0.2, 0.7, 0.5, 0.7, 0.03, P.p);
      // horizontal boiler drum on the +x side
      const prof: number[] = [];
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2; prof.push(0.6 + Math.cos(a) * 0.3, 0.4 + Math.sin(a) * 0.3); }
      m.exY(prof, -0.78, 0.6, F.rust);
      const band = prof.map((v, i) => (i % 2 === 0 ? 0.6 + (v - 0.6) * 1.06 : 0.4 + (v - 0.4) * 1.06));
      m.exY(band, -0.5, -0.4, F.dark);
      m.exY(band, 0.2, 0.3, F.dark);
      m.box(0.6, -0.1, 0.07, 0.3, 1.2, 0.06, F.dark);
      winY(m, -0.26, 0.65, 0.14, 0.6, 0.26, F.glow);
      m.box(-0.26, 0.655, 0.12, 0.72, 0.02, 0.03, F.black);
      chimney(m, -0.56, -0.56, 0.7, 0.16, 0.95);
      chimney(m, -0.56, 0.02, 0.7, 0.14, 0.75);
    },
    smoke: [[-0.56, -0.56, 1.7], [-0.56, 0.02, 1.5]],
    live: (g) => {
      if (!g.on) return;
      g.glow(-0.26, 0.7, 0.26, 24, ORANGE, 0.5 * flicker(g.t, g.seed));
    },
  },
  f_refinery: {
    build: (m, P) => {
      slab(m, 3, 3, fConcrete);
      // blast furnace
      m.column(-0.82, -0.82, 0.07, 0.6, 1.15, F.iron, 0.72, 8, [[0.5, 0.1, F.hazard, 1.05], [0.9, 0.07, F.dark, 1.06]]);
      m.cyl(-0.82, -0.82, 1.22, 0.47, 0.12, F.dark, { sides: 8 });
      m.cyl(-0.82, -0.82, 1.34, 0.36, 0.015, F.glow, { sides: 8, emis: true });
      winY(m, -0.82, -0.24, 0.16, 0.26, 0.26, F.glow);
      winX(m, -0.24, -0.82, 0.16, 0.26, 0.26, F.glow);
      // sorting shed
      m.box(-0.86, 0.72, 0.07, 1.0, 1.3, 0.52, F.mid);
      m.box(-0.86, 0.72, 0.59, 1.06, 1.36, 0.05, F.dark);
      m.box(-0.86, 0.72, 0.64, 0.56, 0.9, 0.03, P.p);
      winX(m, -0.36, 0.72, 0.28, 0.8, 0.1, F.glow);
      // hopper feeding the furnace by conveyor
      m.box(0.5, -0.95, 0.07, 0.9, 0.8, 0.6, F.rust, { taper: [1.1, 1.1], top: F.black });
      m.box(0.5, -0.95, 0.67, 0.7, 0.6, 0.06, ORE, { taper: 0.6, top: ORE_L });
      m.bar(0.1, -0.9, 0.6, -0.6, -0.84, 1.16, 0.07, F.dark);
      // dock pad with hazard edges
      m.box(0.74, 0.56, 0.07, 1.34, 1.68, 0.035, F.black);
      for (let i = 0; i < 5; i++) m.box(0.2 + i * 0.27, 1.34, 0.105, 0.14, 0.08, 0.006, F.hazard);
      for (let i = 0; i < 6; i++) m.box(1.36, -0.18 + i * 0.28, 0.105, 0.08, 0.14, 0.006, F.hazard);
      chimney(m, 1.14, -1.14, 0.07, 0.13, 1.4);
    },
    smoke: [[1.14, -1.14, 1.52], [-0.82, -0.82, 1.4]],
    live: (g) => {
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(-0.82, -0.82, 1.36, 26 + g.active * 12, ORANGE, (0.4 + g.active * 0.4) * f);
      g.glow(-0.82, -0.2, 0.3, 14, ORANGE, 0.4 * f);
      g.glow(0.5, -0.95, 0.74, 12 + g.active * 10, MAGENTA, 0.2 + g.active * 0.5);
    },
  },
  f_barracks: {
    build: (m, P) => {
      slab(m, 2, 2, fConcrete);
      const arch = (s: number): number[] => [-0.7 * s, 0, 0.7 * s, 0, 0.7 * s, 0.3 * s, 0.45 * s, 0.58 * s, 0, 0.68 * s, -0.45 * s, 0.58 * s, -0.7 * s, 0.3 * s];
      m.exX(arch(1), -0.86, 0.52, F.iron);
      for (const x of [-0.62, -0.16, 0.3]) m.exX(arch(1.04), x - 0.035, x + 0.035, F.dark);
      m.exX(arch(1.045), -0.44, -0.2 - 0.14, F.dark);
      m.exX(arch(1.05), -0.02, 0.2, P.p);
      m.box(0.525, 0, 0.07, 0.02, 0.4, 0.42, F.black);
      winX(m, 0.53, 0, 0.52, 0.2, 0.06, F.glow);
      // sandbags + crates + flag
      m.box(0.72, -0.62, 0.07, 0.3, 0.5, 0.16, F.sand, { taper: 0.85 });
      m.box(0.72, 0.4, 0.07, 0.26, 0.26, 0.2, F.rust);
      m.bar(0.78, 0.8, 0.07, 0.78, 0.8, 1.1, 0.025, F.black);
      m.box(0.78, 0.63, 0.8, 0.025, 0.32, 0.24, P.p);
      m.cyl(-0.5, -0.36, 0.56, 0.06, 0.34, F.black, { sides: 6 });
    },
    smoke: [[-0.5, -0.36, 0.92]],
    live: (g) => {
      if (g.on) g.glow(0.56, 0, 0.55, 9, ORANGE, 0.6);
    },
  },
  f_factory: {
    build: (m, P) => {
      slab(m, 3, 3, fConcrete);
      m.box(-0.2, -0.24, 0.07, 2.36, 2.2, 0.78, F.iron);
      // sawtooth roof with lit skylights
      for (let i = 0; i < 3; i++) {
        const x0 = -1.38 + i * 0.787;
        m.exY([x0, 0.85, x0 + 0.787, 0.85, x0 + 0.787, 1.16], -1.34, 0.86, F.mid);
        winX(m, x0 + 0.787 - 0.004, -0.24, 0.9, 1.9, 0.2, mul(F.glow, 0.9));
      }
      // heavy door on the +y face
      m.box(-0.2, 0.87, 0.07, 1.5, 0.03, 0.6, F.black);
      m.box(-0.2, 0.885, 0.67, 1.6, 0.03, 0.08, F.hazard);
      m.box(-0.2, 0.89, 0.07, 1.3, 0.012, 0.52, hex('#3a2a20'));
      m.box(-0.2, 0.885, 0.76, 1.0, 0.02, 0.07, P.p);
      // apron + gantry
      m.box(-0.2, 1.16, 0.07, 1.8, 0.52, 0.03, F.black);
      m.bar(-1.1, 1.3, 0.07, -1.1, 1.3, 0.95, 0.045, F.dark);
      m.bar(0.72, 1.3, 0.07, 0.72, 1.3, 0.95, 0.045, F.dark);
      m.bar(-1.16, 1.3, 0.95, 0.78, 1.3, 0.95, 0.05, F.hazard);
      // side annex + chimneys
      m.box(1.2, 0.2, 0.07, 0.44, 1.2, 0.46, F.mid);
      m.box(1.2, 0.2, 0.53, 0.3, 0.9, 0.03, P.p);
      chimney(m, 1.16, -1.0, 0.07, 0.17, 1.7);
      m.box(1.16, -1.0, 0.07, 0.5, 0.5, 0.3, F.dark);
    },
    smoke: [[1.16, -1.0, 1.82]],
    live: (g) => {
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(-0.2, 0.92, 0.4, 36, ORANGE, 0.14 + g.active * 0.5 * f);
    },
  },
  f_radar: {
    build: (m, P) => {
      slab(m, 2, 2, fConcrete);
      m.box(0, 0, 0.07, 1.2, 1.2, 0.34, F.iron, { taper: 0.86 });
      m.box(0.52, 0, 0.12, 0.02, 0.3, 0.22, F.black);
      // lattice tower
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.bar(sx * 0.34, sy * 0.34, 0.41, sx * 0.15, sy * 0.15, 1.5, 0.035, F.dark);
      for (const z of [0.78, 1.14]) {
        const r = 0.34 - ((z - 0.41) / 1.09) * 0.19;
        m.bar(-r, r, z, r, r, z, 0.02, F.dark); m.bar(r, -r, z, r, r, z, 0.02, F.dark);
        m.bar(-r, -r, z, r, -r, z, 0.02, F.dark); m.bar(-r, -r, z, -r, r, z, 0.02, F.dark);
      }
      m.box(0, 0, 1.5, 0.56, 0.56, 0.06, F.mid);
      m.box(0, 0, 1.56, 0.36, 0.36, 0.2, F.rust);
      winX(m, 0.18, 0, 1.62, 0.26, 0.08, F.glow);
      winY(m, 0, 0.18, 1.62, 0.26, 0.08, F.glow);
      m.box(0, 0, 1.76, 0.42, 0.42, 0.04, P.p);
      m.box(-0.74, 0.7, 0.07, 0.3, 0.3, 0.22, F.rust);
      m.box(0.7, -0.74, 0.07, 0.34, 0.3, 0.3, F.mid);
    },
    live: (g) => {
      const c = g.ctx;
      const th = g.on ? g.t * 1.4 + g.seed : g.seed;
      const ux = Math.cos(th) * 0.52, uy = Math.sin(th) * 0.52;
      const z0 = 1.88, z1 = 2.16;
      c.strokeStyle = css(F.black, 1); c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, Y(0, 0, 1.8)); c.lineTo(0, Y(0, 0, z1)); c.stroke();
      c.beginPath();
      c.moveTo(X(-ux, -uy), Y(-ux, -uy, z0)); c.lineTo(X(ux, uy), Y(ux, uy, z0));
      c.lineTo(X(ux, uy), Y(ux, uy, z1)); c.lineTo(X(-ux, -uy), Y(-ux, -uy, z1)); c.closePath();
      c.fillStyle = 'rgba(40,36,33,0.7)'; c.fill();
      c.strokeStyle = css(F.steel, 1); c.lineWidth = 1.4; c.stroke();
      c.beginPath();
      for (let i = -2; i <= 2; i++) {
        const k = i / 3;
        c.moveTo(X(ux * k, uy * k), Y(ux * k, uy * k, z0)); c.lineTo(X(ux * k, uy * k), Y(ux * k, uy * k, z1));
      }
      c.lineWidth = 0.8; c.stroke();
      if (g.on) {
        g.glow(0, 0, 2.2, 6, RED, 0.4 + 0.5 * Math.sin(g.t * 5 + g.seed));
        g.glow(0.2, 0.2, 1.66, 12, ORANGE, 0.35);
      }
    },
  },
  f_airpad: {
    build: (m, P) => {
      slab(m, 3, 2, fConcrete);
      m.box(0.22, 0, 0.07, 2.3, 1.74, 0.07, F.dark);
      m.cyl(0.3, 0, 0.14, 0.64, 0.008, P.p, { sides: 8 });
      m.cyl(0.3, 0, 0.148, 0.5, 0.006, F.black, { sides: 8 });
      m.box(0.3, 0, 0.154, 0.16, 0.7, 0.005, P.p);
      for (let i = 0; i < 7; i++) m.box(-0.74 + i * 0.32, 0.8, 0.14, 0.16, 0.1, 0.006, F.hazard);
      for (let i = 0; i < 5; i++) m.box(1.3, -0.64 + i * 0.32, 0.14, 0.1, 0.16, 0.006, F.hazard);
      // fuel tanks, shack, mast
      m.cyl(-1.16, -0.56, 0.07, 0.23, 0.5, F.rust, { sides: 8 });
      m.cyl(-1.16, -0.56, 0.57, 0.23, 0.07, F.dark, { sides: 8, taper: 0.6 });
      m.cyl(-1.16, -0.06, 0.07, 0.2, 0.4, F.hazard, { sides: 8 });
      m.cyl(-1.16, -0.06, 0.47, 0.2, 0.06, F.dark, { sides: 8, taper: 0.6 });
      m.box(-1.14, 0.6, 0.07, 0.5, 0.5, 0.42, F.iron);
      m.box(-1.14, 0.6, 0.49, 0.56, 0.56, 0.04, F.dark);
      winX(m, -0.89, 0.6, 0.26, 0.3, 0.1, F.glow);
      m.bar(-0.7, -0.78, 0.07, -0.7, -0.78, 1.05, 0.02, F.black);
      m.box(-0.7, -0.66, 0.86, 0.02, 0.24, 0.14, P.p);
    },
    live: (g) => {
      lightsBlink(g, [[-0.86, 0.8, 0.18], [1.3, 0.8, 0.18], [1.3, -0.8, 0.18], [-0.7, -0.78, 1.08]], RED, 4.4);
    },
  },
  f_lab: {
    build: (m, P) => {
      slab(m, 3, 2, fConcrete);
      m.box(0, -0.12, 0.07, 2.56, 1.46, 0.66, F.iron, { taper: [0.95, 0.9] });
      m.box(0, -0.12, 0.73, 2.5, 1.38, 0.05, F.dark);
      m.box(-0.34, -0.2, 0.78, 1.6, 1.0, 0.36, F.mid, { taper: 0.92 });
      // buttresses
      for (const x of [-0.98, -0.34, 0.34, 0.98]) m.box(x, 0.66, 0.07, 0.2, 0.26, 0.56, F.dark, { taper: [1, 0.5], shift: [0, -0.06] });
      m.box(0, 0.6, 0.07, 0.4, 0.03, 0.42, F.black);
      winY(m, 0, 0.612, 0.5, 0.4, 0.05, F.glow);
      m.box(-0.66, 0.6, 0.3, 0.3, 0.02, 0.22, P.p);
      m.box(0.66, 0.6, 0.3, 0.3, 0.02, 0.22, P.p);
      winX(m, 1.2, -0.12, 0.3, 1.0, 0.08, F.glow);
      // roof gear emblem
      m.cyl(-0.34, -0.2, 1.14, 0.36, 0.07, F.steel, { sides: 8 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        m.box(-0.34 + Math.cos(a) * 0.38, -0.2 + Math.sin(a) * 0.38, 1.14, 0.12, 0.12, 0.07, F.steel, { rot: a });
      }
      m.cyl(-0.34, -0.2, 1.21, 0.18, 0.03, P.p, { sides: 8 });
      chimney(m, 0.86, -0.56, 0.78, 0.13, 0.85);
      chimney(m, 1.1, -0.2, 0.78, 0.11, 0.65);
    },
    smoke: [[0.86, -0.56, 1.68], [1.1, -0.2, 1.48]],
    live: (g) => {
      if (!g.on) return;
      const f = flicker(g.t, g.seed);
      g.glow(1.24, -0.12, 0.34, 20, ORANGE, 0.32 * f);
      g.glow(0, 0.64, 0.5, 10, ORANGE, 0.5);
    },
  },
  f_drill: {
    build: (m, P) => {
      slab(m, 3, 3, fConcrete);
      m.box(0, 0, 0.07, 2.3, 2.3, 0.38, F.iron, { taper: 0.9 });
      m.box(0, 0, 0.45, 1.5, 1.5, 0.04, F.dark);
      m.cyl(0, 0, 0.49, 0.42, 0.06, F.black, { sides: 8 });
      m.cyl(0, 0, 0.55, 0.3, 0.012, F.glow, { sides: 8, emis: true });
      m.box(1.04, 0.3, 0.16, 0.02, 0.5, 0.2, P.p);
      m.box(0.3, 1.04, 0.16, 0.5, 0.02, 0.2, P.p);
      winX(m, 1.05, -0.5, 0.16, 0.5, 0.14, F.glow);
      // derrick
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.bar(sx * 0.86, sy * 0.86, 0.45, sx * 0.26, sy * 0.26, 2.05, 0.07, F.dark);
      for (const z of [0.98, 1.52]) {
        const r = 0.86 - ((z - 0.45) / 1.6) * 0.6;
        m.bar(-r, r, z, r, r, z, 0.035, F.mid); m.bar(r, -r, z, r, r, z, 0.035, F.mid);
        m.bar(-r, -r, z, r, -r, z, 0.035, F.mid); m.bar(-r, -r, z, -r, r, z, 0.035, F.mid);
      }
      m.box(0, 0, 2.05, 0.66, 0.66, 0.14, F.mid);
      m.box(0, 0, 2.19, 0.7, 0.7, 0.05, F.hazard);
      m.box(0, 0, 2.24, 0.5, 0.5, 0.04, P.p);
      // engine house + stack
      m.box(-0.9, -0.9, 0.45, 0.46, 0.46, 0.4, F.rust);
      chimney(m, -0.9, -0.9, 0.85, 0.11, 0.7);
    },
    smoke: [[-0.9, -0.9, 1.6]],
    live: (g) => {
      const c = g.ctx;
      // pounding piston inside the derrick
      const ph = g.on ? g.t * (2.2 + g.charge * 3) + g.seed : 1;
      const off = Math.abs(Math.sin(ph)) * 0.5;
      const yb = Y(0, 0, 0.58 + off), yt = Y(0, 0, 1.5 + off);
      c.fillStyle = css(F.steel, 0.9); c.fillRect(-7, yt, 7, yb - yt);
      c.fillStyle = css(F.steel, 0.6); c.fillRect(0, yt, 7, yb - yt);
      c.fillStyle = css(F.hazard, 0.95); c.fillRect(-8, yb - 9, 16, 5);
      c.fillStyle = css(F.black, 1); c.fillRect(-3, yt - 22, 6, 22);
      c.beginPath(); c.moveTo(-7, yb); c.lineTo(0, yb + 11); c.lineTo(7, yb); c.closePath(); c.fillStyle = css(F.dark, 1); c.fill();
      if (!g.on) return;
      const hit = Math.max(0, 1 - off * 4);
      g.glow(0, 0, 0.56, 22 + hit * 16 + g.charge * 14, ORANGE, 0.3 + hit * 0.4 + g.charge * 0.2);
      g.glow(0, 0, 2.3, 6, RED, 0.4 + 0.5 * Math.sin(g.t * 5));
    },
  },
  f_wall: {
    build: (m, P, mask) => {
      const arm = (dx: number, dy: number): void => {
        m.box(dx * 0.28, dy * 0.28, 0, dx ? 0.46 : 0.3, dy ? 0.46 : 0.3, 0.3, F.concrete, { taper: dx ? [1, 0.8] : [0.8, 1] });
        m.bar(dx * 0.3, dy * 0.3, 0.3, dx * 0.3, dy * 0.3, 0.46, 0.012, F.rust);
      };
      if (mask & 1) arm(0, -1);
      if (mask & 2) arm(1, 0);
      if (mask & 4) arm(0, 1);
      if (mask & 8) arm(-1, 0);
      m.box(0, 0, 0, 0.46, 0.46, 0.4, F.concrete, { taper: 0.82 });
      m.box(0, 0, 0.4, 0.32, 0.32, 0.03, P.p);
      for (const [px, py] of [[-0.09, -0.09], [0.09, 0.09], [0.09, -0.09], [-0.09, 0.09]]) m.bar(px, py, 0.43, px * 1.2, py * 1.2, 0.58, 0.012, F.rust);
    },
  },
  f_bunker: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.47, 0.08, F.sand, { sides: 10 });
      m.cyl(0, 0, 0.06, 0.43, 0.26, F.iron, { sides: 8, taper: 0.78 });
      m.cyl(0, 0, 0.32, 0.36, 0.07, F.dark, { sides: 8, taper: 0.9 });
      m.cyl(0, 0, 0.39, 0.17, 0.03, P.p, { sides: 8 });
      // firing slits on the two visible flanks
      m.box(0.375, 0, 0.18, 0.02, 0.26, 0.06, F.black);
      m.box(0, 0.375, 0.18, 0.26, 0.02, 0.06, F.black);
      m.box(0.26, 0.26, 0.18, 0.2, 0.02, 0.06, F.black, { rot: -Math.PI / 4 });
    },
    muzzles: [[0.42, 0, 0.2]], flash: 9, recoil: 0,
  },
  f_flaknest: {
    build: (m, P) => {
      m.cyl(0, 0, 0, 0.47, 0.17, F.sand, { sides: 10, taper: 0.92, top: F.black });
      m.cyl(0, 0, 0.17, 0.4, 0.012, F.black, { sides: 10 });
      m.cyl(0, 0, 0.05, 0.14, 0.2, F.dark, { sides: 6 });
    },
    turret: (m, P) => {
      m.box(-0.04, 0, 0, 0.2, 0.26, 0.14, F.mid);
      m.box(0.08, 0, 0, 0.03, 0.44, 0.24, P.p);
      for (const y of [-0.16, -0.07, 0.07, 0.16]) m.bar(0.02, y, 0.12, 0.4, y, 0.52, 0.02, F.gun);
      m.box(-0.18, 0, 0, 0.12, 0.2, 0.1, F.rust);
    },
    pivot: [0, 0, 0.27], muzzles: [[0.42, -0.12, 0.54], [0.42, 0.12, 0.54]], recoil: 0.03, flash: 10,
  },
  f_siege: {
    build: (m, P) => {
      m.box(0, 0, 0, 0.9, 0.9, 0.1, fConcrete);
      m.box(0, 0, 0.1, 0.76, 0.76, 0.2, F.iron, { taper: 0.84 });
      m.box(0, 0, 0.3, 0.6, 0.6, 0.03, F.hazard);
    },
    turret: (m, P) => {
      m.cyl(0, 0, 0, 0.24, 0.06, F.dark, { sides: 8 });
      m.box(-0.04, 0, 0.06, 0.4, 0.42, 0.2, F.mid, { taper: [0.85, 0.85] });
      m.box(-0.06, 0, 0.26, 0.24, 0.3, 0.02, P.p);
      m.box(0.19, 0, 0.08, 0.08, 0.26, 0.17, F.dark);
      m.bar(0.2, 0, 0.17, 0.78, 0, 0.17, 0.06, F.gun, { sides: 6 });
      m.box(0.84, 0, 0.11, 0.12, 0.18, 0.12, F.black);
      m.box(-0.3, 0, 0.06, 0.14, 0.3, 0.14, F.rust);
    },
    pivot: [0, 0, 0.33], muzzles: [[0.92, 0, 0.17]], recoil: 0.1, flash: 22,
  },
};

export const BUILDING_FALLBACK: BuildingArt = {
  build: (m, P) => {
    m.box(0, 0, 0, 0.9, 0.9, 0.5, hex('#888888'));
    m.box(0, 0, 0.5, 0.6, 0.6, 0.05, P.p);
  },
};
