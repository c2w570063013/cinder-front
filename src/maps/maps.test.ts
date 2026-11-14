import { describe, expect, it } from 'vitest';
import { ORE_TILE_MAX } from '../core/constants';
import { Terrain, type GameMap } from '../core/types';
import { nearestOreDistance, oreWithin, reachableFrom, totalOre } from './analysis';
import { MAPS } from './index';

const SEEDS = [0, 1, 2, 7, 42, 1234567, -99];
/** Maps whose symmetry is tile-exact (rotations by 90°/180°). */
const EXACT: Record<string, 2 | 4> = { cinder_pass: 2, riven_fords: 2, cross_mesa: 4, ember_basin: 4, shard_isles: 4 };

function image(map: GameMap, order: 2 | 4, x: number, y: number): [number, number] {
  return order === 2 ? [map.width - 1 - x, map.height - 1 - y] : [map.width - 1 - y, x];
}

describe('map registry', () => {
  it('has at least five maps with unique ids and Chinese names', () => {
    expect(MAPS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(MAPS.length);
    for (const m of MAPS) {
      expect(m.name).toMatch(/[一-鿿]/);
      expect(m.desc).toMatch(/[一-鿿]/);
      expect(m.maxPlayers).toBeGreaterThanOrEqual(2);
    }
  });
  it('offers 2-, 3- and 4-player maps', () => {
    const sizes = new Set(MAPS.map((m) => m.maxPlayers));
    expect(sizes.has(2) && sizes.has(3) && sizes.has(4)).toBe(true);
  });
});

for (const info of MAPS) {
  describe(`map ${info.id}`, () => {
    for (const seed of SEEDS) {
      const map = info.generate(seed);
      const { width: w, height: h } = map;
      const tag = `seed ${seed}`;

      it(`${tag}: well-formed arrays`, () => {
        expect(map.id).toBe(info.id);
        expect(map.name).toBe(info.name);
        expect(w).toBe(info.width);
        expect(h).toBe(info.height);
        expect(map.terrain.length).toBe(w * h);
        expect(map.ore.length).toBe(w * h);
        expect(map.variant.length).toBe(w * h);
        for (let i = 0; i < w * h; i++) {
          if (map.terrain[i] > Terrain.Tree) throw new Error(`bad terrain ${map.terrain[i]} at ${i}`);
          if (map.ore[i] > ORE_TILE_MAX) throw new Error(`ore ${map.ore[i]} over max at ${i}`);
        }
        expect(new Set(map.variant).size).toBeGreaterThan(100);
      });

      it(`${tag}: enough starts, away from the edge and from each other`, () => {
        expect(map.starts.length).toBeGreaterThanOrEqual(info.maxPlayers);
        for (const s of map.starts) {
          expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
          expect(Math.min(s.x, s.y, w - 1 - s.x, h - 1 - s.y)).toBeGreaterThanOrEqual(10);
        }
        for (let a = 0; a < map.starts.length; a++) {
          for (let b = a + 1; b < map.starts.length; b++) {
            expect(Math.hypot(map.starts[a].x - map.starts[b].x, map.starts[a].y - map.starts[b].y)).toBeGreaterThan(40);
          }
        }
      });

      it(`${tag}: every start has a clear, ore-free 15×15 of Ground`, () => {
        for (const s of map.starts) {
          for (let ty = s.y - 7; ty <= s.y + 7; ty++) {
            for (let tx = s.x - 7; tx <= s.x + 7; tx++) {
              const i = ty * w + tx;
              if (map.terrain[i] !== Terrain.Ground || map.ore[i] !== 0) throw new Error(`start (${s.x},${s.y}) not clear at (${tx},${ty})`);
            }
          }
        }
      });

      it(`${tag}: starter ore field of 250–350 units, 6–10 tiles out, equal for everyone`, () => {
        const totals = map.starts.map((s) => oreWithin(map, s.x, s.y, 17));
        for (let k = 0; k < map.starts.length; k++) {
          expect(totals[k]).toBeGreaterThanOrEqual(250);
          expect(totals[k]).toBeLessThanOrEqual(350);
          const d = nearestOreDistance(map, map.starts[k].x, map.starts[k].y);
          expect(d).toBeGreaterThanOrEqual(6);
          expect(d).toBeLessThanOrEqual(10);
        }
        expect(Math.max(...totals) - Math.min(...totals)).toBe(0);
      });

      it(`${tag}: expansion and contested ore exists, fairly distributed`, () => {
        const total = totalOre(map);
        const starter = map.starts.reduce((a, s) => a + oreWithin(map, s.x, s.y, 17), 0);
        expect(total - starter).toBeGreaterThanOrEqual(info.maxPlayers * 600);
        // Ore within a medium radius (starter + natural expansions) is near-identical per start.
        const local = map.starts.map((s) => oreWithin(map, s.x, s.y, 34));
        expect(Math.min(...local)).toBeGreaterThanOrEqual(550);
        expect(Math.max(...local) / Math.min(...local)).toBeLessThan(1.12);
      });

      it(`${tag}: ore sits on Ground/Rough, off the edge, and is reachable`, () => {
        const reach = reachableFrom(map, 0);
        for (let ty = 0; ty < h; ty++) {
          for (let tx = 0; tx < w; tx++) {
            const i = ty * w + tx;
            if (!map.ore[i]) continue;
            const t = map.terrain[i];
            if (t !== Terrain.Ground && t !== Terrain.Rough) throw new Error(`ore on terrain ${t} at (${tx},${ty})`);
            if (tx < 3 || ty < 3 || tx >= w - 3 || ty >= h - 3) throw new Error(`ore at the edge (${tx},${ty})`);
            if (!reach[i]) throw new Error(`unreachable ore at (${tx},${ty})`);
          }
        }
      });

      it(`${tag}: all starts mutually reachable through corridors ≥ 3 tiles wide`, () => {
        const wide = reachableFrom(map, 0, true);
        for (const s of map.starts) expect(wide[s.y * w + s.x]).toBe(1);
        // And a decent share of the map is actually usable land.
        let open = 0;
        const reach = reachableFrom(map, 0);
        for (let i = 0; i < reach.length; i++) open += reach[i];
        expect(open / (w * h)).toBeGreaterThan(info.id === 'shard_isles' ? 0.25 : 0.55);
      });

      const order = EXACT[info.id];
      if (order) {
        it(`${tag}: terrain and ore are exactly rotation-symmetric`, () => {
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const [ix, iy] = image(map, order, x, y);
              if (map.terrain[y * w + x] !== map.terrain[iy * w + ix]) throw new Error(`terrain asymmetry at (${x},${y})`);
              if (map.ore[y * w + x] !== map.ore[iy * w + ix]) throw new Error(`ore asymmetry at (${x},${y})`);
            }
          }
        });
      }

      it(`${tag}: deterministic`, () => {
        const again = info.generate(seed);
        expect(again.terrain).toEqual(map.terrain);
        expect(again.ore).toEqual(map.ore);
        expect(again.variant).toEqual(map.variant);
        expect(again.starts).toEqual(map.starts);
      });
    }

    it('different seeds give different maps', () => {
      const a = info.generate(11);
      const b = info.generate(12);
      let diff = 0;
      for (let i = 0; i < a.terrain.length; i++) if (a.terrain[i] !== b.terrain[i]) diff++;
      expect(diff).toBeGreaterThan(a.terrain.length * 0.02);
    });
  });
}
