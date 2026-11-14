// Crude top-down debug view of the simulation (dev/sim.html, launch config `dev-sim`).
import { Terrain } from '../core/types';
import type { Command, World } from '../core/types';
import { makeRng } from '../core/rng';
import { BUILDINGS, UNITS } from '../data';
import { spawnUnit } from './entities';
import { sim } from './index';
import { getSim, type SimEntity } from './state';
import { botCommands, type BotPlan } from './testbot';
import { fillRect, makeMap, makeSetup, oreRect } from './testmap';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const info = document.getElementById('info')!;
const scnSel = document.getElementById('scn') as HTMLSelectElement;
const speedSel = document.getElementById('speed') as HTMLSelectElement;
const fogSel = document.getElementById('fog') as HTMLSelectElement;

const COLORS = ['#3fa7ff', '#ff8a2a'];
const TERRAIN = ['#2b3328', '#3a3a2c', '#4a4a48', '#17324a', '#55524c', '#1d4424'];

let world: World;
let pending: Command[] = [];
let bots: BotPlan[] | null = null;
let stepMs = 0;
const counts: Record<string, number> = {};

const H = ['h_warden', 'h_warden', 'h_breacher', 'h_javelin', 'h_javelin', 'h_ranger', 'h_farstrike', 'h_skyveil', 'h_arbiter', 'h_kestrel'];
const F = ['f_militia', 'f_militia', 'f_grenadier', 'f_hammer', 'f_hammer', 'f_jackal', 'f_hailstorm', 'f_flakcrawler', 'f_salamander', 'f_vulture'];

function start(): void {
  pending = [];
  bots = null;
  for (const k of Object.keys(counts)) delete counts[k];
  const kind = scnSel.value;
  if (kind === 'match') {
    const map = makeMap(48, 48, [{ x: 7, y: 7 }, { x: 40, y: 40 }]);
    oreRect(map, 14, 4, 18, 8, 10);
    oreRect(map, 30, 40, 34, 44, 10);
    fillRect(map, 20, 22, 27, 25, Terrain.Rock);
    fillRect(map, 10, 30, 14, 31, Terrain.Water);
    fillRect(map, 30, 14, 31, 18, Terrain.Tree);
    world = sim.createWorld(makeSetup(map, ['helion', 'ferrum'], {}, 10000));
    bots = [
      { build: ['h_power', 'h_refinery', 'h_barracks', 'h_factory', 'h_power', 'h_radar', 'h_sentry'], units: { h_warden: 6, h_javelin: 6, h_ranger: 2 }, attackAt: 3200 },
      { build: ['f_power', 'f_refinery', 'f_barracks', 'f_factory', 'f_bunker', 'f_power'], units: { f_militia: 8, f_hammer: 4, f_grenadier: 3 }, attackAt: 4200 },
    ];
  } else if (kind === 'battle') {
    const map = makeMap(96, 96, [{ x: 4, y: 4 }, { x: 91, y: 91 }]);
    const rng = makeRng(7);
    for (let i = 0; i < 60; i++) {
      const x = rng.int(12, 82);
      const y = rng.int(12, 82);
      fillRect(map, x, y, x + rng.int(0, 3), y + rng.int(0, 3), rng.chance(0.5) ? Terrain.Rock : Terrain.Tree);
    }
    fillRect(map, 30, 46, 64, 48, Terrain.Water);
    world = sim.createWorld(makeSetup(map, ['helion', 'ferrum'], { fog: true }));
    const S = getSim(world);
    const ids: number[][] = [[], []];
    for (let side = 0; side < 2; side++) {
      const defs = side === 0 ? H : F;
      let placed = 0;
      for (let k = 0; placed < 150 && k < 2000; k++) {
        const x = 36.5 + (k % 25);
        const y = side === 0 ? 12.5 + Math.floor(k / 25) : 83.5 - Math.floor(k / 25);
        if (S.blocked[(y | 0) * 96 + (x | 0)]) continue;
        ids[side].push(spawnUnit(world, S, defs[placed % defs.length], side, x, y).id);
        placed++;
      }
    }
    pending.push({ type: 'attackMove', player: 0, ids: ids[0], x: 48, y: 44 }, { type: 'attackMove', player: 1, ids: ids[1], x: 48, y: 51 });
  } else {
    const map = makeMap(64, 64, [{ x: 3, y: 3 }, { x: 60, y: 60 }]);
    fillRect(map, 8, 30, 50, 31, Terrain.Rock);
    fillRect(map, 20, 44, 63, 45, Terrain.Water);
    fillRect(map, 30, 10, 34, 20, Terrain.Tree);
    fillRect(map, 10, 36, 40, 38, Terrain.Rough);
    fillRect(map, 52, 20, 53, 44, Terrain.Road);
    world = sim.createWorld(makeSetup(map, ['helion', 'ferrum'], { fog: false }));
    const S = getSim(world);
    const ids: number[] = [];
    for (let i = 0; i < 80; i++) ids.push(spawnUnit(world, S, H[i % 9], 0, 12.5 + (i % 16), 8.5 + Math.floor(i / 16) * 1.2).id);
    pending.push({ type: 'move', player: 0, ids, x: 12, y: 56 });
  }
  (window as unknown as Record<string, unknown>).__sim = {
    world,
    sim,
    /** Step n ticks synchronously (set speed to 暫停 first) and redraw. */
    stepN(n: number) {
      for (let i = 0; i < n; i++) tick();
      draw();
      return world.tick;
    },
  };
}

function tick(): void {
  const cmds = pending;
  pending = [];
  if (bots) for (let p = 0; p < bots.length; p++) cmds.push(...botCommands(world, p, bots[p]));
  const t0 = performance.now();
  sim.step(world, cmds);
  stepMs = stepMs * 0.95 + (performance.now() - t0) * 0.05;
  for (const ev of world.events) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
}

function draw(): void {
  const map = world.map;
  const s = canvas.width / map.width;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      ctx.fillStyle = TERRAIN[map.terrain[i]];
      ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      if (map.ore[i] > 0) {
        ctx.fillStyle = `rgba(120,230,210,${0.25 + map.ore[i] / 20})`;
        ctx.fillRect(x * s + s * 0.2, y * s + s * 0.2, s * 0.6, s * 0.6);
      }
    }
  }
  for (const ent of world.entities.values()) {
    const e = ent as SimEntity;
    const col = COLORS[e.owner % COLORS.length];
    if (e.kind === 'building') {
      const d = BUILDINGS[e.defId];
      ctx.globalAlpha = 0.35 + 0.65 * e.buildProgress;
      ctx.fillStyle = col;
      ctx.fillRect(e.fx * s + 1, e.fy * s + 1, e.fw * s - 2, e.fh * s - 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000a';
      ctx.font = `${Math.max(8, s * 0.55)}px ui-monospace, monospace`;
      ctx.fillText(d.nameEn.slice(0, 3), e.fx * s + 2, e.fy * s + s * 0.7);
      if (!e.powered) {
        ctx.strokeStyle = '#ff0';
        ctx.strokeRect(e.fx * s + 1, e.fy * s + 1, e.fw * s - 2, e.fh * s - 2);
      }
      if (d.weapon) {
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(e.x * s, e.y * s);
        ctx.lineTo((e.x + Math.cos(e.turretFacing) * 0.6) * s, (e.y + Math.sin(e.turretFacing) * 0.6) * s);
        ctx.stroke();
      }
    } else {
      const d = UNITS[e.defId];
      const r = Math.max(1.5, d.radius * s);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(e.x * s, e.y * s, r, 0, 6.2832);
      ctx.fill();
      if (e.air) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(e.x * s, e.y * s);
      ctx.lineTo((e.x + Math.cos(e.facing) * d.radius) * s, (e.y + Math.sin(e.facing) * d.radius) * s);
      ctx.stroke();
      if (d.turret) {
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(e.x * s, e.y * s);
        ctx.lineTo((e.x + Math.cos(e.turretFacing) * d.radius * 1.3) * s, (e.y + Math.sin(e.turretFacing) * d.radius * 1.3) * s);
        ctx.stroke();
      }
      if (e.cargo > 0) {
        ctx.fillStyle = '#7fe';
        ctx.fillRect(e.x * s - 2, e.y * s - 2, 4, 4);
      }
      if (e.rank > 0) {
        ctx.fillStyle = e.rank === 2 ? '#ffd700' : '#ddd';
        ctx.fillRect(e.x * s - r, e.y * s + r, 3, 3);
      }
    }
    if (e.hp < e.maxHp) {
      const wbar = Math.max(6, (e.kind === 'building' ? e.fw : 0.8) * s);
      ctx.fillStyle = '#400';
      ctx.fillRect(e.x * s - wbar / 2, e.y * s - (e.kind === 'building' ? e.fh / 2 : 0.6) * s - 3, wbar, 2);
      ctx.fillStyle = '#4f4';
      ctx.fillRect(e.x * s - wbar / 2, e.y * s - (e.kind === 'building' ? e.fh / 2 : 0.6) * s - 3, (wbar * e.hp) / e.maxHp, 2);
    }
    if (e.lastFireTick === world.tick && e.targetId !== null) {
      const t = world.entities.get(e.targetId);
      if (t) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(e.x * s, e.y * s);
        ctx.lineTo(t.x * s, t.y * s);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.fillStyle = '#fff';
  for (const p of world.projectiles) ctx.fillRect(p.x * s - 1, (p.y - p.z * 0.3) * s - 1, 2.5, 2.5);
  const fp = Number(fogSel.value);
  if (fp >= 0 && world.players[fp]) {
    const pl = world.players[fp];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        if (pl.visible[i]) continue;
        ctx.fillStyle = pl.explored[i] ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.92)';
        ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      }
    }
  }
  const lines = [`tick ${world.tick}   step ≈ ${stepMs.toFixed(3)} ms   entities ${world.entities.size}   projectiles ${world.projectiles.length}`];
  if (world.winnerTeam !== null) lines.push(`GAME OVER — winner team ${world.winnerTeam}`);
  for (const p of world.players) {
    const n = [...world.entities.values()].filter((e) => e.owner === p.id);
    lines.push(
      `P${p.id} ${p.faction}${p.defeated ? ' (defeated)' : ''}: $${p.credits}  power ${p.powerProduced}/${p.powerConsumed}${p.lowPower ? ' LOW' : ''}  ` +
        `units ${n.filter((e) => e.kind === 'unit').length}  bld ${n.filter((e) => e.kind === 'building').length}  kills ${p.stats.kills}  ore ${p.stats.oreHarvested}`,
    );
    for (const [c, q] of Object.entries(p.queues)) {
      if (q.items.length) lines.push(`   ${c}: ${q.items[0].defId} ${(q.items[0].progress * 100).toFixed(0)}%${q.ready ? ' READY' : ''}${q.paused ? ' PAUSED' : ''} (+${q.items.length - 1})`);
    }
  }
  lines.push('', 'events: ' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
  info.textContent = lines.join('\n');
}

let acc = 0;
function frame(): void {
  const speed = Number(speedSel.value);
  acc += speed;
  let n = 0;
  while (acc >= 1 && n < 64) {
    tick();
    acc -= 1;
    n++;
  }
  draw();
  requestAnimationFrame(frame);
}

function order(ev: MouseEvent, player: number): void {
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * world.map.width;
  const y = ((ev.clientY - r.top) / r.height) * world.map.height;
  const ids = [...world.entities.values()].filter((e) => e.owner === player && e.kind === 'unit' && !UNITS[e.defId].harvester).map((e) => e.id);
  pending.push({ type: 'attackMove', player, ids, x, y });
}
canvas.addEventListener('click', (ev) => order(ev, 0));
canvas.addEventListener('contextmenu', (ev) => order(ev, 1));
document.getElementById('restart')!.addEventListener('click', start);
scnSel.addEventListener('change', start);

start();
requestAnimationFrame(frame);
