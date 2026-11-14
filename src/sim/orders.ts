// Command validation → orders, and the per-unit order state machine.
import type { Command, Order, UnitDef, World } from '../core/types';
import { BUILDINGS, UNITS, WEAPONS } from '../data';
import { acquire, distTo, rangeState, shoot } from './combat';
import { updateHarvester } from './economy';
import { checkPlacement, removeEntity, spawnBuilding } from './entities';
import { groupGoals, setMoveGoal, stopMove } from './move';
import { cmdCancel, cmdPlace, cmdProduce, cmdResume, cmdSell, cmdSetPrimary, cmdUsePower } from './production';
import { DT, TUNE, isEnemyP, type SimEntity, type SimState } from './state';
import { defeatPlayer } from './victory';

const fin = Number.isFinite;

function giveOrder(e: SimEntity, order: Order, queue: boolean | undefined): void {
  if (queue && e.order !== null) {
    if (e.queue.length < TUNE.maxOrderQueue) e.queue.push(order);
    return;
  }
  e.queue.length = 0;
  e.order = order;
  e.os = 0;
  e.targetId = null;
  e.auto = true;
  e.leash = false;
}

function finishOrder(e: SimEntity): void {
  e.order = null;
  e.os = 0;
  e.ax = e.x;
  e.ay = e.y;
  e.leash = false;
}

function ownUnits(world: World, player: number, ids: unknown): SimEntity[] {
  const out: SimEntity[] = [];
  if (!Array.isArray(ids)) return out;
  let last = -1;
  const sorted = ids.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  for (const id of sorted) {
    if (id === last) continue;
    last = id;
    const e = world.entities.get(id) as SimEntity | undefined;
    if (e && !e.dead && e.kind === 'unit' && e.owner === player) out.push(e);
  }
  return out;
}

export function applyCommands(world: World, S: SimState, commands: Command[]): void {
  if (!Array.isArray(commands)) return;
  for (const c of commands) {
    if (!c || typeof c !== 'object') continue;
    const p = world.players[c.player];
    if (!p || p.defeated || !Number.isInteger(c.player)) continue;
    switch (c.type) {
      case 'move':
      case 'attackMove': {
        if (!fin(c.x) || !fin(c.y)) break;
        const units = ownUnits(world, c.player, c.ids);
        if (units.length === 0) break;
        const goals = groupGoals(S, units, c.x, c.y);
        for (let i = 0; i < units.length; i++) {
          giveOrder(units[i], { type: c.type, x: goals[i * 2], y: goals[i * 2 + 1] }, c.queue);
        }
        break;
      }
      case 'attack': {
        const t = world.entities.get(c.targetId) as SimEntity | undefined;
        if (!t || t.dead || !isEnemyP(world, c.player, t.owner)) break;
        for (const e of ownUnits(world, c.player, c.ids)) {
          const d = UNITS[e.defId];
          const w0 = d.weapon ? WEAPONS[d.weapon] : undefined;
          const w1 = d.secondary ? WEAPONS[d.secondary] : undefined;
          if (rangeState(e, w0, w1, t) === 0) continue;
          giveOrder(e, { type: 'attack', targetId: t.id }, c.queue);
        }
        break;
      }
      case 'stop':
        for (const e of ownUnits(world, c.player, c.ids)) {
          e.queue.length = 0;
          e.targetId = null;
          e.tgt1 = null;
          stopMove(e);
          finishOrder(e);
        }
        break;
      case 'guard':
        for (const e of ownUnits(world, c.player, c.ids)) {
          stopMove(e);
          giveOrder(e, { type: 'guard' }, false);
        }
        break;
      case 'harvest': {
        if (!fin(c.tx) || !fin(c.ty)) break;
        const tx = Math.max(0, Math.min(S.w - 1, Math.floor(c.tx)));
        const ty = Math.max(0, Math.min(S.h - 1, Math.floor(c.ty)));
        for (const e of ownUnits(world, c.player, c.ids)) {
          if (!UNITS[e.defId].harvester) continue;
          giveOrder(e, { type: 'harvest', tx, ty }, false);
        }
        break;
      }
      case 'dock': {
        const t = world.entities.get(c.targetId) as SimEntity | undefined;
        if (!t || t.dead || t.kind !== 'building' || t.owner !== c.player || !BUILDINGS[t.defId].refinery) break;
        for (const e of ownUnits(world, c.player, c.ids)) {
          if (!UNITS[e.defId].harvester) continue;
          giveOrder(e, { type: 'dock', targetId: t.id }, false);
        }
        break;
      }
      case 'capture': {
        const t = world.entities.get(c.targetId) as SimEntity | undefined;
        if (!t || t.dead || t.kind !== 'building') break;
        for (const e of ownUnits(world, c.player, c.ids)) {
          if (!UNITS[e.defId].engineer) continue;
          giveOrder(e, { type: 'capture', targetId: t.id }, false);
        }
        break;
      }
      case 'deploy':
        for (const e of ownUnits(world, c.player, c.ids)) {
          if (!UNITS[e.defId].deploysTo) continue;
          stopMove(e);
          giveOrder(e, { type: 'deploy' }, false);
        }
        break;
      case 'produce':
        if (typeof c.defId === 'string') cmdProduce(world, S, c.player, c.defId);
        break;
      case 'cancelProduction':
        if (typeof c.defId === 'string') cmdCancel(world, S, c.player, c.defId);
        break;
      case 'resumeProduction':
        if (typeof c.category === 'string' && p.queues[c.category]) cmdResume(world, c.player, c.category);
        break;
      case 'placeBuilding':
        if (typeof c.defId === 'string' && fin(c.tx) && fin(c.ty)) cmdPlace(world, S, c.player, c.defId, c.tx, c.ty);
        break;
      case 'sell':
        cmdSell(world, S, c.player, c.buildingId);
        break;
      case 'toggleRepair': {
        const b = world.entities.get(c.buildingId) as SimEntity | undefined;
        if (!b || b.dead || b.kind !== 'building' || b.owner !== c.player || b.buildProgress < 1) break;
        b.repairing = !b.repairing && b.hp < b.maxHp;
        break;
      }
      case 'setRally': {
        const b = world.entities.get(c.buildingId) as SimEntity | undefined;
        if (!b || b.dead || b.kind !== 'building' || b.owner !== c.player || !fin(c.x) || !fin(c.y)) break;
        const bd = BUILDINGS[b.defId];
        if (!bd.produces || bd.conyard) break;
        b.rally = { x: Math.max(0.5, Math.min(S.w - 0.5, c.x)), y: Math.max(0.5, Math.min(S.h - 0.5, c.y)) };
        break;
      }
      case 'setPrimary':
        cmdSetPrimary(world, S, c.player, c.buildingId);
        break;
      case 'usePower':
        cmdUsePower(world, S, c.player, c.power, c.x, c.y);
        break;
      case 'surrender':
        defeatPlayer(world, S, c.player);
        break;
      default:
        break;
    }
  }
}

/** Move toward a (possibly moving) target, re-pathing at most every half second. */
function chase(world: World, S: SimState, e: SimEntity, t: SimEntity): void {
  if (world.tick < e.chaseAt) return;
  const dx = e.rx - t.x;
  const dy = e.ry - t.y;
  const far = dx * dx + dy * dy > 1.5 * 1.5;
  if (e.mv && !far) return;
  // not moving although the request still points at the target → we are as close as we can get; retry slowly
  e.chaseAt = world.tick + (!e.mv && !far ? 40 : 10);
  setMoveGoal(S, e, t.x, t.y);
}

function tryDeploy(world: World, S: SimState, e: SimEntity, def: UnitDef): void {
  const bd = BUILDINGS[def.deploysTo!];
  if (!bd) return;
  const tx = Math.floor(e.x) - Math.floor(bd.footprint.w / 2);
  const ty = Math.floor(e.y) - Math.floor(bd.footprint.h / 2);
  const check = checkPlacement(world, S, e.owner, bd.id, tx, ty, true, e.id);
  if (!check.ok) {
    world.events.push({ type: 'cannotPlace', player: e.owner });
    return;
  }
  const unitId = e.id;
  const owner = e.owner;
  const hpRatio = e.hp / e.maxHp;
  removeEntity(world, S, e);
  const b = spawnBuilding(world, S, bd.id, owner, tx, ty, 0);
  b.hp = Math.max(1, b.maxHp * hpRatio);
  world.events.push({ type: 'unitDeployed', unitId, buildingId: b.id, owner });
  world.events.push({ type: 'buildingPlaced', id: b.id, defId: bd.id, owner, x: b.x, y: b.y });
}

function capture(world: World, S: SimState, e: SimEntity, t: SimEntity): void {
  if (isEnemyP(world, e.owner, t.owner)) {
    const from = t.owner;
    t.owner = e.owner;
    t.rally = null;
    t.primary = false;
    t.repairing = false;
    t.targetId = null;
    t.tgt1 = null;
    world.events.push({ type: 'buildingCaptured', id: t.id, defId: t.defId, from, to: e.owner });
  } else {
    t.hp = t.maxHp;
  }
  removeEntity(world, S, e);
}

export function updateUnit(world: World, S: SimState, e: SimEntity): void {
  const def = UNITS[e.defId];
  const w0 = def.weapon ? WEAPONS[def.weapon] : undefined;
  const w1 = def.secondary ? WEAPONS[def.secondary] : undefined;
  const armed = !!(w0 || w1);
  if (e.order === null && e.queue.length > 0) {
    e.order = e.queue.shift()!;
    e.os = 0;
    e.targetId = null;
    e.auto = true;
  }
  e.action = 'idle';
  const o = e.order;
  if (o === null) {
    if (armed) {
      acquire(world, S, e, w0, w1, TUNE.idleAcquireExtra);
      const t = e.targetId !== null ? (world.entities.get(e.targetId) as SimEntity | undefined) : undefined;
      if (t && !t.dead) {
        const rs = rangeState(e, w0, w1, t);
        if (rs === 2 || rs === 3) {
          if (e.mv) stopMove(e);
        } else if (rs === 1) {
          const dx = t.x - e.ax;
          const dy = t.y - e.ay;
          const reach = TUNE.leash + (w0 ?? w1!).range;
          if (dx * dx + dy * dy <= reach * reach) {
            chase(world, S, e, t);
            e.leash = true;
          } else {
            e.targetId = null;
          }
        } else e.targetId = null;
      } else if (e.leash) {
        // chase over: walk back to where we were standing
        e.leash = false;
        const dx = e.ax - e.x;
        const dy = e.ay - e.y;
        if (dx * dx + dy * dy > 1) setMoveGoal(S, e, e.ax, e.ay);
        else if (e.mv) stopMove(e);
      }
      shoot(world, S, e, w0, w1);
    } else if (!def.turret) e.turretFacing = e.facing;
  } else {
    switch (o.type) {
      case 'move': {
        if (e.os === 0) {
          setMoveGoal(S, e, o.x, o.y);
          e.os = 1;
        } else if (!e.mv) finishOrder(e);
        if (armed) {
          acquire(world, S, e, w0, w1, 0);
          shoot(world, S, e, w0, w1);
        }
        break;
      }
      case 'attackMove': {
        if (e.os === 0) {
          setMoveGoal(S, e, o.x, o.y);
          e.os = 1;
        }
        if (armed) acquire(world, S, e, w0, w1, TUNE.attackMoveAcquireExtra);
        const t = e.targetId !== null ? (world.entities.get(e.targetId) as SimEntity | undefined) : undefined;
        if (t && !t.dead) {
          const rs = rangeState(e, w0, w1, t);
          if (rs === 2 || rs === 3) {
            if (e.mv) stopMove(e);
            e.os = 2;
          } else if (rs === 1) {
            chase(world, S, e, t);
            e.os = 2;
          } else e.targetId = null;
        } else if (e.os === 2) {
          setMoveGoal(S, e, o.x, o.y);
          e.os = 1;
        } else if (!e.mv) finishOrder(e);
        if (armed) shoot(world, S, e, w0, w1);
        break;
      }
      case 'attack': {
        const t = world.entities.get(o.targetId) as SimEntity | undefined;
        const rs = t && !t.dead && isEnemyP(world, e.owner, t.owner) ? rangeState(e, w0, w1, t) : 0;
        if (!t || rs === 0) {
          e.targetId = null;
          if (e.mv) stopMove(e);
          finishOrder(e);
          break;
        }
        e.targetId = t.id;
        e.auto = false;
        e.os = 1;
        if (rs === 2) {
          if (e.mv) stopMove(e);
        } else if (rs === 1) chase(world, S, e, t);
        else if (e.mv) stopMove(e);
        acquire(world, S, e, w0, w1, 0);
        shoot(world, S, e, w0, w1);
        break;
      }
      case 'guard': {
        if (e.mv) stopMove(e);
        if (armed) {
          acquire(world, S, e, w0, w1, 0);
          shoot(world, S, e, w0, w1);
        }
        break;
      }
      case 'harvest':
      case 'dock': {
        if (!def.harvester) finishOrder(e);
        else updateHarvester(world, S, e, def);
        break;
      }
      case 'capture': {
        const t = world.entities.get(o.targetId) as SimEntity | undefined;
        if (!t || t.dead || t.kind !== 'building' || !def.engineer) {
          if (e.mv) stopMove(e);
          finishOrder(e);
          break;
        }
        if (!isEnemyP(world, e.owner, t.owner) && t.hp >= t.maxHp) {
          if (e.mv) stopMove(e);
          finishOrder(e);
          break;
        }
        if (distTo(e.x, e.y, t) <= 0.8) {
          capture(world, S, e, t);
          return;
        }
        e.os = 1;
        chase(world, S, e, t);
        break;
      }
      case 'deploy': {
        if (def.deploysTo) {
          tryDeploy(world, S, e, def);
          if (e.dead) return;
        }
        finishOrder(e);
        break;
      }
    }
  }
  if (e.rank === 2 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * TUNE.eliteRegenPerSec * DT);
  if (e.action === 'idle' && e.lastFireTick >= 0 && world.tick - e.lastFireTick < 10) e.action = 'attack';
}
