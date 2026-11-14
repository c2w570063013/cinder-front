// Read-only map analysis shared by the generators, the tests and the dev viewer.
import { Terrain, type GameMap } from '../core/types';

/** Ground units can stand on Ground / Rough / Road. */
export function isPassableTerrain(t: number): boolean {
  return t === Terrain.Ground || t === Terrain.Rough || t === Terrain.Road;
}

/**
 * 1 where a tile and all eight neighbours are passable, i.e. the centre line of a corridor that is
 * at least 3 tiles wide. Connectivity over this mask proves there is no chokepoint narrower than 3.
 */
export function erodedMask(terrain: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let ty = 1; ty < h - 1; ty++) {
    for (let tx = 1; tx < w - 1; tx++) {
      let ok = 1;
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!isPassableTerrain(terrain[(ty + dy) * w + tx + dx])) {
            ok = 0;
            break;
          }
        }
      }
      out[ty * w + tx] = ok;
    }
  }
  return out;
}

/** 4-connected flood fill over a 0/1 mask. Returns 1 for every tile reachable from (sx,sy). */
export function floodFill(mask: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const start = sy * w + sx;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !mask[start]) return out;
  const stack = [start];
  out[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0 && mask[i - 1] && !out[i - 1]) (out[i - 1] = 1), stack.push(i - 1);
    if (x < w - 1 && mask[i + 1] && !out[i + 1]) (out[i + 1] = 1), stack.push(i + 1);
    if (i >= w && mask[i - w] && !out[i - w]) (out[i - w] = 1), stack.push(i - w);
    if (i < w * (h - 1) && mask[i + w] && !out[i + w]) (out[i + w] = 1), stack.push(i + w);
  }
  return out;
}

export function passableMask(map: GameMap): Uint8Array {
  const out = new Uint8Array(map.terrain.length);
  for (let i = 0; i < out.length; i++) out[i] = isPassableTerrain(map.terrain[i]) ? 1 : 0;
  return out;
}

/** Tiles reachable by ground from a start. `wide` restricts to corridors ≥ 3 tiles wide. */
export function reachableFrom(map: GameMap, startIndex: number, wide = false): Uint8Array {
  const s = map.starts[startIndex];
  const mask = wide ? erodedMask(map.terrain, map.width, map.height) : passableMask(map);
  return floodFill(mask, map.width, map.height, s.x, s.y);
}

/** Total ore units on tiles whose centre lies within `r` tiles of tile (tx,ty). */
export function oreWithin(map: GameMap, tx: number, ty: number, r: number): number {
  let sum = 0;
  const x0 = Math.max(0, Math.floor(tx - r));
  const x1 = Math.min(map.width - 1, Math.ceil(tx + r));
  const y0 = Math.max(0, Math.floor(ty - r));
  const y1 = Math.min(map.height - 1, Math.ceil(ty + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - tx;
      const dy = y - ty;
      if (dx * dx + dy * dy <= r * r) sum += map.ore[y * map.width + x];
    }
  }
  return sum;
}

/** Distance (tiles) from (tx,ty) to the nearest ore tile, or Infinity. */
export function nearestOreDistance(map: GameMap, tx: number, ty: number): number {
  let best = Infinity;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!map.ore[y * map.width + x]) continue;
      const d = Math.hypot(x - tx, y - ty);
      if (d < best) best = d;
    }
  }
  return best;
}

export function totalOre(map: GameMap): number {
  let sum = 0;
  for (let i = 0; i < map.ore.length; i++) sum += map.ore[i];
  return sum;
}
