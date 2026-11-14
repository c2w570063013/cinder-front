// Map thumbnail for the skirmish lobby: our own simple top-down tile image, shown as an isometric diamond.
import { ORE_TILE_MAX } from '../../core/constants';
import { Terrain, type GameMap } from '../../core/types';

const PX = 3; // base image pixels per tile

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [Terrain.Ground]: [74, 67, 57],
  [Terrain.Rough]: [92, 78, 58],
  [Terrain.Road]: [112, 106, 97],
  [Terrain.Water]: [28, 76, 98],
  [Terrain.Rock]: [36, 37, 42],
  [Terrain.Tree]: [44, 76, 52],
};

/** Flat top-down image of the map, PX pixels per tile. */
export function renderMapBase(map: GameMap): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, map.width * PX);
  cv.height = Math.max(1, map.height * PX);
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const img = ctx.createImageData(cv.width, cv.height);
  const d = img.data;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const i = ty * map.width + tx;
      const base = TERRAIN_RGB[map.terrain[i]] ?? TERRAIN_RGB[Terrain.Ground];
      const jitter = ((map.variant[i] ?? 0) / 255 - 0.5) * 14;
      let r = base[0] + jitter;
      let g = base[1] + jitter;
      let b = base[2] + jitter;
      const ore = map.ore[i];
      if (ore > 0) {
        const k = 0.55 + 0.45 * Math.min(1, ore / ORE_TILE_MAX);
        r = 250 * k;
        g = 184 * k;
        b = 62 * k;
      }
      for (let py = 0; py < PX; py++) {
        for (let px = 0; px < PX; px++) {
          const o = ((ty * PX + py) * cv.width + tx * PX + px) * 4;
          d[o] = r;
          d[o + 1] = g;
          d[o + 2] = b;
          d[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export interface StartMark {
  /** Fill colour when a player sits here; null = free spot. */
  color: string | null;
  label: string;
  highlight: boolean;
}

export interface PreviewLayout {
  /** Tile coords → CSS px inside the preview canvas. */
  toScreen(x: number, y: number): { x: number; y: number };
}

export function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap, base: HTMLCanvasElement, marks: StartMark[], dpr: number): PreviewLayout {
  const cw = Math.max(1, canvas.clientWidth);
  const ch = Math.max(1, canvas.clientHeight);
  const pw = Math.round(cw * dpr);
  const ph = Math.round(ch * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const W = map.width;
  const H = map.height;
  const pad = 18;
  const s = Math.max(0.5, Math.min((cw - pad * 2) / (W + H), (ch - pad * 2) / ((W + H) / 2)));
  const ox = (cw - (W + H) * s) / 2 + H * s;
  const oy = (ch - ((W + H) * s) / 2) / 2;
  const toScreen = (x: number, y: number) => ({ x: ox + (x - y) * s, y: oy + ((x + y) * s) / 2 });

  const ctx = canvas.getContext('2d');
  if (!ctx) return { toScreen };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  // soft drop shadow of the diamond
  const corners = [toScreen(0, 0), toScreen(W, 0), toScreen(W, H), toScreen(0, H)];
  const path = (dy: number) => {
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y + dy) : ctx.moveTo(c.x, c.y + dy)));
    ctx.closePath();
  };
  path(7);
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fill();

  ctx.save();
  ctx.transform(s, s / 2, -s, s / 2, ox, oy);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(base, 0, 0, W, H);
  ctx.restore();

  path(0);
  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '700 11px -apple-system, "PingFang TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  map.starts.forEach((st, i) => {
    const m = marks[i];
    if (!m) return;
    const p = toScreen(st.x + 0.5, st.y + 0.5);
    const r = m.color ? 10 : 8;
    if (m.highlight) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = m.color ?? 'rgba(10,12,15,.78)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = m.color ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.75)';
    ctx.stroke();
    ctx.fillStyle = m.color ? '#0b0d10' : '#fff';
    ctx.fillText(m.label, p.x, p.y + 0.5);
  });
  return { toScreen };
}
