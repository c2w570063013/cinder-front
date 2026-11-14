// Dev page for the ai-maps session: top-down map viewer + (when the sim exists) AI-vs-AI fast-forward.
import type { AiController, CreateAi, MapInfo, SimApi } from '../core/api';
import { TICK_RATE } from '../core/constants';
import { Terrain, type Command, type Difficulty, type FactionId, type GameMap, type World } from '../core/types';
import { BUILDINGS, FACTIONS, UNITS } from '../data';
import { nearestOreDistance, oreWithin, reachableFrom, passableMask, totalOre } from './analysis';
import { MAPS } from './index';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const mapSel = $<HTMLSelectElement>('map');
const seedIn = $<HTMLInputElement>('seed');
const overlaySel = $<HTMLSelectElement>('overlay');
const zoomSel = $<HTMLSelectElement>('zoom');
const side = $<HTMLDivElement>('side');
const gallery = $<HTMLDivElement>('gallery');
const simbar = $<HTMLSpanElement>('simbar');

const TERRAIN_RGB: [number, number, number][] = [
  [96, 84, 62], // Ground — ash-brown soil
  [122, 104, 70], // Rough
  [150, 146, 136], // Road
  [34, 78, 110], // Water
  [58, 56, 60], // Rock
  [40, 86, 52], // Tree
];
const TERRAIN_NAMES = ['平地 Ground', '崎嶇 Rough', '道路 Road', '水域 Water', '岩石 Rock', '樹林 Tree'];
const PLAYER_COLORS = ['#3fa7ff', '#ff8a2a', '#b08cff', '#7bd148'];

let current: GameMap = MAPS[0].generate(1);
let currentInfo: MapInfo = MAPS[0];

function drawTerrain(target: CanvasRenderingContext2D, map: GameMap, scale: number, overlay: string): void {
  const { width: w, height: h } = map;
  const img = new ImageData(w, h);
  const reach = overlay === 'none' ? null : reachableFrom(map, 0, overlay === 'wide');
  const pass = overlay === 'blocked' ? passableMask(map) : null;
  for (let i = 0; i < w * h; i++) {
    let [r, g, b] = TERRAIN_RGB[map.terrain[i]];
    const v = (map.variant[i] / 255 - 0.5) * 14;
    r += v;
    g += v;
    b += v;
    if (map.ore[i]) {
      const k = 0.45 + 0.55 * (map.ore[i] / 12);
      r = r * (1 - k) + 60 * k;
      g = g * (1 - k) + 235 * k;
      b = b * (1 - k) + 200 * k;
    }
    if (reach && overlay !== 'blocked' && reach[i]) {
      r = r * 0.55 + 255 * 0.45;
      g = g * 0.55 + 240 * 0.45;
      b = b * 0.55 + 120 * 0.45;
    }
    if (pass && reach && pass[i] && !reach[i]) {
      r = 255;
      g = 40;
      b = 90;
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  off.getContext('2d')!.putImageData(img, 0, 0);
  target.imageSmoothingEnabled = false;
  target.drawImage(off, 0, 0, w * scale, h * scale);
  map.starts.forEach((s, k) => {
    target.strokeStyle = PLAYER_COLORS[k % 4];
    target.lineWidth = Math.max(1, scale / 3);
    target.strokeRect((s.x - 7) * scale, (s.y - 7) * scale, 15 * scale, 15 * scale);
    target.fillStyle = PLAYER_COLORS[k % 4];
    target.beginPath();
    target.arc((s.x + 0.5) * scale, (s.y + 0.5) * scale, Math.max(2, scale * 0.9), 0, Math.PI * 2);
    target.fill();
    if (scale >= 4) {
      target.fillStyle = '#fff';
      target.font = `bold ${scale * 2.2}px sans-serif`;
      target.fillText(String(k + 1), (s.x + 1.6) * scale, (s.y - 0.6) * scale);
    }
  });
}

function renderMap(): void {
  const scale = Number(zoomSel.value);
  canvas.width = current.width * scale;
  canvas.height = current.height * scale;
  drawTerrain(ctx, current, scale, overlaySel.value);
}

function stats(): void {
  const map = current;
  const n = map.width * map.height;
  const counts = new Array(6).fill(0);
  for (let i = 0; i < n; i++) counts[map.terrain[i]]++;
  const wide = reachableFrom(map, 0, true);
  const reach = reachableFrom(map, 0);
  const pass = passableMask(map);
  let pocket = 0;
  for (let i = 0; i < n; i++) if (pass[i] && !reach[i]) pocket++;
  const rows = map.starts
    .map((s, k) => {
      const ok = wide[s.y * map.width + s.x] === 1;
      return `<tr><td><span class="sw" style="background:${PLAYER_COLORS[k % 4]}"></span>${k + 1} (${s.x},${s.y})</td>
        <td>${oreWithin(map, s.x, s.y, 17)}</td><td>${oreWithin(map, s.x, s.y, 34)}</td>
        <td>${nearestOreDistance(map, s.x, s.y).toFixed(1)}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</td></tr>`;
    })
    .join('');
  side.innerHTML = `
    <h2>${currentInfo.name} <small>(${currentInfo.id})</small></h2>
    <div>${currentInfo.desc}</div>
    <div>${map.width}×${map.height} · ${currentInfo.maxPlayers} 人 · 總礦量 ${totalOre(map)} 單位</div>
    <h2>地形</h2>
    <table>${counts.map((cnt, t) => `<tr><td><span class="sw" style="background:rgb(${TERRAIN_RGB[t].join(',')})"></span>${TERRAIN_NAMES[t]}</td><td>${((cnt / n) * 100).toFixed(1)}%</td></tr>`).join('')}
      <tr><td><span class="sw" style="background:rgb(60,235,200)"></span>晶礦 Ore</td><td>${Array.from(map.ore).filter((o) => o > 0).length} 格</td></tr>
      <tr><td>不可達的可通行地</td><td class="${pocket > n * 0.02 ? 'bad' : ''}">${pocket} 格</td></tr></table>
    <h2>起始點</h2>
    <table><tr><th>#</th><th>礦 r17</th><th>礦 r34</th><th>最近礦</th><th>寬通道</th></tr>${rows}</table>
    <div id="simout"></div>`;
}

function regenerate(): void {
  currentInfo = MAPS.find((m) => m.id === mapSel.value) ?? MAPS[0];
  current = currentInfo.generate(Number(seedIn.value) | 0);
  stopMatch();
  renderMap();
  stats();
}

function buildGallery(): void {
  gallery.innerHTML = '';
  const seed = Number(seedIn.value) | 0;
  for (const info of MAPS) {
    const map = info.generate(seed);
    const fig = document.createElement('figure');
    const cv = document.createElement('canvas');
    const scale = 2;
    cv.width = map.width * scale;
    cv.height = map.height * scale;
    drawTerrain(cv.getContext('2d')!, map, scale, 'none');
    const cap = document.createElement('figcaption');
    cap.textContent = `${info.name} · ${info.maxPlayers}人 · ${info.width}×${info.height}`;
    fig.append(cv, cap);
    fig.onclick = () => {
      mapSel.value = info.id;
      regenerate();
      window.scrollTo({ top: 0 });
    };
    gallery.append(fig);
  }
}

for (const m of MAPS) mapSel.add(new Option(`${m.name} (${m.maxPlayers}人 ${m.width}×${m.height})`, m.id));
mapSel.onchange = regenerate;
overlaySel.onchange = renderMap;
zoomSel.onchange = renderMap;
seedIn.onchange = () => {
  regenerate();
  buildGallery();
};
$('prev').onclick = () => {
  seedIn.value = String((Number(seedIn.value) | 0) - 1);
  regenerate();
  buildGallery();
};
$('next').onclick = () => {
  seedIn.value = String((Number(seedIn.value) | 0) + 1);
  regenerate();
  buildGallery();
};

// ───────────────────────────── AI-vs-AI fast-forward (needs src/sim and src/ai) ─────────────────────────────

const simMods = import.meta.glob('../sim/index.ts');
const aiMods = import.meta.glob('../ai/index.ts');
let advanceTo: (tick: number) => void = () => {};
let match: { world: World; sim: SimApi; ais: AiController[]; timer: number; thinkMs: number; thinkN: number } | null = null;

function stopMatch(): void {
  if (match) cancelAnimationFrame(match.timer);
  match = null;
}

function drawMatch(): void {
  if (!match) return;
  const { world } = match;
  const scale = Number(zoomSel.value);
  renderMap();
  for (const e of world.entities.values()) {
    const col = world.players[e.owner]?.color ?? '#fff';
    ctx.fillStyle = col;
    if (e.kind === 'building') {
      const fp = BUILDINGS[e.defId]?.footprint ?? { w: 1, h: 1 };
      ctx.fillRect((e.x - fp.w / 2) * scale, (e.y - fp.h / 2) * scale, fp.w * scale, fp.h * scale);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect((e.x - fp.w / 2) * scale + 0.5, (e.y - fp.h / 2) * scale + 0.5, fp.w * scale - 1, fp.h * scale - 1);
    } else {
      const def = UNITS[e.defId];
      const r = def?.harvester ? 0.55 : def?.category === 'infantry' ? 0.28 : def?.category === 'aircraft' ? 0.5 : 0.42;
      ctx.beginPath();
      ctx.arc(e.x * scale, e.y * scale, Math.max(1.2, r * scale), 0, Math.PI * 2);
      ctx.fill();
      if (def?.harvester || def?.category === 'aircraft') {
        ctx.strokeStyle = def.harvester ? '#3cebc8' : '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
  const out = document.getElementById('simout');
  if (out) {
    const mins = (world.tick / TICK_RATE / 60).toFixed(1);
    const rows = world.players
      .map((p) => {
        let units = 0;
        let army = 0;
        let harv = 0;
        let bld = 0;
        for (const e of world.entities.values()) {
          if (e.owner !== p.id) continue;
          if (e.kind === 'building') bld++;
          else {
            units++;
            const d = UNITS[e.defId];
            if (d?.harvester) harv++;
            else if (d?.weapon) army += d.cost;
          }
        }
        return `<tr><td><span class="sw" style="background:${p.color}"></span>${p.name}${p.defeated ? ' ✗' : ''}</td><td>${Math.floor(p.credits)}</td><td>${p.powerProduced - p.powerConsumed}</td><td>${bld}</td><td>${harv}</td><td>${units}</td><td>${army}</td><td>${p.stats.kills}</td></tr>`;
      })
      .join('');
    out.innerHTML = `<h2>AI 對戰 — ${mins} 分 (tick ${world.tick})${world.winnerTeam !== null ? ` · 勝方隊伍 ${world.winnerTeam}` : ''}</h2>
      <table><tr><th>玩家</th><th>資金</th><th>電力</th><th>建築</th><th>採礦</th><th>單位</th><th>軍力$</th><th>擊殺</th></tr>${rows}</table>
      <pre>think 平均 ${(match.thinkMs / Math.max(1, match.thinkN)).toFixed(4)} ms / tick / AI</pre>
      ${match.ais.map((a, k) => `<h2>P${k} 決策紀錄</h2><pre>${((a as { log?: string[] }).log ?? []).slice(-8).join('\n')}</pre>`).join('')}`;
  }
}

async function startMatch(speed: number): Promise<void> {
  stopMatch();
  const simLoad = simMods['../sim/index.ts'];
  const aiLoad = aiMods['../ai/index.ts'];
  if (!simLoad || !aiLoad) return;
  const simMod = (await simLoad()) as { sim?: SimApi };
  const sim = simMod.sim ?? (simMod as unknown as SimApi); // tolerate either export style
  const { createAi } = (await aiLoad()) as { createAi: CreateAi };
  const seed = Number(seedIn.value) | 0;
  const diffs = ($<HTMLSelectElement>('diffs').value.split(',') as Difficulty[]);
  const factions: FactionId[] = $<HTMLInputElement>('swap').checked ? ['ferrum', 'helion'] : ['helion', 'ferrum'];
  const players = Array.from({ length: currentInfo.maxPlayers }, (_, k) => ({
    name: `${FACTIONS[factions[k % 2]].name} ${diffs[k % diffs.length]}`,
    faction: factions[k % 2],
    color: PLAYER_COLORS[k % 4],
    team: k,
    controller: 'ai' as const,
    difficulty: diffs[k % diffs.length],
    startIndex: k,
  }));
  const world = sim.createWorld({
    map: currentInfo.generate(seed),
    seed,
    players,
    startingCredits: 10000,
    options: { fog: true, shortGame: true, superweapons: true },
  });
  current = world.map;
  const ais = players.map((p, k) => createAi(k, p.difficulty, seed * 7919 + k, sim));
  const m = { world, sim, ais, timer: 0, thinkMs: 0, thinkN: 0 };
  match = m;
  const stepOnce = (): void => {
    const cmds: Command[] = [];
    for (const ai of ais) {
      const t0 = performance.now();
      const out = ai.think(world);
      m.thinkMs += performance.now() - t0;
      m.thinkN++;
      for (const c of out) cmds.push(c);
    }
    sim.step(world, cmds);
  };
  // Debug stepping: speed 0 starts paused; __aimaps.advanceTo(tick) then runs synchronously.
  advanceTo = (tick: number): void => {
    while (match === m && world.tick < tick && world.winnerTeam === null) stepOnce();
    drawMatch();
  };
  const frame = (): void => {
    if (match !== m) return;
    for (let s = 0; s < speed && world.winnerTeam === null; s++) stepOnce();
    drawMatch();
    if (world.winnerTeam === null && speed > 0) m.timer = requestAnimationFrame(frame);
  };
  m.timer = requestAnimationFrame(frame);
}

if (simMods['../sim/index.ts'] && aiMods['../ai/index.ts']) {
  simbar.innerHTML = `<label>難度 <select id="diffs">
      <option value="normal,easy">normal vs easy</option><option value="normal,normal">normal vs normal</option>
      <option value="hard,normal">hard vs normal</option><option value="hard,hard">hard vs hard</option><option value="easy,easy">easy vs easy</option>
    </select></label>
    <label><input id="swap" type="checkbox" /> 交換陣營</label>
    <button id="run8">AI 對戰 ×8</button> <button id="run40">×40</button> <button id="stop">停止</button>`;
  $('run8').onclick = () => void startMatch(8);
  $('run40').onclick = () => void startMatch(40);
  $('stop').onclick = () => {
    stopMatch();
    renderMap();
  };
} else {
  simbar.textContent = '(AI 對戰檢視:等待 src/sim 與 src/ai)';
}

// Debug handle for poking at things from the console.
(window as unknown as Record<string, unknown>).__aimaps = { MAPS, get map() { return current; }, get match() { return match; }, Terrain, startMatch, advanceTo: (t: number) => advanceTo(t) };

regenerate();
buildGallery();
