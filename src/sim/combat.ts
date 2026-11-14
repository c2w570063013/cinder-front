// Combat: target acquisition, aiming, firing, projectiles, damage.
import type { PlayerId, WeaponDef, World } from '../core/types';
import { BUILDINGS, UNITS, WARHEADS, WEAPONS } from '../data';
import { destroyEntity } from './entities';
import {
  DT,
  TUNE,
  angleDiff,
  isEnemyP,
  queryNear,
  turnToward,
  type SimEntity,
  type SimProjectile,
  type SimState,
} from './state';

const scanBuf: SimEntity[] = [];
const splashBuf: SimEntity[] = [];

/** Distance from a point to the target's edge (footprint rect for buildings, circle for units). */
export function distTo(x: number, y: number, t: SimEntity): number {
  if (t.kind === 'building') {
    const dx = x < t.fx ? t.fx - x : x > t.fx + t.fw ? x - (t.fx + t.fw) : 0;
    const dy = y < t.fy ? t.fy - y : y > t.fy + t.fh ? y - (t.fy + t.fh) : 0;
    return Math.sqrt(dx * dx + dy * dy);
  }
  const dx = t.x - x;
  const dy = t.y - y;
  const d = Math.sqrt(dx * dx + dy * dy) - t.r;
  return d > 0 ? d : 0;
}

export function canHit(wd: WeaponDef, t: SimEntity): boolean {
  if (t.air ? !wd.targetsAir : !wd.targetsGround) return false;
  return WARHEADS[wd.warhead][t.armor] > 0;
}

export function canSee(world: World, S: SimState, player: PlayerId, t: SimEntity): boolean {
  const vis = world.players[player].visible;
  const w = S.w;
  if (t.kind === 'unit') return vis[(t.y | 0) * w + (t.x | 0)] > 0;
  if (vis[(t.y | 0) * w + (t.x | 0)] > 0) return true;
  const x1 = t.fx + t.fw - 1;
  const y1 = t.fy + t.fh - 1;
  return vis[t.fy * w + t.fx] > 0 || vis[t.fy * w + x1] > 0 || vis[y1 * w + t.fx] > 0 || vis[y1 * w + x1] > 0;
}

/**
 * 0 = no weapon can hit the target, 1 = out of range, 2 = in range, 3 = inside minimum range.
 */
export function rangeState(e: SimEntity, w0: WeaponDef | undefined, w1: WeaponDef | undefined, t: SimEntity): number {
  let res = 0;
  const d = distTo(e.x, e.y, t);
  for (let s = 0; s < 2; s++) {
    const wd = s === 0 ? w0 : w1;
    if (!wd || !canHit(wd, t)) continue;
    if (d > wd.range) {
      if (res === 0) res = 1;
    } else if (wd.minRange && Math.hypot(t.x - e.x, t.y - e.y) < wd.minRange) {
      if (res === 0 || res === 1) res = 3;
    } else return 2;
  }
  return res;
}

export function applyDamage(world: World, S: SimState, t: SimEntity, amount: number, attacker: PlayerId | null, attackerId: number): void {
  if (t.dead || amount <= 0) return;
  t.hp -= amount;
  t.lastHitTick = world.tick;
  world.events.push({ type: 'entityDamaged', id: t.id, owner: t.owner, amount, x: t.x, y: t.y });
  if (attacker !== null && isEnemyP(world, attacker, t.owner)) {
    t.aggro = attackerId;
    const ps = S.pl[t.owner];
    if (ps) {
      const ac = TUNE.alertCell;
      const cell = ((t.y / ac) | 0) * Math.ceil(S.w / ac) + ((t.x / ac) | 0);
      if (world.tick - ps.alertAt[cell] >= TUNE.alertCooldown) {
        ps.alertAt[cell] = world.tick;
        world.events.push({ type: 'underAttack', player: t.owner, x: t.x, y: t.y, base: t.kind === 'building' });
      }
    }
  }
  if (t.hp <= 0) destroyEntity(world, S, t, attacker, attackerId);
}

/** Apply a weapon hit at (x,y,z): full damage to `direct`, splash with linear falloff to 25% at the edge. */
export function detonate(
  world: World,
  S: SimState,
  wd: WeaponDef,
  x: number,
  y: number,
  z: number,
  direct: SimEntity | null,
  owner: PlayerId,
  srcId: number,
  mul: number,
): void {
  const splash = wd.splash ?? 0;
  world.events.push({ type: 'impact', weaponId: wd.id, kind: wd.projectile, x, y, z, splash });
  const base = wd.damage * mul;
  const mult = WARHEADS[wd.warhead];
  const airLayer = direct ? direct.air : wd.targetsAir && (!wd.targetsGround || z > 1);
  if (direct && !direct.dead) applyDamage(world, S, direct, base * mult[direct.armor], owner, srcId);
  if (splash > 0) {
    const n = queryNear(S, x, y, splash + 2.3, splashBuf);
    for (let i = 0; i < n; i++) {
      const t = splashBuf[i];
      if (t === direct || t.dead || t.air !== airLayer) continue;
      if (!isEnemyP(world, owner, t.owner)) continue;
      const d = distTo(x, y, t);
      if (d >= splash) continue;
      applyDamage(world, S, t, base * mult[t.armor] * (1 - (0.75 * d) / splash), owner, srcId);
    }
  }
}

function fire(world: World, S: SimState, e: SimEntity, wd: WeaponDef, t: SimEntity): void {
  const mul = TUNE.rankDamage[e.rank];
  const sx = e.x;
  const sy = e.y;
  const sz = e.altitude + (e.kind === 'building' ? 0.8 : 0.35);
  const tx = t.x;
  const ty = t.y;
  const tz = t.altitude + (t.kind === 'building' ? 0.4 : 0.2);
  e.lastFireTick = world.tick;
  world.events.push({ type: 'weaponFired', sourceId: e.id, weaponId: wd.id, kind: wd.projectile, x: sx, y: sy, z: sz, tx, ty, tz });
  const k = wd.projectile;
  if (k === 'tracer' || k === 'beam' || k === 'flame' || k === 'flakburst') {
    detonate(world, S, wd, tx, ty, tz, t, e.owner, e.id, mul);
    return;
  }
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const p: SimProjectile = {
    id: S.nextProjId++,
    weaponId: wd.id,
    kind: k,
    owner: e.owner,
    sourceId: e.id,
    x: sx,
    y: sy,
    z: sz,
    px: sx,
    py: sy,
    pz: sz,
    tx,
    ty,
    targetId: t.id,
    sx,
    sy,
    sz,
    tz,
    t: 0,
    dist0: Math.max(0.05, Math.sqrt(dx * dx + dy * dy + dz * dz)),
    speed: wd.projectileSpeed ?? 10,
    mul,
    homing: k === 'missile' || k === 'shell',
  };
  world.projectiles.push(p);
}

export function updateProjectiles(world: World, S: SimState): void {
  const ps = world.projectiles as SimProjectile[];
  let out = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    let t: SimEntity | undefined;
    if (p.targetId !== null) {
      t = world.entities.get(p.targetId) as SimEntity | undefined;
      if (!t || t.dead) {
        t = undefined;
        p.targetId = null;
      }
    }
    const wd: WeaponDef | undefined = WEAPONS[p.weaponId];
    let hit = false;
    if (p.homing) {
      if (t) {
        p.tx = t.x;
        p.ty = t.y;
        p.tz = t.altitude + (t.kind === 'building' ? 0.4 : 0.2);
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dz = p.tz - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const step = p.speed * DT;
      p.t += step;
      if (d <= step || p.t > p.dist0 * 3 + 20) {
        p.x = p.tx;
        p.y = p.ty;
        p.z = p.tz;
        hit = true;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        p.z += (dz / d) * step;
      }
    } else {
      p.t += (p.speed * DT) / p.dist0;
      const u = p.t >= 1 ? 1 : p.t;
      p.x = p.sx + (p.tx - p.sx) * u;
      p.y = p.sy + (p.ty - p.sy) * u;
      p.z = p.sz + (p.tz - p.sz) * u;
      if (p.kind === 'arc') p.z += Math.min(3.5, p.dist0 * 0.3) * 4 * u * (1 - u);
      if (u >= 1) hit = true;
    }
    if (hit) {
      let direct: SimEntity | null = null;
      if (t && wd) {
        // ballistic shots only score a direct hit if the target is still under the impact point
        if (p.homing || distTo(p.x, p.y, t) < 0.35) direct = t;
      }
      if (wd) detonate(world, S, wd, p.x, p.y, p.z, direct, p.owner, p.sourceId, p.mul);
    } else {
      ps[out++] = p;
    }
  }
  ps.length = out;
}

function validAuto(world: World, S: SimState, e: SimEntity, t: SimEntity | undefined, wd: WeaponDef | undefined, extra: number): boolean {
  if (!t || t.dead || !wd) return false;
  if (!isEnemyP(world, e.owner, t.owner) || !canHit(wd, t)) return false;
  if (!canSee(world, S, e.owner, t)) return false;
  if (wd.minRange && Math.hypot(t.x - e.x, t.y - e.y) < wd.minRange) return false;
  return distTo(e.x, e.y, t) <= wd.range + extra + 2;
}

/**
 * Keep auto-acquired targets valid and look for new ones (staggered scan through the spatial hash).
 * `extra` = how far beyond weapon range the entity is willing to notice enemies.
 * Explicit targets (`e.auto === false`) are left alone; the secondary weapon still picks its own.
 */
export function acquire(world: World, S: SimState, e: SimEntity, w0: WeaponDef | undefined, w1: WeaponDef | undefined, extra: number): void {
  const ents = world.entities;
  if (e.targetId !== null && e.auto) {
    const t = ents.get(e.targetId) as SimEntity | undefined;
    const ok = validAuto(world, S, e, t, w0, extra) || (!w0 && validAuto(world, S, e, t, w1, extra));
    if (!ok) e.targetId = null;
  }
  if (e.tgt1 !== null) {
    if (!validAuto(world, S, e, ents.get(e.tgt1) as SimEntity | undefined, w1, 0)) e.tgt1 = null;
  }
  const hadAggro = e.aggro !== 0;
  if (world.tick < e.scanAt && !hadAggro) return;
  let need0 = e.targetId === null && (!!w0 || !!w1);
  let need1 = false;
  if (w1 && w0 && e.tgt1 === null) {
    const t = e.targetId !== null ? (ents.get(e.targetId) as SimEntity | undefined) : undefined;
    need1 = !t || !canHit(w1, t);
  }
  if (hadAggro) {
    // retaliate against whoever hit us if nothing better is going on
    const a = ents.get(e.aggro) as SimEntity | undefined;
    e.aggro = 0;
    if (need0 && a && !a.dead && isEnemyP(world, e.owner, a.owner) && canSee(world, S, e.owner, a)) {
      const wd = w0 && canHit(w0, a) ? w0 : w1 && canHit(w1, a) ? w1 : undefined;
      if (wd && distTo(e.x, e.y, a) <= wd.range + extra + 3 && !(wd.minRange && Math.hypot(a.x - e.x, a.y - e.y) < wd.minRange)) {
        e.targetId = a.id;
        e.auto = true;
        need0 = false;
      }
    }
  }
  if (!need0 && !need1) return;
  e.scanAt = world.tick + 7 + (e.id & 3);
  const pw = w0 ?? w1!;
  const r0 = pw.range + extra;
  const r1 = w1 ? w1.range : 0;
  const n = queryNear(S, e.x, e.y, Math.max(r0, r1) + 2.3, scanBuf);
  let best0: SimEntity | null = null;
  let bestS0 = Infinity;
  let best1: SimEntity | null = null;
  let bestS1 = Infinity;
  const myTeam = world.players[e.owner].team;
  const players = world.players;
  const vis = players[e.owner].visible;
  const W = S.w;
  for (let i = 0; i < n; i++) {
    const t = scanBuf[i];
    if (players[t.owner].team === myTeam) continue;
    const d = distTo(e.x, e.y, t);
    let c0 = need0 && d <= r0 && canHit(pw, t);
    const c1 = need1 && d <= r1 && canHit(w1!, t);
    if (c0 && pw.minRange && Math.hypot(t.x - e.x, t.y - e.y) < pw.minRange) c0 = false;
    if (!c0 && !c1) continue;
    let score = d;
    if (t.kind === 'building') {
      const bd = BUILDINGS[t.defId];
      if (bd.wall) continue;
      if (!bd.weapon) score += 2.5;
      if (!canSee(world, S, e.owner, t)) continue;
    } else if (!vis[(t.y | 0) * W + (t.x | 0)]) continue;
    if (c0 && score < bestS0) {
      bestS0 = score;
      best0 = t;
    }
    if (c1 && score < bestS1) {
      bestS1 = score;
      best1 = t;
    }
  }
  if (need0 && best0) {
    e.targetId = best0.id;
    e.auto = true;
  }
  if (need1 && best1) e.tgt1 = best1.id;
}

function fireSlot(world: World, S: SimState, e: SimEntity, slot: number, wd: WeaponDef, t: SimEntity): void {
  fire(world, S, e, wd, t);
  const burst = wd.burst ?? 1;
  let left = slot === 0 ? e.b0 : e.b1;
  if (left <= 0) left = burst;
  left--;
  const cd = left > 0 ? TUNE.burstGapTicks : Math.max(1, Math.round(wd.cooldown / DT));
  if (slot === 0) {
    e.b0 = left;
    e.cd0 = cd;
  } else {
    e.b1 = left;
    e.cd1 = cd;
  }
}

/**
 * Aim and fire at the current targets. Returns true while the primary target is in range
 * (callers use that to hold position).
 */
export function shoot(world: World, S: SimState, e: SimEntity, w0: WeaponDef | undefined, w1: WeaponDef | undefined): boolean {
  if (e.cd0 > 0) e.cd0--;
  if (e.cd1 > 0) e.cd1--;
  const ents = world.entities;
  let t0: SimEntity | undefined;
  if (e.targetId !== null) {
    t0 = ents.get(e.targetId) as SimEntity | undefined;
    if (!t0 || t0.dead) {
      t0 = undefined;
      e.targetId = null;
    }
  }
  let engaged = false;
  const isUnit = e.kind === 'unit';
  const hasTurret = isUnit ? UNITS[e.defId].turret : !!BUILDINGS[e.defId].turret;
  // primary weapon (or a lone secondary) needs to be aimed
  const aimW = w0 ?? w1;
  let aimed = false;
  let aimTarget: SimEntity | undefined;
  if (aimW && t0 && canHit(aimW, t0)) aimTarget = t0;
  if (aimTarget) {
    const desired = Math.atan2(aimTarget.y - e.y, aimTarget.x - e.x);
    if (hasTurret) {
      e.turretFacing = turnToward(e.turretFacing, desired, TUNE.turretRate * DT);
      aimed = Math.abs(angleDiff(desired, e.turretFacing)) < 0.15;
    } else if (!isUnit) {
      e.turretFacing = desired;
      aimed = true;
    } else {
      if (!e.mv) e.facing = turnToward(e.facing, desired, UNITS[e.defId].turnRate * DT);
      e.turretFacing = e.facing;
      aimed = Math.abs(angleDiff(desired, e.facing)) < 0.3;
    }
    const d = distTo(e.x, e.y, aimTarget);
    if (d <= aimW!.range && !(aimW!.minRange && Math.hypot(aimTarget.x - e.x, aimTarget.y - e.y) < aimW!.minRange)) {
      engaged = true;
      if (aimed && (w0 ? e.cd0 : e.cd1) <= 0) fireSlot(world, S, e, w0 ? 0 : 1, aimW!, aimTarget);
    }
  } else if (isUnit) {
    if (hasTurret) e.turretFacing = turnToward(e.turretFacing, e.facing, TUNE.turretRate * DT);
    else e.turretFacing = e.facing;
  }
  // secondary weapon fires independently, no aiming needed
  if (w0 && w1) {
    let t1: SimEntity | undefined;
    if (t0 && !t0.dead && canHit(w1, t0)) t1 = t0;
    else if (e.tgt1 !== null) {
      t1 = ents.get(e.tgt1) as SimEntity | undefined;
      if (!t1 || t1.dead) {
        t1 = undefined;
        e.tgt1 = null;
      }
    }
    if (t1 && distTo(e.x, e.y, t1) <= w1.range) {
      if (t1 === t0) engaged = true;
      if (e.cd1 <= 0) fireSlot(world, S, e, 1, w1, t1);
    }
  }
  return engaged;
}
