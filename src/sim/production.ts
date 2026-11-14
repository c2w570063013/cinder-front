// Player-level systems: power, tech availability, production queues, building upkeep, support powers.
import type { BuildOption } from '../core/api';
import { LOW_POWER_BUILD_FACTOR, MAX_QUEUE, SELL_REFUND, secToTicks } from '../core/constants';
import type { BuildingDef, EntityDef, PlayerId, QueueCategory, SupportPowerId, UnitDef, World } from '../core/types';
import { BUILDINGS, SUPPORT_POWERS, UNITS, factionDefs } from '../data';
import { applyDamage, distTo } from './combat';
import { checkPlacement, findFreeTile, removeEntity, spawnBuilding, spawnUnit } from './entities';
import { revealNow } from './fog';
import { CATS, TUNE, emptyInfo, queryNear, type PlayerInfo, type SimEntity, type SimState } from './state';

const buf: SimEntity[] = [];

function anyDef(id: string): EntityDef | undefined {
  return (UNITS[id] as EntityDef | undefined) ?? BUILDINGS[id];
}

/** Pure scan of the entity list → per-player derived info and raw power totals. */
function scanPlayers(world: World): { infos: PlayerInfo[]; produced: number[]; consumed: number[] } {
  const infos: PlayerInfo[] = world.players.map(() => emptyInfo());
  const produced = world.players.map(() => 0);
  const consumed = world.players.map(() => 0);
  for (const ent of world.entities.values()) {
    const e = ent as SimEntity;
    const info = infos[e.owner];
    if (!info) continue;
    if (e.kind === 'unit') {
      info.units++;
      if (UNITS[e.defId]?.deploysTo) info.deployables++;
      continue;
    }
    info.buildings++;
    if (e.buildProgress < 1) continue;
    const def = BUILDINGS[e.defId];
    if (!def) continue;
    info.have.set(e.defId, (info.have.get(e.defId) ?? 0) + 1);
    if (def.power > 0) produced[e.owner] += def.power * Math.max(0, Math.min(1, e.hp / e.maxHp));
    else consumed[e.owner] += -def.power;
    if (def.produces) {
      for (const c of def.produces) {
        info.producers[c]++;
        const cur = info.exitId[c];
        if (cur === 0) info.exitId[c] = e.id;
        else if (e.primary && !(world.entities.get(cur) as SimEntity).primary) info.exitId[c] = e.id;
      }
    }
    if (def.supportPower && !info.powerSrc.has(def.supportPower)) info.powerSrc.set(def.supportPower, e.id);
    if (def.radar) info.radar = true;
  }
  return { infos, produced, consumed };
}

/** Start-of-tick refresh of per-player derived state (operational buildings, producers, power, radar). */
export function refreshPlayers(world: World, S: SimState, emit: boolean): void {
  const { infos, produced, consumed } = scanPlayers(world);
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i];
    S.pl[i].info = infos[i];
    p.powerProduced = Math.round(produced[i]);
    p.powerConsumed = Math.round(consumed[i]);
    const low = p.powerConsumed > p.powerProduced;
    if (low !== p.lowPower) {
      p.lowPower = low;
      if (emit) world.events.push({ type: 'lowPower', player: i, low });
    }
    p.hasRadar = infos[i].radar && !low;
  }
}

function isSuperweapon(def: EntityDef): boolean {
  return def.kind === 'building' && !!def.supportPower && def.supportPower !== 'recon_sweep';
}

function availableWith(world: World, info: PlayerInfo, player: PlayerId, def: EntityDef): boolean {
  const p = world.players[player];
  if (def.faction !== p.faction) return false;
  if (def.kind === 'building' && !def.buildable) return false;
  if (isSuperweapon(def) && !world.setup.options.superweapons) return false;
  if (info.producers[def.category] <= 0) return false;
  for (const pr of def.prereqs) if (!info.have.has(pr)) return false;
  return true;
}

export function defAvailable(world: World, S: SimState, player: PlayerId, def: EntityDef): boolean {
  return availableWith(world, S.pl[player].info, player, def);
}

/** Read-only (safe to call between ticks from ui / ai): scans the current entity list. */
export function buildOptions(world: World, player: PlayerId): BuildOption[] {
  const p = world.players[player];
  if (!p) return [];
  const info = scanPlayers(world).infos[player];
  const out: BuildOption[] = [];
  for (const def of factionDefs(p.faction)) {
    if (def.kind === 'building' && !def.buildable) continue;
    out.push({ defId: def.id, category: def.category, available: !p.defeated && availableWith(world, info, player, def) });
  }
  return out;
}

// ───────────────────────────── production ─────────────────────────────

export function cmdProduce(world: World, S: SimState, player: PlayerId, defId: string): void {
  const def = anyDef(defId);
  if (!def || !defAvailable(world, S, player, def)) return;
  const q = world.players[player].queues[def.category];
  if (q.items.length >= MAX_QUEUE) return;
  q.items.push({ defId, progress: 0, paid: 0 });
}

export function cmdCancel(world: World, S: SimState, player: PlayerId, defId: string): void {
  const def = anyDef(defId);
  if (!def) return;
  const p = world.players[player];
  const q = p.queues[def.category];
  if (q.items.length === 0) return;
  if (q.items[0].defId === defId && !q.paused && !q.ready) {
    q.paused = true;
    return;
  }
  let idx = -1;
  for (let i = q.items.length - 1; i >= 0; i--) {
    if (q.items[i].defId === defId) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return;
  const item = q.items[idx];
  p.credits += item.paid;
  p.stats.creditsSpent -= item.paid;
  q.items.splice(idx, 1);
  if (idx === 0) {
    q.paused = false;
    q.ready = false;
    S.pl[player].stalled[def.category] = false;
  }
}

export function cmdResume(world: World, player: PlayerId, category: QueueCategory): void {
  const q = world.players[player].queues[category];
  if (q) q.paused = false;
}

/** Spawn a finished unit at its factory's exit and send it to the rally point. */
function rollOut(world: World, S: SimState, player: PlayerId, def: UnitDef, factory: SimEntity): SimEntity {
  let x: number;
  let y: number;
  const exitX = factory.fx + factory.fw / 2;
  const exitY = factory.fy + factory.fh + 0.5;
  if (def.movement === 'air') {
    x = factory.x;
    y = factory.y;
  } else {
    const t = findFreeTile(S, exitX, exitY, 8);
    if (t >= 0) {
      x = (t % S.w) + 0.5;
      y = ((t / S.w) | 0) + 0.5;
    } else {
      x = exitX;
      y = exitY;
    }
  }
  const u = spawnUnit(world, S, def.id, player, x, y, Math.PI / 2);
  if (def.harvester) {
    u.order = { type: 'harvest', tx: null, ty: null };
  } else {
    let rx = factory.rally ? factory.rally.x : exitX;
    let ry = factory.rally ? factory.rally.y : exitY + 2;
    if (def.movement !== 'air') {
      // gather on a free tile near the rally point so successive units don't queue up on one spot
      const rt = findFreeTile(S, rx, ry, 6);
      if (rt >= 0 && rt !== (ry | 0) * S.w + (rx | 0)) {
        rx = (rt % S.w) + 0.5;
        ry = ((rt / S.w) | 0) + 0.5;
      }
    }
    u.order = { type: 'move', x: rx, y: ry };
  }
  u.os = 0;
  return u;
}

export function updateProduction(world: World, S: SimState): void {
  for (let pi = 0; pi < world.players.length; pi++) {
    const p = world.players[pi];
    if (p.defeated) continue;
    const ps = S.pl[pi];
    const info = ps.info;
    for (const cat of CATS) {
      const q = p.queues[cat];
      if (q.items.length === 0) {
        ps.stalled[cat] = false;
        q.ready = false;
        continue;
      }
      if (q.ready || q.paused) continue;
      const nProd = info.producers[cat];
      if (nProd <= 0) continue;
      const item = q.items[0];
      const def = anyDef(item.defId);
      if (!def) {
        q.items.shift();
        continue;
      }
      let rate = (1 / secToTicks(def.buildTime)) * Math.min(TUNE.factoryBonusCap, 1 + TUNE.factoryBonus * (nProd - 1));
      if (p.lowPower) rate *= LOW_POWER_BUILD_FACTOR;
      let np = item.progress + rate;
      if (np > 1 - 1e-9) np = 1;
      let due = Math.round(def.cost * np) - item.paid;
      if (due < 0) due = 0;
      if (due > p.credits) {
        const pay = Math.max(0, Math.floor(p.credits));
        if (!ps.stalled[cat]) {
          ps.stalled[cat] = true;
          world.events.push({ type: 'insufficientFunds', player: pi });
        }
        if (pay <= 0) continue;
        due = pay;
        np = Math.min(np, (item.paid + pay) / def.cost);
      } else {
        ps.stalled[cat] = false;
      }
      p.credits -= due;
      item.paid += due;
      p.stats.creditsSpent += due;
      item.progress = np;
      if (np < 1) continue;
      if (def.kind === 'unit') {
        const factory = world.entities.get(info.exitId[cat]) as SimEntity | undefined;
        if (!factory) {
          item.progress = 1;
          continue;
        }
        q.items.shift();
        const u = rollOut(world, S, pi, def, factory);
        p.stats.unitsBuilt++;
        world.events.push({ type: 'unitReady', id: u.id, defId: def.id, owner: pi });
      } else {
        q.ready = true;
        world.events.push({ type: 'constructionReady', defId: def.id, owner: pi });
      }
    }
  }
}

export function cmdPlace(world: World, S: SimState, player: PlayerId, defId: string, tx: number, ty: number): void {
  const def = BUILDINGS[defId];
  if (!def) return;
  const p = world.players[player];
  const q = p.queues[def.category];
  if (!q.ready || q.items.length === 0 || q.items[0].defId !== defId) return;
  if (S.pl[player].info.producers[def.category] <= 0) return;
  const check = checkPlacement(world, S, player, defId, tx, ty);
  if (!check.ok) {
    world.events.push({ type: 'cannotPlace', player });
    return;
  }
  const b = spawnBuilding(world, S, defId, player, Math.floor(tx), Math.floor(ty), 0);
  q.items.shift();
  q.ready = false;
  world.events.push({ type: 'buildingPlaced', id: b.id, defId, owner: player, x: b.x, y: b.y });
}

export function cmdSell(world: World, S: SimState, player: PlayerId, id: number): void {
  const b = world.entities.get(id) as SimEntity | undefined;
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player) return;
  const def = BUILDINGS[b.defId];
  const p = world.players[player];
  p.credits += Math.round(def.cost * SELL_REFUND * Math.max(0, Math.min(1, b.hp / b.maxHp)) * Math.max(0.2, b.buildProgress));
  world.events.push({ type: 'buildingSold', id: b.id, defId: b.defId, owner: player, x: b.x, y: b.y });
  removeEntity(world, S, b);
}

export function cmdSetPrimary(world: World, S: SimState, player: PlayerId, id: number): void {
  const b = world.entities.get(id) as SimEntity | undefined;
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player) return;
  const def = BUILDINGS[b.defId];
  if (!def.produces || def.conyard) return;
  for (const ent of world.entities.values()) {
    const o = ent as SimEntity;
    if (o.kind !== 'building' || o.owner !== player || !o.primary) continue;
    const od = BUILDINGS[o.defId];
    if (od.produces && od.produces.some((c) => def.produces!.includes(c))) o.primary = false;
  }
  b.primary = true;
}

// ───────────────────────────── buildings ─────────────────────────────

function completeBuilding(world: World, S: SimState, b: SimEntity, def: BuildingDef): void {
  b.buildProgress = 1;
  const p = world.players[b.owner];
  p.stats.buildingsBuilt++;
  world.events.push({ type: 'buildingComplete', id: b.id, defId: b.defId, owner: b.owner });
  if (def.freeUnit && UNITS[def.freeUnit]) rollOut(world, S, b.owner, UNITS[def.freeUnit], b);
}

/** Per-tick building upkeep (construction rise, repair, powered flag). Weapons are handled by the caller. */
export function updateBuilding(world: World, S: SimState, b: SimEntity, def: BuildingDef): void {
  const p = world.players[b.owner];
  if (b.buildProgress < 1) {
    const sec = def.wall ? TUNE.wallRiseSec : def.conyard ? TUNE.deployRiseSec : TUNE.buildRiseSec;
    b.buildProgress += 1 / secToTicks(sec);
    b.action = 'construct';
    if (b.buildProgress >= 1 - 1e-9) completeBuilding(world, S, b, def);
    return;
  }
  b.powered = !(p.lowPower && (def.needsPower || def.radar || def.supportPower));
  if (b.repairing) {
    if (b.hp >= b.maxHp) {
      b.repairing = false;
      b.repairAcc = 0;
    } else {
      const ticks = TUNE.repairSec * 20;
      const heal = b.maxHp / ticks;
      b.repairAcc += (def.cost * TUNE.repairCostFactor) / ticks;
      const cost = Math.floor(b.repairAcc);
      if (cost <= p.credits) {
        p.credits -= cost;
        p.stats.creditsSpent += cost;
        b.repairAcc -= cost;
        b.hp = Math.min(b.maxHp, b.hp + heal);
        if (b.hp >= b.maxHp) {
          b.repairing = false;
          b.repairAcc = 0;
        }
      } else {
        b.repairAcc -= (def.cost * TUNE.repairCostFactor) / ticks;
      }
    }
  }
  b.action = b.lastFireTick >= 0 && world.tick - b.lastFireTick < 10 ? 'attack' : 'idle';
}

// ───────────────────────────── support powers ─────────────────────────────

export function updatePowers(world: World, S: SimState): void {
  for (let pi = 0; pi < world.players.length; pi++) {
    const p = world.players[pi];
    const src = S.pl[pi].info.powerSrc;
    // drop powers whose building is gone, re-point to a surviving provider
    for (let i = p.powers.length - 1; i >= 0; i--) {
      const st = p.powers[i];
      const s = src.get(st.id);
      if (s === undefined) p.powers.splice(i, 1);
      else st.sourceId = s;
    }
    for (const [id, s] of src) {
      let st = p.powers.find((x) => x.id === id);
      if (!st) {
        st = { id, sourceId: s, charge: 0, chargeMax: secToTicks(SUPPORT_POWERS[id].recharge), ready: false };
        p.powers.push(st);
      }
      if (!st.ready && !p.lowPower) {
        st.charge++;
        if (st.charge >= st.chargeMax) {
          st.charge = st.chargeMax;
          st.ready = true;
          world.events.push({ type: 'powerReady', player: pi, power: id });
        }
      }
    }
  }
  // delayed impacts
  if (S.pending.length > 0) {
    let out = 0;
    for (let i = 0; i < S.pending.length; i++) {
      const pd = S.pending[i];
      if (world.tick >= pd.at) powerImpact(world, S, pd.player, pd.power, pd.x, pd.y);
      else S.pending[out++] = pd;
    }
    S.pending.length = out;
  }
}

export function cmdUsePower(world: World, S: SimState, player: PlayerId, power: SupportPowerId, x: number, y: number): void {
  const def = SUPPORT_POWERS[power];
  if (!def || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const p = world.players[player];
  const st = p.powers.find((s) => s.id === power);
  if (!st || !st.ready || p.lowPower) return;
  x = Math.max(0, Math.min(S.w, x));
  y = Math.max(0, Math.min(S.h, y));
  st.ready = false;
  st.charge = 0;
  world.events.push({ type: 'powerUsed', player, power, x, y });
  if (def.delay <= 0) powerImpact(world, S, player, power, x, y);
  else S.pending.push({ player, power, x, y, at: world.tick + secToTicks(def.delay) });
}

function powerImpact(world: World, S: SimState, player: PlayerId, power: SupportPowerId, x: number, y: number): void {
  const def = SUPPORT_POWERS[power];
  world.events.push({ type: 'powerImpact', player, power, x, y, radius: def.radius });
  if (power === 'recon_sweep') {
    S.reveals.push({ team: world.players[player].team, x, y, r: def.radius, until: world.tick + secToTicks(def.duration) });
    revealNow(world, S, world.players[player].team, x, y, def.radius);
    return;
  }
  const n = queryNear(S, x, y, def.radius + 2.3, buf);
  const hits: SimEntity[] = buf.slice(0, n);
  for (const t of hits) {
    if (t.dead) continue;
    if (power === 'tremor') {
      // buildings and ground vehicles only
      if (t.air) continue;
      if (t.kind === 'unit' && UNITS[t.defId].category !== 'vehicle') continue;
    }
    const d = distTo(x, y, t);
    if (d >= def.radius) continue;
    applyDamage(world, S, t, def.damage * (1 - (0.75 * d) / def.radius), player, 0);
  }
}
