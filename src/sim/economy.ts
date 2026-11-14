// Harvester loop and ore regrowth.
import { ORE_TILE_MAX, ORE_UNIT_VALUE } from '../core/constants';
import { Terrain } from '../core/types';
import type { UnitDef, World } from '../core/types';
import { BUILDINGS } from '../data';
import { rngNext } from '../core/rng';
import { distTo } from './combat';
import { setMoveGoal, stopMove } from './move';
import { ensureRegions } from './path';
import { TUNE, type SimEntity, type SimState } from './state';

// harvester states
const H_SEEK = 0;
const H_TO_ORE = 1;
const H_GATHER = 2;
const H_PICK_REF = 3;
const H_TO_REF = 4;
const H_UNLOAD = 5;

/** Nearest ore tile to (rx,ry) in the harvester's region, avoiding tiles other harvesters are working. */
function findOre(world: World, S: SimState, e: SimEntity, rx: number, ry: number): number {
  ensureRegions(S);
  const { w, h } = S;
  const ore = world.map.ore;
  const hx = Math.max(0, Math.min(w - 1, e.x | 0));
  const hy = Math.max(0, Math.min(h - 1, e.y | 0));
  const reg = S.blocked[hy * w + hx] ? 0 : S.region[hy * w + hx];
  const claimed: number[] = [];
  for (const o of S.list) {
    if (o === e || o.dead || o.kind !== 'unit' || o.htx < 0) continue;
    if (o.order && o.order.type === 'harvest' && (o.hs === H_TO_ORE || o.hs === H_GATHER)) claimed.push(o.hty * w + o.htx);
  }
  const tx = Math.max(0, Math.min(w - 1, rx | 0));
  const ty = Math.max(0, Math.min(h - 1, ry | 0));
  let best = -1;
  let bestD = Infinity;
  let fallback = -1;
  let fallbackD = Infinity;
  const maxR = Math.max(w, h);
  for (let r = 0; r <= maxR; r++) {
    if (best >= 0 && r - 1 > bestD) break;
    if (best < 0 && fallback >= 0 && r - 3 > fallbackD) break;
    for (let yy = ty - r; yy <= ty + r; yy++) {
      if (yy < 0 || yy >= h) continue;
      const edgeRow = yy === ty - r || yy === ty + r;
      const stepX = edgeRow || r === 0 ? 1 : 2 * r;
      for (let xx = tx - r; xx <= tx + r; xx += stepX) {
        if (xx < 0 || xx >= w) continue;
        const i = yy * w + xx;
        if (ore[i] === 0 || S.blocked[i] || (reg > 0 && S.region[i] !== reg)) continue;
        const dx = xx - tx;
        const dy = yy - ty;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (claimed.includes(i)) {
          if (d < fallbackD) {
            fallbackD = d;
            fallback = i;
          }
        } else if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best >= 0 ? best : fallback;
}

function findRefinery(world: World, S: SimState, e: SimEntity): SimEntity | null {
  let best: SimEntity | null = null;
  let bestD = Infinity;
  for (const b of S.list) {
    if (b.dead || b.kind !== 'building' || b.owner !== e.owner || b.buildProgress < 1) continue;
    if (!BUILDINGS[b.defId].refinery) continue;
    const d = distTo(e.x, e.y, b);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function validRefinery(world: World, e: SimEntity, id: number): SimEntity | null {
  const b = world.entities.get(id) as SimEntity | undefined;
  if (!b || b.dead || b.kind !== 'building' || b.owner !== e.owner || b.buildProgress < 1) return null;
  return BUILDINGS[b.defId].refinery ? b : null;
}

/** Runs while the unit's order is `harvest` or `dock`. */
export function updateHarvester(world: World, S: SimState, e: SimEntity, def: UnitDef): void {
  const cap = def.harvester!.capacity;
  const o = e.order!;
  const w = S.w;
  if (e.os === 0) {
    e.os = 1;
    e.ht = 0;
    if (o.type === 'dock') {
      e.href = o.targetId;
      e.hs = H_PICK_REF;
    } else if (o.type === 'harvest') {
      e.hs = H_SEEK;
      if (o.tx !== null && o.ty !== null) {
        e.htx = o.tx;
        e.hty = o.ty;
      } else {
        e.htx = -1;
        e.hty = -1;
      }
    }
  }
  const ore = world.map.ore;
  switch (e.hs) {
    case H_SEEK: {
      if (e.cargo >= cap) {
        e.hs = H_PICK_REF;
        break;
      }
      if (world.tick < e.ht) break;
      const t = e.htx >= 0 ? findOre(world, S, e, e.htx + 0.5, e.hty + 0.5) : findOre(world, S, e, e.x, e.y);
      if (t < 0) {
        if (e.cargo > 0) e.hs = H_PICK_REF;
        else e.ht = world.tick + 40;
        break;
      }
      e.htx = t % w;
      e.hty = (t / w) | 0;
      setMoveGoal(S, e, e.htx + 0.5, e.hty + 0.5);
      e.hs = H_TO_ORE;
      break;
    }
    case H_TO_ORE: {
      if (ore[e.hty * w + e.htx] === 0) {
        e.hs = H_SEEK;
        e.ht = 0;
        break;
      }
      const dx = e.htx + 0.5 - e.x;
      const dy = e.hty + 0.5 - e.y;
      const d2 = dx * dx + dy * dy;
      if (!e.mv) {
        if (d2 < 0.8 * 0.8) {
          e.hs = H_GATHER;
          e.ht = TUNE.harvestTicks;
        } else {
          e.hs = H_SEEK;
          e.ht = world.tick + 20;
        }
      } else if (d2 < 0.45 * 0.45 && e.stuck > 6) {
        stopMove(e);
        e.hs = H_GATHER;
        e.ht = TUNE.harvestTicks;
      }
      break;
    }
    case H_GATHER: {
      const i = e.hty * w + e.htx;
      const dx = e.htx + 0.5 - e.x;
      const dy = e.hty + 0.5 - e.y;
      if (dx * dx + dy * dy > 1.1 * 1.1) {
        setMoveGoal(S, e, e.htx + 0.5, e.hty + 0.5);
        e.hs = H_TO_ORE;
        break;
      }
      if (ore[i] === 0) {
        e.hs = H_SEEK;
        e.ht = 0;
        break;
      }
      e.action = 'harvest';
      if (--e.ht <= 0) {
        ore[i]--;
        e.cargo++;
        e.ht = TUNE.harvestTicks;
        if (e.cargo >= cap) e.hs = H_PICK_REF;
      }
      break;
    }
    case H_PICK_REF: {
      if (world.tick < e.ht) break;
      let ref = e.href ? validRefinery(world, e, e.href) : null;
      if (!ref) ref = findRefinery(world, S, e);
      if (!ref) {
        e.href = 0;
        e.ht = world.tick + 40;
        break;
      }
      e.href = ref.id;
      setMoveGoal(S, e, ref.fx + ref.fw / 2, ref.fy + ref.fh + 0.5);
      e.hs = H_TO_REF;
      break;
    }
    case H_TO_REF: {
      const ref = validRefinery(world, e, e.href);
      if (!ref) {
        e.href = 0;
        e.hs = H_PICK_REF;
        e.ht = 0;
        break;
      }
      const d = distTo(e.x, e.y, ref);
      if (d < 0.9 || (!e.mv && d < 1.8)) {
        stopMove(e);
        e.hs = H_UNLOAD;
        e.ht = TUNE.unloadTicks;
        e.hsum = 0;
      } else if (!e.mv) {
        e.hs = H_PICK_REF;
        e.ht = world.tick + 20;
      }
      break;
    }
    case H_UNLOAD: {
      const ref = validRefinery(world, e, e.href);
      if (!ref) {
        e.href = 0;
        e.hs = H_PICK_REF;
        e.ht = 0;
        break;
      }
      e.action = 'unload';
      if (e.cargo > 0 && --e.ht <= 0) {
        e.cargo--;
        e.ht = TUNE.unloadTicks;
        const p = world.players[e.owner];
        p.credits += ORE_UNIT_VALUE;
        p.stats.oreHarvested += ORE_UNIT_VALUE;
        e.hsum += ORE_UNIT_VALUE;
      }
      if (e.cargo <= 0) {
        world.events.push({ type: 'harvesterUnloaded', id: e.id, owner: e.owner, credits: e.hsum });
        e.hsum = 0;
        e.hs = H_SEEK;
        e.ht = 0;
        e.href = 0;
        // resume the harvest cycle near the last field
        e.order = { type: 'harvest', tx: e.htx >= 0 ? e.htx : null, ty: e.htx >= 0 ? e.hty : null };
      }
      break;
    }
    default:
      e.hs = H_SEEK;
  }
}

/** Slow ore regrowth: existing ore thickens and creeps onto neighbouring open ground. */
export function regrowOre(world: World, S: SimState): void {
  if (world.tick % TUNE.oreGrowPeriod !== 0) return;
  const { w, h } = S;
  const map = world.map;
  const ore = map.ore;
  const tries = Math.max(1, (w * h) >> 8);
  let st = world.rngState;
  for (let k = 0; k < tries; k++) {
    let r = rngNext(st);
    st = r.state;
    const i = Math.floor(r.value * w * h);
    r = rngNext(st);
    st = r.state;
    const roll = r.value;
    if (ore[i] > 0) {
      if (ore[i] < ORE_TILE_MAX && roll < 0.5) ore[i]++;
      continue;
    }
    const t = map.terrain[i];
    if ((t !== Terrain.Ground && t !== Terrain.Rough) || S.bld[i] !== 0 || roll >= 0.25) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const rich =
      (x > 0 && ore[i - 1] >= 6) || (x < w - 1 && ore[i + 1] >= 6) || (y > 0 && ore[i - w] >= 6) || (y < h - 1 && ore[i + w] >= 6);
    if (rich) ore[i] = 1;
  }
  world.rngState = st;
}
