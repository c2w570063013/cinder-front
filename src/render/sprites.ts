// Sprite bank: lazily rasterised, cached sprites for units (32 directions), buildings, props and soft particles.
import { BUILDINGS, UNITS } from '../data';
import { BUILDING_ART, BUILDING_FALLBACK, type BuildingArt } from './art-buildings';
import { type Pal, UNIT_ART, UNIT_FALLBACK, type UnitArt, makePal } from './art-units';
import { HH, HW, Model, type RGB, type Sprite, ZPX, hash2, hex, makeCanvas, modelBounds, modelShadowPath, mul, renderSprite } from './model';

export const DIRS = 32;
export const DIR_STEP = (Math.PI * 2) / DIRS;

export function dirIndex(facing: number): number {
  return Math.round(facing / DIR_STEP) & (DIRS - 1);
}

export interface UnitSprites {
  art: UnitArt;
  pal: Pal;
  /** hull[frame * DIRS + dir] */
  hull: (Sprite | undefined)[];
  turret: (Sprite | undefined)[];
  /** Model height in tiles (hull + turret), and collision-ish extent. */
  height: number;
  air: boolean;
  gen: number;
}

export interface BuildingSprites {
  art: BuildingArt;
  pal: Pal;
  body: Sprite;
  shadow: Sprite;
  turret: (Sprite | undefined)[];
  height: number;
  w: number;
  h: number;
  gen: number;
}

const palCache = new Map<string, Pal>();
export function palOf(color: string): Pal {
  let p = palCache.get(color);
  if (!p) { p = makePal(color); palCache.set(color, p); }
  return p;
}

const heightCache = new Map<string, number>();
const NEUTRAL = makePal('#888888');
/** Visual height of a def in tiles (static, independent of sprite scale). */
export function defHeight(defId: string): number {
  let h = heightCache.get(defId);
  if (h === undefined) {
    const m = new Model();
    if (UNITS[defId]) {
      const a = UNIT_ART[defId] ?? UNIT_FALLBACK;
      a.hull(m, NEUTRAL, 0);
      h = m.height();
      if (a.turret) { const t = new Model(); a.turret(t, NEUTRAL); h = Math.max(h, a.pivot[2] + t.height()); }
    } else {
      const a = BUILDING_ART[defId] ?? BUILDING_FALLBACK;
      a.build(m, NEUTRAL, 0);
      h = m.height();
      if (a.turret && a.pivot) { const t = new Model(); a.turret(t, NEUTRAL); h = Math.max(h, a.pivot[2] + t.height()); }
    }
    heightCache.set(defId, h);
  }
  return h;
}

const SCALE_BUCKETS = [1, 1.5, 2, 3, 4];

export class SpriteBank {
  /** Backing px per iso px for building / prop sprites, and (capped) for units. */
  scale = 2;
  unitScale = 2;
  /** Bumped whenever caches are flushed, so per-entity cached references know to re-resolve. */
  gen = 1;
  private units = new Map<string, Map<string, UnitSprites>>();
  private buildings = new Map<string, BuildingSprites>();
  private props: (Sprite | undefined)[] = [];
  private glows = new Map<string, HTMLCanvasElement>();
  private puffs = new Map<string, HTMLCanvasElement>();
  private pixels = 0;

  /** Pick the sprite resolution for an effective scale (dpr × zoom). Returns true when caches were flushed. */
  setScale(eff: number): boolean {
    let b = SCALE_BUCKETS[SCALE_BUCKETS.length - 1];
    for (const s of SCALE_BUCKETS) if (s >= eff * 0.88) { b = s; break; }
    if (b === this.scale) return false;
    this.scale = b;
    this.unitScale = Math.min(b, 3);
    this.flush();
    return true;
  }

  flush(): void {
    this.units.clear();
    this.buildings.clear();
    this.props.length = 0;
    this.pixels = 0;
    this.gen++;
  }

  private account(s: Sprite): Sprite {
    this.pixels += s.c.width * s.c.height;
    return s;
  }
  /** Call once per frame: drops everything if the cache grew past its budget (it refills lazily). */
  budget(): void {
    if (this.pixels > 90e6) this.flush();
  }

  unitSet(defId: string, color: string): UnitSprites {
    let byDef = this.units.get(color);
    if (!byDef) { byDef = new Map(); this.units.set(color, byDef); }
    let s = byDef.get(defId);
    if (!s) {
      const art = UNIT_ART[defId] ?? UNIT_FALLBACK;
      s = { art, pal: palOf(color), hull: [], turret: [], height: defHeight(defId), air: UNITS[defId]?.movement === 'air', gen: this.gen };
      byDef.set(defId, s);
    }
    return s;
  }

  /** Milliseconds spent rasterising sprites this frame; past the budget we reuse the nearest cached direction. */
  private spent = 0;
  frameStart(): void { this.spent = 0; }
  private near(arr: (Sprite | undefined)[], base: number, dir: number): Sprite | undefined {
    if (this.spent < 5) return undefined;
    for (let k = 1; k <= DIRS / 2; k++) {
      const a = arr[base + ((dir + k) & (DIRS - 1))] ?? arr[base + ((dir - k) & (DIRS - 1))];
      if (a) return a;
    }
    return undefined;
  }

  hull(s: UnitSprites, dir: number, frame: number): Sprite {
    const i = frame * DIRS + dir;
    let sp = s.hull[i];
    if (!sp) {
      const nb = this.near(s.hull, frame * DIRS, dir) ?? (frame > 0 ? this.near(s.hull, 0, dir) ?? (this.spent >= 5 ? s.hull[dir] : undefined) : undefined);
      if (nb) return nb;
      const t0 = performance.now();
      const m = new Model();
      s.art.hull(m, s.pal, frame);
      sp = this.account(renderSprite(m, dir * DIR_STEP, this.unitScale, { outline: 0.6, shadow: s.air ? 0 : 0.3 }));
      s.hull[i] = sp;
      this.spent += performance.now() - t0;
    }
    return sp;
  }

  turret(s: { art: { turret?: (m: Model, P: Pal) => void }; pal: Pal; turret: (Sprite | undefined)[] }, dir: number): Sprite {
    let sp = s.turret[dir];
    if (!sp) {
      const nb = this.near(s.turret, 0, dir);
      if (nb) return nb;
      const t0 = performance.now();
      const m = new Model();
      s.art.turret!(m, s.pal);
      sp = this.account(renderSprite(m, dir * DIR_STEP, this.unitScale, { outline: 0.6 }));
      s.turret[dir] = sp;
      this.spent += performance.now() - t0;
    }
    return sp;
  }

  /** variant bits: 1 = unlit (unpowered), 2 = damaged, 4 = heavily damaged. `mask` = wall neighbours. */
  building(defId: string, color: string, variant: number, mask: number): BuildingSprites {
    const key = defId + '|' + color + '|' + variant + '|' + mask;
    let b = this.buildings.get(key);
    if (b) return b;
    const def = BUILDINGS[defId];
    const art = BUILDING_ART[defId] ?? BUILDING_FALLBACK;
    const pal = palOf(color);
    const m = new Model();
    m.unlit = (variant & 1) !== 0;
    art.build(m, pal, mask);
    const sc = this.scale;
    const body = renderSprite(m, 0, sc, { outline: 0.55 });
    const ctx = body.c.getContext('2d')!;
    if (variant & 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(16,20,30,0.42)';
      ctx.fillRect(0, 0, body.c.width, body.c.height);
    }
    if (variant & 6) {
      // scorch blotches + cracks baked onto the silhouette
      ctx.globalCompositeOperation = 'source-atop';
      const n = variant & 4 ? 11 : 5;
      const seed = defId.length * 31 + defId.charCodeAt(2) * 7;
      for (let i = 0; i < n; i++) {
        const x = hash2(seed + i, 3) * body.c.width, y = (0.15 + hash2(seed + i, 9) * 0.8) * body.c.height;
        const r = (6 + hash2(seed + i, 17) * 12) * sc;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(12,10,9,0.78)');
        g.addColorStop(1, 'rgba(12,10,9,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.strokeStyle = 'rgba(10,8,8,0.6)';
        ctx.lineWidth = Math.max(1, sc * 0.6);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (hash2(seed + i, 23) - 0.5) * r, y + r * 0.5);
        ctx.lineTo(x + (hash2(seed + i, 29) - 0.5) * r * 1.6, y + r);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    const w = def ? def.footprint.w : 1, h = def ? def.footprint.h : 1;
    b = { art, pal, body: this.account(body), shadow: this.account(buildingShadow(m, w, h)), turret: [], height: defHeight(defId), w, h, gen: this.gen };
    this.buildings.set(key, b);
    return b;
  }

  /** Tall terrain props. kind 0 = tree, 1 = rock. 8 variants each. */
  prop(kind: number, variant: number): Sprite {
    const i = kind * 8 + (variant & 7);
    let s = this.props[i];
    if (!s) {
      const m = new Model();
      if (kind === 0) treeModel(m, variant & 7); else rockModel(m, variant & 7);
      s = this.account(renderSprite(m, 0, this.scale, { outline: 0.4, shadow: 0.26 }));
      this.props[i] = s;
    }
    return s;
  }

  /** Additive glow blob (white-hot core falling off into `color`). */
  glow(color: string): HTMLCanvasElement {
    let c = this.glows.get(color);
    if (!c) {
      c = makeCanvas(64, 64);
      const ctx = c.getContext('2d')!;
      const [r, g, b] = hex(color);
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${Math.min(255, r + 120)},${Math.min(255, g + 120)},${Math.min(255, b + 120)},1)`);
      gr.addColorStop(0.22, `rgba(${r},${g},${b},0.75)`);
      gr.addColorStop(0.55, `rgba(${r},${g},${b},0.22)`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 64, 64);
      this.glows.set(color, c);
    }
    return c;
  }

  /** Soft lumpy smoke / dust puff in a flat colour. */
  puff(color: string): HTMLCanvasElement {
    let c = this.puffs.get(color);
    if (!c) {
      c = makeCanvas(64, 64);
      const ctx = c.getContext('2d')!;
      const [r, g, b] = hex(color);
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = i === 6 ? 32 : 32 + Math.cos(a) * 11, y = i === 6 ? 32 : 32 + Math.sin(a) * 11;
        const rad = i === 6 ? 22 : 13 + hash2(i, r) * 6;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
        gr.addColorStop(0.6, `rgba(${r},${g},${b},0.28)`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, 64, 64);
      }
      this.puffs.set(color, c);
    }
    return c;
  }
}

/** Fill the current path builder with a feathered edge of bounded extent (no canvas blur → no clipped tails). */
function softFill(ctx: CanvasRenderingContext2D, path: () => void, alpha: number, feather: number): void {
  const n = 7;
  const d = 1 - Math.pow(1 - alpha, 1 / (n + 1));
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = `rgba(6,8,14,${d})`;
  for (let i = n; i >= 1; i--) {
    ctx.lineWidth = (feather * 2 * i) / n;
    path();
    ctx.stroke();
  }
  path();
  ctx.fill('nonzero');
}

/** Soft ambient-occlusion halo around the footprint plus the projected body shadow (low-res, feathered). */
function buildingShadow(m: Model, w: number, h: number): Sprite {
  const mb = modelBounds(m, 0, true);
  // the footprint diamond (contact shadow) may be wider than the model itself
  const fx = ((w + h) / 2) * HW, fy = ((w + h) / 2) * HH;
  const b = [Math.min(mb[0], -fx), Math.min(mb[1], -fy), Math.max(mb[2], fx), Math.max(mb[3], fy)];
  const pad = 13;
  const ox = Math.ceil(-b[0] + pad), oy = Math.ceil(-b[1] + pad);
  const sw = Math.ceil(b[2] + pad) + ox, sh = Math.ceil(b[3] + pad) + oy;
  const c = makeCanvas(sw, sh);
  const ctx = c.getContext('2d')!;
  ctx.translate(ox, oy);
  softFill(ctx, () => modelShadowPath(ctx, m, 0, 1), 0.3, 4);
  // contact shadow hugging the footprint
  const hw = w / 2, hh = h / 2;
  softFill(ctx, () => {
    ctx.beginPath();
    ctx.moveTo((-hw + hh) * HW, (-hw - hh) * HH);
    ctx.lineTo((hw + hh) * HW, (hw - hh) * HH);
    ctx.lineTo((hw - hh) * HW, (hw + hh) * HH);
    ctx.lineTo((-hw - hh) * HW, (-hw + hh) * HH);
    ctx.closePath();
  }, 0.3, 10);
  return { c, ox, oy, w: sw, h: sh, s: 1 };
}

// ───────────────────────────── terrain props ─────────────────────────────

const BARK = hex('#4a3a2e');
const CHAR = hex('#2e2a28');
const PINE: RGB[] = [hex('#3f6e5c'), hex('#356052'), hex('#4b7a5e')];
const EMBER: RGB[] = [hex('#d07a34'), hex('#c2562c'), hex('#dba23e')];

function crown(m: Model, x: number, y: number, z: number, r: number, h: number, col: RGB, rot: number): void {
  m.cyl(x, y, z, r * 0.5, h * 0.36, mul(col, 0.86), { sides: 7, taper: 2, rot, noRim: true });
  m.cyl(x, y, z + h * 0.36, r, h * 0.3, col, { sides: 7, taper: 0.78, rot, noRim: true });
  m.cyl(x, y, z + h * 0.66, r * 0.78, h * 0.34, mul(col, 1.08), { sides: 7, taper: 0.3, rot, noRim: true });
}

function treeModel(m: Model, v: number): void {
  const j = (k: number): number => hash2(v * 13 + k, 77);
  if (v <= 2) {
    // layered conifer
    const s = 0.85 + v * 0.14;
    const col = PINE[v % 3];
    m.cyl(0, 0, 0, 0.055, 0.22 * s, BARK, { sides: 5 });
    m.cyl(0, 0, 0.16 * s, 0.34 * s, 0.4 * s, mul(col, 0.9), { sides: 6, taper: 0.3, rot: j(1), noRim: true });
    m.cyl(0, 0, 0.44 * s, 0.26 * s, 0.38 * s, col, { sides: 6, taper: 0.25, rot: j(2) + 0.5, noRim: true });
    m.cyl(0, 0, 0.72 * s, 0.17 * s, 0.4 * s, mul(col, 1.12), { sides: 6, taper: 0.04, rot: j(3) + 1, noRim: true });
  } else if (v <= 5) {
    // ember-leaf broadleaf
    const col = EMBER[v - 3];
    const s = 0.9 + j(4) * 0.25;
    m.cyl(0, 0, 0, 0.06, 0.3 * s, BARK, { sides: 5, taper: 0.8 });
    crown(m, 0, 0, 0.26 * s, 0.34 * s, 0.56 * s, col, j(5) * 2);
    if (v === 4) crown(m, 0.2, -0.16, 0.2, 0.2, 0.34, EMBER[0], j(6) * 2);
  } else if (v === 6) {
    // scrub cluster
    crown(m, -0.14, 0.08, 0.02, 0.2, 0.3, EMBER[2], 0.3);
    crown(m, 0.14, -0.06, 0.02, 0.24, 0.36, PINE[2], 1.1);
    crown(m, 0.04, 0.2, 0.0, 0.15, 0.22, EMBER[1], 2);
  } else {
    // charred snag
    m.cyl(0, 0, 0, 0.06, 0.62, CHAR, { sides: 5, taper: 0.5 });
    m.bar(0, 0, 0.4, 0.2, -0.1, 0.62, 0.022, CHAR);
    m.bar(0, 0, 0.3, -0.16, 0.12, 0.5, 0.02, CHAR);
    crown(m, 0.2, 0.2, 0.0, 0.14, 0.2, EMBER[1], 0.7);
  }
}

const BASALT: RGB[] = [hex('#7c7672'), hex('#6c6866'), hex('#8a8078')];

function boulder(m: Model, x: number, y: number, r: number, h: number, col: RGB, seed: number): void {
  const n = 6 + (seed & 1);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash2(seed, i) * 0.5;
    const rr = r * (0.78 + hash2(seed + 3, i) * 0.35);
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  const sx = (hash2(seed, 91) - 0.5) * r * 0.4, sy = (hash2(seed, 93) - 0.5) * r * 0.4;
  m.poly(pts, 0, h * 0.6, mul(col, 0.92), { taper: 0.84, shift: [sx * 0.5, sy * 0.5], noRim: true });
  const top = pts.map((v, i) => (i % 2 === 0 ? x + (v - x) * 0.84 + sx * 0.5 : y + (v - y) * 0.84 + sy * 0.5));
  m.poly(top, h * 0.6, h * 0.4, col, { taper: 0.55, shift: [sx, sy] });
}

function rockModel(m: Model, v: number): void {
  const j = (k: number): number => hash2(v * 17 + k, 41);
  const col = BASALT[v % 3];
  boulder(m, -0.08 + j(1) * 0.1, -0.1 + j(2) * 0.1, 0.4, 0.5 + j(3) * 0.45, col, v * 5 + 1);
  boulder(m, 0.2 + j(4) * 0.1, 0.2 + j(5) * 0.08, 0.24, 0.26 + j(6) * 0.2, BASALT[(v + 1) % 3], v * 5 + 2);
  if (v & 1) boulder(m, -0.26, 0.24, 0.17, 0.2, BASALT[(v + 2) % 3], v * 5 + 3);
  if (v % 3 === 0) boulder(m, 0.26, -0.24, 0.2, 0.3 + j(7) * 0.2, col, v * 5 + 4);
}

export { ZPX };
