// Movement: goals, path following with hull turning, separation, crushing, group formations.
import type { World } from '../core/types';
import { UNITS } from '../data';
import { destroyEntity } from './entities';
import { ensureRegions, nearestTile, requestPath } from './path';
import {
  CELL,
  DT,
  MV_FOOT,
  TERRAIN_SPEED,
  angleDiff,
  blockedAt,
  isEnemyP,
  turnToward,
  type SimEntity,
  type SimState,
} from './state';

export function setMoveGoal(S: SimState, e: SimEntity, x: number, y: number): void {
  if (x < 0.05) x = 0.05;
  else if (x > S.w - 0.05) x = S.w - 0.05;
  if (y < 0.05) y = 0.05;
  else if (y > S.h - 0.05) y = S.h - 0.05;
  e.mv = true;
  e.rx = x;
  e.ry = y;
  e.gx = x;
  e.gy = y;
  e.path = null;
  e.pi = 0;
  e.stuck = 0;
  e.repaths = 0;
  e.sx = e.x;
  e.sy = e.y;
  if (!e.air) requestPath(S, e);
}

export function stopMove(e: SimEntity): void {
  e.mv = false;
  e.path = null;
  e.pi = 0;
  e.stuck = 0;
}

function tryMove(S: SimState, e: SimEntity, nx: number, ny: number): boolean {
  if (!blockedAt(S, nx, ny) || blockedAt(S, e.x, e.y)) {
    if (nx < 0 || ny < 0 || nx >= S.w || ny >= S.h) return false;
    e.x = nx;
    e.y = ny;
    return true;
  }
  if (!blockedAt(S, nx, e.y)) {
    e.x = nx;
    return true;
  }
  if (!blockedAt(S, e.x, ny)) {
    e.y = ny;
    return true;
  }
  return false;
}

function stepGround(world: World, S: SimState, e: SimEntity): void {
  const path = e.path;
  if (path === null) {
    if (!e.pathPending) requestPath(S, e);
    return;
  }
  const def = UNITS[e.defId];
  const w = S.w;
  let last = e.pi >= path.length - 1;
  let wx: number;
  let wy: number;
  if (last) {
    wx = e.gx;
    wy = e.gy;
  } else {
    const t = path[e.pi];
    wx = (t % w) + 0.5;
    wy = ((t / w) | 0) + 0.5;
  }
  let dx = wx - e.x;
  let dy = wy - e.y;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (!last && d < 0.3) {
    e.pi++;
    last = e.pi >= path.length - 1;
    if (last) {
      wx = e.gx;
      wy = e.gy;
    } else {
      const t = path[e.pi];
      wx = (t % w) + 0.5;
      wy = ((t / w) | 0) + 0.5;
    }
    dx = wx - e.x;
    dy = wy - e.y;
    d = Math.sqrt(dx * dx + dy * dy);
  }
  if (last && d < 0.04) {
    stopMove(e);
    return;
  }
  const desired = Math.atan2(dy, dx);
  const ad = Math.abs(angleDiff(desired, e.facing));
  e.facing = turnToward(e.facing, desired, def.turnRate * DT);
  const terr = world.map.terrain[(e.y | 0) * w + (e.x | 0)];
  let sp = def.speed * (TERRAIN_SPEED[e.mvType][terr] || 1);
  let pivoting = false;
  if (e.mvType !== MV_FOOT) {
    if (ad > 0.9) {
      sp = 0;
      pivoting = true;
    } else if (ad > 0.2) sp *= Math.cos(ad);
  }
  let step = sp * DT;
  if (step > d) step = d;
  if (step > 0 && d > 1e-9) {
    const ox = e.x;
    const oy = e.y;
    if (tryMove(S, e, e.x + (dx / d) * step, e.y + (dy / d) * step)) {
      e.moved = e.x !== ox || e.y !== oy;
    }
  }
  if (last && step >= d - 1e-9 && e.moved) {
    stopMove(e);
    return;
  }
  // stuck detection
  const pdx = e.x - e.sx;
  const pdy = e.y - e.sy;
  if (pdx * pdx + pdy * pdy > 0.09) {
    e.sx = e.x;
    e.sy = e.y;
    e.stuck = 0;
  } else if (!pivoting && ++e.stuck > 30) {
    e.stuck = 0;
    const gdx = e.gx - e.x;
    const gdy = e.gy - e.y;
    if (gdx * gdx + gdy * gdy < 1.6 * 1.6 || e.repaths >= 3) {
      stopMove(e);
    } else {
      e.repaths++;
      e.path = null;
      requestPath(S, e);
    }
  }
}

function stepAir(S: SimState, e: SimEntity): void {
  const def = UNITS[e.defId];
  const dx = e.gx - e.x;
  const dy = e.gy - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.08) {
    stopMove(e);
    return;
  }
  const desired = Math.atan2(dy, dx);
  const ad = Math.abs(angleDiff(desired, e.facing));
  e.facing = turnToward(e.facing, desired, def.turnRate * DT);
  let nx: number;
  let ny: number;
  if (d < 1.5 || ad < 0.05) {
    const step = Math.min(def.speed * DT, d);
    nx = e.x + (dx / d) * step;
    ny = e.y + (dy / d) * step;
  } else {
    const step = def.speed * DT * Math.max(0.3, Math.cos(ad));
    nx = e.x + Math.cos(e.facing) * step;
    ny = e.y + Math.sin(e.facing) * step;
  }
  e.x = nx < 0.2 ? 0.2 : nx > S.w - 0.2 ? S.w - 0.2 : nx;
  e.y = ny < 0.2 ? 0.2 : ny > S.h - 0.2 ? S.h - 0.2 : ny;
  e.moved = true;
}

function nudge(S: SimState, e: SimEntity, dx: number, dy: number): void {
  if (e.air) {
    e.x += dx;
    e.y += dy;
    return;
  }
  const here = blockedAt(S, e.x, e.y);
  const nx = e.x + dx;
  if (here || !blockedAt(S, nx, e.y)) e.x = nx;
  const ny = e.y + dy;
  if (here || !blockedAt(S, e.x, ny)) e.y = ny;
}

/** Integrate all moving units, then resolve overlaps (and crushing). */
export function updateMovement(world: World, S: SimState): void {
  const list = S.list;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (e.dead || e.kind !== 'unit') continue;
    e.moved = false;
    if (!e.mv) continue;
    if (e.air) stepAir(S, e);
    else stepGround(world, S, e);
  }
  // separation
  const head = S.cellHead;
  const next = S.cellNext;
  const gw = S.gw;
  const gh = S.gh;
  for (let i = 0; i < n; i++) {
    const a = list[i];
    if (a.dead || a.kind !== 'unit') continue;
    let cx0 = ((a.x - 1.4) / CELL) | 0;
    let cy0 = ((a.y - 1.4) / CELL) | 0;
    let cx1 = ((a.x + 1.4) / CELL) | 0;
    let cy1 = ((a.y + 1.4) / CELL) | 0;
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 >= gw) cx1 = gw - 1;
    if (cy1 >= gh) cy1 = gh - 1;
    for (let cy = cy0; cy <= cy1 && !a.dead; cy++) {
      for (let cx = cx0; cx <= cx1 && !a.dead; cx++) {
        for (let j = head[cy * gw + cx]; j >= 0; j = next[j]) {
          if (j <= i) continue;
          const b = list[j];
          if (b.dead || b.kind !== 'unit' || b.air !== a.air) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const rr = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2);
          const aFoot = a.mvType === MV_FOOT;
          const bFoot = b.mvType === MV_FOOT;
          if (!a.air && aFoot !== bFoot && isEnemyP(world, a.owner, b.owner)) {
            // crusher vehicles run over enemy infantry
            const veh = aFoot ? b : a;
            const inf = aFoot ? a : b;
            if (veh.moved && d < veh.r + 0.05 && UNITS[veh.defId].crusher) {
              destroyEntity(world, S, inf, veh.owner, veh.id);
              if (a.dead) break;
              continue;
            }
          }
          let nx: number;
          let ny: number;
          if (d < 1e-6) {
            const ang = (a.id * 2.399963 + b.id) % 6.283185;
            nx = Math.cos(ang);
            ny = Math.sin(ang);
          } else {
            nx = dx / d;
            ny = dy / d;
          }
          const overlap = rr - d;
          const ma = (aFoot ? 1 : 4) * (a.mv ? 2 : 1);
          const mb = (bFoot ? 1 : 4) * (b.mv ? 2 : 1);
          const push = overlap * (a.air ? 0.25 : 0.5);
          const sa = (push * mb) / (ma + mb);
          const sb = (push * ma) / (ma + mb);
          let tx = 0;
          let ty = 0;
          if (a.mv && b.mv) {
            // both moving: slide past each other (keep right)
            tx = -ny * overlap * 0.25;
            ty = nx * overlap * 0.25;
          }
          nudge(S, a, -nx * sa + tx, -ny * sa + ty);
          nudge(S, b, nx * sb - tx, ny * sb - ty);
        }
      }
    }
  }
  const maxX = S.w - 0.05;
  const maxY = S.h - 0.05;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (e.dead || e.kind !== 'unit') continue;
    if (e.x < 0.05) e.x = 0.05;
    else if (e.x > maxX) e.x = maxX;
    if (e.y < 0.05) e.y = 0.05;
    else if (e.y > maxY) e.y = maxY;
    if (e.moved && (e.action === 'idle' || e.action === 'attack')) e.action = 'move';
  }
}

/**
 * Destination slots for a group order: a compact grid spiral around (x,y), ground slots restricted to
 * passable tiles of the destination's region. Returns [x0,y0,x1,y1,…] in `units` order.
 */
export function groupGoals(S: SimState, units: SimEntity[], x: number, y: number): number[] {
  const n = units.length;
  const out = new Array<number>(n * 2);
  x = Math.max(0.5, Math.min(S.w - 0.5, x));
  y = Math.max(0.5, Math.min(S.h - 0.5, y));
  if (n === 1) {
    out[0] = x;
    out[1] = y;
    return out;
  }
  for (let pass = 0; pass < 2; pass++) {
    const air = pass === 1;
    const idx: number[] = [];
    let maxR = 0;
    let cxs = 0;
    let cys = 0;
    for (let i = 0; i < n; i++) {
      if (units[i].air !== air) continue;
      idx.push(i);
      if (units[i].r > maxR) maxR = units[i].r;
      cxs += units[i].x;
      cys += units[i].y;
    }
    const m = idx.length;
    if (m === 0) continue;
    cxs /= m;
    cys /= m;
    let cx = x;
    let cy = y;
    let region = 0;
    if (!air) {
      ensureRegions(S);
      const first = units[idx[0]];
      const ureg = blockedAt(S, first.x, first.y) ? 0 : S.region[(first.y | 0) * S.w + (first.x | 0)];
      const t = nearestTile(S, x, y, ureg);
      if (t >= 0) {
        if (t !== (y | 0) * S.w + (x | 0)) {
          cx = (t % S.w) + 0.5;
          cy = ((t / S.w) | 0) + 0.5;
        }
        region = S.region[t];
      }
    }
    const s = air ? 1.1 : Math.max(0.5, 2 * maxR + 0.2);
    const slots: number[] = [];
    for (let k = 0; k <= 16 && slots.length < m * 2; k++) {
      for (let j = -k; j <= k; j++) {
        for (let i = -k; i <= k; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== k) continue;
          const px = cx + i * s;
          const py = cy + j * s;
          if (px < 0.3 || py < 0.3 || px > S.w - 0.3 || py > S.h - 0.3) continue;
          if (!air) {
            const ti = (py | 0) * S.w + (px | 0);
            if (S.blocked[ti] || (region > 0 && S.region[ti] !== region)) continue;
          }
          slots.push(px, py);
        }
      }
    }
    const ns = slots.length / 2;
    const used = new Uint8Array(ns);
    // keep the group's rough shape: each unit wants the slot matching its offset from the centroid
    let ext = 0;
    for (const i of idx) ext = Math.max(ext, Math.abs(units[i].x - cxs), Math.abs(units[i].y - cys));
    const half = (Math.ceil(Math.sqrt(m)) * s) / 2;
    const scale = ext > half ? half / ext : 1;
    for (const i of idx) {
      const u = units[i];
      const wxp = cx + (u.x - cxs) * scale;
      const wyp = cy + (u.y - cys) * scale;
      let best = -1;
      let bestD = Infinity;
      for (let k = 0; k < ns; k++) {
        if (used[k]) continue;
        const ddx = slots[k * 2] - wxp;
        const ddy = slots[k * 2 + 1] - wyp;
        const dd = ddx * ddx + ddy * ddy;
        if (dd < bestD) {
          bestD = dd;
          best = k;
        }
      }
      if (best >= 0) {
        used[best] = 1;
        out[i * 2] = slots[best * 2];
        out[i * 2 + 1] = slots[best * 2 + 1];
      } else {
        out[i * 2] = cx;
        out[i * 2 + 1] = cy;
      }
    }
  }
  return out;
}
