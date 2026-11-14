// Dev-only stand-in renderer: flat top-down view with coloured shapes. Implements the full Renderer contract
// (picking, rect queries, minimap, icons) so the UI can be exercised before the real renderer exists.
import type { Camera, CreateRenderer, Renderer, ViewState } from '../../core/api';
import { Terrain, type Entity, type EntityId, type PlayerId, type World } from '../../core/types';
import { BUILDINGS, UNITS } from '../../data';
import { defOf } from '../dom';

const BASE = 28; // css px per tile at zoom 1
const TERRAIN_COL = ['#4a4339', '#5c4e3a', '#706a61', '#1c4c62', '#24252a', '#2c4c34'];

export const createFakeRenderer: CreateRenderer = (canvas) => {
  const camera: Camera = { x: 10, y: 10, zoom: 1 };
  const ctx = canvas.getContext('2d')!;
  let cw = canvas.clientWidth || 800;
  let ch = canvas.clientHeight || 600;
  let dpr = 1;
  const icons = new Map<string, HTMLCanvasElement>();
  let terrainFor: World['map'] | null = null;
  let terrainImg: HTMLCanvasElement | null = null;

  const scale = () => BASE * camera.zoom;
  const worldToScreen = (x: number, y: number, z = 0) => ({ x: cw / 2 + (x - camera.x) * scale(), y: ch / 2 + (y - camera.y - z * 0.5) * scale() });
  const screenToWorld = (sx: number, sy: number) => ({ x: camera.x + (sx - cw / 2) / scale(), y: camera.y + (sy - ch / 2) / scale() });

  function sizeOf(e: Entity): { w: number; h: number } {
    if (e.kind === 'building') {
      const d = BUILDINGS[e.defId];
      return { w: d?.footprint.w ?? 1, h: d?.footprint.h ?? 1 };
    }
    const r = (UNITS[e.defId]?.radius ?? 0.3) * 2;
    return { w: r, h: r };
  }
  function seen(world: World, e: Entity, viewer: PlayerId): boolean {
    if (e.owner === viewer || !world.setup.options.fog) return true;
    const p = world.players[viewer];
    const i = Math.floor(e.y) * world.map.width + Math.floor(e.x);
    return !!p && p.visible[i] > 0;
  }

  function terrain(world: World): HTMLCanvasElement {
    if (terrainImg && terrainFor === world.map) return terrainImg;
    terrainFor = world.map;
    const m = world.map;
    const cv = document.createElement('canvas');
    cv.width = m.width * 4;
    cv.height = m.height * 4;
    const c = cv.getContext('2d')!;
    for (let ty = 0; ty < m.height; ty++) {
      for (let tx = 0; tx < m.width; tx++) {
        c.fillStyle = TERRAIN_COL[m.terrain[ty * m.width + tx]] ?? TERRAIN_COL[Terrain.Ground];
        c.fillRect(tx * 4, ty * 4, 4, 4);
      }
    }
    terrainImg = cv;
    return cv;
  }

  function render(world: World, view: ViewState): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, cw, ch);
    const s = scale();
    const m = world.map;
    const o = worldToScreen(0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrain(world), o.x, o.y, m.width * s, m.height * s);

    // ore + grid in view
    const a = screenToWorld(0, 0);
    const b = screenToWorld(cw, ch);
    const x0 = Math.max(0, Math.floor(a.x));
    const y0 = Math.max(0, Math.floor(a.y));
    const x1 = Math.min(m.width - 1, Math.ceil(b.x));
    const y1 = Math.min(m.height - 1, Math.ceil(b.y));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const ore = m.ore[ty * m.width + tx];
        if (ore > 0) {
          const p = worldToScreen(tx + 0.5, ty + 0.5);
          ctx.fillStyle = `rgba(250,184,62,${0.35 + 0.05 * ore})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s * 0.3);
          ctx.lineTo(p.x + s * 0.3, p.y);
          ctx.lineTo(p.x, p.y + s * 0.3);
          ctx.lineTo(p.x - s * 0.3, p.y);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let tx = x0; tx <= x1 + 1; tx++) {
      const p = worldToScreen(tx, 0);
      ctx.moveTo(Math.round(p.x) + 0.5, 0);
      ctx.lineTo(Math.round(p.x) + 0.5, ch);
    }
    for (let ty = y0; ty <= y1 + 1; ty++) {
      const p = worldToScreen(0, ty);
      ctx.moveTo(0, Math.round(p.y) + 0.5);
      ctx.lineTo(cw, Math.round(p.y) + 0.5);
    }
    ctx.stroke();

    const ents = [...world.entities.values()].sort((p, q) => (p.kind === q.kind ? p.y - q.y : p.kind === 'building' ? -1 : 1));
    ctx.font = `600 ${Math.max(9, s * 0.36)}px -apple-system, "PingFang TC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of ents) {
      if (!seen(world, e, view.viewer)) continue;
      const col = world.players[e.owner]?.color ?? '#999';
      const p = worldToScreen(e.x, e.y, e.altitude);
      const sz = sizeOf(e);
      const selected = view.selection.has(e.id);
      const hover = view.hoverId === e.id;
      if (e.kind === 'building') {
        const w = sz.w * s;
        const h = sz.h * s;
        ctx.globalAlpha = 0.45 + 0.55 * e.buildProgress;
        ctx.fillStyle = col;
        ctx.fillRect(p.x - w / 2 + 2, p.y - h / 2 + 2, w - 4, h - 4);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(p.x - w / 2 + 5, p.y - h / 2 + 5, w - 10, h - 10);
        ctx.fillStyle = '#fff';
        ctx.fillText((BUILDINGS[e.defId]?.name ?? e.defId).slice(0, 2), p.x, p.y);
        if (selected || hover) {
          ctx.strokeStyle = selected ? '#fff' : 'rgba(255,255,255,.5)';
          ctx.lineWidth = selected ? 2 : 1;
          ctx.strokeRect(p.x - w / 2, p.y - h / 2, w, h);
        }
        if (e.rally && selected) {
          const r = worldToScreen(e.rally.x, e.rally.y);
          ctx.strokeStyle = col;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(r.x, r.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        const r = Math.max(4, (sz.w / 2) * s);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(e.facing) * r, p.y + Math.sin(e.facing) * r);
        ctx.stroke();
        if (selected || hover) {
          ctx.strokeStyle = selected ? '#fff' : 'rgba(255,255,255,.5)';
          ctx.lineWidth = selected ? 2 : 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (selected || hover || view.showAllHealth || e.hp < e.maxHp) {
        const w = Math.max(18, sz.w * s);
        const top = p.y - (sz.h * s) / 2 - 8;
        const f = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,.7)';
        ctx.fillRect(p.x - w / 2, top, w, 4);
        ctx.fillStyle = f > 0.5 ? '#62d894' : f > 0.25 ? '#ffb62e' : '#ff5148';
        ctx.fillRect(p.x - w / 2, top, w * f, 4);
      }
    }

    if (view.placement) {
      for (const c of view.placement.check.cells) {
        const p = worldToScreen(c.tx, c.ty);
        ctx.fillStyle = c.ok ? 'rgba(98,216,148,.45)' : 'rgba(255,81,72,.5)';
        ctx.fillRect(p.x + 1, p.y + 1, s - 2, s - 2);
      }
    }
    if (view.powerTarget) {
      const p = worldToScreen(view.powerTarget.x, view.powerTarget.y);
      ctx.strokeStyle = '#ff9d2e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const mk of view.markers) {
      const age = (view.time - mk.at) / 900;
      if (age > 1) continue;
      const p = worldToScreen(mk.x, mk.y);
      ctx.strokeStyle = mk.kind === 'attack' ? `rgba(255,90,82,${1 - age})` : mk.kind === 'rally' ? `rgba(255,224,122,${1 - age})` : `rgba(111,227,161,${1 - age})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + age * 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (view.dragRect) {
      const d = view.dragRect;
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1;
      ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      ctx.strokeRect(d.x0 + 0.5, d.y0 + 0.5, d.x1 - d.x0, d.y1 - d.y0);
    }
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FAKE RENDERER (top-down dev stand-in)', 12, ch - 14);
  }

  function miniLayout(world: World, w: number, h: number) {
    const m = world.map;
    const k = Math.min(w / m.width, h / m.height);
    return { k, ox: (w - m.width * k) / 2, oy: (h - m.height * k) / 2 };
  }

  const api: Renderer = {
    camera,
    resize(cssWidth, cssHeight, ratio) {
      cw = cssWidth;
      ch = cssHeight;
      dpr = ratio;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    },
    render: (world, view) => render(world, view),
    handleEvents() {
      /* no effects in the stand-in */
    },
    screenToWorld,
    worldToScreen,
    pickEntity(world, sx, sy, viewer) {
      const p = screenToWorld(sx, sy);
      let best: EntityId | null = null;
      let bestScore = Infinity;
      for (const e of world.entities.values()) {
        if (!seen(world, e, viewer)) continue;
        const sz = sizeOf(e);
        const pad = e.kind === 'unit' ? 0.18 : 0;
        const dx = Math.abs(p.x - e.x);
        const dy = Math.abs(p.y - (e.y - e.altitude * 0.5));
        if (dx <= sz.w / 2 + pad && dy <= sz.h / 2 + pad) {
          const score = (e.kind === 'unit' ? 0 : 10) + dx + dy;
          if (score < bestScore) {
            bestScore = score;
            best = e.id;
          }
        }
      }
      return best;
    },
    entitiesInRect(world, x0, y0, x1, y1, viewer) {
      const out: EntityId[] = [];
      const lx = Math.min(x0, x1);
      const hx = Math.max(x0, x1);
      const ly = Math.min(y0, y1);
      const hy = Math.max(y0, y1);
      for (const e of world.entities.values()) {
        if (!seen(world, e, viewer)) continue;
        const p = worldToScreen(e.x, e.y, e.altitude);
        if (p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy) out.push(e.id);
      }
      return out;
    },
    drawMinimap(c, world, view, w, h) {
      const { k, ox, oy } = miniLayout(world, w, h);
      const m = world.map;
      c.fillStyle = '#05070a';
      c.fillRect(0, 0, w, h);
      c.imageSmoothingEnabled = false;
      c.drawImage(terrain(world), ox, oy, m.width * k, m.height * k);
      for (let i = 0; i < m.ore.length; i++) {
        if (m.ore[i] > 0) {
          c.fillStyle = '#e8ad3c';
          c.fillRect(ox + (i % m.width) * k, oy + Math.floor(i / m.width) * k, Math.max(1, k), Math.max(1, k));
        }
      }
      for (const e of world.entities.values()) {
        if (!seen(world, e, view.viewer)) continue;
        const sz = sizeOf(e);
        const r = Math.max(2, (e.kind === 'building' ? sz.w : 0.8) * k);
        c.fillStyle = world.players[e.owner]?.color ?? '#999';
        c.fillRect(ox + e.x * k - r / 2, oy + e.y * k - r / 2, r, r);
      }
      const a = screenToWorld(0, 0);
      const b = screenToWorld(cw, ch);
      c.strokeStyle = '#fff';
      c.lineWidth = Math.max(1, w / 180);
      c.strokeRect(ox + a.x * k, oy + a.y * k, (b.x - a.x) * k, (b.y - a.y) * k);
    },
    minimapToWorld(world, mx, my, w, h) {
      const { k, ox, oy } = miniLayout(world, w, h);
      return { x: (mx - ox) / k, y: (my - oy) / k };
    },
    getIcon(defId, color, size) {
      const key = `${defId}|${color}|${size}`;
      let cv = icons.get(key);
      if (cv) return cv;
      cv = document.createElement('canvas');
      cv.width = size;
      cv.height = size;
      const c = cv.getContext('2d')!;
      const g = c.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, '#2a323b');
      g.addColorStop(1, '#12161b');
      c.fillStyle = g;
      c.fillRect(0, 0, size, size);
      const def = defOf(defId);
      c.fillStyle = color;
      c.strokeStyle = 'rgba(0,0,0,.5)';
      c.lineWidth = size * 0.03;
      c.beginPath();
      if (def?.kind === 'building') c.rect(size * 0.22, size * 0.3, size * 0.56, size * 0.42);
      else if (def?.kind === 'unit' && def.category === 'aircraft') {
        c.moveTo(size * 0.5, size * 0.2);
        c.lineTo(size * 0.8, size * 0.72);
        c.lineTo(size * 0.5, size * 0.6);
        c.lineTo(size * 0.2, size * 0.72);
        c.closePath();
      } else c.arc(size / 2, size / 2, size * (def?.kind === 'unit' && def.category === 'infantry' ? 0.16 : 0.26), 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.font = `700 ${Math.round(size * 0.24)}px -apple-system, "PingFang TC", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText((def?.name ?? defId).slice(0, 1), size / 2, size / 2 + size * 0.02);
      icons.set(key, cv);
      return cv;
    },
    clampCamera(world) {
      camera.zoom = Math.min(2, Math.max(0.5, camera.zoom));
      camera.x = Math.min(world.map.width, Math.max(0, camera.x));
      camera.y = Math.min(world.map.height, Math.max(0, camera.y));
    },
    destroy() {
      icons.clear();
    },
  };
  return api;
};
