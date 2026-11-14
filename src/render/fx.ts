// Effects: pooled particles (smoke, fire, sparks, debris), tracers, beams, shock rings, scorch decals,
// collapsing buildings and the three support-power set pieces. Everything is spawned from sim events.
import type { ProjectileKind, SupportPowerId } from '../core/types';
import { HH, HW, type Sprite, ZPX, hash2, makeCanvas } from './model';
import type { SpriteBank } from './sprites';

const MAXP = 2600;
/** Screen px radius (x) of a ground circle of 1 tile radius; y radius is half. */
export const GK = HW * Math.SQRT2;

const K_PUFF = 0, K_GLOW = 1, K_DEBRIS = 2, K_SPARK = 3;

interface Beam { tracer: boolean; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t0: number; dur: number; col: string; w: number }
interface Ring { x: number; y: number; z: number; r0: number; r1: number; t0: number; dur: number; col: string; w: number; add: boolean }
interface Decal { x: number; y: number; r: number; t0: number; life: number; crack: boolean; seed: number; a: number }
interface Sink { sp: Sprite; x: number; y: number; w: number; h: number; t0: number; dur: number; sell: boolean }
interface Power { id: SupportPowerId; x: number; y: number; t0: number; delay: number; dur: number; r: number; hit: number; acc: number }
interface Emitter { x: number; y: number; z: number; until: number; rate: number; acc: number; fire: boolean }
interface Delayed { t: number; x: number; y: number; z: number; size: number }
interface Floater { x: number; y: number; z: number; t0: number; rank: number }

const rnd = Math.random;
const rs = (a: number): number => (rnd() - 0.5) * 2 * a;

export class Fx {
  /** Seconds (wall clock from ViewState.time). */
  now = 0;
  /** Current screen-shake amplitude in css px. */
  shake = 0;
  // view rect in iso px for culling
  vx0 = 0; vy0 = 0; vx1 = 0; vy1 = 0;

  private n = 0;
  private kind = new Uint8Array(MAXP);
  private spr = new Uint8Array(MAXP);
  private px = new Float32Array(MAXP); private py = new Float32Array(MAXP); private pz = new Float32Array(MAXP);
  private vx = new Float32Array(MAXP); private vy = new Float32Array(MAXP); private vz = new Float32Array(MAXP);
  private life = new Float32Array(MAXP); private max = new Float32Array(MAXP);
  private s0 = new Float32Array(MAXP); private s1 = new Float32Array(MAXP);
  private al = new Float32Array(MAXP); private grav = new Float32Array(MAXP); private drag = new Float32Array(MAXP);

  private sprites: HTMLCanvasElement[] = [];
  private G_WHITE: number; private G_YELLOW: number; private G_ORANGE: number; private G_RED: number; private G_CYAN: number; private G_MAGENTA: number; private G_GOLD: number;
  private P_DARK: number; private P_GREY: number; private P_DUST: number; private P_LIGHT: number;
  private scorch: HTMLCanvasElement;

  private beams: Beam[] = [];
  private rings: Ring[] = [];
  private decals: Decal[] = [];
  private sinks: Sink[] = [];
  private powers: Power[] = [];
  private emitters: Emitter[] = [];
  private delayed: Delayed[] = [];
  private floaters: Floater[] = [];
  private glowByColor = new Map<string, number>();

  constructor(private bank: SpriteBank) {
    const g = (c: string): number => this.sprites.push(bank.glow(c)) - 1;
    const p = (c: string): number => this.sprites.push(bank.puff(c)) - 1;
    this.G_WHITE = g('#fff2d8'); this.G_YELLOW = g('#ffd060'); this.G_ORANGE = g('#ff8a2a'); this.G_RED = g('#e2401c');
    this.G_CYAN = g('#62e6ff'); this.G_MAGENTA = g('#f070d0'); this.G_GOLD = g('#ffd84a');
    this.P_DARK = p('#26221f'); this.P_GREY = p('#6e6a66'); this.P_DUST = p('#a8946e'); this.P_LIGHT = p('#cfc8bc');
    this.scorch = makeCanvas(64, 64);
    const sc = this.scorch.getContext('2d')!;
    for (let i = 0; i < 9; i++) {
      const x = i === 0 ? 32 : 32 + (hash2(i, 5) - 0.5) * 26, y = i === 0 ? 32 : 32 + (hash2(i, 9) - 0.5) * 26, r = i === 0 ? 30 : 10 + hash2(i, 3) * 10;
      const gr = sc.createRadialGradient(x, y, 0, x, y, r);
      const k = i === 0 ? 0.34 : 0.2;
      gr.addColorStop(0, `rgba(16,13,11,${k})`); gr.addColorStop(0.55, `rgba(16,13,11,${k * 0.55})`); gr.addColorStop(1, 'rgba(16,13,11,0)');
      sc.fillStyle = gr; sc.fillRect(0, 0, 64, 64);
    }
  }

  private glowIdx(col: string): number {
    let i = this.glowByColor.get(col);
    if (i === undefined) { i = this.sprites.push(this.bank.glow(col)) - 1; this.glowByColor.set(col, i); }
    return i;
  }

  clear(): void {
    this.n = 0; this.beams.length = 0; this.rings.length = 0; this.decals.length = 0; this.sinks.length = 0;
    this.powers.length = 0; this.emitters.length = 0; this.delayed.length = 0; this.floaters.length = 0; this.shake = 0;
  }

  get count(): number { return this.n; }

  private add(kind: number, spr: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a: number, grav: number, drag: number): void {
    if (this.n >= MAXP) return;
    const i = this.n++;
    this.kind[i] = kind; this.spr[i] = spr;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.al[i] = a; this.grav[i] = grav; this.drag[i] = drag;
  }

  // ───────────────────────────── spawners ─────────────────────────────

  smoke(x: number, y: number, z: number, dark: boolean, size = 1): void {
    this.add(K_PUFF, dark ? this.P_DARK : this.P_GREY, x + rs(0.05), y + rs(0.05), z, rs(0.12) + 0.18, rs(0.12) - 0.12, 0.55 + rnd() * 0.3, 1.6 + rnd() * 1.2, 9 * size, 34 * size, 0.6, -0.08, 0.5);
  }
  flame(x: number, y: number, z: number, size = 1): void {
    this.add(K_GLOW, rnd() < 0.5 ? this.G_ORANGE : this.G_YELLOW, x + rs(0.08), y + rs(0.08), z, rs(0.1), rs(0.1), 0.5 + rnd() * 0.5, 0.3 + rnd() * 0.3, 16 * size, 5 * size, 0.85, 0, 0.5);
  }
  dust(x: number, y: number, size = 1): void {
    this.add(K_PUFF, this.P_DUST, x + rs(0.1), y + rs(0.1), 0.03, rs(0.25), rs(0.25), 0.12 + rnd() * 0.15, 0.6 + rnd() * 0.5, 7 * size, 22 * size, 0.42, 0, 1.6);
  }
  trail(x: number, y: number, z: number): void {
    this.add(K_PUFF, this.P_LIGHT, x, y, z, rs(0.08), rs(0.08), 0.06, 0.55 + rnd() * 0.3, 5, 15, 0.5, 0, 0.8);
  }
  sparkle(x: number, y: number, z: number, col: string, n: number, spread = 0.4): void {
    const gi = this.glowIdx(col);
    for (let i = 0; i < n; i++) this.add(K_GLOW, gi, x + rs(spread), y + rs(spread), z + rnd() * 0.3, rs(0.3), rs(0.3), 0.5 + rnd() * 0.9, 0.5 + rnd() * 0.6, 7, 2, 0.9, 0, 0.6);
  }
  glowPulse(x: number, y: number, z: number, col: string, size: number, life: number): void {
    this.add(K_GLOW, this.glowIdx(col), x, y, z, 0, 0, 0, life, size, size * 0.4, 0.95, 0, 0);
  }
  private sparks(x: number, y: number, z: number, n: number, speed: number, cool: boolean): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, s = speed * (0.4 + rnd() * 0.8);
      this.add(K_SPARK, cool ? 1 : 0, x, y, z, Math.cos(a) * s, Math.sin(a) * s, 1 + rnd() * 3.2, 0.25 + rnd() * 0.45, 1, 1, 1, 9, 0.4);
    }
  }
  private debris(x: number, y: number, z: number, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, s = speed * (0.3 + rnd() * 0.9);
      this.add(K_DEBRIS, 0, x, y, z + 0.1, Math.cos(a) * s, Math.sin(a) * s, 2 + rnd() * 3.5, 0.8 + rnd() * 0.9, 2 + rnd() * 3, 1.5, 1, 9, 0.2);
    }
  }
  ring(x: number, y: number, z: number, r0: number, r1: number, dur: number, col: string, w: number, add = true): void {
    this.rings.push({ x, y, z, r0, r1, t0: this.now, dur, col, w, add });
  }
  scorchAt(x: number, y: number, r: number, life = 38): void {
    // refresh a nearby recent mark instead of stacking many on one spot
    const ds = this.decals;
    for (let i = ds.length - 1, n = 0; i >= 0 && n < 40; i--, n++) {
      const d = ds[i];
      if (!d.crack && Math.abs(d.x - x) < 0.45 && Math.abs(d.y - y) < 0.45 && d.r >= r * 0.8) { d.t0 = this.now; return; }
    }
    if (ds.length > 110) ds.shift();
    const big = Math.min(1, r / 1.6);
    ds.push({ x, y, r, t0: this.now, life: life * (0.45 + 0.55 * big), crack: false, seed: 0, a: 0.5 + 0.5 * big });
  }
  dustRing(x: number, y: number, r: number): void {
    const n = Math.min(26, 8 + r * 7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rs(0.2);
      this.add(K_PUFF, this.P_DUST, x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, 0.05, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.15 + rnd() * 0.2, 0.7 + rnd() * 0.5, 10, 30, 0.45, 0, 1.8);
    }
  }

  explode(x: number, y: number, z: number, size: number): void {
    const s = Math.max(0.25, size);
    this.add(K_GLOW, this.G_WHITE, x, y, z + 0.15, 0, 0, 0, 0.14, 90 * s, 50 * s, 1, 0, 0);
    this.add(K_GLOW, this.G_ORANGE, x, y, z + 0.1, 0, 0, 0, 0.4, 70 * s, 110 * s, 0.5, 0, 0);
    const nf = 4 + Math.round(s * 6);
    for (let i = 0; i < nf; i++) {
      const a = rnd() * 6.283, sp = (0.5 + rnd() * 1.4) * s;
      this.add(K_GLOW, i % 3 === 0 ? this.G_YELLOW : i % 3 === 1 ? this.G_ORANGE : this.G_RED, x + rs(0.1 * s), y + rs(0.1 * s), z + 0.1, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + rnd() * 1.5 * s, 0.3 + rnd() * 0.35, 26 * s, 10 * s, 0.9, 0.5, 1.6);
    }
    const ns = 2 + Math.round(s * 4);
    for (let i = 0; i < ns; i++) {
      const a = rnd() * 6.283, sp = rnd() * 0.5 * s;
      this.add(K_PUFF, this.P_DARK, x + rs(0.2 * s), y + rs(0.2 * s), z + 0.2, Math.cos(a) * sp + 0.15, Math.sin(a) * sp - 0.1, 0.6 + rnd() * 0.7, 1.2 + rnd() * 1.3, 18 * s, 52 * s, 0.6, -0.05, 0.7);
    }
    this.sparks(x, y, z + 0.1, 5 + Math.round(s * 9), 2.2 * s + 1, false);
    if (s > 0.55) this.debris(x, y, z, Math.round(s * 6), 1.6 + s);
    if (s > 0.7 && z < 0.5) this.ring(x, y, 0, 0.1, s * 1.5, 0.45, '#ffd9a0', 2.5);
    if (s > 0.9) this.shake = Math.max(this.shake, Math.min(7, s * 2.6));
  }

  /** Muzzle effects + instant-hit visuals for a weapon shot. */
  fire(kind: ProjectileKind, col: string, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, flash: number): void {
    switch (kind) {
      case 'tracer':
        this.beams.push({ tracer: true, x0: sx, y0: sy, z0: sz, x1: tx, y1: ty, z1: tz, t0: this.now, dur: 0.1, col, w: 1.6 });
        break;
      case 'beam': {
        this.beams.push({ tracer: false, x0: sx, y0: sy, z0: sz, x1: tx, y1: ty, z1: tz, t0: this.now, dur: 0.42, col, w: 3 });
        this.glowPulse(sx, sy, sz, col, 46, 0.3);
        const n = 9;
        for (let i = 1; i < n; i++) {
          const k = i / n;
          this.add(K_GLOW, this.glowIdx(col), sx + (tx - sx) * k + rs(0.06), sy + (ty - sy) * k + rs(0.06), sz + (tz - sz) * k, rs(0.2), rs(0.2), 0.2 + rnd() * 0.3, 0.35 + rnd() * 0.3, 9, 2, 0.8, 0, 0.5);
        }
        break;
      }
      case 'flame': {
        const dx = tx - sx, dy = ty - sy, dz = tz - sz;
        const d = Math.hypot(dx, dy) || 1;
        const tt = 0.38;
        for (let i = 0; i < 5; i++) {
          const k = 0.75 + rnd() * 0.5;
          this.add(K_GLOW, i % 3 === 0 ? this.G_YELLOW : i % 3 === 1 ? this.G_ORANGE : this.G_RED, sx, sy, sz, (dx / tt) * k + rs(d * 0.35), (dy / tt) * k + rs(d * 0.35), dz / tt + 0.3 + rnd() * 0.5, tt * (0.8 + rnd() * 0.5), 7, 30, 0.75, 0, 0.9);
        }
        if (rnd() < 0.35) this.add(K_PUFF, this.P_DARK, tx + rs(0.3), ty + rs(0.3), tz + 0.2, rs(0.2), rs(0.2), 0.7, 1.1, 12, 34, 0.4, 0, 0.6);
        break;
      }
      case 'flakburst':
        this.beams.push({ tracer: true, x0: sx, y0: sy, z0: sz, x1: tx, y1: ty, z1: tz, t0: this.now, dur: 0.12, col, w: 1.2 });
        break;
      case 'bomb':
        return;
      default: {
        // shell / arc / missile: muzzle smoke
        const dx = tx - sx, dy = ty - sy;
        const d = Math.hypot(dx, dy) || 1;
        for (let i = 0; i < 2; i++) this.add(K_PUFF, this.P_LIGHT, sx, sy, sz, (dx / d) * (0.5 + rnd()) + rs(0.2), (dy / d) * (0.5 + rnd()) + rs(0.2), 0.2, 0.5 + rnd() * 0.3, 6, 20, 0.45, 0, 2);
      }
    }
    if (flash > 0) this.add(K_GLOW, kind === 'beam' ? this.G_CYAN : this.G_YELLOW, sx, sy, sz, 0, 0, 0, 0.09, flash * 2.4, flash * 1.2, 1, 0, 0);
  }

  impact(kind: ProjectileKind, col: string, x: number, y: number, z: number, splash: number): void {
    switch (kind) {
      case 'tracer':
        this.sparks(x, y, z + 0.1, 2, 1.2, false);
        if (z < 0.3 && rnd() < 0.5) this.dust(x, y, 0.6);
        this.add(K_GLOW, this.G_YELLOW, x, y, z + 0.1, 0, 0, 0, 0.08, 14, 6, 0.9, 0, 0);
        break;
      case 'beam':
        this.add(K_GLOW, this.G_WHITE, x, y, z + 0.15, 0, 0, 0, 0.16, 70, 30, 1, 0, 0);
        this.glowPulse(x, y, z + 0.15, col, 60, 0.4);
        this.ring(x, y, z, 0.1, 0.9, 0.35, col, 2);
        this.sparks(x, y, z + 0.15, 9, 2.4, true);
        if (z < 0.3) this.scorchAt(x, y, 0.35, 20);
        break;
      case 'flame':
        if (rnd() < 0.6) this.flame(x + rs(splash * 0.5), y + rs(splash * 0.5), z + 0.05, 1.1);
        if (rnd() < 0.08 && z < 0.3) this.scorchAt(x, y, 0.4 + splash * 0.4, 16);
        break;
      case 'flakburst': {
        this.add(K_GLOW, this.G_WHITE, x, y, z, 0, 0, 0, 0.1, 44, 20, 1, 0, 0);
        for (let i = 0; i < 4; i++) this.add(K_PUFF, this.P_DARK, x + rs(0.25), y + rs(0.25), z + rs(0.15), rs(0.3), rs(0.3), rs(0.2), 0.9 + rnd() * 0.6, 12, 30, 0.7, 0.05, 1.2);
        this.sparks(x, y, z, 6, 2, false);
        break;
      }
      default: {
        const size = 0.42 + splash * 0.85;
        this.explode(x, y, z, size);
        if (z < 0.4) this.scorchAt(x, y, 0.3 + splash * 0.7);
      }
    }
  }

  unitDeath(x: number, y: number, z: number, radius: number, infantry: boolean): void {
    if (infantry) {
      this.add(K_GLOW, this.G_ORANGE, x, y, 0.2, 0, 0, 0, 0.12, 22, 10, 0.8, 0, 0);
      for (let i = 0; i < 3; i++) this.dust(x, y, 0.8);
      this.debris(x, y, 0.1, 2, 1);
      return;
    }
    const size = radius * 2.5;
    this.explode(x, y, z, size);
    if (z > 0.5) {
      // aircraft: flaming wreckage rains down
      for (let i = 0; i < 6; i++) this.add(K_GLOW, this.G_ORANGE, x, y, z, rs(1.2), rs(1.2), 1 + rnd() * 1.5, 0.9 + rnd() * 0.5, 12, 4, 0.9, 5, 0.2);
      this.debris(x, y, z, 8, 2.2);
      this.delayed.push({ t: this.now + 0.65, x: x + rs(0.4), y: y + rs(0.4), z: 0, size: size * 0.6 });
    } else {
      this.scorchAt(x, y, radius * 1.8);
      this.emitters.push({ x, y, z: 0.15, until: this.now + 3.5, rate: 7, acc: 0, fire: true });
    }
  }

  buildingCollapse(sp: Sprite | null, x: number, y: number, w: number, h: number): void {
    const r = Math.max(w, h) / 2;
    if (sp) this.sinks.push({ sp, x, y, w, h, t0: this.now, dur: 1.0, sell: false });
    const n = Math.round(3 + w * h * 0.9);
    for (let i = 0; i < n; i++) this.delayed.push({ t: this.now + i * (0.75 / n), x: x + rs(w * 0.42), y: y + rs(h * 0.42), z: rnd() * 0.6, size: 0.7 + rnd() * 0.5 + r * 0.25 });
    this.explode(x, y, 0.3, 0.9 + r * 0.6);
    this.dustRing(x, y, r + 0.3);
    this.debris(x, y, 0.4, Math.round(8 + w * h * 2), 2.4);
    this.scorchAt(x, y, r * 1.5, 60);
    this.emitters.push({ x, y, z: 0.2, until: this.now + 5, rate: 9, acc: 0, fire: true });
    this.shake = Math.max(this.shake, 3 + r * 2);
  }

  sell(sp: Sprite | null, x: number, y: number, w: number, h: number): void {
    if (sp) this.sinks.push({ sp, x, y, w, h, t0: this.now, dur: 0.7, sell: true });
    this.dustRing(x, y, Math.max(w, h) / 2);
    this.sparkle(x, y, 0.3, '#ffd84a', 14, Math.max(w, h) * 0.4);
  }

  promote(x: number, y: number, z: number, rank: number): void {
    this.floaters.push({ x, y, z, t0: this.now, rank });
    this.sparkle(x, y, z + 0.3, '#ffd84a', 8, 0.25);
    this.ring(x, y, 0, 0.2, 0.9, 0.5, '#ffd84a', 2);
  }

  powerUsed(id: SupportPowerId, x: number, y: number, r: number, delay: number, dur: number): void {
    this.powers.push({ id, x, y, t0: this.now, delay, dur, r, hit: -1, acc: 0 });
    if (id === 'recon_sweep') this.ring(x, y, 0, 0.3, r, 0.6, '#7dffd9', 2.5);
  }

  powerImpact(id: SupportPowerId, x: number, y: number, r: number, dur: number): void {
    let p: Power | undefined;
    for (const q of this.powers) if (q.id === id && q.hit < 0 && Math.abs(q.x - x) < 0.6 && Math.abs(q.y - y) < 0.6) { p = q; break; }
    if (!p) { p = { id, x, y, t0: this.now, delay: 0, dur, r, hit: -1, acc: 0 }; this.powers.push(p); }
    p.hit = this.now;
    p.r = r;
    if (id === 'orbital_lance') {
      this.add(K_GLOW, this.G_WHITE, x, y, 0.3, 0, 0, 0, 0.3, 420, 260, 1, 0, 0);
      for (let i = 0; i < 3; i++) this.rings.push({ x, y, z: 0, r0: 0.2, r1: r * (1.1 + i * 0.35), t0: this.now + i * 0.1, dur: 0.7 + i * 0.15, col: '#aef6ff', w: 4 - i, add: true });
      this.explode(x, y, 0, 2.6);
      this.debris(x, y, 0.2, 26, 4);
      this.scorchAt(x, y, r * 0.95, 70);
      this.shake = Math.max(this.shake, 10);
    } else if (id === 'tremor') {
      for (let i = 0; i < 4; i++) {
        this.rings.push({ x, y, z: 0, r0: 0.2, r1: r * 1.15, t0: this.now + i * 0.13, dur: 0.75, col: '#e8c890', w: 7 - i * 1.4, add: false });
        this.rings.push({ x, y, z: 0, r0: 0.1, r1: r * 1.1, t0: this.now + i * 0.13, dur: 0.7, col: '#ff9a3c', w: 3, add: true });
      }
      for (let i = 0; i < 46; i++) {
        const a = rnd() * 6.283, rr = rnd() * r;
        this.add(K_PUFF, this.P_DUST, x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.05, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0.3 + rnd() * 0.6, 1 + rnd() * 0.9, 14, 46, 0.5, 0, 1.4);
      }
      for (let i = 0; i < 5; i++) this.debris(x + rs(r * 0.6), y + rs(r * 0.6), 0, 7, 1.6);
      if (this.decals.length > 150) this.decals.shift();
      this.decals.push({ x, y, r, t0: this.now, life: 30, crack: true, seed: (x * 31 + y * 17) | 0, a: 1 });
      this.shake = Math.max(this.shake, 11);
    } else {
      this.ring(x, y, 0, 0.3, r, 0.6, '#7dffd9', 2.5);
    }
  }

  // ───────────────────────────── simulation ─────────────────────────────

  update(dt: number): void {
    if (dt > 0.1) dt = 0.1;
    this.shake *= Math.exp(-dt * 5.5);
    if (this.shake < 0.05) this.shake = 0;
    const { kind, px, py, pz, vx, vy, vz, life, grav, drag } = this;
    for (let i = 0; i < this.n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          kind[i] = kind[l]; this.spr[i] = this.spr[l]; px[i] = px[l]; py[i] = py[l]; pz[i] = pz[l]; vx[i] = vx[l]; vy[i] = vy[l]; vz[i] = vz[l];
          life[i] = life[l]; this.max[i] = this.max[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l]; this.al[i] = this.al[l]; grav[i] = grav[l]; drag[i] = drag[l];
        }
        i--;
        continue;
      }
      const d = 1 - drag[i] * dt;
      vx[i] *= d; vy[i] *= d; vz[i] = vz[i] * d - grav[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (pz[i] < 0 && grav[i] > 0) { pz[i] = 0; vz[i] = -vz[i] * 0.3; vx[i] *= 0.5; vy[i] *= 0.5; }
    }
    // delayed secondary blasts
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i];
      if (d.t <= this.now) { this.explode(d.x, d.y, d.z, d.size); this.delayed.splice(i, 1); }
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (e.until <= this.now) { this.emitters.splice(i, 1); continue; }
      const k = Math.min(1, (e.until - this.now) / 1.5);
      e.acc += dt * e.rate * k;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.smoke(e.x + rs(0.15), e.y + rs(0.15), e.z, true, 0.9);
        if (e.fire && rnd() < 0.6 * k) this.flame(e.x + rs(0.2), e.y + rs(0.2), e.z, 0.9);
      }
    }
    // support-power particle streams
    for (let i = this.powers.length - 1; i >= 0; i--) {
      const p = this.powers[i];
      const t = this.now - p.t0;
      if (p.hit < 0) {
        if (t > p.delay + 0.8) { this.powers.splice(i, 1); continue; }
        if (p.id === 'tremor') {
          p.acc += dt * 12;
          while (p.acc >= 1) { p.acc -= 1; const a = rnd() * 6.283, r = Math.sqrt(rnd()) * p.r; this.dust(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 1.1); }
          this.shake = Math.max(this.shake, 1.2 * Math.min(1, t / Math.max(0.1, p.delay)));
        } else if (p.id === 'orbital_lance') {
          p.acc += dt * 14;
          while (p.acc >= 1) { p.acc -= 1; const a = rnd() * 6.283, r = p.r * (0.3 + rnd() * 0.7); this.add(K_GLOW, this.G_CYAN, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 0.1, -Math.cos(a) * r * 1.6, -Math.sin(a) * r * 1.6, 0.5 + rnd(), 0.6, 8, 2, 0.8, 0, 0); }
        }
      } else {
        const th = this.now - p.hit;
        if (th > p.dur) { this.powers.splice(i, 1); continue; }
        if (p.id === 'orbital_lance') {
          const env = th > p.dur - 0.5 ? (p.dur - th) / 0.5 : 1;
          p.acc += dt * 70 * env;
          while (p.acc >= 1) {
            p.acc -= 1;
            const a = rnd() * 6.283, r = Math.sqrt(rnd()) * p.r * 0.8;
            const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
            const q = rnd();
            if (q < 0.4) this.add(K_SPARK, 1, x, y, 0.1, Math.cos(a) * 2.5, Math.sin(a) * 2.5, 2 + rnd() * 5, 0.4 + rnd() * 0.4, 1, 1, 1, 8, 0.3);
            else if (q < 0.7) this.add(K_GLOW, rnd() < 0.5 ? this.G_CYAN : this.G_WHITE, x, y, 0.1, rs(0.4), rs(0.4), 1.5 + rnd() * 3, 0.4 + rnd() * 0.4, 20, 5, 0.8, 0, 0.3);
            else this.add(K_PUFF, this.P_DARK, x, y, 0.2, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.8 + rnd(), 1.4 + rnd(), 20, 60, 0.5, 0, 0.6);
          }
          this.shake = Math.max(this.shake, 3.5 * env);
        }
      }
    }
  }

  private vis(X: number, Y: number, m: number): boolean {
    return X > this.vx0 - m && X < this.vx1 + m && Y > this.vy0 - m && Y < this.vy1 + m;
  }

  // ───────────────────────────── drawing (ctx carries the camera transform) ─────────────────────────────

  /** Ground decals + ground-level phases of support powers. Draw right after terrain. */
  drawGround(ctx: CanvasRenderingContext2D): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const t = (this.now - d.t0) / d.life;
      if (t >= 1) { this.decals.splice(i, 1); continue; }
      const X = (d.x - d.y) * HW, Y = (d.x + d.y) * HH;
      const rx = d.r * GK;
      if (!this.vis(X, Y, rx + 20)) continue;
      const a = (t > 0.5 ? (1 - t) / 0.5 : 1) * d.a;
      if (d.crack) this.drawCracks(ctx, d.x, d.y, d.r, 1, a, d.seed, false);
      else { ctx.globalAlpha = a; ctx.drawImage(this.scorch, X - rx, Y - rx / 2, rx * 2, rx); }
    }
    ctx.globalAlpha = 1;
    for (const p of this.powers) {
      const X = (p.x - p.y) * HW, Y = (p.x + p.y) * HH;
      if (!this.vis(X, Y, p.r * GK + 40)) continue;
      const t = this.now - p.t0;
      if (p.id === 'tremor' && p.hit < 0) {
        const k = Math.min(1, t / Math.max(0.1, p.delay));
        this.drawCracks(ctx, p.x, p.y, p.r, k, 0.9, (p.x * 31 + p.y * 17) | 0, true);
        ctx.strokeStyle = `rgba(255,170,90,${0.25 + 0.25 * k})`; ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]); ctx.lineDashOffset = t * 30;
        for (let i = 0; i < 2; i++) {
          const rr = p.r * (1 - ((t * 0.7 + i * 0.5) % 1) * 0.9);
          ctx.beginPath(); ctx.ellipse(X, Y, rr * GK, rr * GK / 2, 0, 0, 6.3); ctx.stroke();
        }
        ctx.setLineDash([]);
      } else if (p.id === 'orbital_lance' && p.hit < 0) {
        const k = Math.min(1, t / Math.max(0.1, p.delay));
        ctx.strokeStyle = `rgba(130,240,255,${0.35 + 0.4 * k})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(X, Y, p.r * GK, p.r * GK / 2, 0, 0, 6.3); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const f = (t * (0.6 + k) + i / 3) % 1;
          const rr = p.r * (1 - f);
          ctx.strokeStyle = `rgba(130,240,255,${f * 0.7})`;
          ctx.beginPath(); ctx.ellipse(X, Y, rr * GK, rr * GK / 2, 0, 0, 6.3); ctx.stroke();
        }
      } else if (p.id === 'recon_sweep') {
        const th = this.now - (p.hit < 0 ? p.t0 : p.hit);
        const fade = Math.min(1, Math.max(0, (p.dur - th) / 2)) * Math.min(1, th * 3);
        const rx = p.r * GK;
        ctx.save();
        ctx.translate(X, Y); ctx.scale(1, 0.5);
        ctx.strokeStyle = `rgba(125,255,217,${0.5 * fade})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.3); ctx.stroke();
        ctx.strokeStyle = `rgba(125,255,217,${0.18 * fade})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, rx * 0.66, 0, 6.3); ctx.moveTo(rx * 0.33, 0); ctx.arc(0, 0, rx * 0.33, 0, 6.3); ctx.stroke();
        const ang = th * 2.2;
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = `rgba(125,255,217,${(0.22 - i * 0.021) * fade})`;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, rx, ang - (i + 1) * 0.09, ang - i * 0.09); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = `rgba(200,255,240,${0.8 * fade})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * rx, Math.sin(ang) * rx); ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawCracks(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, grow: number, alpha: number, seed: number, glow: boolean): void {
    const n = 9;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < (glow ? 2 : 1); pass++) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        let a = (i / n) * 6.283 + hash2(seed, i) * 0.5;
        let cx = x, cy = y;
        const len = r * (0.6 + hash2(seed + 1, i) * 0.4) * grow;
        ctx.moveTo((cx - cy) * HW, (cx + cy) * HH);
        const segs = 6;
        for (let s = 1; s <= segs; s++) {
          a += (hash2(seed + s * 7, i) - 0.5) * 0.9;
          cx += Math.cos(a) * (len / segs); cy += Math.sin(a) * (len / segs);
          ctx.lineTo((cx - cy) * HW, (cx + cy) * HH);
        }
      }
      if (glow && pass === 0) { ctx.strokeStyle = `rgba(255,140,50,${0.5 * alpha})`; ctx.lineWidth = 5; }
      else { ctx.strokeStyle = `rgba(20,14,10,${0.75 * alpha})`; ctx.lineWidth = 2; }
      ctx.stroke();
    }
  }

  /** Buildings sinking into the ground (destroyed / sold). */
  drawSinks(ctx: CanvasRenderingContext2D): void {
    for (let i = this.sinks.length - 1; i >= 0; i--) {
      const s = this.sinks[i];
      const p = (this.now - s.t0) / s.dur;
      if (p >= 1) { this.sinks.splice(i, 1); continue; }
      const X = (s.x - s.y) * HW, Y = (s.x + s.y) * HH;
      if (!this.vis(X, Y, 200)) continue;
      const hw = s.w / 2, hh = s.h / 2;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(X + (-hw - hh) * HW - 60, Y + (-hw + hh) * HH);
      ctx.lineTo(X + (-hw - hh) * HW, Y + (-hw + hh) * HH);
      ctx.lineTo(X + (hw - hh) * HW, Y + (hw + hh) * HH);
      ctx.lineTo(X + (hw + hh) * HW, Y + (hw - hh) * HH);
      ctx.lineTo(X + (hw + hh) * HW + 60, Y + (hw - hh) * HH);
      ctx.lineTo(X + (hw + hh) * HW + 60, Y - 400);
      ctx.lineTo(X + (-hw - hh) * HW - 60, Y - 400);
      ctx.closePath();
      ctx.clip();
      const drop = p * p * (s.sp.h * 0.9);
      const jit = s.sell ? 0 : Math.sin(this.now * 70) * 2 * (1 - p);
      ctx.globalAlpha = s.sell ? 1 - p * 0.6 : 1;
      ctx.drawImage(s.sp.c, X - s.sp.ox + jit, Y - s.sp.oy + drop, s.sp.w, s.sp.h);
      ctx.restore();
      if (!s.sell && rnd() < 0.5) this.dust(s.x + rs(s.w * 0.5), s.y + rs(s.h * 0.5), 1.4);
    }
    ctx.globalAlpha = 1;
  }

  /** Alpha-blended particles (smoke, dust, debris). `high` selects particles above/below 1.3 tiles so aircraft sort between. */
  drawSoft(ctx: CanvasRenderingContext2D): void {
    const { kind, px, py, pz, life, max, s0, s1, al, spr, sprites } = this;
    for (let i = 0; i < this.n; i++) {
      const k = kind[i];
      if (k !== K_PUFF && k !== K_DEBRIS) continue;
      const X = (px[i] - py[i]) * HW, Y = (px[i] + py[i]) * HH - pz[i] * ZPX;
      if (X < this.vx0 - 40 || X > this.vx1 + 40 || Y < this.vy0 - 40 || Y > this.vy1 + 40) continue;
      const t = 1 - life[i] / max[i];
      if (k === K_PUFF) {
        const s = s0[i] + (s1[i] - s0[i]) * t;
        ctx.globalAlpha = al[i] * (1 - t) * (t < 0.12 ? t / 0.12 : 1);
        ctx.drawImage(sprites[spr[i]], X - s / 2, Y - s / 2, s, s);
      } else {
        ctx.globalAlpha = t > 0.75 ? (1 - t) * 4 : 1;
        ctx.fillStyle = '#231f1c';
        const s = s0[i];
        ctx.fillRect(X - s / 2, Y - s / 2, s, s * 0.75);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Additive pass: fire, glows, sparks, tracers, beams, rings, support-power beams. Caller sets 'lighter'. */
  drawAdd(ctx: CanvasRenderingContext2D): void {
    const { kind, px, py, pz, vx, vy, vz, life, max, s0, s1, al, spr, sprites } = this;
    for (let i = 0; i < this.n; i++) {
      if (kind[i] !== K_GLOW) continue;
      const X = (px[i] - py[i]) * HW, Y = (px[i] + py[i]) * HH - pz[i] * ZPX;
      const t = 1 - life[i] / max[i];
      const s = s0[i] + (s1[i] - s0[i]) * t;
      if (X < this.vx0 - s || X > this.vx1 + s || Y < this.vy0 - s || Y > this.vy1 + s) continue;
      ctx.globalAlpha = al[i] * (1 - t * t);
      ctx.drawImage(sprites[spr[i]], X - s / 2, Y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    // sparks: two batched paths (warm / cool)
    ctx.lineCap = 'round';
    for (let c = 0; c < 2; c++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < this.n; i++) {
        if (kind[i] !== K_SPARK || spr[i] !== c) continue;
        const X = (px[i] - py[i]) * HW, Y = (px[i] + py[i]) * HH - pz[i] * ZPX;
        if (X < this.vx0 || X > this.vx1 || Y < this.vy0 || Y > this.vy1) continue;
        const k = 0.045;
        ctx.moveTo(X, Y);
        ctx.lineTo(X - (vx[i] - vy[i]) * HW * k, Y - ((vx[i] + vy[i]) * HH - vz[i] * ZPX) * k);
        any = true;
      }
      if (any) { ctx.strokeStyle = c ? '#b8f4ff' : '#ffd98a'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    // tracers + beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      const p = (this.now - b.t0) / b.dur;
      if (p >= 1) { this.beams.splice(i, 1); continue; }
      const X0 = (b.x0 - b.y0) * HW, Y0 = (b.x0 + b.y0) * HH - b.z0 * ZPX, X1 = (b.x1 - b.y1) * HW, Y1 = (b.x1 + b.y1) * HH - b.z1 * ZPX;
      if (b.tracer) {
        const a = Math.max(0, p - 0.4), c = Math.min(1, p + 0.15);
        ctx.strokeStyle = b.col; ctx.lineWidth = b.w; ctx.globalAlpha = 0.95;
        ctx.beginPath(); ctx.moveTo(X0 + (X1 - X0) * a, Y0 + (Y1 - Y0) * a); ctx.lineTo(X0 + (X1 - X0) * c, Y0 + (Y1 - Y0) * c); ctx.stroke();
        ctx.globalAlpha = 0.14; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
      } else {
        const a = 1 - p;
        const wob = 1 + Math.sin(this.now * 90) * 0.15;
        ctx.strokeStyle = b.col;
        ctx.globalAlpha = 0.3 * a; ctx.lineWidth = b.w * 4.5 * wob;
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        ctx.globalAlpha = 0.7 * a; ctx.lineWidth = b.w * 1.8;
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = a; ctx.lineWidth = b.w * 0.7 * a + 0.4;
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const p = (this.now - r.t0) / r.dur;
      if (p >= 1) { this.rings.splice(i, 1); continue; }
      if (p < 0 || !r.add) continue;
      this.strokeRing(ctx, r, p);
    }
    ctx.globalAlpha = 1;
    // orbital lance
    for (const pw of this.powers) {
      if (pw.id !== 'orbital_lance') continue;
      const X = (pw.x - pw.y) * HW, Y = (pw.x + pw.y) * HH;
      if (X < this.vx0 - 300 || X > this.vx1 + 300) continue;
      if (pw.hit < 0) {
        const k = Math.min(1, (this.now - pw.t0) / Math.max(0.1, pw.delay));
        const fl = 0.7 + 0.3 * Math.sin(this.now * 40);
        const g = ctx.createLinearGradient(0, Y - 900, 0, Y);
        g.addColorStop(0, 'rgba(140,240,255,0)'); g.addColorStop(1, `rgba(170,246,255,${(0.2 + 0.6 * k) * fl})`);
        ctx.strokeStyle = g; ctx.lineWidth = 1 + k * 3;
        ctx.beginPath(); ctx.moveTo(X, Y - 900); ctx.lineTo(X, Y); ctx.stroke();
        const s = 30 + k * 90;
        ctx.globalAlpha = 0.3 + 0.5 * k;
        ctx.drawImage(sprites[this.G_CYAN], X - s, Y - s / 2, s * 2, s);
        ctx.globalAlpha = 1;
      } else {
        const th = this.now - pw.hit;
        const env = th < 0.12 ? th / 0.12 : th > pw.dur - 0.5 ? Math.max(0, (pw.dur - th) / 0.5) : 1;
        const wd = pw.r * GK * 0.42 * env * (1 + Math.sin(this.now * 55) * 0.06);
        if (wd > 0.5) {
          const top = Y - 2400;
          const g = ctx.createLinearGradient(X - wd, 0, X + wd, 0);
          g.addColorStop(0, 'rgba(60,180,255,0)'); g.addColorStop(0.25, 'rgba(90,220,255,0.45)');
          g.addColorStop(0.42, 'rgba(235,252,255,0.95)'); g.addColorStop(0.58, 'rgba(235,252,255,0.95)');
          g.addColorStop(0.75, 'rgba(90,220,255,0.45)'); g.addColorStop(1, 'rgba(60,180,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(X - wd, top, wd * 2, Y - top);
          const gr = pw.r * GK * 1.5 * env;
          ctx.globalAlpha = 0.9;
          ctx.drawImage(sprites[this.G_CYAN], X - gr, Y - gr / 2, gr * 2, gr);
          ctx.drawImage(sprites[this.G_WHITE], X - gr * 0.6, Y - gr * 0.3, gr * 1.2, gr * 0.6);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  /** Non-additive rings (dust shock fronts) and floating promotion chevrons. */
  drawOver(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const p = (this.now - r.t0) / r.dur;
      if (p < 0 || p >= 1 || r.add) continue;
      this.strokeRing(ctx, r, p);
    }
    ctx.globalAlpha = 1;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      const p = (this.now - f.t0) / 1.4;
      if (p >= 1) { this.floaters.splice(i, 1); continue; }
      const X = (f.x - f.y) * HW, Y = (f.x + f.y) * HH - (f.z + 0.5 + p * 0.7) * ZPX;
      ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
      ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 4.5; ctx.lineJoin = 'miter';
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let k = 0; k < f.rank; k++) { ctx.moveTo(X - 7, Y + k * 6); ctx.lineTo(X, Y - 5 + k * 6); ctx.lineTo(X + 7, Y + k * 6); }
        ctx.stroke();
        ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2.4;
      }
    }
    ctx.globalAlpha = 1;
  }

  private strokeRing(ctx: CanvasRenderingContext2D, r: Ring, p: number): void {
    const e = 1 - (1 - p) * (1 - p);
    const rr = (r.r0 + (r.r1 - r.r0) * e) * GK;
    const X = (r.x - r.y) * HW, Y = (r.x + r.y) * HH - r.z * ZPX;
    if (!this.vis(X, Y, rr + 10)) return;
    ctx.globalAlpha = (1 - p) * (r.add ? 0.9 : 0.6);
    ctx.strokeStyle = r.col;
    ctx.lineWidth = r.w * (1 - p * 0.5);
    ctx.beginPath(); ctx.ellipse(X, Y, rr, rr / 2, 0, 0, 6.3); ctx.stroke();
  }
}
