// Terrain: soft "splat" blended ground + crisp procedural detail, baked into cached screen-space chunks.
// Only chunk regions whose ore level changed are repainted.
import { ORE_TILE_MAX } from '../core/constants';
import { type GameMap, Terrain as T } from '../core/types';
import { HH, HW, type Sprite, hash2, makeCanvas, vnoise } from './model';
import type { SpriteBank } from './sprites';

const CH = 512; // chunk size, iso px
const PADC = 1; // overlap so neighbouring chunks never show seams
const SPX = 6; // splat px per tile

// base colours (r,g,b) per terrain id
const C_GROUND = [128, 119, 88];
const C_GROUND2 = [112, 116, 84];
const C_ROUGH = [94, 88, 80];
const C_ROAD = [156, 147, 130];
const C_DEEP = [34, 78, 100];
const C_SHALLOW = [70, 138, 146];
const C_ROCKG = [90, 86, 82];
const C_TREEG = [92, 100, 70];
const C_VOID = [13, 14, 18];
export const VOID_CSS = 'rgb(13,14,18)';

interface Chunk {
  x0: number;
  y0: number;
  c: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scale: number;
  splat: HTMLCanvasElement;
  tx0: number;
  ty0: number;
  tn: number;
  water: Int32Array;
  used: number;
}

export function oreLevel(v: number): number {
  return v <= 0 ? 0 : Math.min(6, Math.ceil((v / ORE_TILE_MAX) * 6));
}

export class TerrainCache {
  map: GameMap | null = null;
  private chunks = new Map<number, Chunk>();
  private base = new Uint8Array(0); // rgb per tile
  private oreLvl = new Uint8Array(0);
  private frame = 0;
  /** 1 px per tile overview (terrain + ore), shared with the minimap. */
  mini: HTMLCanvasElement = makeCanvas(1, 1);
  private miniData: ImageData | null = null;
  private miniDirty = true;
  /** True while some visible chunk has not been baked yet. */
  pending = false;

  constructor(private bank: SpriteBank) {}

  setMap(map: GameMap): void {
    if (this.map === map && this.base.length === map.width * map.height * 3) return;
    this.map = map;
    this.chunks.clear();
    const n = map.width * map.height;
    this.base = new Uint8Array(n * 3);
    this.oreLvl = new Uint8Array(n);
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const i = ty * map.width + tx;
        const t = map.terrain[i];
        const v = map.variant[i] / 255;
        let c: number[];
        let j = 0.94 + v * 0.12;
        if (t === T.Ground) {
          const g = vnoise(tx * 0.11 + 5, ty * 0.11 + 9);
          c = [C_GROUND[0] + (C_GROUND2[0] - C_GROUND[0]) * g, C_GROUND[1] + (C_GROUND2[1] - C_GROUND[1]) * g, C_GROUND[2] + (C_GROUND2[2] - C_GROUND[2]) * g];
        } else if (t === T.Rough) c = C_ROUGH;
        else if (t === T.Road) { c = C_ROAD; j = 0.97 + v * 0.06; }
        else if (t === T.Water) c = C_DEEP;
        else if (t === T.Rock) c = C_ROCKG;
        else c = C_TREEG;
        this.base[i * 3] = c[0] * j; this.base[i * 3 + 1] = c[1] * j; this.base[i * 3 + 2] = c[2] * j;
        this.oreLvl[i] = oreLevel(map.ore[i]);
      }
    }
    this.mini = makeCanvas(map.width, map.height);
    this.miniData = this.mini.getContext('2d')!.createImageData(map.width, map.height);
    this.miniDirty = true;
  }

  /** Compare ore against the last painted levels; repaint the affected chunk regions. Call once per sim tick. */
  syncOre(): void {
    const map = this.map;
    if (!map) return;
    const ore = map.ore, lv = this.oreLvl, w = map.width;
    for (let i = 0, n = lv.length; i < n; i++) {
      const o = ore[i];
      const l = o <= 0 ? 0 : oreLevel(o);
      if (l !== lv[i]) {
        lv[i] = l;
        this.miniDirty = true;
        const tx = i % w, ty = (i / w) | 0;
        const cx = (tx - ty) * HW, cy = (tx + ty + 1) * HH;
        this.repaint(cx - 36, cy - 44, cx + 36, cy + 20);
      }
    }
  }

  private repaint(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.floor((x0 - PADC) / CH), cx1 = Math.floor((x1 + PADC) / CH);
    const cy0 = Math.floor((y0 - PADC) / CH), cy1 = Math.floor((y1 + PADC) / CH);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ch = this.chunks.get((cx + 512) * 4096 + cy + 512);
        if (ch) this.paint(ch, x0, y0, x1, y1, false);
      }
    }
  }

  /** Refresh the 1px/tile overview if terrain or ore changed. */
  miniCanvas(): HTMLCanvasElement {
    const map = this.map;
    if (map && this.miniDirty && this.miniData) {
      const d = this.miniData.data;
      for (let i = 0, n = map.width * map.height; i < n; i++) {
        let r = this.base[i * 3], g = this.base[i * 3 + 1], b = this.base[i * 3 + 2];
        const t = map.terrain[i];
        if (t === T.Tree) { r = 66; g = 92; b = 62; if (map.variant[i] % 8 >= 3 && map.variant[i] % 8 <= 5) { r = 170; g = 104; b = 50; } }
        else if (t === T.Rock) { r = 70; g = 66; b = 64; }
        else if (t === T.Water) { r = 40; g = 92; b = 112; }
        const l = this.oreLvl[i];
        if (l > 0) { const k = 0.45 + l * 0.09; r = r + (236 - r) * k; g = g + (90 - g) * k; b = b + (196 - b) * k; }
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
      this.mini.getContext('2d')!.putImageData(this.miniData, 0, 0);
      this.miniDirty = false;
    }
    return this.mini;
  }

  /**
   * Draw all chunks intersecting the iso-space view rect. `ctx` must already carry the camera transform.
   * Bakes missing chunks within a small time budget; unbaked area shows the blurred overview.
   */
  draw(ctx: CanvasRenderingContext2D, vx0: number, vy0: number, vx1: number, vy1: number, eff: number): void {
    const map = this.map;
    if (!map) return;
    this.frame++;
    const want = eff <= 1.3 ? 1 : 2;
    const mx0 = -map.height * HW, mx1 = map.width * HW, my1 = (map.width + map.height) * HH;
    const cx0 = Math.floor(Math.max(vx0, mx0) / CH), cx1 = Math.floor(Math.min(vx1, mx1 - 1) / CH);
    const cy0 = Math.floor(Math.max(vy0, 0) / CH), cy1 = Math.floor(Math.min(vy1, my1 - 1) / CH);
    const start = performance.now();
    let baked = 0;
    this.pending = false;
    // first pass: find out if anything is missing → draw the blurry overview underneath
    let missing = false;
    for (let cy = cy0; cy <= cy1 && !missing; cy++) for (let cx = cx0; cx <= cx1; cx++) if (!this.chunks.has((cx + 512) * 4096 + cy + 512)) { missing = true; break; }
    if (missing) {
      ctx.save();
      ctx.transform(HW, HH, -HW, HH, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.miniCanvas(), 0, 0);
      ctx.restore();
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = (cx + 512) * 4096 + cy + 512;
        let ch = this.chunks.get(key);
        if (!ch || ch.scale !== want) {
          if (baked === 0 || performance.now() - start < 7) {
            ch = this.bake(cx, cy, want);
            this.chunks.set(key, ch);
            baked++;
          } else this.pending = true;
        }
        if (ch) {
          ch.used = this.frame;
          ctx.drawImage(ch.c, ch.x0 - PADC, ch.y0 - PADC, CH + PADC * 2, CH + PADC * 2);
        }
      }
    }
    if (baked) this.evict();
  }

  private evict(): void {
    let px = 0;
    for (const ch of this.chunks.values()) px += ch.c.width * ch.c.height;
    if (px < 44e6) return;
    const arr = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, ch] of arr) {
      if (px < 34e6 || ch.used === this.frame) break;
      px -= ch.c.width * ch.c.height;
      this.chunks.delete(k);
    }
  }

  private bake(cx: number, cy: number, scale: number): Chunk {
    const map = this.map!;
    const x0 = cx * CH, y0 = cy * CH;
    const size = (CH + PADC * 2) * scale;
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d')!;
    // tile bounds for the splat (1 tile margin)
    const ax0 = x0 - PADC, ay0 = y0 - PADC, ax1 = x0 + CH + PADC, ay1 = y0 + CH + PADC;
    const tx0 = Math.floor((ax0 / HW + ay0 / HH) / 2) - 1;
    const tx1 = Math.ceil((ax1 / HW + ay1 / HH) / 2) + 1;
    const ty0 = Math.floor((ay0 / HH - ax1 / HW) / 2) - 1;
    const ty1 = Math.ceil((ay1 / HH - ax0 / HW) / 2) + 1;
    const tn = Math.max(tx1 - tx0, ty1 - ty0);
    const splat = this.makeSplat(tx0, ty0, tn);
    const water: number[] = [];
    for (let ty = Math.max(0, ty0); ty < Math.min(map.height, ty0 + tn); ty++) {
      for (let tx = Math.max(0, tx0); tx < Math.min(map.width, tx0 + tn); tx++) {
        if (map.terrain[ty * map.width + tx] !== T.Water) continue;
        const px = (tx - ty) * HW, py = (tx + ty + 1) * HH;
        if (px >= x0 && px < x0 + CH && py >= y0 && py < y0 + CH) water.push(ty * map.width + tx);
      }
    }
    const ch: Chunk = { x0, y0, c, ctx, scale, splat, tx0, ty0, tn, water: Int32Array.from(water), used: this.frame };
    this.paint(ch, ax0, ay0, ax1, ay1, true);
    return ch;
  }

  private makeSplat(tx0: number, ty0: number, tn: number): HTMLCanvasElement {
    const map = this.map!;
    const W = map.width, Hh = map.height;
    const n = tn * SPX;
    const c = makeCanvas(n, n);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    const d = img.data;
    const base = this.base, terr = map.terrain;
    for (let j = 0; j < n; j++) {
      const py = ty0 + (j + 0.5) / SPX;
      for (let i = 0; i < n; i++) {
        const px = tx0 + (i + 0.5) / SPX;
        const wx = px + (vnoise(px * 1.3 + 17, py * 1.3) - 0.5) * 0.7 - 0.5;
        const wy = py + (vnoise(px * 1.3, py * 1.3 + 31) - 0.5) * 0.7 - 0.5;
        const xi = Math.floor(wx), yi = Math.floor(wy);
        let u = (wx - xi - 0.15) / 0.7, v = (wy - yi - 0.15) / 0.7;
        u = u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
        v = v < 0 ? 0 : v > 1 ? 1 : v * v * (3 - 2 * v);
        let r = 0, g = 0, b = 0, lw = 0, ww = 0, vw = 0;
        for (let k = 0; k < 4; k++) {
          const tx = xi + (k & 1), ty = yi + (k >> 1);
          const wgt = (k & 1 ? u : 1 - u) * (k >> 1 ? v : 1 - v);
          if (wgt <= 0) continue;
          if (tx < 0 || ty < 0 || tx >= W || ty >= Hh) {
            r += C_VOID[0] * wgt; g += C_VOID[1] * wgt; b += C_VOID[2] * wgt; lw += wgt; vw += wgt;
          } else {
            const ti = ty * W + tx;
            if (terr[ti] === T.Water) ww += wgt;
            else { r += base[ti * 3] * wgt; g += base[ti * 3 + 1] * wgt; b += base[ti * 3 + 2] * wgt; lw += wgt; }
          }
        }
        const nz = 0.9 + 0.2 * (vnoise(px * 0.37, py * 0.37) * 0.6 + vnoise(px * 1.9 + 3, py * 1.9) * 0.4);
        if (ww > 0.5) {
          let t = (ww - 0.5) * 2.4; if (t > 1) t = 1;
          const k = 0.92 + 0.16 * vnoise(px * 0.8, py * 0.8 + 40);
          r = (C_SHALLOW[0] + (C_DEEP[0] - C_SHALLOW[0]) * t) * k;
          g = (C_SHALLOW[1] + (C_DEEP[1] - C_SHALLOW[1]) * t) * k;
          b = (C_SHALLOW[2] + (C_DEEP[2] - C_SHALLOW[2]) * t) * k;
          if (ww < 0.58) { const f = 0.55 * (1 - (ww - 0.5) / 0.08); r += (214 - r) * f; g += (236 - g) * f; b += (232 - b) * f; }
        } else {
          if (lw > 0) { r /= lw; g /= lw; b /= lw; }
          r *= nz; g *= nz; b *= nz;
          // drifting ash-grey and ember-tan patches so open ground is never flat
          const ash = vnoise(px * 0.16 + 70, py * 0.16 + 20), emb = vnoise(px * 0.23 + 11, py * 0.23 + 90);
          const land = 1 - vw;
          if (ash > 0.56) { const f = Math.min(0.45, (ash - 0.56) * 1.6) * land; r += (104 - r) * f; g += (100 - g) * f; b += (96 - b) * f; }
          if (emb > 0.62) { const f = Math.min(0.3, (emb - 0.62) * 1.3) * land; r += (156 - r) * f; g += (124 - g) * f; b += (84 - b) * f; }
          const grain = (hash2(i + tx0 * SPX, j + ty0 * SPX) - 0.5) * 7 * land;
          r += grain; g += grain; b += grain;
          if (ww > 0.2) {
            // damp shoreline
            const f = (ww - 0.2) / 0.3;
            r = r * (1 - 0.3 * f) + 16 * f; g = g * (1 - 0.26 * f) + 14 * f; b = b * (1 - 0.2 * f) + 12 * f;
          }
        }
        const o = (j * n + i) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Where the tall prop of a Tree / Rock tile sits. Shared by the baked terrain and the depth-sorted redraw. */
  propAt(tx: number, ty: number): Sprite | null {
    const map = this.map!;
    const i = ty * map.width + tx;
    const t = map.terrain[i];
    if (t !== T.Tree && t !== T.Rock) return null;
    const v = map.variant[i];
    PROP.x = (tx - ty) * HW + (hash2(tx, ty + 7) - 0.5) * (t === T.Tree ? 14 : 5);
    PROP.y = (tx + ty + 1) * HH + (hash2(tx + 5, ty) - 0.5) * (t === T.Tree ? 8 : 3);
    return this.bank.prop(t === T.Tree ? 0 : 1, v);
  }

  private paint(ch: Chunk, rx0: number, ry0: number, rx1: number, ry1: number, full: boolean): void {
    const map = this.map!;
    const ctx = ch.ctx, s = ch.scale;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, (-ch.x0 + PADC) * s, (-ch.y0 + PADC) * s);
    if (!full) {
      ctx.beginPath();
      ctx.rect(rx0, ry0, rx1 - rx0, ry1 - ry0);
      ctx.clip();
      ctx.clearRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    }
    ctx.save();
    ctx.transform(HW, HH, -HW, HH, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ch.splat, ch.tx0, ch.ty0, ch.tn, ch.tn);
    ctx.restore();
    // tile range (generous margins: props reach up from tiles below the rect)
    const qx0 = rx0 - 46, qx1 = rx1 + 46, qy0 = ry0 - 22, qy1 = ry1 + 110;
    const tx0 = Math.max(0, Math.floor((qx0 / HW + qy0 / HH) / 2) - 1), tx1 = Math.min(map.width - 1, Math.ceil((qx1 / HW + qy1 / HH) / 2));
    const ty0 = Math.max(0, Math.floor((qy0 / HH - qx1 / HW) / 2) - 1), ty1 = Math.min(map.height - 1, Math.ceil((qy1 / HH - qx0 / HW) / 2));
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      for (let dsum = tx0 + ty0; dsum <= tx1 + ty1; dsum++) {
        for (let tx = Math.max(tx0, dsum - ty1); tx <= Math.min(tx1, dsum - ty0); tx++) {
          const ty = dsum - tx;
          const cx = (tx - ty) * HW, cy = (tx + ty + 1) * HH;
          if (cx + 46 < rx0 || cx - 46 > rx1) continue;
          const i = ty * map.width + tx;
          if (pass === 0) {
            if (cy + 18 < ry0 || cy - 46 > ry1) continue;
            this.detail(ctx, tx, ty, cx, cy, i);
            const lv = this.oreLvl[i];
            if (lv > 0) drawOre(ctx, tx, ty, cx, cy, lv);
          } else {
            if (cy + 22 < ry0 || cy - 104 > ry1) continue;
            const sp = this.propAt(tx, ty);
            if (sp) ctx.drawImage(sp.c, PROP.x - sp.ox, PROP.y - sp.oy, sp.w, sp.h);
          }
        }
      }
    }
    ctx.restore();
  }

  private detail(ctx: CanvasRenderingContext2D, tx: number, ty: number, cx: number, cy: number, i: number): void {
    const map = this.map!;
    const t = map.terrain[i];
    const vr = map.variant[i];
    const h = (k: number): number => hash2(tx * 31 + k * 7, ty * 17 + vr);
    const ptx = (k: number): number => cx + (0.14 + h(k) * 0.72 - (0.14 + h(k + 1) * 0.72)) * HW;
    const pty = (k: number): number => cy + (0.14 + h(k) * 0.72 + (0.14 + h(k + 1) * 0.72) - 1) * HH;
    const W = map.width, Hh = map.height;
    const tAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= Hh ? -1 : map.terrain[y * W + x]);
    if (t === T.Ground || t === T.Tree) {
      if (h(1) < (t === T.Tree ? 0.9 : 0.5)) {
        const n = 1 + ((h(2) * 3) | 0);
        for (let k = 0; k < n; k++) {
          const x = ptx(10 + k * 2), y = pty(10 + k * 2);
          ctx.strokeStyle = h(20 + k) < 0.5 ? 'rgba(88,102,60,0.8)' : 'rgba(168,152,98,0.75)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x - 2.5, y - 4);
          ctx.moveTo(x, y); ctx.lineTo(x + 0.3, y - 5.5);
          ctx.moveTo(x, y); ctx.lineTo(x + 2.8, y - 3.6);
          ctx.stroke();
        }
      }
      if (h(3) < 0.3) {
        const x = ptx(30), y = pty(30);
        ctx.fillStyle = 'rgba(58,54,48,0.6)';
        ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1.5, 0, 0, 6.3); ctx.fill();
        ctx.fillStyle = 'rgba(196,186,164,0.55)';
        ctx.beginPath(); ctx.ellipse(x - 0.6, y - 0.5, 1.1, 0.6, 0, 0, 6.3); ctx.fill();
      }
      if (h(4) < 0.1) {
        const x = ptx(34), y = pty(34);
        ctx.strokeStyle = 'rgba(48,42,34,0.38)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - 7, y - 1); ctx.lineTo(x - 2, y + 1.5); ctx.lineTo(x + 2, y - 0.5); ctx.lineTo(x + 8, y + 2); ctx.stroke();
      }
      if (t === T.Tree) {
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = k === 0 ? 'rgba(204,122,52,0.7)' : 'rgba(44,56,40,0.45)';
          ctx.beginPath(); ctx.ellipse(ptx(40 + k * 2), pty(40 + k * 2), k === 0 ? 1.4 : 5, k === 0 ? 0.9 : 2.4, 0, 0, 6.3); ctx.fill();
        }
      }
    } else if (t === T.Rough || t === T.Rock) {
      const n = 3 + ((h(1) * 3) | 0);
      for (let k = 0; k < n; k++) {
        const x = ptx(10 + k * 2), y = pty(10 + k * 2), r = 2.2 + h(22 + k) * 3;
        ctx.fillStyle = 'rgba(52,48,46,0.85)';
        ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.4, y - r * 0.8); ctx.lineTo(x + r * 0.7, y - r * 0.6); ctx.lineTo(x + r, y + r * 0.1); ctx.lineTo(x, y + r * 0.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(138,130,120,0.9)';
        ctx.beginPath(); ctx.moveTo(x - r * 0.7, y - r * 0.15); ctx.lineTo(x - r * 0.3, y - r * 0.75); ctx.lineTo(x + r * 0.6, y - r * 0.55); ctx.lineTo(x + r * 0.2, y - r * 0.05); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(40,36,34,0.4)'; ctx.lineWidth = 1;
      for (let k = 0; k < 2; k++) {
        const x = ptx(50 + k * 2), y = pty(50 + k * 2);
        ctx.beginPath(); ctx.moveTo(x - 8, y + (h(60 + k) - 0.5) * 4); ctx.lineTo(x - 2, y + 1.5); ctx.lineTo(x + 3, y - 1.5); ctx.lineTo(x + 9, y + (h(62 + k) - 0.5) * 5); ctx.stroke();
      }
    } else if (t === T.Road) {
      // packed plates: lighter inset + seams, kerb lines against other terrain
      ctx.fillStyle = 'rgba(206,198,180,0.14)';
      ctx.beginPath(); ctx.moveTo(cx, cy - HH + 2); ctx.lineTo(cx + HW - 4, cy); ctx.lineTo(cx, cy + HH - 2); ctx.lineTo(cx - HW + 4, cy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(56,50,42,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - HW, cy); ctx.lineTo(cx, cy - HH); ctx.lineTo(cx + HW, cy);
      if (vr & 1) { ctx.moveTo(cx - HW / 2, cy - HH / 2); ctx.lineTo(cx + HW / 2, cy + HH / 2); } else { ctx.moveTo(cx + HW / 2, cy - HH / 2); ctx.lineTo(cx - HW / 2, cy + HH / 2); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(40,35,30,0.5)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (tAt(tx, ty - 1) !== T.Road) { ctx.moveTo(cx, cy - HH + 1.5); ctx.lineTo(cx + HW - 3, cy); }
      if (tAt(tx + 1, ty) !== T.Road) { ctx.moveTo(cx + HW - 3, cy); ctx.lineTo(cx, cy + HH - 1.5); }
      if (tAt(tx, ty + 1) !== T.Road) { ctx.moveTo(cx, cy + HH - 1.5); ctx.lineTo(cx - HW + 3, cy); }
      if (tAt(tx - 1, ty) !== T.Road) { ctx.moveTo(cx - HW + 3, cy); ctx.lineTo(cx, cy - HH + 1.5); }
      ctx.stroke();
      if (h(5) < 0.5) {
        ctx.fillStyle = 'rgba(70,62,52,0.35)';
        ctx.beginPath(); ctx.ellipse(ptx(70), pty(70), 4, 1.6, 0.4, 0, 6.3); ctx.fill();
      }
    } else if (t === T.Water) {
      // foam strokes just inside any shoreline edge
      ctx.strokeStyle = 'rgba(214,238,234,0.5)'; ctx.lineWidth = 1.3;
      ctx.beginPath();
      const wob = (k: number): number => (h(k) - 0.5) * 3;
      const edge = (ax: number, ay: number, bx: number, by: number, k: number): void => {
        const mx = (ax + bx) / 2 + (cx - (ax + bx) / 2) * 0.3, my = (ay + by) / 2 + (cy - (ay + by) / 2) * 0.3;
        ctx.moveTo(ax + (cx - ax) * 0.22, ay + (cy - ay) * 0.22 + wob(k));
        ctx.quadraticCurveTo(mx + wob(k + 1), my + wob(k + 2), bx + (cx - bx) * 0.22, by + (cy - by) * 0.22 + wob(k + 3));
      };
      const land = (x: number, y: number): boolean => { const q = tAt(x, y); return q !== T.Water && q !== -1; };
      if (land(tx, ty - 1)) edge(cx, cy - HH, cx + HW, cy, 80);
      if (land(tx + 1, ty)) edge(cx + HW, cy, cx, cy + HH, 84);
      if (land(tx, ty + 1)) edge(cx, cy + HH, cx - HW, cy, 88);
      if (land(tx - 1, ty)) edge(cx - HW, cy, cx, cy - HH, 92);
      ctx.stroke();
    }
  }

  /** Animated wave glints on visible water tiles (one batched path per brightness band). */
  glints(ctx: CanvasRenderingContext2D, vx0: number, vy0: number, vx1: number, vy1: number, t: number): void {
    const map = this.map;
    if (!map) return;
    const cx0 = Math.floor(vx0 / CH), cx1 = Math.floor(vx1 / CH), cy0 = Math.floor(vy0 / CH), cy1 = Math.floor(vy1 / CH);
    const W = map.width, vr = map.variant;
    ctx.lineCap = 'round';
    for (let band = 0; band < 2; band++) {
      ctx.beginPath();
      let any = false;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const ch = this.chunks.get((cx + 512) * 4096 + cy + 512);
          if (!ch || ch.water.length === 0) continue;
          const wt = ch.water;
          for (let k = 0; k < wt.length; k++) {
            const i = wt[k];
            const v = vr[i];
            if ((v & 1) !== band) continue;
            const tx = i % W, ty = (i / W) | 0;
            const ph = (v / 255 + t * (0.1 + (v & 7) * 0.012)) % 1;
            if (ph > 0.6) continue;
            const x = (tx - ty) * HW + ((v >> 3) - 16) * 1.4 + ph * 14, y = (tx + ty + 1) * HH + ((v & 15) - 8) * 0.9;
            const len = 3 + Math.sin(ph * 5.236) * 7;
            ctx.moveTo(x - len, y);
            ctx.quadraticCurveTo(x, y - 2.2, x + len, y);
            any = true;
          }
        }
      }
      if (any) {
        ctx.strokeStyle = band ? 'rgba(210,244,246,0.34)' : 'rgba(170,226,236,0.2)';
        ctx.lineWidth = band ? 1.2 : 1.8;
        ctx.stroke();
      }
    }
  }
}

/** Scratch output of `propAt`. */
export const PROP = { x: 0, y: 0 };

function drawOre(ctx: CanvasRenderingContext2D, tx: number, ty: number, cx: number, cy: number, lv: number): void {
  // glow underlay
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
  g.addColorStop(0, `rgba(240,110,210,${0.2 + lv * 0.05})`);
  g.addColorStop(1, 'rgba(236,96,200,0)');
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(1, 0.5); ctx.translate(-cx, -cy);
  ctx.fillStyle = g;
  ctx.fillRect(cx - 30, cy - 30, 60, 60);
  ctx.restore();
  const n = 1 + lv;
  // deterministic shard list sorted back-to-front
  const sh: number[] = [];
  for (let k = 0; k < n; k++) {
    const u = 0.16 + hash2(tx * 13 + k, ty * 7 + 1) * 0.68, v = 0.16 + hash2(tx * 5 + k, ty * 11 + 2) * 0.68;
    sh.push((u + v - 1) * HH, (u - v) * HW, k);
  }
  for (let a = 0; a < n; a++) {
    // selection by y
    let best = -1;
    for (let k = 0; k < n; k++) if (sh[k * 3] < 1e8 && (best < 0 || sh[k * 3] < sh[best * 3])) best = k;
    const y = cy + sh[best * 3], x = cx + sh[best * 3 + 1], k = sh[best * 3 + 2];
    sh[best * 3] = 1e9;
    const r1 = hash2(tx + k * 3, ty * 3 + 5), r2 = hash2(tx * 3 + k, ty + 9);
    const hgt = 6 + lv * 1.9 + r1 * 7, w = 3.4 + r2 * 2.6 + lv * 0.25, lean = (r2 - 0.5) * 5;
    ctx.fillStyle = 'rgba(40,10,40,0.35)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 0.6, w * 1.5, w * 0.6, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#e85cc0';
    ctx.beginPath(); ctx.moveTo(x - w, y - 0.5); ctx.lineTo(x + lean, y - hgt); ctx.lineTo(x + 0.2, y + w * 0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#93308a';
    ctx.beginPath(); ctx.moveTo(x + 0.2, y + w * 0.5); ctx.lineTo(x + lean, y - hgt); ctx.lineTo(x + w, y - 0.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,244,0.9)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x + lean, y - hgt); ctx.lineTo(x + 0.2, y + w * 0.5); ctx.stroke();
  }
}
