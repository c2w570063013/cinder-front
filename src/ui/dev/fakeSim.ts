// Dev-only stand-in simulation: enough behaviour to exercise every UI path (queues, placement, simple
// straight-line movement, support powers, sell/repair) when the real sim is unavailable. Not deterministic-grade.
import type { BuildOption, PlacementCheck, SimApi } from '../../core/api';
import { BUILD_ADJACENCY, ORE_UNIT_VALUE, SELL_REFUND, secToTicks, TICK_RATE } from '../../core/constants';
import { Terrain, type Command, type Entity, type GameSetup, type Order, type Player, type PlayerId, type QueueCategory, type World } from '../../core/types';
import { BUILDINGS, FACTIONS, SUPPORT_POWERS, UNITS, WEAPONS } from '../../data';
import { defOf } from '../dom';

const CATS: QueueCategory[] = ['structure', 'defense', 'infantry', 'vehicle', 'aircraft'];

function spawn(world: World, defId: string, owner: PlayerId, x: number, y: number, built = true): Entity {
  const u = UNITS[defId];
  const b = BUILDINGS[defId];
  const hp = (u ?? b).hp;
  const e: Entity = {
    id: world.nextEntityId++,
    defId,
    kind: u ? 'unit' : 'building',
    owner,
    x,
    y,
    px: x,
    py: y,
    facing: 0.6,
    turretFacing: 0.6,
    altitude: u?.altitude ?? 0,
    hp,
    maxHp: hp,
    rank: 0,
    kills: 0,
    action: 'idle',
    order: null,
    queue: [],
    targetId: null,
    lastFireTick: -1,
    lastHitTick: -1,
    cargo: 0,
    buildProgress: built ? 1 : 0,
    rally: null,
    primary: false,
    repairing: false,
    powered: true,
  };
  world.entities.set(e.id, e);
  world.events.push({ type: 'entityCreated', id: e.id, defId, owner, x, y });
  return e;
}

/** Exposed so the dev page can pre-build a base in the fake world. */
export const fakeSpawn = spawn;

function ownBuildings(world: World, player: PlayerId): Entity[] {
  const out: Entity[] = [];
  for (const e of world.entities.values()) if (e.owner === player && e.kind === 'building' && e.buildProgress >= 1) out.push(e);
  return out;
}

function occupied(world: World, tx: number, ty: number): boolean {
  for (const e of world.entities.values()) {
    if (e.kind !== 'building') continue;
    const fp = BUILDINGS[e.defId]?.footprint ?? { w: 1, h: 1 };
    const x0 = Math.round(e.x - fp.w / 2);
    const y0 = Math.round(e.y - fp.h / 2);
    if (tx >= x0 && tx < x0 + fp.w && ty >= y0 && ty < y0 + fp.h) return true;
  }
  return false;
}

function canPlaceBuilding(world: World, player: PlayerId, defId: string, tx: number, ty: number): PlacementCheck {
  const def = BUILDINGS[defId];
  if (!def) return { ok: false, cells: [] };
  const m = world.map;
  let near = false;
  for (const b of ownBuildings(world, player)) {
    const fp = BUILDINGS[b.defId]?.footprint ?? { w: 1, h: 1 };
    const bx0 = b.x - fp.w / 2;
    const by0 = b.y - fp.h / 2;
    const dx = Math.max(bx0 - (tx + def.footprint.w), tx - (bx0 + fp.w), 0);
    const dy = Math.max(by0 - (ty + def.footprint.h), ty - (by0 + fp.h), 0);
    if (Math.max(dx, dy) <= BUILD_ADJACENCY) near = true;
  }
  const cells: PlacementCheck['cells'] = [];
  let ok = true;
  for (let y = ty; y < ty + def.footprint.h; y++) {
    for (let x = tx; x < tx + def.footprint.w; x++) {
      let c = near && x >= 0 && y >= 0 && x < m.width && y < m.height;
      if (c) {
        const t = m.terrain[y * m.width + x];
        c = t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Tree && m.ore[y * m.width + x] === 0 && !occupied(world, x, y);
      }
      if (!c) ok = false;
      cells.push({ tx: x, ty: y, ok: c });
    }
  }
  return { ok, cells };
}

function getBuildOptions(world: World, player: PlayerId): BuildOption[] {
  const p = world.players[player];
  if (!p) return [];
  const have = new Set(ownBuildings(world, player).map((b) => b.defId));
  const produced = new Set<QueueCategory>();
  for (const id of have) for (const c of BUILDINGS[id]?.produces ?? []) produced.add(c);
  const out: BuildOption[] = [];
  for (const d of [...Object.values(BUILDINGS), ...Object.values(UNITS)]) {
    if (d.faction !== p.faction) continue;
    if (d.kind === 'building' && !d.buildable) continue;
    if (d.kind === 'building' && d.supportPower && d.supportPower !== 'recon_sweep' && !world.setup.options.superweapons) continue;
    out.push({ defId: d.id, category: d.category, available: produced.has(d.category) && d.prereqs.every((r) => have.has(r)) });
  }
  return out;
}

function refresh(world: World, p: Player): void {
  let prod = 0;
  let used = 0;
  let radar = false;
  const powers = new Map<string, number>();
  for (const b of ownBuildings(world, p.id)) {
    const d = BUILDINGS[b.defId];
    if (!d) continue;
    if (d.power > 0) prod += d.power;
    else used -= d.power;
    if (d.radar) radar = true;
    if (d.supportPower) powers.set(d.supportPower, b.id);
  }
  const low = used > prod;
  if (low !== p.lowPower) world.events.push({ type: 'lowPower', player: p.id, low });
  p.powerProduced = prod;
  p.powerConsumed = used;
  p.lowPower = low;
  p.hasRadar = radar && !low;
  p.powers = p.powers.filter((s) => powers.has(s.id));
  for (const [id, src] of powers) {
    if (!p.powers.some((s) => s.id === id)) {
      const def = SUPPORT_POWERS[id as keyof typeof SUPPORT_POWERS];
      // dev: charge 10× faster so the ready state is quick to reach
      p.powers.push({ id: def.id, sourceId: src, charge: 0, chargeMax: secToTicks(def.recharge / 10), ready: false });
    }
  }
  for (const s of p.powers) {
    if (s.ready || low) continue;
    if (++s.charge >= s.chargeMax) {
      s.ready = true;
      world.events.push({ type: 'powerReady', player: p.id, power: s.id });
    }
  }
}

function apply(world: World, c: Command): void {
  const p = world.players[c.player];
  if (!p) return;
  const give = (ids: number[], order: Order, queue?: boolean) => {
    for (const id of ids) {
      const e = world.entities.get(id);
      if (!e || e.owner !== c.player || e.kind !== 'unit') continue;
      if (queue && e.order) e.queue.push(order);
      else {
        e.order = order;
        e.queue = [];
      }
    }
  };
  switch (c.type) {
    case 'move':
      give(c.ids, { type: 'move', x: c.x, y: c.y }, c.queue);
      break;
    case 'attackMove':
      give(c.ids, { type: 'attackMove', x: c.x, y: c.y }, c.queue);
      break;
    case 'attack':
      give(c.ids, { type: 'attack', targetId: c.targetId }, c.queue);
      break;
    case 'harvest':
      give(c.ids, { type: 'harvest', tx: c.tx, ty: c.ty });
      break;
    case 'dock':
      give(c.ids, { type: 'dock', targetId: c.targetId });
      break;
    case 'capture':
      give(c.ids, { type: 'capture', targetId: c.targetId });
      break;
    case 'guard':
      give(c.ids, { type: 'guard' });
      break;
    case 'stop':
      for (const id of c.ids) {
        const e = world.entities.get(id);
        if (e && e.owner === c.player) {
          e.order = null;
          e.queue = [];
        }
      }
      break;
    case 'deploy':
      for (const id of c.ids) {
        const e = world.entities.get(id);
        const to = e && UNITS[e.defId]?.deploysTo;
        if (!e || e.owner !== c.player || !to) continue;
        world.entities.delete(e.id);
        const b = spawn(world, to, c.player, Math.floor(e.x) + 0.5, Math.floor(e.y) + 0.5, false);
        world.events.push({ type: 'unitDeployed', unitId: e.id, buildingId: b.id, owner: c.player });
      }
      break;
    case 'produce': {
      const d = defOf(c.defId);
      if (!d) break;
      const q = p.queues[d.category];
      if (d.kind === 'building' && q.items.length >= 1) break;
      if (q.items.length < 20) q.items.push({ defId: c.defId, progress: 0, paid: 0 });
      break;
    }
    case 'cancelProduction': {
      const d = defOf(c.defId);
      if (!d) break;
      const q = p.queues[d.category];
      if (q.items[0]?.defId === c.defId && !q.paused && !q.ready) {
        q.paused = true;
        break;
      }
      let i = -1;
      for (let k = q.items.length - 1; k >= 0; k--) if (q.items[k].defId === c.defId) { i = k; break; }
      if (i < 0) break;
      p.credits += q.items[i].paid;
      q.items.splice(i, 1);
      if (i === 0) {
        q.paused = false;
        q.ready = false;
      }
      break;
    }
    case 'resumeProduction':
      p.queues[c.category].paused = false;
      break;
    case 'placeBuilding': {
      const d = BUILDINGS[c.defId];
      const q = d ? p.queues[d.category] : undefined;
      if (!d || !q || !q.ready || q.items[0]?.defId !== c.defId) break;
      if (!canPlaceBuilding(world, c.player, c.defId, c.tx, c.ty).ok) {
        world.events.push({ type: 'cannotPlace', player: c.player });
        break;
      }
      q.items.shift();
      q.ready = false;
      const b = spawn(world, c.defId, c.player, c.tx + d.footprint.w / 2, c.ty + d.footprint.h / 2, false);
      p.stats.buildingsBuilt++;
      world.events.push({ type: 'buildingPlaced', id: b.id, defId: c.defId, owner: c.player, x: b.x, y: b.y });
      break;
    }
    case 'sell': {
      const b = world.entities.get(c.buildingId);
      if (!b || b.owner !== c.player || b.kind !== 'building') break;
      world.entities.delete(b.id);
      p.credits += Math.round((BUILDINGS[b.defId]?.cost ?? 0) * SELL_REFUND * (b.hp / b.maxHp));
      world.events.push({ type: 'buildingSold', id: b.id, defId: b.defId, owner: c.player, x: b.x, y: b.y });
      break;
    }
    case 'toggleRepair': {
      const b = world.entities.get(c.buildingId);
      if (b && b.owner === c.player) b.repairing = !b.repairing;
      break;
    }
    case 'setRally': {
      const b = world.entities.get(c.buildingId);
      if (b && b.owner === c.player) b.rally = { x: c.x, y: c.y };
      break;
    }
    case 'setPrimary': {
      const b = world.entities.get(c.buildingId);
      if (!b || b.owner !== c.player) break;
      for (const o of ownBuildings(world, c.player)) if (o.defId === b.defId) o.primary = false;
      b.primary = true;
      break;
    }
    case 'usePower': {
      const s = p.powers.find((x) => x.id === c.power);
      if (!s?.ready) break;
      s.ready = false;
      s.charge = 0;
      world.events.push({ type: 'powerUsed', player: c.player, power: c.power, x: c.x, y: c.y });
      world.events.push({ type: 'powerImpact', player: c.player, power: c.power, x: c.x, y: c.y, radius: SUPPORT_POWERS[c.power].radius });
      break;
    }
    case 'surrender':
      p.defeated = true;
      world.events.push({ type: 'playerDefeated', player: c.player });
      break;
  }
}

function kill(world: World, e: Entity, killer: PlayerId | null): void {
  world.entities.delete(e.id);
  const o = world.players[e.owner];
  if (o) e.kind === 'unit' ? o.stats.unitsLost++ : o.stats.buildingsLost++;
  if (killer != null && world.players[killer]) world.players[killer].stats.kills++;
  world.events.push({ type: 'entityDestroyed', id: e.id, defId: e.defId, kind: e.kind, owner: e.owner, killer, x: e.x, y: e.y });
}

function stepUnit(world: World, e: Entity): void {
  const d = UNITS[e.defId];
  if (!d) return;
  e.px = e.x;
  e.py = e.y;
  const next = () => {
    e.order = e.queue.shift() ?? null;
  };
  const goto = (x: number, y: number, stopAt = 0.08): boolean => {
    const dx = x - e.x;
    const dy = y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= stopAt) return true;
    const sp = d.speed / TICK_RATE;
    e.facing = e.turretFacing = Math.atan2(dy, dx);
    e.x += (dx / dist) * Math.min(sp, dist);
    e.y += (dy / dist) * Math.min(sp, dist);
    e.action = 'move';
    return false;
  };
  e.action = 'idle';
  const o = e.order;
  if (!o) return;
  const m = world.map;
  const p = world.players[e.owner];
  switch (o.type) {
    case 'move':
    case 'attackMove':
      if (goto(o.x, o.y)) next();
      break;
    case 'attack': {
      const t = world.entities.get(o.targetId);
      const w = d.weapon ? WEAPONS[d.weapon] : undefined;
      if (!t || !w) return next();
      if (!goto(t.x, t.y, w.range)) break;
      e.action = 'attack';
      e.targetId = t.id;
      if (world.tick - e.lastFireTick >= secToTicks(w.cooldown)) {
        e.lastFireTick = world.tick;
        t.hp -= w.damage;
        t.lastHitTick = world.tick;
        world.events.push({ type: 'entityDamaged', id: t.id, owner: t.owner, amount: w.damage, x: t.x, y: t.y });
        if (world.tick % 40 === 0) world.events.push({ type: 'underAttack', player: t.owner, x: t.x, y: t.y, base: t.kind === 'building' });
        if (t.hp <= 0) {
          kill(world, t, e.owner);
          e.kills++;
          next();
        }
      }
      break;
    }
    case 'harvest': {
      if (!d.harvester) return next();
      if (e.cargo >= d.harvester.capacity) {
        const ref = ownBuildings(world, e.owner).find((b) => BUILDINGS[b.defId]?.refinery);
        e.order = ref ? { type: 'dock', targetId: ref.id } : null;
        break;
      }
      const tx = o.tx ?? Math.floor(e.x);
      const ty = o.ty ?? Math.floor(e.y);
      if (!goto(tx + 0.5, ty + 0.5, 0.3)) break;
      const i = ty * m.width + tx;
      e.action = 'harvest';
      if (m.ore[i] > 0) {
        if (world.tick % 10 === 0) {
          m.ore[i]--;
          e.cargo++;
        }
      } else {
        let best = -1;
        let bd = 1e9;
        for (let k = 0; k < m.ore.length; k++) {
          if (m.ore[k] <= 0) continue;
          const dd = Math.hypot((k % m.width) - tx, Math.floor(k / m.width) - ty);
          if (dd < bd) {
            bd = dd;
            best = k;
          }
        }
        if (best < 0) e.order = e.cargo > 0 ? { type: 'harvest', tx: null, ty: null } : null;
        else e.order = { type: 'harvest', tx: best % m.width, ty: Math.floor(best / m.width) };
        if (best < 0 && e.cargo > 0) e.cargo = d.harvester.capacity;
      }
      break;
    }
    case 'dock': {
      const t = world.entities.get(o.targetId);
      if (!t) return next();
      if (!goto(t.x, t.y, 2)) break;
      e.action = 'unload';
      if (e.cargo > 0 && p) {
        const credits = e.cargo * ORE_UNIT_VALUE;
        p.credits += credits;
        p.stats.oreHarvested += credits;
        world.events.push({ type: 'harvesterUnloaded', id: e.id, owner: e.owner, credits });
        e.cargo = 0;
      }
      e.order = d.harvester ? { type: 'harvest', tx: null, ty: null } : null;
      break;
    }
    case 'capture': {
      const t = world.entities.get(o.targetId);
      if (!t) return next();
      if (!goto(t.x, t.y, 1.6)) break;
      world.entities.delete(e.id);
      if (t.owner === e.owner) t.hp = t.maxHp;
      else {
        world.events.push({ type: 'buildingCaptured', id: t.id, defId: t.defId, from: t.owner, to: e.owner });
        t.owner = e.owner;
      }
      break;
    }
    case 'deploy':
    case 'guard':
      break;
  }
}

function step(world: World, commands: Command[]): void {
  world.tick++;
  world.events = [];
  for (const c of commands) apply(world, c);

  for (const p of world.players) {
    refresh(world, p);
    for (const cat of CATS) {
      const q = p.queues[cat];
      const it = q.items[0];
      if (!it || q.paused || q.ready) continue;
      const d = defOf(it.defId);
      if (!d) {
        q.items.shift();
        continue;
      }
      // dev: build 3× faster than the data says
      const rate = (3 / secToTicks(d.buildTime)) * (p.lowPower ? 0.5 : 1);
      const cost = Math.min(d.cost - it.paid, d.cost * rate);
      if (p.credits < cost) {
        if (world.tick % 60 === 0) world.events.push({ type: 'insufficientFunds', player: p.id });
        continue;
      }
      p.credits -= cost;
      p.stats.creditsSpent += cost;
      it.paid += cost;
      it.progress = Math.min(1, it.progress + rate);
      if (it.progress < 1) continue;
      if (d.kind === 'building') {
        q.ready = true;
        world.events.push({ type: 'constructionReady', defId: d.id, owner: p.id });
      } else {
        q.items.shift();
        const makers = ownBuildings(world, p.id).filter((b) => BUILDINGS[b.defId]?.produces?.includes(cat));
        const src = makers.find((b) => b.primary) ?? makers[0];
        if (!src) continue;
        const u = spawn(world, d.id, p.id, src.x + 0.3, src.y + 2.2);
        const r = src.rally ?? { x: src.x + (world.tick % 5) - 2, y: src.y + 3.5 };
        u.order = { type: 'move', x: r.x, y: r.y };
        p.stats.unitsBuilt++;
        world.events.push({ type: 'unitReady', id: u.id, defId: d.id, owner: p.id });
      }
    }
  }

  for (const e of [...world.entities.values()]) {
    if (e.kind === 'unit') stepUnit(world, e);
    else {
      if (e.buildProgress < 1) {
        e.buildProgress = Math.min(1, e.buildProgress + 1 / TICK_RATE);
        if (e.buildProgress >= 1) {
          world.events.push({ type: 'buildingComplete', id: e.id, defId: e.defId, owner: e.owner });
          const free = BUILDINGS[e.defId]?.freeUnit;
          if (free) spawn(world, free, e.owner, e.x, e.y + 2.4).order = { type: 'harvest', tx: null, ty: null };
        }
      }
      if (e.repairing) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp / (TICK_RATE * 6));
        if (e.hp >= e.maxHp) e.repairing = false;
      }
    }
  }

  if (world.winnerTeam === null) {
    const alive = new Set(world.players.filter((p) => !p.defeated).map((p) => p.team));
    if (alive.size <= 1 && world.players.length > 1) {
      world.winnerTeam = [...alive][0] ?? -1;
      world.events.push({ type: 'gameOver', winnerTeam: world.winnerTeam });
    }
  }
}

function createWorld(setup: GameSetup): World {
  const map = { ...setup.map, ore: setup.map.ore.slice() };
  const n = map.width * map.height;
  const queues = () => ({
    structure: { items: [], paused: false, ready: false },
    defense: { items: [], paused: false, ready: false },
    infantry: { items: [], paused: false, ready: false },
    vehicle: { items: [], paused: false, ready: false },
    aircraft: { items: [], paused: false, ready: false },
  });
  const world: World = {
    tick: 0,
    rngState: setup.seed | 0,
    setup,
    map,
    players: setup.players.map((ps, id) => ({
      id,
      name: ps.name,
      faction: ps.faction,
      color: ps.color,
      team: ps.team,
      controller: ps.controller,
      difficulty: ps.difficulty,
      credits: setup.startingCredits,
      powerProduced: 0,
      powerConsumed: 0,
      lowPower: false,
      hasRadar: false,
      queues: queues(),
      powers: [],
      explored: new Uint8Array(n).fill(1),
      visible: new Uint8Array(n).fill(1),
      defeated: false,
      stats: { unitsBuilt: 0, unitsLost: 0, buildingsBuilt: 0, buildingsLost: 0, kills: 0, oreHarvested: 0, creditsSpent: 0 },
    })),
    entities: new Map(),
    nextEntityId: 1,
    projectiles: [],
    events: [],
    winnerTeam: null,
  };
  setup.players.forEach((ps, id) => {
    const st = map.starts[ps.startIndex] ?? map.starts[0] ?? { x: 8, y: 8 };
    const f = FACTIONS[ps.faction];
    if (ps.controller === 'human') spawn(world, f.baseVehicle, id, st.x + 0.5, st.y + 0.5);
    else spawn(world, f.conyard, id, st.x + 0.5, st.y + 0.5);
    f.startingUnits.forEach((u, i) => spawn(world, u, id, st.x - 1.5 + (i % 4) * 1.1, st.y + 2.6 + Math.floor(i / 4)));
  });
  world.events = [];
  return world;
}

export const fakeSim: SimApi = {
  createWorld,
  step,
  canPlaceBuilding,
  getBuildOptions,
  isPassable(world, tx, ty, movement) {
    const m = world.map;
    if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return false;
    if (movement === 'air') return true;
    const t = m.terrain[ty * m.width + tx];
    return t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Tree && !occupied(world, tx, ty);
  },
  isEnemy: (world, a, b) => world.players[a]?.team !== world.players[b]?.team,
  hashWorld: (world) => world.tick,
};
