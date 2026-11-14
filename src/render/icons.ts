// Build-menu portraits and the radar minimap.
import type { ViewState } from '../core/api';
import type { BuildingDef, PlayerId, UnitDef, World } from '../core/types';
import { BUILDINGS, UNITS } from '../data';
import { BUILDING_ART, BUILDING_FALLBACK, type LiveCtx } from './art-buildings';
import { UNIT_ART, UNIT_FALLBACK } from './art-units';
import { HH, HW, Model, ZPX, makeCanvas, modelBounds, renderSprite } from './model';
import { type SpriteBank, palOf } from './sprites';

const ICON_ANGLE = 0.42;

export function makeIcon(bank: SpriteBank, defId: string, color: string, size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const u: UnitDef | undefined = UNITS[defId];
  const b: BuildingDef | undefined = BUILDINGS[defId];
  const faction = (u ?? b)?.faction ?? 'helion';
  const pal = palOf(color);
  const S = size;

  // ── faction backdrop ──
  if (faction === 'helion') {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#22384e'); g.addColorStop(1, '#0d151f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    // hex lattice
    ctx.strokeStyle = 'rgba(116,244,255,0.09)'; ctx.lineWidth = Math.max(1, S / 96);
    const r = S / 7;
    for (let row = -1; row < 7; row++) {
      for (let col = -1; col < 6; col++) {
        const cx = col * r * 1.5, cy = row * r * 1.732 + (col & 1 ? r * 0.866 : 0);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath(); ctx.stroke();
      }
    }
    const gl = ctx.createRadialGradient(S / 2, S * 0.62, 0, S / 2, S * 0.62, S * 0.6);
    gl.addColorStop(0, 'rgba(116,244,255,0.22)'); gl.addColorStop(1, 'rgba(116,244,255,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, S, S);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#43301f'); g.addColorStop(1, '#16110d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    // riveted plate seams
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(1, S / 80);
    ctx.beginPath(); ctx.moveTo(0, S * 0.3); ctx.lineTo(S, S * 0.3); ctx.moveTo(S * 0.62, 0); ctx.lineTo(S * 0.62, S * 0.3); ctx.moveTo(S * 0.3, S * 0.3); ctx.lineTo(S * 0.3, S); ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,160,0.16)';
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(S * (0.08 + i * 0.105), S * 0.3 + S * 0.035, S / 90 + 0.6, 0, 6.3); ctx.fill(); }
    const gl = ctx.createRadialGradient(S / 2, S * 0.66, 0, S / 2, S * 0.66, S * 0.6);
    gl.addColorStop(0, 'rgba(255,150,60,0.24)'); gl.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, S, S);
    // hazard corner
    ctx.save();
    ctx.beginPath(); ctx.moveTo(S, S * 0.78); ctx.lineTo(S, S); ctx.lineTo(S * 0.78, S); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#e9bf3d'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#1c1612'; ctx.lineWidth = S / 26;
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(S * (0.6 + i * 0.09), S * 1.02); ctx.lineTo(S * (0.75 + i * 0.09), S * 0.7); ctx.stroke(); }
    ctx.restore();
  }

  // ── subject ──
  const body = new Model();
  let turret: Model | null = null;
  let pivot: number[] = [0, 0, 0];
  let ang = 0;
  let alt = 0;
  if (u) {
    const art = UNIT_ART[defId] ?? UNIT_FALLBACK;
    art.hull(body, pal, u.harvester ? 2 : 0);
    if (art.turret) { turret = new Model(); art.turret(turret, pal); pivot = art.pivot; }
    ang = ICON_ANGLE;
    alt = u.movement === 'air' ? 0.35 : 0;
  } else {
    const art = BUILDING_ART[defId] ?? BUILDING_FALLBACK;
    art.build(body, pal, defId.endsWith('wall') ? 2 | 8 : 0);
    if (art.turret && art.pivot) { turret = new Model(); art.turret(turret, pal); pivot = art.pivot; ang = 0; }
  }
  const tAng = u ? ang : ICON_ANGLE;
  // combined bounds at scale 1
  const bb = modelBounds(body, ang, false);
  let x0 = bb[0], y0 = bb[1] - alt * ZPX, x1 = bb[2], y1 = bb[3];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pvx = pivot[0] * ca - pivot[1] * sa, pvy = pivot[0] * sa + pivot[1] * ca;
  const tox = (pvx - pvy) * HW, toy = (pvx + pvy) * HH - pivot[2] * ZPX;
  if (turret) {
    const tb = modelBounds(turret, tAng, false);
    x0 = Math.min(x0, tb[0] + tox); x1 = Math.max(x1, tb[2] + tox);
    y0 = Math.min(y0, tb[1] + toy - alt * ZPX); y1 = Math.max(y1, tb[3] + toy);
  }
  if (b) y0 -= b.radar || defId === 'h_nexus' ? 22 : 0; // room for animated roof gear
  const fit = Math.min((S * 0.86) / (x1 - x0), (S * 0.8) / (y1 - y0));
  const sc = Math.max(0.2, fit);
  const cx = S / 2 - ((x0 + x1) / 2) * sc, cy = S * 0.53 - ((y0 + y1) / 2) * sc;
  // floor disc
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(S / 2, cy + Math.min(y1, 20) * sc * 0.6 + (alt > 0 ? S * 0.1 : 0), (x1 - x0) * sc * 0.46, (x1 - x0) * sc * 0.2, 0, 0, 6.3); ctx.fill();
  const sp = renderSprite(body, ang, sc, { outline: 0.7, shadow: alt > 0 ? 0 : 0.3 });
  const ay = cy - alt * ZPX * sc;
  ctx.drawImage(sp.c, cx - sp.ox * sc, ay - sp.oy * sc);
  if (turret) {
    const ts = renderSprite(turret, tAng, sc, { outline: 0.7 });
    ctx.drawImage(ts.c, cx + tox * sc - ts.ox * sc, ay + toy * sc - ts.oy * sc);
  }
  if (b) {
    const art = BUILDING_ART[defId] ?? BUILDING_FALLBACK;
    if (art.live) {
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(sc, sc);
      const g: LiveCtx = {
        ctx, t: 1.3, on: true, P: pal, charge: 0.6, active: 0.5, seed: 0.7,
        glow: (x, y, z, r, col, a) => {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(bank.glow(col), (x - y) * HW - r, (x + y) * HH - z * ZPX - r, r * 2, r * 2);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        },
      };
      art.live(g);
      ctx.restore();
    }
  }
  // vignette + frame
  const vg = ctx.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = faction === 'helion' ? 'rgba(150,230,255,0.5)' : 'rgba(255,190,120,0.5)';
  ctx.lineWidth = Math.max(1, S / 64);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, S - ctx.lineWidth, S - ctx.lineWidth);
  // player colour tab
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S * 0.3, Math.max(2, S * 0.045));
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
