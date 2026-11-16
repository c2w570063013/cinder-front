// Build-menu portraits and the radar minimap.
import type { ViewState } from '../core/api';
import type { BuildingDef, PlayerId, UnitDef, World } from '../core/types';
import { BUILDINGS, UNITS } from '../data';
import { BUILDING_ART, BUILDING_FALLBACK, type LiveCtx } from './art-buildings';
import { UNIT_ART, UNIT_FALLBACK } from './art-units';
import { Model, type Sprite, hash2, makeCanvas, modelBounds, renderSprite, withProjection } from './model';
import { type SpriteBank, palOf } from './sprites';

const ICON_ANGLE = 0.5;
// Portrait camera: lower and closer than the in-game one, so subjects loom.
const P_HW = 32, P_HH = 12.5, P_Z = 43;

function backdrop(ctx: CanvasRenderingContext2D, S: number, helion: boolean, seed: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, S);
  if (helion) { g.addColorStop(0, '#31506c'); g.addColorStop(0.55, '#1b3046'); g.addColorStop(1, '#0a121b'); }
  else { g.addColorStop(0, '#6a3d22'); g.addColorStop(0.55, '#3a2113'); g.addColorStop(1, '#130c08'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // light source behind the subject, upper left
  const sun = ctx.createRadialGradient(S * 0.3, S * 0.26, 0, S * 0.3, S * 0.26, S * 0.75);
  sun.addColorStop(0, helion ? 'rgba(160,236,255,0.5)' : 'rgba(255,176,92,0.5)');
  sun.addColorStop(0.45, helion ? 'rgba(90,190,235,0.16)' : 'rgba(240,120,50,0.16)');
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, S, S);
  ctx.save();
  if (helion) {
    // hex lattice fading toward the floor
    ctx.strokeStyle = 'rgba(150,235,255,0.1)'; ctx.lineWidth = Math.max(1, S / 110);
    const r = S / 6.5;
    for (let row = -1; row < 5; row++) {
      for (let col = -1; col < 6; col++) {
        const cx = col * r * 1.5, cy = row * r * 1.732 + (col & 1 ? r * 0.866 : 0);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath(); ctx.stroke();
      }
    }
    // slanted light shafts
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x = S * (0.1 + i * 0.26 + hash2(seed, i) * 0.1), w = S * (0.05 + hash2(seed, i + 9) * 0.06);
      const lg = ctx.createLinearGradient(0, 0, 0, S * 0.8);
      lg.addColorStop(0, 'rgba(150,230,255,0.13)'); lg.addColorStop(1, 'rgba(150,230,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w + S * 0.3, S * 0.8); ctx.lineTo(x + S * 0.3, S * 0.8); ctx.closePath(); ctx.fill();
    }
  } else {
    // riveted plate wall
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(1, S / 80);
    ctx.beginPath();
    ctx.moveTo(0, S * 0.27); ctx.lineTo(S, S * 0.27); ctx.moveTo(S * 0.64, 0); ctx.lineTo(S * 0.64, S * 0.27);
    ctx.moveTo(S * 0.28, S * 0.27); ctx.lineTo(S * 0.28, S * 0.62); ctx.moveTo(S * 0.8, S * 0.27); ctx.lineTo(S * 0.8, S * 0.62);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,160,0.2)';
    for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc(S * (0.05 + i * 0.1), S * 0.3, S / 85 + 0.6, 0, 6.3); ctx.fill(); }
    // furnace glow low on the right + embers
    ctx.globalCompositeOperation = 'lighter';
    const eg = ctx.createRadialGradient(S * 0.8, S * 0.78, 0, S * 0.8, S * 0.78, S * 0.6);
    eg.addColorStop(0, 'rgba(255,120,40,0.3)'); eg.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = eg; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 16; i++) {
      const x = hash2(seed + i, 3) * S, y = hash2(seed + i, 7) * S * 0.7, r = (0.004 + hash2(seed + i, 11) * 0.008) * S;
      ctx.fillStyle = `rgba(255,${150 + ((hash2(seed + i, 13) * 80) | 0)},70,${0.25 + hash2(seed + i, 17) * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    }
  }
  ctx.restore();
}

/** Floor the subject stands on: receding slab lines + a pool of light. */
function floor(ctx: CanvasRenderingContext2D, S: number, helion: boolean, horizon: number): void {
  const g = ctx.createLinearGradient(0, horizon, 0, S);
  if (helion) { g.addColorStop(0, '#16283a'); g.addColorStop(1, '#2c4257'); }
  else { g.addColorStop(0, '#1c120c'); g.addColorStop(1, '#3d2a1c'); }
  ctx.fillStyle = g; ctx.fillRect(0, horizon, S, S - horizon);
  ctx.strokeStyle = helion ? 'rgba(150,235,255,0.14)' : 'rgba(0,0,0,0.3)';
  ctx.lineWidth = Math.max(1, S / 140);
  ctx.beginPath();
  for (let i = -6; i <= 6; i++) { ctx.moveTo(S / 2 + i * S * 0.07, horizon); ctx.lineTo(S / 2 + i * S * 0.34, S); }
  for (let k = 1; k <= 4; k++) { const y = horizon + (S - horizon) * (k / 4) ** 1.7; ctx.moveTo(0, y); ctx.lineTo(S, y); }
  ctx.stroke();
  ctx.fillStyle = helion ? 'rgba(170,240,255,0.5)' : 'rgba(255,190,120,0.45)';
  ctx.fillRect(0, horizon - Math.max(1, S / 160), S, Math.max(1, S / 160));
}

const tintCanvas: (HTMLCanvasElement | null)[] = [null];
/** Silhouette of a sprite filled with one colour. */
function silhouette(src: HTMLCanvasElement, col: string): HTMLCanvasElement {
  let c = tintCanvas[0];
  if (!c || c.width < src.width || c.height < src.height) { c = makeCanvas(src.width, src.height); tintCanvas[0] = c; }
  const x = c.getContext('2d')!;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = col;
  x.fillRect(0, 0, src.width, src.height);
  x.globalCompositeOperation = 'source-over';
  return c;
}

export function makeIcon(bank: SpriteBank, defId: string, color: string, size: number): HTMLCanvasElement {
  return withProjection(P_HW, P_HH, P_Z, () => paintIcon(bank, defId, color, size));
}

function paintIcon(bank: SpriteBank, defId: string, color: string, size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const u: UnitDef | undefined = UNITS[defId];
  const b: BuildingDef | undefined = BUILDINGS[defId];
  const faction = (u ?? b)?.faction ?? 'helion';
  const helion = faction === 'helion';
  const pal = palOf(color);
  const S = size;
  let seed = 0;
  for (let i = 0; i < defId.length; i++) seed = (seed * 31 + defId.charCodeAt(i)) | 0;
  seed = Math.abs(seed) % 9973;

  // ── subject models ──
  const body = new Model();
  let turret: Model | null = null;
  let pivot: number[] = [0, 0, 0];
  let ang = 0;
  let alt = 0;
  const bart = b ? BUILDING_ART[defId] ?? BUILDING_FALLBACK : null;
  if (u) {
    const art = UNIT_ART[defId] ?? UNIT_FALLBACK;
    art.hull(body, pal, u.harvester ? 2 : art.infantry ? 5 : 0);
    if (art.turret) { turret = new Model(); art.turret(turret, pal); pivot = art.pivot; }
    ang = ICON_ANGLE;
    alt = u.movement === 'air' ? 0.5 : 0;
  } else if (bart) {
    bart.build(body, pal, defId.endsWith('wall') ? 2 | 8 : 0);
    if (bart.turret && bart.pivot) { turret = new Model(); bart.turret(turret, pal); pivot = bart.pivot; }
  }
  const tAng = u ? ang - 0.25 : ICON_ANGLE;
  // combined bounds at scale 1 (portrait projection)
  const bb = modelBounds(body, ang, false);
  let x0 = bb[0], y0 = bb[1] - alt * P_Z, x1 = bb[2], y1 = bb[3];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pvx = pivot[0] * ca - pivot[1] * sa, pvy = pivot[0] * sa + pivot[1] * ca;
  const tox = (pvx - pvy) * P_HW, toy = (pvx + pvy) * P_HH - pivot[2] * P_Z;
  if (turret) {
    const tb = modelBounds(turret, tAng, false);
    x0 = Math.min(x0, tb[0] + tox); x1 = Math.max(x1, tb[2] + tox);
    y0 = Math.min(y0, tb[1] + toy - alt * P_Z); y1 = Math.max(y1, tb[3] + toy);
  }
  // room for animated roof gear that is not part of the baked model
  const extra: Record<string, number> = { h_nexus: 62, h_radar: 44, h_lab: 26, h_uplink: 14, f_core: 40, f_radar: 34, f_barracks: 6, h_barracks: 6, f_lab: 4 };
  if (b) y0 -= extra[defId] ?? 0;
  // fill the frame; wide flat subjects are allowed to run past the side edges a little
  const fit = Math.min((S * (b ? 1.02 : 0.95)) / (x1 - x0), (S * (u && (UNIT_ART[defId] ?? UNIT_FALLBACK).infantry ? 0.78 : 0.86)) / (y1 - y0));
  const sc = Math.max(0.2, fit);
  const cx = S / 2 - ((x0 + x1) / 2) * sc;
  const groundY = S * 0.93 - Math.max(0, y1) * sc + (alt > 0 ? -S * 0.02 : 0);
  const cy = Math.min(groundY, S * 0.9 - y1 * sc);

  // ── backdrop ──
  backdrop(ctx, S, helion, seed);
  const horizon = Math.min(S * 0.8, Math.max(S * 0.5, cy - S * 0.1));
  floor(ctx, S, helion, horizon);
  // pool of light + contact shadow under the subject
  const pool = ctx.createRadialGradient(S / 2, cy + S * 0.02, 0, S / 2, cy + S * 0.02, S * 0.6);
  pool.addColorStop(0, helion ? 'rgba(120,225,255,0.28)' : 'rgba(255,150,70,0.26)'); pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save(); ctx.translate(0, cy + S * 0.02); ctx.scale(1, 0.38); ctx.translate(0, -(cy + S * 0.02));
  ctx.fillStyle = pool; ctx.fillRect(0, cy - S * 1.4, S, S * 3);
  ctx.restore();
  if (alt > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(S / 2 + S * 0.03, S * 0.9, (x1 - x0) * sc * 0.34, (x1 - x0) * sc * 0.1, 0, 0, 6.3); ctx.fill();
  }

  // ── subject ──
  const sp = renderSprite(body, ang, sc, { outline: 0.85, shadow: alt > 0 ? 0 : 0.42, bloom: 0.7, grime: b ? (helion ? 0.3 : 0.9) : 0, pad: 4 });
  const ay = cy - alt * P_Z * sc;
  const bx = cx - sp.ox * sc, by = ay - sp.oy * sc;
  const rimCol = helion ? '#d9fbff' : '#ffd9a0';
  const d = Math.max(1, S / 90);
  // rim light: a bright copy of the silhouette pushed toward the light, then the body on top
  const rim = silhouette(sp.c, rimCol);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(rim, 0, 0, sp.c.width, sp.c.height, bx - d, by - d, sp.c.width, sp.c.height);
  ctx.globalAlpha = 1;
  ctx.drawImage(sp.c, bx, by);
  let ts: Sprite | null = null;
  if (turret) {
    ts = renderSprite(turret, tAng, sc, { outline: 0.85, bloom: 0.7 });
    const tx = cx + tox * sc - ts.ox * sc, ty = ay + toy * sc - ts.oy * sc;
    const trim = silhouette(ts.c, rimCol);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(trim, 0, 0, ts.c.width, ts.c.height, tx - d, ty - d, ts.c.width, ts.c.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(ts.c, tx, ty);
  }
  if (bart?.live) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(sc, sc);
    const g: LiveCtx = {
      ctx, t: 1.3 + (seed % 7) * 0.37, on: true, P: pal, charge: 0.8, active: 0.6, seed: 0.7, door: 0.3,
      chance: () => false, puff: () => {}, spark: () => {},
      glow: (x, y, z, r, col, a) => {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(bank.glow(col), (x - y) * P_HW - r, (x + y) * P_HH - z * P_Z - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      },
    };
    bart.live(g);
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]);
  }
  // smoke / steam plumes for stacks
  if (bart?.smoke) {
    for (const p of bart.smoke) {
      const px = cx + (p[0] - p[1]) * P_HW * sc, py = cy + ((p[0] + p[1]) * P_HH - p[2] * P_Z) * sc;
      const puff = bank.puff(p[3] === 1 ? '#eef2f4' : p[3] === 2 ? '#26221f' : '#6e6a66');
      for (let k = 0; k < 4; k++) {
        const r = S * (0.035 + k * 0.022) * (p[4] ?? 0.8);
        ctx.globalAlpha = 0.55 - k * 0.11;
        ctx.drawImage(puff, px + k * S * 0.022 - r, py - k * S * 0.045 - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
  }
  // atmosphere in front: haze at the feet, vignette
  const haze = ctx.createLinearGradient(0, S * 0.8, 0, S);
  haze.addColorStop(0, 'rgba(0,0,0,0)'); haze.addColorStop(1, helion ? 'rgba(8,16,26,0.55)' : 'rgba(16,8,4,0.55)');
  ctx.fillStyle = haze; ctx.fillRect(0, S * 0.8, S, S * 0.2);
  const vg = ctx.createRadialGradient(S * 0.46, S * 0.44, S * 0.34, S / 2, S / 2, S * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, S, S);
  // player-colour footer bar + bevelled frame
  const fh = Math.max(2, Math.round(S * 0.035));
  ctx.fillStyle = color; ctx.fillRect(0, S - fh, S, fh);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, S - fh, S, Math.max(1, fh * 0.22));
  const lw = Math.max(1, S / 70);
  ctx.strokeStyle = helion ? 'rgba(170,236,255,0.55)' : 'rgba(255,196,130,0.55)';
  ctx.lineWidth = lw; ctx.strokeRect(lw / 2, lw / 2, S - lw, S - lw);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeRect(lw * 1.5, lw * 1.5, S - lw * 3, S - lw * 3);
  return c;
}

/** Minimap mapping: the map diamond squashed to fill (w,h). Exact inverse in `minimapToWorld`. */
export function worldToMinimap(world: World, x: number, y: number, w: number, h: number, out: { x: number; y: number }): void {
  const n = world.map.width + world.map.height;
  out.x = ((x - y + world.map.height) / n) * w;
  out.y = ((x + y) / n) * h;
}

export function minimapToWorld(world: World, mx: number, my: number, w: number, h: number): { x: number; y: number } {
  const n = world.map.width + world.map.height;
  const a = (mx / w) * n - world.map.height;
  const b = (my / h) * n;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export interface MinimapDeps {
  terrain: HTMLCanvasElement;
  fog: HTMLCanvasElement | null;
  /** Is this entity position currently visible to the viewer? */
  visible: (x: number, y: number) => boolean;
  ghosts: Iterable<{ x: number; y: number; w: number; h: number; color: string; live: boolean }>;
  /** Viewport corners in world coords: [x0,y0, x1,y1, x2,y2, x3,y3]. */
  corners: number[];
}

const tmp = { x: 0, y: 0 };

export function drawMinimap(ctx: CanvasRenderingContext2D, world: World, view: ViewState, w: number, h: number, d: MinimapDeps): void {
  const map = world.map;
  const n = map.width + map.height;
  const kx = w / n, ky = h / n;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = '#07090c';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  // tile space → minimap space
  ctx.transform(kx, ky, -kx, ky, map.height * kx, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(d.terrain, 0, 0);
  const viewer: PlayerId = view.viewer;
  const us = Math.max(1.3, 2.4 / kx);
  // remembered buildings under fog
  for (const g of d.ghosts) {
    if (g.live) continue;
    ctx.fillStyle = g.color;
    ctx.fillRect(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h);
  }
  if (d.fog) ctx.drawImage(d.fog, -1, -1);
  let last = '';
  for (const e of world.entities.values()) {
    if (e.owner !== viewer && !d.visible(e.x, e.y)) continue;
    const col = view.selection.has(e.id) ? '#ffffff' : world.players[e.owner]?.color ?? '#999999';
    if (col !== last) { ctx.fillStyle = col; last = col; }
    if (e.kind === 'building') {
      const def = BUILDINGS[e.defId];
      const fw = def ? def.footprint.w : 1, fh = def ? def.footprint.h : 1;
      const m = Math.max(0, (us * 0.7 - Math.min(fw, fh)) / 2);
      ctx.fillRect(e.x - fw / 2 - m, e.y - fh / 2 - m, fw + m * 2, fh + m * 2);
    } else {
      ctx.fillRect(e.x - us / 2, e.y - us / 2, us, us);
    }
  }
  ctx.restore();
  // viewport outline
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    worldToMinimap(world, d.corners[i * 2], d.corners[i * 2 + 1], w, h, tmp);
    if (i) ctx.lineTo(tmp.x, tmp.y); else ctx.moveTo(tmp.x, tmp.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
