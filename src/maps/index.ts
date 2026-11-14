// Skirmish maps for 燼原戰線. Every map is an original, procedurally generated layout:
// a deterministic function of the seed, built from symmetric noise so each start is equally good.
import type { MapInfo } from '../core/api';
import { makeRng } from '../core/rng';
import { Terrain, type GameMap, type TerrainId } from '../core/types';
import {
  clearStarts,
  disc,
  distToSegment,
  ensureConnected,
  finalize,
  newCanvas,
  noiseField,
  onGround,
  oreField,
  orbitTiles,
  paintEach,
  quantile,
  rot2,
  rot3,
  rot4,
  scatter,
  segment,
  starterAngle,
  starterField,
} from './gen';

const { Ground, Rough, Road, Water, Rock, Tree } = Terrain;
const DEG = Math.PI / 180;
/**
 * Expansion / contested fields. Starter fields are deliberately small (≈300 units); these are the
 * long-game economy. Harvested-out fields never regrow, so the multiplier sets how long a match can last.
 */
const RICHNESS = 1.7;
const richField: typeof oreField = (c, sym, starts, px, py, target, rng) => oreField(c, sym, starts, px, py, Math.round(target * RICHNESS), rng);
const roadOverGround =(t: TerrainId): TerrainId => (t === Ground || t === Rough ? Road : t);

// ───────────────────────────── 1. 灰燼隘口 — 2 players, 64×64 ─────────────────────────────
// A broken rock ridge runs corner to corner between the two bases. Three ways across:
// the central gap and the open ground around either end of the ridge.

function genCinderPass(seed: number): GameMap {
  const W = 64;
  const H = 64;
  const rng = makeRng(seed ^ 0x1c1de5);
  const c = newCanvas(W, H);
  const sym = rot2(W, H);
  const starts = orbitTiles(sym, 12, 12);

  const nRidge = noiseField(c, sym, rng.int(1, 1e9), 7, 3);
  const nRock = noiseField(c, sym, rng.int(1, 1e9), 6, 3);
  const nTree = noiseField(c, sym, rng.int(1, 1e9), 8, 3);
  const nRough = noiseField(c, sym, rng.int(1, 1e9), 11, 2);
  const gap = rng.range(3.5, 5);
  const ridgeEnd = rng.range(20, 24);
  const bend = rng.range(-0.12, 0.12);

  scatter(c, nRough, 0.88, Rough, onGround);
  scatter(c, nTree, 0.92, Tree, onGround);
  scatter(c, nRock, 0.965, Rock, onGround);
  paintEach(c, (px, py, i) => {
    const along = (px - py) / Math.SQRT2; // position along the ridge (0 at the map centre)
    const across = (px + py - W) / Math.SQRT2 + bend * along; // odd in `along` → still 180° symmetric
    const a = Math.abs(along);
    if (a < gap || a > ridgeEnd + nRidge[i] * 3) return -1;
    return Math.abs(across) < 1.4 + nRidge[i] * 2.4 ? Rock : -1;
  });
  // A worn track from each base toward the central gap.
  segment(c, sym, 14, 14, W / 2 - 2, H / 2 - 2, 0.9, roadOverGround);

  clearStarts(c, starts);
  starterField(c, sym, starts, starterAngle(rng, [0, 90]), 300, rng);
  // Natural expansions along each player's own edges, contested fields at both ridge ends and in the gap.
  richField(c, sym, starts, 35 + rng.int(-2, 2), 9, 420, rng);
  richField(c, sym, starts, 9, 36 + rng.int(-2, 2), 360, rng);
  richField(c, sym, starts, 53, 10, 480, rng);
  richField(c, sym, starts, W / 2 - 4, H / 2 + 3, 260, rng);

  ensureConnected(c, sym, starts);
  return finalize(c, 'cinder_pass', '灰燼隘口', starts, rng);
}

// ───────────────────────────── 2. 裂川渡口 — 2 players, 96×72 ─────────────────────────────
// A meandering river cuts the map in two. Three paved fords are the only crossings.

function genRivenFords(seed: number): GameMap {
  const W = 96;
  const H = 72;
  const rng = makeRng(seed ^ 0x2f0bd5);
  const c = newCanvas(W, H);
  const sym = rot2(W, H);
  const starts = orbitTiles(sym, 15, 25);

  const nBank = noiseField(c, sym, rng.int(1, 1e9), 6, 2);
  const nRock = noiseField(c, sym, rng.int(1, 1e9), 6, 3);
  const nTree = noiseField(c, sym, rng.int(1, 1e9), 9, 3);
  const nPond = noiseField(c, sym, rng.int(1, 1e9), 7, 2);
  const amp1 = rng.range(5, 9);
  const amp2 = rng.range(1.5, 3.5);
  const freq = rng.pick([1, 1.5]);
  const fordY = rng.int(19, 23);
  // Odd function of the distance from the horizontal midline → the river is 180° symmetric.
  const riverX = (py: number): number => {
    const yc = py - H / 2;
    return W / 2 + amp1 * Math.sin((yc / H) * 2 * Math.PI * freq) + amp2 * Math.sin((yc / H) * 2 * Math.PI * 2.5);
  };

  scatter(c, nTree, 0.9, Tree, onGround);
  scatter(c, nRock, 0.96, Rock, onGround);
  const pondTh = quantile(nPond, 0.975);
  paintEach(c, (px, py, i) => {
    const d = Math.abs(px - riverX(py));
    const half = 3 + nBank[i] * 1.8;
    if (d < half) return Water;
    if (d < half + 1.6) return Rough; // muddy banks
    if (nPond[i] > pondTh && d > 14) return Water;
    return -1;
  });
  // Fords: a paved band across the river plus short approaches.
  const fordRule = (t: TerrainId): TerrainId => (t === Rock || t === Tree ? Ground : Road);
  for (const fy of [H / 2 - fordY, H / 2]) {
    const rx = riverX(fy);
    segment(c, sym, rx - 8, fy, rx + 8, fy, 2.6, fordRule);
  }
  // Supply roads from each base to the middle ford.
  segment(c, sym, 17, 27, W / 2 - 10, H / 2, 0.9, roadOverGround);

  clearStarts(c, starts);
  starterField(c, sym, starts, starterAngle(rng, [0, 90, -90]), 300, rng);
  richField(c, sym, starts, 17 + rng.int(-2, 2), 57, 440, rng); // own bank, far end
  richField(c, sym, starts, 33, 8 + rng.int(0, 2), 380, rng); // own bank, toward the upper ford
  richField(c, sym, starts, Math.max(40, riverX(H / 2 - fordY) - 12), H / 2 - fordY + 6, 340, rng); // by the outer fords
  richField(c, sym, starts, W / 2 - 10, H / 2 - 7, 300, rng); // by the middle ford

  ensureConnected(c, sym, starts);
  return finalize(c, 'riven_fords', '裂川渡口', starts, rng);
}

// ───────────────────────────── 3. 十字台地 — 4 players, 96×96 ─────────────────────────────
// Rock walls quarter the map; a walled mesa with four ramps sits in the middle holding the best ore.
// Each quarter has a gate to both neighbours and a ramp up to the mesa.

function genCrossMesa(seed: number): GameMap {
  const N = 96;
  const rng = makeRng(seed ^ 0x3c7055);
  const c = newCanvas(N, N);
  const sym = rot4(N);
  const starts = orbitTiles(sym, 15, 15);

  const nWall = noiseField(c, sym, rng.int(1, 1e9), 6, 2);
  const nRock = noiseField(c, sym, rng.int(1, 1e9), 6, 3);
  const nTree = noiseField(c, sym, rng.int(1, 1e9), 9, 3);
  const nRough = noiseField(c, sym, rng.int(1, 1e9), 12, 2);
  const mesaR = rng.range(16, 18.5);
  const gateAt = rng.range(29, 34);
  const gateHalf = 3.6;
  const rampHalf = 3.6;

  scatter(c, nRough, 0.9, Rough, onGround);
  scatter(c, nTree, 0.91, Tree, onGround);
  scatter(c, nRock, 0.97, Rock, onGround);
  paintEach(c, (px, py, i) => {
    const dx = px - N / 2;
    const dy = py - N / 2;
    const r = Math.sqrt(dx * dx + dy * dy);
    const thick = 1.3 + nWall[i] * 1.5;
    // Mesa rim, open where the diagonals (toward each base) cross it.
    if (Math.abs(r - mesaR) < thick) {
      const offDiagonal = Math.abs(Math.abs(dx) - Math.abs(dy)) / Math.SQRT2;
      return offDiagonal < rampHalf ? Ground : Rock;
    }
    // Cross arms from the rim to the map edge, each with one gate.
    if (r > mesaR) {
      const arm = Math.min(Math.abs(dx), Math.abs(dy));
      const alongArm = Math.max(Math.abs(dx), Math.abs(dy));
      if (arm < thick) return Math.abs(alongArm - gateAt) < gateHalf ? Ground : Rock;
    }
    return -1;
  });
  // The mesa top is rough, cracked ground.
  paintEach(c, (px, py, i, cur) => (cur === Ground && Math.hypot(px - N / 2, py - N / 2) < mesaR - 3 && nRough[i] > 0.45 ? Rough : -1));

  clearStarts(c, starts);
  starterField(c, sym, starts, starterAngle(rng, [0, 90]), 300, rng);
  richField(c, sym, starts, 39, 22 + rng.int(-2, 2), 400, rng); // by the gate to one neighbour
  richField(c, sym, starts, 31, 31, 280, rng); // at the foot of the ramp
  richField(c, sym, starts, N / 2 - 6, N / 2 - 6, 420, rng); // mesa top, one lobe per player
  richField(c, sym, starts, N / 2, N / 2 - 1, 200, rng); // mesa centre

  ensureConnected(c, sym, starts);
  return finalize(c, 'cross_mesa', '十字台地', starts, rng);
}

// ───────────────────────────── 4. 餘燼盆地 — 4 players, 128×128 ─────────────────────────────
// A wide open basin. Bases sit at the middle of each edge; the richest ore lies in the centre.

function genEmberBasin(seed: number): GameMap {
  const N = 128;
  const rng = makeRng(seed ^ 0x4eb0a5);
  const c = newCanvas(N, N);
  const sym = rot4(N);
  const starts = orbitTiles(sym, 64, 15);

  const nRock = noiseField(c, sym, rng.int(1, 1e9), 7, 3);
  const nTree = noiseField(c, sym, rng.int(1, 1e9), 10, 3);
  const nRough = noiseField(c, sym, rng.int(1, 1e9), 14, 2);
  const nPond = noiseField(c, sym, rng.int(1, 1e9), 9, 2);

  scatter(c, nRough, 0.86, Rough, onGround);
  scatter(c, nTree, 0.925, Tree, onGround);
  scatter(c, nRock, 0.968, Rock, onGround);
  scatter(c, nPond, 0.982, Water, (t) => t !== Rock);
  // Keep the very centre open so the fight over the ore is a real field battle.
  disc(c, sym, N / 2, N / 2, 15, (t) => (t === Rough || t === Ground ? t : Ground));
  segment(c, sym, 64, 20, 64, 46, 0.9, roadOverGround);

  clearStarts(c, starts);
  starterField(c, sym, starts, starterAngle(rng, [0, 180, 90]), 320, rng);
  richField(c, sym, starts, 40 + rng.int(-3, 3), 24, 420, rng); // natural expansion
  richField(c, sym, starts, 19, 19, 520, rng); // corners: shared with one neighbour
  richField(c, sym, starts, 43, 43 + rng.int(-2, 2), 380, rng); // mid ring
  richField(c, sym, starts, 64, 50, 460, rng); // inner ring
  richField(c, sym, starts, N / 2 - 3, N / 2 - 3, 360, rng); // dead centre

  ensureConnected(c, sym, starts);
  return finalize(c, 'ember_basin', '餘燼盆地', starts, rng);
}

// ───────────────────────────── 5. 碎嶼群 — 4 players, 112×112 ─────────────────────────────
// Islands in a shallow sea. There are no ships: every island is joined to its neighbours by
// sandbars and paved causeways, so the fight is over the crossings.

function genShardIsles(seed: number): GameMap {
  const N = 112;
  const rng = makeRng(seed ^ 0x5a1d35);
  const c = newCanvas(N, N, Water);
  const sym = rot4(N);
  const starts = orbitTiles(sym, 19, 19);

  const nShore = noiseField(c, sym, rng.int(1, 1e9), 8, 3);
  const nRock = noiseField(c, sym, rng.int(1, 1e9), 6, 3);
  const nTree = noiseField(c, sym, rng.int(1, 1e9), 8, 3);
  const nRough = noiseField(c, sym, rng.int(1, 1e9), 10, 2);
  const sideAt = rng.int(15, 19);
  const islands: { x: number; y: number; r: number }[] = [];
  const addIsland = (x: number, y: number, r: number): void => {
    for (let k = 0; k < sym.n; k++) {
      const [ix, iy] = sym.point(k, x, y);
      islands.push({ x: ix, y: iy, r });
    }
  };
  addIsland(23, 23, 19); // home islands (the base sits a little off-centre, toward the corner)
  addIsland(N / 2, sideAt + 0.5, 11.5); // side islands between neighbouring homes
  islands.push({ x: N / 2, y: N / 2, r: rng.range(15, 17.5) }); // the central island

  paintEach(c, (px, py, i) => {
    let best = Infinity;
    for (const isl of islands) {
      const d = Math.hypot(px - isl.x, py - isl.y) / isl.r;
      if (d < best) best = d;
    }
    const edge = best + (nShore[i] - 0.5) * 0.42;
    if (edge < 0.9) return Ground;
    if (edge < 1) return Rough; // beaches
    return nRock[i] > 0.93 && edge > 1.25 ? Rock : -1; // sea stacks
  });
  scatter(c, nRough, 0.9, Rough, onGround);
  scatter(c, nTree, 0.8, Tree, onGround);
  scatter(c, nRock, 0.94, Rock, onGround);

  // Sandbars: home ↔ both neighbouring side islands. Causeways: side island ↔ centre.
  const sand = (t: TerrainId): TerrainId => (t === Water || t === Rock || t === Tree ? Rough : t);
  const pave = (t: TerrainId): TerrainId => (t === Ground ? Ground : Road);
  segment(c, sym, 23, 23, N / 2, sideAt + 0.5, 2.6, sand);
  segment(c, sym, 23, 23, sideAt + 0.5, N / 2, 2.6, sand);
  segment(c, sym, N / 2, sideAt + 0.5, N / 2, N / 2 - 10, 2.6, pave);

  clearStarts(c, starts);
  starterField(c, sym, starts, starterAngle(rng, [0, 90]), 320, rng);
  richField(c, sym, starts, 35, 34, 260, rng); // second field on the far side of the home island
  richField(c, sym, starts, N / 2 + rng.int(-3, 3), sideAt - 2, 440, rng); // side islands
  richField(c, sym, starts, N / 2 - 7, N / 2 - 7, 440, rng); // central island, one lobe per player
  richField(c, sym, starts, N / 2, N / 2, 240, rng);

  ensureConnected(c, sym, starts);
  return finalize(c, 'shard_isles', '碎嶼群', starts, rng);
}

// ───────────────────────────── 6. 三冠環 — 3 players, 104×104 ─────────────────────────────
// Three bases around a moated central island. Each base has its own causeway to the island;
// rock spurs between the bases leave an inner and an outer pass toward each neighbour.

function genTriCrown(seed: number): GameMap {
  const N = 104;
  const rng = makeRng(seed ^ 0x67c0a5);
  const c = newCanvas(N, N);
  const sym = rot3(N, N);
  const C = N / 2;
  const startR = 35;
  const baseAngle = -90 * DEG; // start 0 is due "north"
  const starts = orbitTiles(sym, Math.floor(C + Math.cos(baseAngle) * startR), Math.floor(C + Math.sin(baseAngle) * startR));

  const nWall = noiseField(c, sym, rng.int(1, 1e9), 6, 2);
  const nRock = noiseField(c, sym, rng.int(1, 1e9), 6, 3);
  const nTree = noiseField(c, sym, rng.int(1, 1e9), 9, 3);
  const nRough = noiseField(c, sym, rng.int(1, 1e9), 12, 2);
  const moatIn = rng.range(11, 12.5);
  const moatOut = moatIn + rng.range(4, 5);
  const spurFrom = rng.range(22.5, 24.5);
  const spurTo = rng.range(39, 42);

  scatter(c, nRough, 0.9, Rough, onGround);
  scatter(c, nTree, 0.91, Tree, onGround);
  scatter(c, nRock, 0.968, Rock, onGround);
  paintEach(c, (px, py, i) => {
    const r = Math.hypot(px - C, py - C);
    if (r > moatIn - nWall[i] && r < moatOut + nWall[i]) return Water;
    for (let k = 0; k < 3; k++) {
      // Spurs lie on the bisectors between neighbouring bases.
      const a = baseAngle + (k * 120 + 60) * DEG;
      const d = distToSegment(px, py, C + Math.cos(a) * spurFrom, C + Math.sin(a) * spurFrom, C + Math.cos(a) * spurTo, C + Math.sin(a) * spurTo);
      if (d < 1.4 + nWall[i] * 1.6) return Rock;
    }
    return -1;
  });
  // Causeways across the moat, one in line with each base.
  const ax = Math.cos(baseAngle);
  const ay = Math.sin(baseAngle);
  segment(c, sym, C + ax * (moatIn - 3), C + ay * (moatIn - 3), C + ax * (moatOut + 3), C + ay * (moatOut + 3), 2.7, (t) => (t === Ground ? Ground : Road));
  segment(c, sym, C + ax * (moatOut + 3), C + ay * (moatOut + 3), C + ax * (startR - 10), C + ay * (startR - 10), 0.9, roadOverGround);

  clearStarts(c, starts);
  const polar = (r: number, deg: number): [number, number] => [C + Math.cos(baseAngle + deg * DEG) * r, C + Math.sin(baseAngle + deg * DEG) * r];
  starterField(c, sym, starts, starterAngle(rng, [0, 180]), 300, rng);
  let p = polar(41, 40 + rng.int(-3, 3));
  richField(c, sym, starts, p[0], p[1], 420, rng); // clockwise flank
  p = polar(41, -40 + rng.int(-3, 3));
  richField(c, sym, starts, p[0], p[1], 360, rng); // counter-clockwise flank
  p = polar(19, 60);
  richField(c, sym, starts, p[0], p[1], 300, rng); // inner pass, shared with a neighbour
  p = polar(5.5, 0);
  richField(c, sym, starts, p[0], p[1], 380, rng); // the island

  ensureConnected(c, sym, starts);
  return finalize(c, 'tri_crown', '三冠環', starts, rng);
}

// ───────────────────────────── registry ─────────────────────────────

export const MAPS: MapInfo[] = [
  {
    id: 'cinder_pass',
    name: '灰燼隘口',
    desc: '雙人對決。一道斷裂的岩脊橫亙兩座基地之間,可走中央隘口,或繞過岩脊兩端的開闊礦區。節奏快,適合速攻。',
    maxPlayers: 2,
    width: 64,
    height: 64,
    generate: genCinderPass,
  },
  {
    id: 'riven_fords',
    name: '裂川渡口',
    desc: '雙人對決。蜿蜒的河流將戰場一分為二,只有三處鋪石渡口可以過河。守住渡口,或從側翼強渡。',
    maxPlayers: 2,
    width: 96,
    height: 72,
    generate: genRivenFords,
  },
  {
    id: 'cross_mesa',
    name: '十字台地',
    desc: '四人混戰。岩牆把地圖切成四塊,各有閘口通往鄰居;中央台地礦藏最豐,四條坡道直通各家門口。',
    maxPlayers: 4,
    width: 96,
    height: 96,
    generate: genCrossMesa,
  },
  {
    id: 'ember_basin',
    name: '餘燼盆地',
    desc: '四人大地圖。基地分據四邊,地勢開闊、少有險阻,盆地中央的富礦是兵家必爭之地。適合大規模裝甲會戰。',
    maxPlayers: 4,
    width: 128,
    height: 128,
    generate: genEmberBasin,
  },
  {
    id: 'shard_isles',
    name: '碎嶼群',
    desc: '四人島嶼圖。淺海中的島嶼以沙洲與堤道相連,沒有船也能抵達每一處。誰掌握堤道,誰就掌握中央島的礦脈。',
    maxPlayers: 4,
    width: 112,
    height: 112,
    generate: genShardIsles,
  },
  {
    id: 'tri_crown',
    name: '三冠環',
    desc: '三人混戰。三座基地環繞著護城湖中的礦島,各有一條堤道直通湖心;岩嶺之間留有內外兩條通道可偷襲鄰居。',
    maxPlayers: 3,
    width: 104,
    height: 104,
    generate: genTriCrown,
  },
];
