// Entity lifecycle: spawn, remove, destroy, placement checks.
import type { PlacementCheck } from '../core/api';
import { BUILD_ADJACENCY } from '../core/constants';
import type { EntityId, PlayerId, World } from '../core/types';
import { BUILDINGS, UNITS } from '../data';
import { TUNE, initSimFields, queryNear, stampBuilding, terrainBlocks, type SimEntity, type SimState } from './state';

const scratch: SimEntity[] = [];

function baseEntity(world: World, defId: string, kind: 'unit' | 'building', owner: PlayerId, x: number, y: number, hp: number, facing: number) {
  return {
    id: world.nextEntityId++,
    defId,
    kind,
    owner,
    x,
    y,
    px: x,
    py: y,
    facing,
    turretFacing: facing,
    altitude: 0,
    hp,
    maxHp: hp,
    rank: 0 as const,
    kills: 0,
    action: 'idle' as const,
    order: null,
    queue: [],
    targetId: null,
    lastFireTick: -1,
    lastHitTick: -1,
    cargo: 0,
    buildProgress: 1,
    rally: null,
    primary: false,
    repairing: false,
    powered: true,
  };
}

export function spawnUnit(world: World, S: SimState, defId: string, owner: PlayerId, x: number, y: number, facing = 0): SimEntity {
  const def = UNITS[defId];
  const e = initSimFields(baseEntity(world, defId, 'unit', owner, x, y, def.hp, facing));
  e.altitude = def.movement === 'air' ? (def.altitude ?? 2) : 0;
  e.scanAt = world.tick + (e.id % 8);
  world.entities.set(e.id, e);
  world.events.push({ type: 'entityCreated', id: e.id, defId, owner, x, y });
  return e;
}

/** (tx,ty) = top-left footprint tile. */
export function spawnBuilding(world: World, S: SimState, defId: string, owner: PlayerId, tx: number, ty: number, progress: number): SimEntity {
  const def = BUILDINGS[defId];
  const x = tx + def.footprint.w / 2;
  const y = ty + def.footprint.h / 2;
  const e = initSimFields(baseEntity(world, defId, 'building', owner, x, y, def.hp, Math.PI / 2));
  e.buildProgress = progress;
  e.action = progress < 1 ? 'construct' : 'idle';
  e.scanAt = world.tick + (e.id % 8);
  world.entities.set(e.id, e);
  stampBuilding(S, e, e.id);
  world.events.push({ type: 'entityCreated', id: e.id, defId, owner, x, y });
  return e;
}

/** Remove without a destroy event (deploy, sell, engineer consumed). */
export function removeEntity(world: World, S: SimState, e: SimEntity): void {
  if (e.dead) return;
  e.dead = true;
  world.entities.delete(e.id);
  if (e.kind === 'building') stampBuilding(S, e, 0);
  S.deaths++;
}

export function destroyEntity(world: World, S: SimState, e: SimEntity, killer: PlayerId | null, killerId: EntityId): void {
  if (e.dead) return;
  e.hp = 0;
  const owner = world.players[e.owner];
  const def = UNITS[e.defId] ?? BUILDINGS[e.defId];
  if (owner) {
    if (e.kind === 'unit') owner.stats.unitsLost++;
    else owner.stats.buildingsLost++;
  }
  if (killer !== null && killer !== e.owner && world.players[killer]) {
    world.players[killer].stats.kills++;
    const k = world.entities.get(killerId) as SimEntity | undefined;
    if (k && !k.dead && k.owner === killer) {
      k.kills++;
      k.xp += def ? def.cost : 0;
      if (k.kind === 'unit' && k.rank < 2) {
        const own = Math.max(100, UNITS[k.defId]?.cost ?? 100);
        const want = k.xp >= own * TUNE.rankXp[1] ? 2 : k.xp >= own * TUNE.rankXp[0] ? 1 : 0;
        if (want > k.rank) {
          k.rank = want as 1 | 2;
          world.events.push({ type: 'unitPromoted', id: k.id, owner: k.owner, rank: want as 1 | 2 });
        }
      }
    }
  }
  world.events.push({ type: 'entityDestroyed', id: e.id, defId: e.defId, kind: e.kind, owner: e.owner, killer, x: e.x, y: e.y });
  removeEntity(world, S, e);
}

/** True if a live ground unit overlaps the tile (uses this tick's spatial hash). */
export function tileHasUnit(S: SimState, tx: number, ty: number, ignoreId = 0): boolean {
  const n = queryNear(S, tx + 0.5, ty + 0.5, 1.2, scratch);
  for (let i = 0; i < n; i++) {
    const u = scratch[i];
    if (u.kind !== 'unit' || u.air || u.id === ignoreId) continue;
    const cx = u.x < tx ? tx : u.x > tx + 1 ? tx + 1 : u.x;
    const cy = u.y < ty ? ty : u.y > ty + 1 ? ty + 1 : u.y;
    const dx = u.x - cx;
    const dy = u.y - cy;
    const rr = u.r * 0.7;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

/**
 * Nearest passable tile to (x,y) with no ground unit on it and not in `taken`.
 * Returns the tile index, or -1.
 */
export function findFreeTile(S: SimState, x: number, y: number, maxR: number, taken?: Set<number>): number {
  const w = S.w;
  const h = S.h;
  const tx = Math.max(0, Math.min(w - 1, x | 0));
  const ty = Math.max(0, Math.min(h - 1, y | 0));
  let best = -1;
  let bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    if (best >= 0 && r - 1 > bestD) break;
    for (let yy = ty - r; yy <= ty + r; yy++) {
      if (yy < 0 || yy >= h) continue;
      const edgeRow = yy === ty - r || yy === ty + r;
      const stepX = edgeRow || r === 0 ? 1 : 2 * r;
      for (let xx = tx - r; xx <= tx + r; xx += stepX) {
        if (xx < 0 || xx >= w) continue;
        const i = yy * w + xx;
        if (S.blocked[i]) continue;
        if (taken && taken.has(i)) continue;
        if (tileHasUnit(S, xx, yy)) continue;
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best;
}

/**
 * Placement rules: footprint inside the map on buildable terrain, no ore, no building, no ground unit,
 * and (unless `free`) within BUILD_ADJACENCY tiles edge-to-edge of an own operational non-wall building.
 */
export function checkPlacement(
  world: World,
  S: SimState,
  player: PlayerId,
  defId: string,
  tx: number,
  ty: number,
  free = false,
  ignoreId: EntityId = 0,
): PlacementCheck {
  const def = BUILDINGS[defId];
  const cells: PlacementCheck['cells'] = [];
  if (!def || !Number.isFinite(tx) || !Number.isFinite(ty)) return { ok: false, cells };
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  const fw = def.footprint.w;
  const fh = def.footprint.h;
  const w = S.w;
  const h = S.h;
  const map = world.map;
  // Ground units near the footprint (scan entities directly so the answer is right between ticks too).
  const units: SimEntity[] = [];
  for (const ent of world.entities.values()) {
    const u = ent as SimEntity;
    if (u.kind !== 'unit' || u.id === ignoreId || u.altitude > 0) continue;
    if (u.x < tx - 1 || u.x > tx + fw + 1 || u.y < ty - 1 || u.y > ty + fh + 1) continue;
    units.push(u);
  }
  let ok = true;
  for (let yy = ty; yy < ty + fh; yy++) {
    for (let xx = tx; xx < tx + fw; xx++) {
      let c = true;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) c = false;
      else {
        const i = yy * w + xx;
        if (terrainBlocks(map.terrain[i]) || map.ore[i] > 0 || S.bld[i] !== 0) c = false;
        else {
          for (const u of units) {
            const r = (UNITS[u.defId]?.radius ?? 0.3) * 0.7;
            const cx = u.x < xx ? xx : u.x > xx + 1 ? xx + 1 : u.x;
            const cy = u.y < yy ? yy : u.y > yy + 1 ? yy + 1 : u.y;
            if ((u.x - cx) * (u.x - cx) + (u.y - cy) * (u.y - cy) < r * r) {
              c = false;
              break;
            }
          }
        }
      }
      if (!c) ok = false;
      cells.push({ tx: xx, ty: yy, ok: c });
    }
  }
  if (ok && !free) {
    let near = false;
    for (const ent of world.entities.values()) {
      const b = ent as SimEntity;
      if (b.kind !== 'building' || b.owner !== player || b.buildProgress < 1) continue;
      const bd = BUILDINGS[b.defId];
      if (!bd || bd.wall) continue;
      const bx = Math.round(b.x - bd.footprint.w / 2);
      const by = Math.round(b.y - bd.footprint.h / 2);
      const gapX = Math.max(0, bx - (tx + fw), tx - (bx + bd.footprint.w));
      const gapY = Math.max(0, by - (ty + fh), ty - (by + bd.footprint.h));
      if (Math.max(gapX, gapY) <= BUILD_ADJACENCY) {
        near = true;
        break;
      }
    }
    if (!near) {
      ok = false;
      for (const c of cells) c.ok = false;
    }
  }
  return { ok, cells };
}
