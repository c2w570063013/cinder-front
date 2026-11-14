// Dev-only stand-ins: silent audio (logs calls for inspection) and two tiny procedural maps.
import type { AudioApi, MapInfo } from '../../core/api';
import { makeRng } from '../../core/rng';
import { Terrain, type GameMap } from '../../core/types';

export const audioLog: string[] = [];

export function createFakeAudio(): AudioApi {
  const vol = { master: 0.8, sfx: 0.8, music: 0.5, voice: 0.8 };
  const log = (s: string) => {
    audioLog.push(s);
    if (audioLog.length > 60) audioLog.shift();
  };
  return {
    unlock: () => log('unlock'),
    handleEvents() {
      /* silent */
    },
    playUi: (s) => log('ui:' + s),
    playAck: (d, k) => log(`ack:${d}:${k}`),
    setMusic: (m) => log('music:' + m),
    setVolume: (v) => Object.assign(vol, v),
    getVolume: () => ({ ...vol }),
  };
}

function generate(id: string, name: string, w: number, h: number, starts: [number, number][], seed: number): GameMap {
  const rng = makeRng(seed);
  const terrain = new Uint8Array(w * h);
  const ore = new Uint8Array(w * h);
  const variant = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) variant[i] = rng.int(0, 255);
  const blob = (t: number, count: number, rMin: number, rMax: number) => {
    for (let n = 0; n < count; n++) {
      const cx = rng.int(2, w - 3);
      const cy = rng.int(2, h - 3);
      const r = rng.range(rMin, rMax);
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (Math.hypot(x - cx, y - cy) <= r * rng.range(0.7, 1)) terrain[y * w + x] = t;
        }
      }
    }
  };
  blob(Terrain.Rough, 8, 2, 5);
  blob(Terrain.Water, 3, 2, 4);
  blob(Terrain.Rock, 6, 1, 2.5);
  blob(Terrain.Tree, 8, 1, 2.5);
  const pts = starts.map(([fx, fy]) => ({ x: Math.round(fx * (w - 1)), y: Math.round(fy * (h - 1)) }));
  for (const s of pts) {
    for (let y = s.y - 6; y <= s.y + 6; y++) for (let x = s.x - 6; x <= s.x + 6; x++) if (x >= 0 && y >= 0 && x < w && y < h) terrain[y * w + x] = Terrain.Ground;
    for (let k = 0; k < 2; k++) {
      const a = rng.range(0, Math.PI * 2);
      const ox = Math.round(s.x + Math.cos(a) * 9);
      const oy = Math.round(s.y + Math.sin(a) * 9);
      for (let y = oy - 3; y <= oy + 3; y++) {
        for (let x = ox - 3; x <= ox + 3; x++) {
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || Math.hypot(x - ox, y - oy) > 3.2) continue;
          if (Math.hypot(x - s.x, y - s.y) < 5) continue;
          terrain[y * w + x] = Terrain.Ground;
          ore[y * w + x] = rng.int(4, 12);
        }
      }
    }
  }
  return { id, name, width: w, height: h, terrain, ore, variant, starts: pts };
}

export const FAKE_MAPS: MapInfo[] = [
  {
    id: 'dev_basin',
    name: '測試盆地',
    desc: '開發用的小型對稱地圖,兩個起始點隔著中央水域相望。(假資料)',
    maxPlayers: 2,
    width: 48,
    height: 48,
    generate: (seed) => generate('dev_basin', '測試盆地', 48, 48, [[0.2, 0.22], [0.8, 0.78]], seed),
  },
  {
    id: 'dev_cross',
    name: '測試十字',
    desc: '開發用的四人地圖,四角各有一個起始點。(假資料)',
    maxPlayers: 4,
    width: 64,
    height: 56,
    generate: (seed) => generate('dev_cross', '測試十字', 64, 56, [[0.15, 0.18], [0.85, 0.82], [0.85, 0.18], [0.15, 0.82]], seed),
  },
];
