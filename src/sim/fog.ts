// Fog of war: per-team visible/explored grids, recomputed on a stagger.
import type { World } from '../core/types';
import { BUILDINGS, UNITS } from '../data';
import { TUNE, type SimState } from './state';

/** Half-width of each row of a filled circle, keyed by radius*2. Pure cache. */
const spanCache = new Map<number, Int16Array>();
function spans(r: number): Int16Array {
  const key = Math.round(r * 2);
  let s = spanCache.get(key);
  if (!s) {
    const ri = Math.floor(r);
    s = new Int16Array(ri * 2 + 1);
    const rr = (r + 0.5) * (r + 0.5);
    for (let dy = -ri; dy <= ri; dy++) s[dy + ri] = Math.floor(Math.sqrt(Math.max(0, rr - dy * dy)));
    spanCache.set(key, s);
  }
  return s;
}

function stamp(vis: Uint8Array, w: number, h: number, x: number, y: number, r: number): void {
  const s = spans(r);
  const ri = (s.length - 1) >> 1;
  const tx = x | 0;
  const ty = y | 0;
  for (let dy = -ri; dy <= ri; dy++) {
    const yy = ty + dy;
    if (yy < 0 || yy >= h) continue;
    const hw = s[dy + ri];
    let x0 = tx - hw;
    let x1 = tx + hw;
    if (x0 < 0) x0 = 0;
    if (x1 >= w) x1 = w - 1;
    if (x0 <= x1) vis.fill(1, yy * w + x0, yy * w + x1 + 1);
  }
}

function recomputeTeam(world: World, S: SimState, ti: number): void {
  const team = S.teams[ti];
  const vis = S.teamVis[ti];
  const exp = S.teamExp[ti];
  const { w, h } = S;
  vis.fill(0);
  const players = world.players;
  for (const e of world.entities.values()) {
    if (players[e.owner].team !== team) continue;
    const sight = e.kind === 'unit' ? UNITS[e.defId].sight : BUILDINGS[e.defId].sight;
    stamp(vis, w, h, e.x, e.y, sight);
  }
  for (const rv of S.reveals) if (rv.team === team) stamp(vis, w, h, rv.x, rv.y, rv.r);
  const n = w * h;
  for (let i = 0; i < n; i++) if (vis[i]) exp[i] = 1;
  // players that don't share the team arrays (hand-made worlds) get a copy
  for (const p of players) {
    if (p.team !== team) continue;
    if (p.visible !== vis) p.visible.set(vis);
    if (p.explored !== exp) p.explored.set(exp);
  }
}

export function updateFog(world: World, S: SimState, force: boolean): void {
  if (S.reveals.length > 0) {
    let out = 0;
    for (const rv of S.reveals) if (world.tick < rv.until) S.reveals[out++] = rv;
    S.reveals.length = out;
  }
  if (!world.setup.options.fog) {
    if (force) {
      for (let ti = 0; ti < S.teams.length; ti++) {
        S.teamVis[ti].fill(1);
        S.teamExp[ti].fill(1);
      }
      for (const p of world.players) {
        p.visible.fill(1);
        p.explored.fill(1);
      }
    }
    return;
  }
  for (let ti = 0; ti < S.teams.length; ti++) {
    if (force || world.tick % TUNE.fogPeriod === ti % TUNE.fogPeriod) recomputeTeam(world, S, ti);
  }
}

/** Reveal immediately (support power) without waiting for the next staggered recompute. */
export function revealNow(world: World, S: SimState, team: number, x: number, y: number, r: number): void {
  if (!world.setup.options.fog) return;
  const ti = S.teams.indexOf(team);
  if (ti < 0) return;
  stamp(S.teamVis[ti], S.w, S.h, x, y, r);
  stamp(S.teamExp[ti], S.w, S.h, x, y, r);
  for (const p of world.players) {
    if (p.team !== team) continue;
    if (p.visible !== S.teamVis[ti]) p.visible.set(S.teamVis[ti]);
    if (p.explored !== S.teamExp[ti]) p.explored.set(S.teamExp[ti]);
  }
}
