// The skirmish AI controller. Reads the world (never mutates it), keeps all memory here, and
// returns commands. Work is staggered: a world scan + military decisions every `scanEvery` ticks,
// economy decisions every `econEvery` ticks, nothing at all on the ticks in between.
import type { SimApi } from '../core/api';
import { MAX_QUEUE, TICK_RATE } from '../core/constants';
import { makeRng } from '../core/rng';
import { Terrain, type Command, type Difficulty, type Entity, type EntityId, type Player, type PlayerId, type Vec2, type World } from '../core/types';
import { BUILDINGS, SUPPORT_POWERS, UNITS, WEAPONS } from '../data';
import { chooseDefense, chooseStructure, chooseUnit, defenseRange, emptyMix, waveThreshold, type BuildState, type EnemyMix } from './decide';
import { buildingPriority, factionInfo, PARAMS, unitInfo, type FactionInfo, type Params } from './knowledge';
import { findPlacement, OreGrid, rectOf, type Lane } from './placement';

const NONE: Command[] = [];
const SEC = TICK_RATE;

interface Census {
  buildings: Entity[];
  /** Own buildings by def id, including ones still rising. */
  count: Map<string, number>;
  conyards: Entity[];
  refineries: Entity[];
  producers: Entity[];
  defenses: Entity[];
  harvesters: Entity[];
  baseVehicles: Entity[];
  /** Armed ground units / aircraft. */
  ground: Entity[];
  air: Entity[];
  unitCount: Map<string, number>;
  armyValue: number;
  /** Power of own buildings that are placed but not finished yet. */
  pendingPower: number;
  /** Currently visible enemy units / buildings. */
  enemies: Entity[];
  enemyBuildings: Entity[];
}

interface SeenBuilding {
  id: EntityId;
  defId: string;
  owner: PlayerId;
  x: number;
  y: number;
}

interface Squad {
  kind: 'wave' | 'harass' | 'scout';
  ids: EntityId[];
  state: 'gather' | 'advance' | 'assault' | 'retreat';
  /** Destination (enemy building position, search point or scout waypoint). */
  tx: number;
  ty: number;
  targetId: EntityId | null;
  /** Army value at launch. */
  start: number;
  since: number;
  lastOrder: number;
  regroupUntil: number;
}

interface Threat {
  x: number;
  y: number;
  strength: number;
  base: boolean;
}

const inc = (m: Map<string, number>, k: string, n = 1): void => {
  m.set(k, (m.get(k) ?? 0) + n);
};
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
const isIdle = (e: Entity): boolean => e.order === null && e.action === 'idle';

export class Brain {
  readonly player: PlayerId;
  readonly difficulty: Difficulty;
  private readonly P: Params;
  private readonly sim: SimApi;
  private readonly rng: ReturnType<typeof makeRng>;
  private readonly phase: number;
  private info: FactionInfo | null = null;
  private enemyOwner: boolean[] = [];
  private scans = 0;
  private cs: Census | null = null;

  // ── knowledge ──
  private home: Vec2 | null = null;
  private baseRadius = 6;
  private enemyDir: Vec2 = { x: 0, y: 0 };
  private staging: Vec2 | null = null;
  private stagingAt = -1e9;
  private seen = new Map<EntityId, SeenBuilding>();
  private mix: EnemyMix = emptyMix();
  private sighting: { x: number; y: number; tick: number } | null = null;
  private alerts: { x: number; y: number; tick: number; base: boolean }[] = [];
  private ore = new OreGrid();
  private oreAt = -1e9;
  private lanes: Lane[] = [];

  // ── economy state ──
  private deploy = { id: -1, tries: 0, nextAt: 0, moving: false, ox: 0, oy: 0 };
  private placing: Record<'structure' | 'defense', { defId: string; skip: number; since: number; lastTx: number; lastTy: number }> = {
    structure: { defId: '', skip: 0, since: 0, lastTx: -1, lastTy: -1 },
    defense: { defId: '', skip: 0, since: 0, lastTx: -1, lastTy: -1 },
  };
  private structureBusy = false;
  private nextStructureAt = 0;
  private harvIdle = new Map<EntityId, number>();
  private rallyAt = new Map<EntityId, number>();
  private defenseSlot = 0;
  private nextUnitAt = { vehicle: 0, infantry: 0, aircraft: 0 };

  // ── military state ──
  private squads: Squad[] = [];
  private squadOf = new Map<EntityId, Squad>();
  private defending: { x: number; y: number; until: number; lastOrder: number; peak: number } | null = null;
  private nextWaveAt = 0;
  private nextScoutAt = 10 * SEC;
  private nextHarassAt = 0;
  private nextPoolOrderAt = 0;
  private nextAirAt = 0;
  private nextPowerAt = 0;
  private waves = 0;
  private enemyArmy = 0;
  private lastWaveAt = 0;
  /** Income tracking: when the harvested total last went up. */
  private lastOreTotal = 0;
  private lastIncomeAt = 0;
  private incomeDead = false;
  private nextSellAt = 0;
  /** Enemy anti-air seen (mobile + static), fading. */
  private enemyAA = 0;
  private allIn = false;
  /** Decision log for debugging (capped). */
  readonly log: string[] = [];
  private note(world: World, msg: string): void {
    if (this.log.length < 400) this.log.push(`${(world.tick / SEC / 60).toFixed(1)}m ${msg}`);
  }
  private blockedCells = new Set<number>();
  private cellSeen: number[] = [];

  constructor(player: PlayerId, difficulty: Difficulty, seed: number, sim: SimApi) {
    this.player = player;
    this.difficulty = difficulty;
    this.P = PARAMS[difficulty];
    this.sim = sim;
    this.rng = makeRng((seed ^ Math.imul(player + 1, 0x9e3779b1)) | 0);
    this.phase = (player * 3) % this.P.scanEvery;
    this.nextHarassAt = (this.P.firstAttackSec + 30) * SEC;
  }

  /** Small read-only summary for tests and the dev viewer. */
  debug(): { squads: number; waves: number; seen: number; staging: Vec2 | null; home: Vec2 | null } {
    return { squads: this.squads.length, waves: this.waves, seen: this.seen.size, staging: this.staging, home: this.home };
  }

  think(world: World): Command[] {
    const me = world.players[this.player];
    if (!me || me.defeated || world.winnerTeam !== null) return NONE;
    const tick = world.tick;
    for (const ev of world.events) {
      if (ev.type === 'underAttack' && ev.player === this.player) this.alerts.push({ x: ev.x, y: ev.y, tick, base: ev.base });
    }
    if (this.cs !== null && (tick + this.phase) % this.P.scanEvery !== 0) return NONE;

    if (!this.info) {
      this.info = factionInfo(me.faction);
      this.enemyOwner = world.players.map((p) => this.sim.isEnemy(world, this.player, p.id));
    }
    const cmds: Command[] = [];
    const cs = this.scan(world, me);
    this.cs = cs;
    const opening = this.opening(world, cs, cmds);
    this.military(world, me, cs, cmds);
    const econRatio = Math.max(1, Math.round(this.P.econEvery / this.P.scanEvery));
    if (!opening && this.scans % econRatio === 0) this.economy(world, me, cs, cmds);
    this.scans++;
    return cmds.length ? cmds : NONE;
  }

  // ───────────────────────────── scan ─────────────────────────────

  private scan(world: World, me: Player): Census {
    const cs: Census = {
      buildings: [],
      count: new Map(),
      conyards: [],
      refineries: [],
      producers: [],
      defenses: [],
      harvesters: [],
      baseVehicles: [],
      ground: [],
      air: [],
      unitCount: new Map(),
      armyValue: 0,
      pendingPower: 0,
      enemies: [],
      enemyBuildings: [],
    };
    const fog = world.setup.options.fog;
    const vis = me.visible;
    const w = world.map.width;
    const now: EnemyMix = emptyMix();
    let enemyArmyNow = 0;
    let enemyAANow = 0;
    let aaKnown = 0;
    for (const e of world.entities.values()) {
      if (e.owner === this.player) {
        if (e.kind === 'building') {
          const def = BUILDINGS[e.defId];
          if (!def) continue;
          cs.buildings.push(e);
          inc(cs.count, e.defId);
          if (e.buildProgress < 1) cs.pendingPower += def.power;
          if (def.conyard) cs.conyards.push(e);
          if (def.refinery) cs.refineries.push(e);
          if (def.produces && !def.conyard) cs.producers.push(e);
          if (def.category === 'defense' && def.weapon) cs.defenses.push(e);
        } else {
          const def = UNITS[e.defId];
          if (!def) continue;
          inc(cs.unitCount, e.defId);
          if (def.harvester) cs.harvesters.push(e);
          else if (def.deploysTo) cs.baseVehicles.push(e);
          else if (def.weapon && !def.engineer) {
            (def.movement === 'air' ? cs.air : cs.ground).push(e);
            cs.armyValue += def.cost;
          }
        }
      } else if (this.enemyOwner[e.owner]) {
        if (fog && !(vis[Math.floor(e.y) * w + Math.floor(e.x)] > 0)) continue;
        if (e.kind === 'building') {
          cs.enemyBuildings.push(e);
          const s = this.seen.get(e.id);
          if (s) s.owner = e.owner;
          else this.seen.set(e.id, { id: e.id, defId: e.defId, owner: e.owner, x: e.x, y: e.y });
        } else {
          cs.enemies.push(e);
          const d = UNITS[e.defId];
          if (d) {
            if (d.weapon && !d.harvester) enemyArmyNow += d.cost;
            if (unitInfo(e.defId)?.antiAir) enemyAANow++;
            if (d.armor === 'air') now.air++;
            else if (d.armor === 'infantry') now.infantry++;
            else if (d.armor === 'light') now.light++;
            else now.heavy++;
          }
        }
      }
    }
    // Forget remembered buildings we can see are gone (or changed hands to a friend).
    let defensesKnown = 0;
    for (const s of this.seen.values()) {
      const ent = world.entities.get(s.id);
      const visible = !fog || vis[Math.floor(s.y) * w + Math.floor(s.x)] > 0;
      if (visible && (!ent || !this.enemyOwner[ent.owner])) {
        this.seen.delete(s.id);
        continue;
      }
      const def = BUILDINGS[s.defId];
      if (def && def.category === 'defense' && def.weapon) {
        if (WEAPONS[def.weapon]?.targetsGround) defensesKnown++;
        if (WEAPONS[def.weapon]?.targetsAir) aaKnown++;
      }
    }
    // Slowly decaying memory of what the enemy fields.
    const m = this.mix;
    m.infantry = Math.max(m.infantry * 0.99, now.infantry);
    m.light = Math.max(m.light * 0.99, now.light);
    m.heavy = Math.max(m.heavy * 0.99, now.heavy);
    m.air = Math.max(m.air * 0.995, now.air);
    if (m.air < 0.3) m.air = 0;
    m.defenses = defensesKnown;
    // Largest enemy force seen at once, fading over a few minutes.
    this.enemyArmy = Math.max(this.enemyArmy * 0.9993, enemyArmyNow);
    this.enemyAA = Math.max(this.enemyAA * 0.999, enemyAANow + aaKnown);
    if (this.enemyAA < 0.5) this.enemyAA = 0;

    this.updateGeography(world, cs);
    this.updateCellSeen(world, me);
    return cs;
  }

  private updateGeography(world: World, cs: Census): void {
    const tick = world.tick;
    const anchor = cs.conyards[0] ?? cs.buildings[0] ?? cs.baseVehicles[0];
    if (anchor && (cs.conyards.length > 0 || !this.home)) this.home = { x: anchor.x, y: anchor.y };
    if (!this.home) {
      const s = world.map.starts[world.setup.players[this.player]?.startIndex ?? 0] ?? { x: world.map.width / 2, y: world.map.height / 2 };
      this.home = { x: s.x + 0.5, y: s.y + 0.5 };
    }
    const home = this.home;
    let r = 6;
    for (const b of cs.buildings) {
      const d = dist(b.x, b.y, home.x, home.y);
      if (d < 15) r = Math.max(r, d); // outlying expansions don't stretch the "base"
    }
    this.baseRadius = Math.min(13, r);

    // Which way is the enemy? Known buildings first, then (hard only) the start positions, else map centre.
    let tx = world.map.width / 2;
    let ty = world.map.height / 2;
    let best = Infinity;
    for (const s of this.seen.values()) {
      const d = dist(s.x, s.y, home.x, home.y);
      if (d < best) {
        best = d;
        tx = s.x;
        ty = s.y;
      }
    }
    if (best === Infinity && this.P.assumeStarts) {
      for (const p of this.enemyStarts(world)) {
        const d = dist(p.x, p.y, home.x, home.y);
        if (d < best) {
          best = d;
          tx = p.x;
          ty = p.y;
        }
      }
    }
    const len = dist(tx, ty, home.x, home.y);
    if (len > 1) this.enemyDir = { x: (tx - home.x) / len, y: (ty - home.y) / len };
    if (!this.staging || tick - this.stagingAt >= 20 * SEC) {
      const d = Math.min(12, this.baseRadius + 5);
      this.staging = this.snap(world, home.x + this.enemyDir.x * d, home.y + this.enemyDir.y * d);
      this.stagingAt = tick;
    }
    if (cs.enemies.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const e of cs.enemies) {
        sx += e.x;
        sy += e.y;
      }
      const cx = sx / cs.enemies.length;
      const cy = sy / cs.enemies.length;
      if (dist(cx, cy, home.x, home.y) > this.baseRadius + 12) this.sighting = { x: cx, y: cy, tick };
    }
  }

  /** Start tiles of living enemies (public map knowledge the hard AI is allowed to assume). */
  private enemyStarts(world: World): Vec2[] {
    const out: Vec2[] = [];
    for (const p of world.players) {
      if (!this.enemyOwner[p.id] || p.defeated) continue;
      const s = world.map.starts[world.setup.players[p.id]?.startIndex ?? -1];
      if (s) out.push({ x: s.x + 0.5, y: s.y + 0.5 });
    }
    return out;
  }

  /** Nearest ground-passable point to (x,y). */
  private snap(world: World, x: number, y: number): Vec2 {
    const map = world.map;
    const bx = Math.max(2, Math.min(map.width - 3, Math.floor(x)));
    const by = Math.max(2, Math.min(map.height - 3, Math.floor(y)));
    for (let r = 0; r <= 7; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = bx + dx;
          const ty = by + dy;
          if (tx < 1 || ty < 1 || tx >= map.width - 1 || ty >= map.height - 1) continue;
          if (this.sim.isPassable(world, tx, ty, 'track')) return { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return { x: bx + 0.5, y: by + 0.5 };
  }

  // ───────────────────────────── opening ─────────────────────────────

  /** Deploy the base vehicle; nudge it somewhere else and retry when the deploy does not take. */
  private opening(world: World, cs: Census, cmds: Command[]): boolean {
    if (cs.conyards.length > 0 || cs.baseVehicles.length === 0) return false;
    const v = cs.baseVehicles[0];
    const d = this.deploy;
    const tick = world.tick;
    if (d.id !== v.id) {
      d.id = v.id;
      d.tries = 0;
      d.nextAt = 0;
      d.moving = false;
      d.ox = v.x;
      d.oy = v.y;
    }
    if (v.order?.type === 'deploy' || v.action === 'deploy') return true;
    if (d.moving && tick < d.nextAt && !isIdle(v)) return true;
    if (!d.moving && tick < d.nextAt) return true;
    if (!d.moving && d.tries > 0) {
      // The last deploy order was dropped: the spot is no good. Try a nearby one.
      const r = 2 + Math.min(7, d.tries);
      for (let attempt = 0; attempt < 10; attempt++) {
        const a = this.rng.range(0, Math.PI * 2);
        const tx = Math.floor(d.ox + Math.cos(a) * r);
        const ty = Math.floor(d.oy + Math.sin(a) * r);
        if (tx < 3 || ty < 3 || tx >= world.map.width - 3 || ty >= world.map.height - 3) continue;
        if (!this.sim.isPassable(world, tx, ty, 'track')) continue;
        cmds.push({ type: 'move', player: this.player, ids: [v.id], x: tx + 0.5, y: ty + 0.5 });
        d.moving = true;
        d.nextAt = tick + 6 * SEC;
        return true;
      }
    }
    d.moving = false;
    cmds.push({ type: 'deploy', player: this.player, ids: [v.id] });
    d.tries++;
    d.nextAt = tick + Math.max(this.P.scanEvery, Math.round(1.5 * SEC));
    return true;
  }

  // ───────────────────────────── economy ─────────────────────────────

  private economy(world: World, me: Player, cs: Census, cmds: Command[]): void {
    const info = this.info!;
    const P = this.P;
    const tick = world.tick;
    const minutes = tick / SEC / 60;
    const fog = world.setup.options.fog;
    const home = this.home!;

    if (tick - this.oreAt >= 10 * SEC) {
      this.ore.update(world, fog && !P.assumeStarts ? me.explored : null);
      this.oreAt = tick;
      this.lanes = [];
      for (const r of cs.refineries) {
        const c = this.ore.nearest(r.x, r.y, 1);
        if (c && dist(c.x, c.y, r.x, r.y) < 20) this.lanes.push({ x0: r.x, y0: r.y, x1: c.x, y1: c.y });
      }
    }

    const avail = new Set<string>();
    for (const o of this.sim.getBuildOptions(world, this.player)) if (o.available) avail.add(o.defId);

    // Buildings waiting in the queues count as owned, and their power is already committed.
    const queued = new Map<string, number>();
    let powerNet = me.powerProduced - me.powerConsumed + cs.pendingPower;
    for (const cat of ['structure', 'defense'] as const) {
      for (const it of me.queues[cat].items) {
        inc(queued, it.defId);
        powerNet += BUILDINGS[it.defId]?.power ?? 0;
      }
    }
    const have = (id: string): number => (cs.count.get(id) ?? 0) + (queued.get(id) ?? 0);

    // 1. Place finished buildings promptly.
    for (const cat of ['structure', 'defense'] as const) {
      const q = me.queues[cat];
      if (q.ready && q.items.length > 0) this.place(world, cs, q.items[0].defId, cat, cmds);
      else this.placing[cat].defId = '';
    }

    // 2. Economy targets.
    const refs = cs.refineries.length;
    const underAttack = this.defending !== null;
    let wantRefineries = Math.min(2, P.maxRefineries);
    if (refs >= 2 && refs < P.maxRefineries && this.expansionTarget(cs) !== null) {
      let local = 0;
      for (const r of cs.refineries) local += this.ore.sumWithin(r.x, r.y, 14);
      const incomeLags = minutes > (this.difficulty === 'hard' ? 3.5 : 5) * refs && me.credits < 2500;
      if (local < 150 * refs || incomeLags) wantRefineries = refs + 1;
    }
    const harvQueued = me.queues.vehicle.items.filter((it) => it.defId === info.harvester.id).length;
    const harvesters = cs.harvesters.length + harvQueued;
    const canBuildHarvester = avail.has(info.harvester.id);

    // 3. Structure + defence queues.
    const bs: BuildState = {
      info,
      P,
      have,
      available: (id) => avail.has(id),
      credits: me.credits,
      powerNet,
      minutes,
      wantRefineries,
      harvesters,
      canBuildHarvester,
      superweaponsAllowed: world.setup.options.superweapons,
      enemyAirSeen: this.mix.air,
      underAttack,
      armyValue: cs.armyValue,
    };
    const dq = me.queues.defense;
    const dChoice = chooseDefense(bs);
    if (dChoice.powerShort > 0) bs.powerNet -= dChoice.powerShort; // make the structure queue add a plant
    let reserve = 0;
    const sq = me.queues.structure;
    if (sq.items.length === 0) {
      if (this.structureBusy) {
        this.structureBusy = false;
        this.nextStructureAt = tick + P.structureGapSec * SEC;
      }
      if (tick >= this.nextStructureAt) {
        const ch = chooseStructure(bs);
        reserve = ch.reserve;
        if (ch.defId) {
          cmds.push({ type: 'produce', player: this.player, defId: ch.defId });
          this.structureBusy = true;
          reserve = (BUILDINGS[ch.defId]?.cost ?? 0) * 0.3;
        }
      }
    } else {
      this.structureBusy = true;
      const it = sq.items[0];
      const def = BUILDINGS[it.defId];
      if (def && !sq.ready) {
        // Early core buildings get the money first; later ones share it with the army.
        const core = refs === 0 || !info.factory || (cs.count.get(info.factory.id) ?? 0) === 0;
        reserve = Math.max(0, def.cost - it.paid) * (core ? 1 : 0.2);
      }
      if (sq.paused) cmds.push({ type: 'resumeProduction', player: this.player, category: 'structure' });
    }
    if (dq.items.length === 0) {
      if (dChoice.defId && avail.has(dChoice.defId)) cmds.push({ type: 'produce', player: this.player, defId: dChoice.defId });
    } else if (dq.paused) cmds.push({ type: 'resumeProduction', player: this.player, category: 'defense' });

    // A lost base: build a new base vehicle if the tech allows it.
    if (cs.conyards.length === 0 && cs.baseVehicles.length === 0 && avail.has(info.baseVehicle.id)) {
      const vq = me.queues.vehicle;
      if (!vq.items.some((it) => it.defId === info.baseVehicle.id) && vq.items.length < MAX_QUEUE) {
        cmds.push({ type: 'produce', player: this.player, defId: info.baseVehicle.id });
        reserve += info.baseVehicle.cost;
      }
    }

    // 4. Harvesters, with priority over the army.
    let spend = me.credits - reserve;
    // Two per refinery early (army first); the extra ones only once the base can afford the greed.
    const perRef = minutes < 6 ? Math.min(2, P.harvPerRefinery) : P.harvPerRefinery;
    const harvWant = refs === 0 || this.incomeDead ? 0 : Math.min(P.maxHarvesters, Math.ceil(refs * perRef));
    const vq = me.queues.vehicle;
    let vehicleSlots = P.queueDepth - vq.items.length;
    if (canBuildHarvester && harvesters < harvWant && harvQueued === 0 && vq.items.length < MAX_QUEUE) {
      if (me.credits >= info.harvester.cost * 0.4 || cs.harvesters.length === 0) {
        cmds.push({ type: 'produce', player: this.player, defId: info.harvester.id });
        spend -= info.harvester.cost;
        vehicleSlots--;
      }
    }

    // 5. Army production from every queue.
    if (cs.armyValue < P.maxArmyValue) {
      let antiAirOwned = 0;
      let frontline = 0;
      for (const e of cs.ground) {
        const u = unitInfo(e.defId);
        if (!u) continue;
        if (u.antiAir) antiAirOwned++;
        if (u.antiGround && !u.siege) frontline++;
      }
      antiAirOwned += cs.defenses.filter((d) => WEAPONS[BUILDINGS[d.defId]?.weapon ?? '']?.targetsAir).length * 0.5;
      const hasFactory = !!info.factory && (cs.count.get(info.factory.id) ?? 0) > 0;
      for (const cat of ['vehicle', 'infantry', 'aircraft'] as const) {
        const q = me.queues[cat];
        const slots = cat === 'vehicle' ? vehicleSlots : P.queueDepth - q.items.length;
        if (slots <= 0 || q.items.length >= MAX_QUEUE) continue;
        if (q.paused) cmds.push({ type: 'resumeProduction', player: this.player, category: cat });
        if (tick < this.nextUnitAt[cat]) continue;
        const inQueue = (id: string): number => q.items.reduce((n, it) => n + (it.defId === id ? 1 : 0), 0);
        if (cat === 'aircraft' && (cs.air.length + q.items.length >= P.aircraftMax || this.enemyAA >= 2)) continue;
        // Infantry is filler once vehicles are available: a modest screen, the money goes to armour.
        if (cat === 'infantry' && hasFactory) {
          let infantry = q.items.length;
          for (const e of cs.ground) if (UNITS[e.defId]?.category === 'infantry') infantry++;
          if (infantry >= 5 + minutes * 0.7 && spend < 2500) continue;
        }
        const options = info.combat.filter((u) => u.def.category === cat && avail.has(u.def.id));
        let pick: string | null = null;
        // First vehicle on normal/hard is a scout car.
        if (cat === 'vehicle' && info.scout && avail.has(info.scout.id) && this.difficulty !== 'easy' && this.seen.size === 0 && (cs.unitCount.get(info.scout.id) ?? 0) + inQueue(info.scout.id) === 0) {
          pick = info.scout.id;
        }
        pick ??= chooseUnit({
          options,
          counts: (id) => (cs.unitCount.get(id) ?? 0) + inQueue(id),
          mix: this.mix,
          antiAirOwned,
          frontline,
          rand: this.rng.next,
        });
        if (!pick) continue;
        const cost = UNITS[pick]?.cost ?? 0;
        if (spend < cost * (cat === 'infantry' ? 1 : 0.7)) continue;
        cmds.push({ type: 'produce', player: this.player, defId: pick });
        spend -= cost;
        this.nextUnitAt[cat] = tick + P.unitGapSec * SEC;
      }
    }

    // Income watch. When nothing has come in for a long time (ore mined out, harvesters gone and
    // no way to replace them) and the bank is empty, liquidate what no longer earns its keep and
    // put the money into one last army rather than sit in a stalemate.
    if (me.stats.oreHarvested > this.lastOreTotal || (refs === 0 && me.stats.oreHarvested === 0)) {
      this.lastOreTotal = me.stats.oreHarvested;
      this.lastIncomeAt = tick;
    }
    this.incomeDead = tick - this.lastIncomeAt > 100 * SEC;
    if (this.incomeDead && me.credits < 300 && tick >= this.nextSellAt) {
      this.nextSellAt = tick + 8 * SEC;
      const keep = new Set<string>([info.conyard.id, info.factory?.id ?? '', info.barracks?.id ?? '']);
      let victim: Entity | null = null;
      let victimScore = -Infinity;
      for (const b of cs.buildings) {
        const def = BUILDINGS[b.defId];
        if (!def || keep.has(def.id) || b.buildProgress < 1) continue;
        if (def.power > 0 && me.powerProduced - def.power < me.powerConsumed) continue; // don't brown out
        // Sell the least useful first: superweapon/tech/airfield, then idle refineries, then the rest.
        let score = def.cost;
        if (def.category === 'defense') score -= 3000;
        if (def.power > 0) score -= 1500;
        if (score > victimScore) {
          victimScore = score;
          victim = b;
        }
      }
      if (victim) {
        cmds.push({ type: 'sell', player: this.player, buildingId: victim.id });
        this.note(world, `income dead: selling ${victim.defId}`);
      }
    }

    // 6. Upkeep: repairs, rally points, idle harvesters.
    let toggles = 0;
    for (const b of cs.buildings) {
      if (toggles >= 2) break;
      if (b.buildProgress < 1) continue;
      const frac = b.hp / b.maxHp;
      if (!b.repairing && frac < 0.7 && me.credits > 400) {
        cmds.push({ type: 'toggleRepair', player: this.player, buildingId: b.id });
        toggles++;
      } else if (b.repairing && (frac >= 1 || me.credits < 60)) {
        cmds.push({ type: 'toggleRepair', player: this.player, buildingId: b.id });
        toggles++;
      }
    }
    if (this.staging) {
      for (const b of cs.producers) {
        const def = BUILDINGS[b.defId];
        const want = def.produces?.includes('aircraft') ? home : this.staging;
        if (b.rally && dist(b.rally.x, b.rally.y, want.x, want.y) < 3) continue;
        if (tick - (this.rallyAt.get(b.id) ?? -1e9) < 10 * SEC) continue;
        this.rallyAt.set(b.id, tick);
        cmds.push({ type: 'setRally', player: this.player, buildingId: b.id, x: want.x, y: want.y });
      }
    }
    for (const h of cs.harvesters) {
      if (!isIdle(h)) {
        this.harvIdle.delete(h.id);
        continue;
      }
      const n = (this.harvIdle.get(h.id) ?? 0) + 1;
      this.harvIdle.set(h.id, n);
      if (n < 2 || refs === 0) continue;
      const c = this.ore.nearest(h.x, h.y, 4);
      if (c) cmds.push({ type: 'harvest', player: this.player, ids: [h.id], tx: c.tx, ty: c.ty });
      this.harvIdle.delete(h.id);
    }
  }

  /** Richest nearby ore not already served by one of our refineries. */
  private expansionTarget(cs: Census): { x: number; y: number } | null {
    const home = this.home!;
    return this.ore.nearest(home.x, home.y, 100, (c) => !cs.refineries.some((r) => dist(r.x, r.y, c.x, c.y) < 11));
  }

  private place(world: World, cs: Census, defId: string, cat: 'structure' | 'defense', cmds: Command[]): void {
    const def = BUILDINGS[defId];
    const st = this.placing[cat];
    const tick = world.tick;
    if (st.defId !== defId) {
      st.defId = defId;
      st.skip = 0;
      st.since = tick;
      st.lastTx = -1;
      st.lastTy = -1;
    }
    const home = this.home!;
    const dir = this.enemyDir;
    let anchor: Vec2;
    let oreClearance = 1;
    let spreadFrom: Entity[] | undefined;
    if (!def || cs.buildings.length === 0) {
      anchor = home;
    } else if (def.refinery) {
      const target = (cs.refineries.length > 0 ? this.expansionTarget(cs) : null) ?? this.ore.nearest(home.x, home.y, 1);
      anchor = target ? { x: target.x, y: target.y } : home;
      oreClearance = 2;
    } else if (def.category === 'defense') {
      anchor = this.defenseAnchor(cs, !!WEAPONS[def.weapon ?? '']?.targetsAir);
      spreadFrom = cs.defenses;
      oreClearance = 0;
    } else if (def.produces) {
      anchor = { x: home.x + dir.x * 5, y: home.y + dir.y * 5 };
    } else {
      // Power and tech go to the rear; when an expansion is wanted they creep toward it instead.
      anchor = { x: home.x - dir.x * 5, y: home.y - dir.y * 5 };
      const exp = cs.refineries.length >= 2 ? this.expansionTarget(cs) : null;
      if (exp && def.power > 0) {
        let near = Infinity;
        for (const b of cs.buildings) near = Math.min(near, dist(b.x, b.y, exp.x, exp.y));
        if (near > 9) anchor = { x: exp.x, y: exp.y };
      }
    }
    const res = findPlacement({
      world,
      sim: this.sim,
      player: this.player,
      defId,
      own: cs.buildings.map(rectOf),
      anchor,
      lanes: this.lanes,
      oreClearance,
      spreadFrom: spreadFrom?.map(rectOf),
      spreadDist: 2,
      skip: st.skip,
      maxChecks: 24,
    });
    if (res.place) {
      // The same tile twice means the sim refused it despite the check: move on.
      if (res.place.tx === st.lastTx && res.place.ty === st.lastTy) st.skip++;
      st.lastTx = res.place.tx;
      st.lastTy = res.place.ty;
      cmds.push({ type: 'placeBuilding', player: this.player, defId, tx: res.place.tx, ty: res.place.ty });
    } else {
      st.skip += 24;
      if (st.skip >= res.candidates) st.skip = 0;
      // Hopeless (walled in / no room): give the money back rather than block the queue forever.
      if (tick - st.since > 60 * SEC) {
        cmds.push({ type: 'cancelProduction', player: this.player, defId });
        st.since = tick;
      }
    }
  }

  /** Where the next turret should go: the enemy-facing front, recent attack sites, or a refinery. */
  private defenseAnchor(cs: Census, antiAir: boolean): Vec2 {
    const home = this.home!;
    const dir = this.enemyDir;
    const spots: Vec2[] = [];
    if (antiAir) {
      spots.push(home);
      for (const r of cs.refineries) spots.push({ x: r.x, y: r.y });
    } else {
      const front = this.baseRadius + 2;
      spots.push({ x: home.x + dir.x * front, y: home.y + dir.y * front });
      for (const a of this.alerts) if (dist(a.x, a.y, home.x, home.y) < this.baseRadius + 10) spots.push({ x: a.x, y: a.y });
      for (const r of cs.refineries) spots.push({ x: r.x + dir.x * 3, y: r.y + dir.y * 3 });
      // Flanks of the front.
      spots.push({ x: home.x + (dir.x * 0.7 - dir.y * 0.7) * front, y: home.y + (dir.y * 0.7 + dir.x * 0.7) * front });
      spots.push({ x: home.x + (dir.x * 0.7 + dir.y * 0.7) * front, y: home.y + (dir.y * 0.7 - dir.x * 0.7) * front });
    }
    let best = spots[0];
    let bestN = Infinity;
    for (const s of spots) {
      let n = 0;
      for (const d of cs.defenses) {
        const isAA = !!WEAPONS[BUILDINGS[d.defId]?.weapon ?? '']?.targetsAir;
        if (isAA === antiAir && dist(d.x, d.y, s.x, s.y) < 6) n++;
      }
      if (n < bestN) {
        bestN = n;
        best = s;
      }
    }
    this.defenseSlot++;
    return best;
  }

  // ───────────────────────────── military ─────────────────────────────

  private cost(e: Entity): number {
    return UNITS[e.defId]?.cost ?? 0;
  }

  private send(cmds: Command[], type: 'move' | 'attackMove', ids: EntityId[], x: number, y: number): void {
    if (ids.length > 0) cmds.push({ type, player: this.player, ids, x, y });
  }

  private military(world: World, me: Player, cs: Census, cmds: Command[]): void {
    const tick = world.tick;
    const P = this.P;
    const home = this.home!;
    const staging = this.staging ?? home;

    // Prune the dead from squads.
    for (let i = this.squads.length - 1; i >= 0; i--) {
      const s = this.squads[i];
      s.ids = s.ids.filter((id) => {
        const e = world.entities.get(id);
        const ok = !!e && e.owner === this.player;
        if (!ok) this.squadOf.delete(id);
        return ok;
      });
      if (s.ids.length === 0) {
        if (s.kind === 'scout') this.nextScoutAt = tick + 90 * SEC;
        this.squads.splice(i, 1);
      }
    }
    if (this.squadOf.size > 400) {
      for (const id of this.squadOf.keys()) if (!world.entities.has(id)) this.squadOf.delete(id);
    }
    while (this.alerts.length && tick - this.alerts[0].tick > 30 * SEC) this.alerts.shift();

    const pool: Entity[] = [];
    let poolStrength = 0;
    for (const e of cs.ground) {
      if (this.squadOf.has(e.id)) continue;
      pool.push(e);
      if (unitInfo(e.defId)?.antiGround) poolStrength += this.cost(e);
    }

    // ── defence ──
    let threat = this.assessThreat(world, cs);
    // Outlying raids (a far refinery, a harvester) are only answered in force — never by trickling
    // units out one at a time into something bigger. The base itself is always defended.
    if (threat && !threat.base && poolStrength < threat.strength * 1.2) threat = null;
    if (threat) {
      // Call back waves that have not committed yet if the home force cannot cope.
      if (threat.base && threat.strength > poolStrength * 1.2) {
        for (const s of this.squads) {
          if (s.kind !== 'wave' || s.state === 'assault' || s.state === 'retreat') continue;
          const c = this.centroid(world, s.ids);
          if (dist(c.x, c.y, home.x, home.y) < dist(c.x, c.y, s.tx, s.ty)) this.dissolve(s);
        }
        this.squads = this.squads.filter((s) => s.ids.length > 0);
      }
      const d = this.defending;
      const moved = d ? dist(d.x, d.y, threat.x, threat.y) : Infinity;
      if (!d || moved > 5 || tick - d.lastOrder >= 2 * SEC) {
        // Leash: meet the threat near what it threatens, never chase it across the map.
        let gx = threat.x;
        let gy = threat.y;
        const leash = this.baseRadius + 6;
        const dHome = dist(gx, gy, home.x, home.y);
        if (dHome > leash && !cs.refineries.some((r) => dist(r.x, r.y, gx, gy) < 7)) {
          gx = home.x + ((gx - home.x) / dHome) * leash;
          gy = home.y + ((gy - home.y) / dHome) * leash;
        }
        const p = this.snap(world, gx, gy);
        const ids: EntityId[] = [];
        for (const e of cs.ground) if (!this.squadOf.has(e.id) && (e.targetId === null || moved > 5)) ids.push(e.id);
        for (const e of cs.air) if (e.targetId === null) ids.push(e.id);
        this.send(cmds, 'attackMove', ids, p.x, p.y);
        this.defending = { x: threat.x, y: threat.y, until: tick + 6 * SEC, lastOrder: tick, peak: Math.max(d?.peak ?? 0, threat.strength) };
      } else {
        d.until = tick + 6 * SEC;
        d.peak = Math.max(d.peak, threat.strength);
      }
    } else if (this.defending && tick > this.defending.until) {
      // Attack repelled: whatever came at us is dead or gone, so the enemy is weaker than we thought.
      this.enemyArmy = Math.max(0, this.enemyArmy - this.defending.peak * 0.7);
      this.defending = null;
      this.nextPoolOrderAt = 0;
    }

    // ── home pool: keep stragglers at the staging point ──
    if (!this.defending && tick >= this.nextPoolOrderAt) {
      this.nextPoolOrderAt = tick + 5 * SEC;
      const ids: EntityId[] = [];
      for (const e of pool) if (isIdle(e) && dist(e.x, e.y, staging.x, staging.y) > 7) ids.push(e.id);
      this.send(cmds, 'attackMove', ids, staging.x, staging.y);
    }

    this.updateScouting(world, me, cs, pool, cmds);

    // ── launch a wave ──
    const minutes = tick / SEC / 60;
    if (!this.defending && tick >= P.firstAttackSec * SEC && tick >= this.nextWaveAt) {
      const fighters = pool.filter((e) => {
        const u = unitInfo(e.defId);
        return !!u && (u.antiGround || this.mix.air > 0) && !this.squadOf.has(e.id);
      });
      let strength = 0;
      for (const e of fighters) strength += this.cost(e);
      // The longer we have sat idle, the less we insist on: a stalemate is worse than a risky push.
      const idle = (tick - Math.max(this.lastWaveAt, P.firstAttackSec * SEC)) / SEC;
      let need = waveThreshold(P, minutes);
      if (idle > 150) need = Math.max(P.waveBase * 0.5, need * Math.max(0.25, 1 - (idle - 150) / 180));
      // Economy dead (nothing left to mine or nothing to mine with): all in.
      const broke = me.credits < 400 && (cs.harvesters.length === 0 || this.incomeDead);
      if (broke || idle > 420) need = 0;
      this.allIn = broke || idle > 420;
      // Don't walk into a force we already know is bigger — unless we are maxed out anyway.
      // What we expect to meet: the biggest force seen lately plus the turrets guarding the target.
      const probable = this.pickTarget(world, this.staging ?? home);
      let turrets = 0;
      if (probable) {
        for (const o of this.seen.values()) {
          const od = BUILDINGS[o.defId];
          if (od && od.category === 'defense' && od.weapon && WEAPONS[od.weapon]?.targetsGround && dist(o.x, o.y, probable.x, probable.y) < 11) turrets += od.cost;
        }
      }
      // (Hard also assumes an unseen enemy has been building at a sensible rate.)
      const expected = Math.max(this.enemyArmy, Math.min(P.enemyPriorMax, P.enemyPriorPerMin * minutes)) + turrets;
      const enough = strength >= expected * P.launchRatio || cs.armyValue >= P.maxArmyValue * 0.9 || this.allIn;
      if (fighters.length >= (broke ? 1 : 3) && strength >= need && enough) this.launchWave(world, fighters, strength);
    }

    // ── hard: harassment of the enemy economy with a few fast units ──
    if (P.harass && !this.defending && tick >= this.nextHarassAt && !this.squads.some((s) => s.kind === 'harass')) {
      this.nextHarassAt = tick + 20 * SEC;
      const target = this.pickTarget(world, staging, (def) => !!def.refinery);
      if (target) {
        const fast = pool.filter((e) => !this.squadOf.has(e.id) && (UNITS[e.defId]?.speed ?? 0) >= 2.5 && unitInfo(e.defId)?.antiGround);
        // Raiders are a luxury: only when the main force can spare them.
        if (fast.length >= 3 && poolStrength >= 4500) {
          const members = fast.slice(0, 4);
          this.addSquad('harass', members, target.x, target.y, target.id, tick, 'advance');
          this.nextHarassAt = tick + 150 * SEC;
        }
      }
    }

    for (const s of this.squads) if (s.kind !== 'scout') this.updateSquad(world, cs, s, cmds);
    this.squads = this.squads.filter((s) => s.ids.length > 0);

    this.updateAir(world, cs, threat, cmds);
    this.usePowers(world, me, cmds);
  }

  private centroid(world: World, ids: EntityId[]): Vec2 {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of ids) {
      const e = world.entities.get(id);
      if (!e) continue;
      x += e.x;
      y += e.y;
      n++;
    }
    return n ? { x: x / n, y: y / n } : { x: this.home!.x, y: this.home!.y };
  }

  private addSquad(kind: Squad['kind'], members: Entity[], tx: number, ty: number, targetId: EntityId | null, tick: number, state: Squad['state']): Squad {
    let start = 0;
    for (const e of members) start += this.cost(e);
    const s: Squad = { kind, ids: members.map((e) => e.id), state, tx, ty, targetId, start, since: tick, lastOrder: -1e9, regroupUntil: 0 };
    for (const id of s.ids) this.squadOf.set(id, s);
    this.squads.push(s);
    return s;
  }

  private dissolve(s: Squad): void {
    for (const id of s.ids) this.squadOf.delete(id);
    s.ids = [];
  }

  /** Is this point covered by a remembered enemy ground-defence turret? */
  private underEnemyGuns(x: number, y: number): boolean {
    for (const s of this.seen.values()) {
      const def = BUILDINGS[s.defId];
      if (def && def.category === 'defense' && def.weapon && WEAPONS[def.weapon]?.targetsGround && dist(s.x, s.y, x, y) < defenseRange(def) + 3) return true;
    }
    return false;
  }

  /** Enemies near the base, the refineries or the harvesters — or a fresh under-attack alert. */
  private assessThreat(world: World, cs: Census): Threat | null {
    const home = this.home!;
    const tick = world.tick;
    const radius = this.baseRadius + 9;
    let sx = 0;
    let sy = 0;
    let strength = 0;
    let base = false;
    for (const e of cs.enemies) {
      let near = dist(e.x, e.y, home.x, home.y) < radius;
      if (near) base = true;
      if (!near) for (const r of cs.refineries) if (dist(e.x, e.y, r.x, r.y) < 8) near = true;
      // Harvesters are worth protecting on our side of the map, not under the enemy's guns.
      if (!near && dist(e.x, e.y, home.x, home.y) < radius + 7 && !this.underEnemyGuns(e.x, e.y)) {
        for (const h of cs.harvesters) if (dist(e.x, e.y, h.x, h.y) < 6) near = true;
      }
      if (!near) continue;
      const c = Math.max(100, this.cost(e));
      sx += e.x * c;
      sy += e.y * c;
      strength += c;
    }
    if (strength > 0) return { x: sx / strength, y: sy / strength, strength, base };
    // Hit by something we cannot see (artillery, bombers): go to where it hurts.
    for (let i = this.alerts.length - 1; i >= 0; i--) {
      const a = this.alerts[i];
      if (tick - a.tick > 4 * SEC) break;
      // Only at home: an alert from a scout or a wave far away is not a reason to move the garrison.
      if (dist(a.x, a.y, home.x, home.y) > radius + 6) continue;
      return { x: a.x, y: a.y, strength: 400, base: a.base };
    }
    return null;
  }

  // ── scouting ──

  private updateScouting(world: World, me: Player, cs: Census, pool: Entity[], cmds: Command[]): void {
    const tick = world.tick;
    const enemiesAlive = world.players.filter((p) => this.enemyOwner[p.id] && !p.defeated);
    const known = new Set<PlayerId>();
    for (const s of this.seen.values()) known.add(s.owner);
    const needScout = enemiesAlive.some((p) => !known.has(p.id));
    let scout = this.squads.find((s) => s.kind === 'scout');

    if (!scout && needScout && !this.defending && tick >= this.nextScoutAt && pool.length > 0) {
      // Fastest thing we have; the dedicated scout car if one exists.
      let best: Entity | null = null;
      let bestSpeed = -1;
      for (const e of pool) {
        if (this.squadOf.has(e.id)) continue;
        const sp = (UNITS[e.defId]?.speed ?? 0) + (e.defId === this.info!.scout?.id ? 10 : 0);
        if (sp > bestSpeed) {
          bestSpeed = sp;
          best = e;
        }
      }
      if (best) {
        scout = this.addSquad('scout', [best], best.x, best.y, null, tick, 'advance');
        scout.since = -1e9; // force a waypoint pick
        pool.splice(pool.indexOf(best), 1);
      }
    }
    if (!scout) return;
    if (!needScout) {
      this.dissolve(scout);
      this.squads = this.squads.filter((s) => s.ids.length > 0);
      return;
    }
    const e = world.entities.get(scout.ids[0]);
    if (!e) return;
    const map = world.map;
    const txi = Math.max(0, Math.min(map.width - 1, Math.floor(scout.tx)));
    const tyi = Math.max(0, Math.min(map.height - 1, Math.floor(scout.ty)));
    const arrived = dist(e.x, e.y, scout.tx, scout.ty) < 4 || me.explored[tyi * map.width + txi] > 0;
    const timedOut = tick - scout.since > 45 * SEC;
    if (arrived || timedOut) {
      if (timedOut && !arrived) this.blockedCells.add(Math.floor(scout.ty / 8) * 1000 + Math.floor(scout.tx / 8));
      const next = this.searchPoint(world, me, { x: e.x, y: e.y }, false);
      if (!next) {
        this.dissolve(scout);
        this.squads = this.squads.filter((s) => s.ids.length > 0);
        this.nextScoutAt = tick + 120 * SEC;
        return;
      }
      scout.tx = next.x;
      scout.ty = next.y;
      scout.since = tick;
      scout.lastOrder = tick;
      this.send(cmds, 'move', scout.ids, next.x, next.y);
    } else if (isIdle(e) && tick - scout.lastOrder > 3 * SEC) {
      scout.lastOrder = tick;
      this.send(cmds, 'move', scout.ids, scout.tx, scout.ty);
    }
  }

  /**
   * Somewhere worth looking for the enemy: a recent sighting, (hard) an unexplored enemy start,
   * else the unexplored region farthest from home.
   */
  private searchPoint(world: World, me: Player, from: Vec2, useSighting: boolean): Vec2 | null {
    const map = world.map;
    const tick = world.tick;
    if (useSighting && this.sighting && tick - this.sighting.tick < 90 * SEC) {
      const s = this.sighting;
      this.sighting = null;
      return this.snap(world, s.x, s.y);
    }
    if (this.P.assumeStarts) {
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (const p of this.enemyStarts(world)) {
        if (me.explored[Math.floor(p.y) * map.width + Math.floor(p.x)] > 0) continue;
        const d = dist(p.x, p.y, from.x, from.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) return best;
    }
    const home = this.home!;
    const S = 8;
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (let cy = 0; cy * S < map.height; cy++) {
      for (let cx = 0; cx * S < map.width; cx++) {
        if (this.blockedCells.has(cy * 1000 + cx)) continue;
        const tx = Math.min(map.width - 3, cx * S + S / 2);
        const ty = Math.min(map.height - 3, cy * S + S / 2);
        const i = ty * map.width + tx;
        if (me.explored[i] > 0) continue;
        const t = map.terrain[i];
        if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Tree) continue;
        const score = dist(tx, ty, home.x, home.y) - 0.6 * dist(tx, ty, from.x, from.y) + this.rng.next() * 4;
        if (score > bestScore) {
          bestScore = score;
          best = { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    if (best) return best;
    // Everything has been explored at some point, yet the enemy is still alive: something was built
    // (or moved) after we looked. Sweep the areas we have not had eyes on for the longest time.
    const cols = Math.ceil(map.width / S);
    for (let cy = 0; cy * S < map.height; cy++) {
      for (let cx = 0; cx * S < map.width; cx++) {
        if (this.blockedCells.has(cy * 1000 + cx)) continue;
        const tx = Math.min(map.width - 3, cx * S + S / 2);
        const ty = Math.min(map.height - 3, cy * S + S / 2);
        const t = map.terrain[ty * map.width + tx];
        if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Tree) continue;
        const stale = (tick - (this.cellSeen[cy * cols + cx] ?? 0)) / SEC;
        if (stale < 45) continue;
        const score = stale - 0.8 * dist(tx, ty, from.x, from.y) + this.rng.next() * 6;
        if (score > bestScore) {
          bestScore = score;
          best = { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return best;
  }

  /** Remember when each coarse map cell was last in sight (for the late-game sweep). */
  private updateCellSeen(world: World, me: Player): void {
    const map = world.map;
    const S = 8;
    const cols = Math.ceil(map.width / S);
    const fog = world.setup.options.fog;
    for (let cy = 0; cy * S < map.height; cy++) {
      for (let cx = 0; cx * S < map.width; cx++) {
        const tx = Math.min(map.width - 3, cx * S + S / 2);
        const ty = Math.min(map.height - 3, cy * S + S / 2);
        if (!fog || me.visible[ty * map.width + tx] > 0) this.cellSeen[cy * cols + cx] = world.tick;
      }
    }
  }

  // ── targeting ──

  /** Best remembered enemy building to go after from `from`. */
  private pickTarget(world: World, from: Vec2, filter?: (def: (typeof BUILDINGS)[string]) => boolean, avoid?: Vec2): SeenBuilding | null {
    const kPrio = this.difficulty === 'easy' ? 0 : this.difficulty === 'normal' ? 2 : 3;
    let best: SeenBuilding | null = null;
    let bestScore = -Infinity;
    for (const s of this.seen.values()) {
      const def = BUILDINGS[s.defId];
      if (!def || world.players[s.owner]?.defeated) continue;
      if (filter && !filter(def)) continue;
      if (avoid && dist(s.x, s.y, avoid.x, avoid.y) < 14) continue;
      let score = buildingPriority(def) * kPrio - dist(s.x, s.y, from.x, from.y) * 0.35;
      if (def.wall) score -= 50;
      if (this.P.focusFire) {
        // Prefer soft targets: count known turrets covering it.
        for (const o of this.seen.values()) {
          const od = BUILDINGS[o.defId];
          if (od && od.category === 'defense' && od.weapon && WEAPONS[od.weapon]?.targetsGround && dist(o.x, o.y, s.x, s.y) < defenseRange(od)) score -= 1.2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  private launchWave(world: World, fighters: Entity[], strength: number): void {
    const tick = world.tick;
    const P = this.P;
    const staging = this.staging ?? this.home!;
    const me = world.players[this.player];
    const first = this.pickTarget(world, staging);
    let tx: number;
    let ty: number;
    let tid: EntityId | null = null;
    if (first) {
      tx = first.x;
      ty = first.y;
      tid = first.id;
    } else {
      const p = this.searchPoint(world, me, staging, true);
      if (!p) {
        this.nextWaveAt = tick + 20 * SEC;
        return;
      }
      tx = p.x;
      ty = p.y;
    }
    // Leave a home guard: the cheapest units stay.
    fighters.sort((a, b) => this.cost(b) - this.cost(a) || a.id - b.id);
    let keep = this.allIn ? 0 : strength * P.homeGuard;
    const members: Entity[] = [];
    for (let i = fighters.length - 1; i >= 0; i--) {
      const c = this.cost(fighters[i]);
      if (keep >= c && fighters.length - members.length > 3) keep -= c;
      else members.push(fighters[i]);
    }
    if (members.length < 3) return;
    // Hard: split off a second prong at a different part of the enemy when the force is big enough.
    // (Only with a clear surplus: two half-strength prongs each lose where one full one would win.)
    const second = P.multiProng && members.length >= 9 && first && strength >= this.enemyArmy * 2.2 ?this.pickTarget(world, staging, undefined, { x: tx, y: ty }) : null;
    if (second) {
      const a: Entity[] = [];
      const b: Entity[] = [];
      members.forEach((e, i) => (i % 3 === 2 ? b : a).push(e));
      this.addSquad('wave', a, tx, ty, tid, tick, 'gather');
      this.addSquad('wave', b, second.x, second.y, second.id, tick, 'gather');
    } else {
      this.addSquad('wave', members, tx, ty, tid, tick, 'gather');
    }
    this.waves++;
    this.lastWaveAt = tick;
    this.note(world, `wave ${this.waves}: ${members.length} units, value ${strength}, target ${first ? first.defId : 'search'} @${tx.toFixed(0)},${ty.toFixed(0)}${second ? ' + second prong' : ''} (enemy est ${this.enemyArmy.toFixed(0)})`);
    this.nextWaveAt = tick + P.waveCooldownSec * SEC;
  }

  private updateSquad(world: World, cs: Census, s: Squad, cmds: Command[]): void {
    const tick = world.tick;
    const P = this.P;
    const staging = this.staging ?? this.home!;
    const me = world.players[this.player];
    const members: Entity[] = [];
    let cx = 0;
    let cy = 0;
    let strength = 0;
    for (const id of s.ids) {
      const e = world.entities.get(id);
      if (!e) continue;
      members.push(e);
      cx += e.x;
      cy += e.y;
      strength += this.cost(e);
    }
    if (members.length === 0) return;
    cx /= members.length;
    cy /= members.length;
    const all = s.ids;

    // Local enemy strength: visible units plus known turrets around the squad.
    let enemy = 0;
    for (const e of cs.enemies) if (dist(e.x, e.y, cx, cy) < 11 && unitInfo(e.defId)?.antiGround) enemy += this.cost(e);
    for (const b of this.seen.values()) {
      const def = BUILDINGS[b.defId];
      if (def && def.category === 'defense' && def.weapon && WEAPONS[def.weapon]?.targetsGround && dist(b.x, b.y, cx, cy) < 9) enemy += def.cost;
    }

    const retarget = (): boolean => {
      const t = this.pickTarget(world, { x: cx, y: cy }, s.kind === 'harass' ? (def) => !!def.refinery : undefined);
      if (t) {
        s.tx = t.x;
        s.ty = t.y;
        s.targetId = t.id;
        return true;
      }
      if (s.kind === 'harass') return false;
      const p = this.searchPoint(world, me, { x: cx, y: cy }, true);
      if (!p) return false;
      s.tx = p.x;
      s.ty = p.y;
      s.targetId = null;
      return true;
    };
    const goHome = (): void => {
      s.state = 'retreat';
      s.since = tick;
      s.lastOrder = tick;
      this.send(cmds, 'move', all, staging.x, staging.y);
    };

    if (s.state !== 'retreat' && s.state !== 'gather') {
      // Pull out only when clearly beaten (or clearly outnumbered on the approach): bailing out of an
      // even fight just feeds units to the pursuit. An all-in never turns back.
      const losing = strength < s.start * 0.45 && enemy > strength * 0.8;
      const outmatched = enemy > strength * 1.6;
      const harassBail = s.kind === 'harass' && (strength < s.start * 0.6 || enemy > strength * 1.3);
      if ((P.retreat && !this.allIn && (losing || outmatched)) || harassBail) {
        this.note(world, `${s.kind} retreats: strength ${strength}/${s.start} vs enemy ${enemy}`);
        this.enemyArmy = Math.max(this.enemyArmy, enemy);
        goHome();
        return;
      }
    }

    switch (s.state) {
      case 'gather': {
        if (s.lastOrder < s.since) {
          s.lastOrder = tick;
          this.send(cmds, 'attackMove', all, staging.x, staging.y);
        }
        let near = 0;
        for (const e of members) if (dist(e.x, e.y, staging.x, staging.y) < 8) near++;
        if (near >= members.length * 0.75 || tick - s.since > 25 * SEC) {
          s.state = 'advance';
          s.since = tick;
          s.lastOrder = -1e9;
        }
        break;
      }
      case 'advance': {
        if (s.targetId !== null && !this.seen.has(s.targetId) && !retarget()) {
          goHome();
          return;
        }
        const d = dist(cx, cy, s.tx, s.ty);
        if (d < 11) {
          s.state = 'assault';
          s.since = tick;
          s.lastOrder = -1e9;
          break;
        }
        if (tick - s.lastOrder < 3 * SEC) break;
        s.lastOrder = tick;
        // Keep together: when strung out, the head waits for the tail.
        let spread = 0;
        for (const e of members) spread += dist(e.x, e.y, cx, cy);
        spread /= members.length;
        if (members.length > 2 && spread > 4.5 + members.length * 0.2 && tick >= s.regroupUntil && d > 18) {
          s.regroupUntil = tick + 12 * SEC;
          const p = this.snap(world, cx, cy);
          this.send(cmds, 'attackMove', all, p.x, p.y);
          s.lastOrder = tick + 2 * SEC; // give them a moment
        } else {
          const ids: EntityId[] = [];
          for (const e of members) if (e.targetId === null || isIdle(e)) ids.push(e.id);
          this.send(cmds, 'attackMove', ids, s.tx, s.ty);
        }
        break;
      }
      case 'assault': {
        if (tick - s.lastOrder < 2 * SEC) break;
        s.lastOrder = tick;
        const focus = this.pickFocus(cs, s, cx, cy);
        if (focus) {
          const ids: EntityId[] = [];
          for (const e of members) {
            const u = unitInfo(e.defId);
            if (!u?.antiGround) continue;
            if (P.focusFire || s.kind === 'harass' || e.targetId === null || isIdle(e)) ids.push(e.id);
          }
          if (ids.length) cmds.push({ type: 'attack', player: this.player, ids, targetId: focus.id });
          // Escorts that cannot shoot ground stay with the group.
          const escorts = members.filter((e) => !unitInfo(e.defId)?.antiGround && isIdle(e)).map((e) => e.id);
          this.send(cmds, 'move', escorts, cx, cy);
        } else {
          const targetGone = s.targetId === null ? dist(cx, cy, s.tx, s.ty) < 6 : !this.seen.has(s.targetId);
          if (targetGone || tick - s.since > 60 * SEC) {
            if (!retarget()) {
              goHome();
              return;
            }
            s.state = 'advance';
            s.since = tick;
            s.lastOrder = -1e9;
          } else {
            const ids: EntityId[] = [];
            for (const e of members) if (e.targetId === null || isIdle(e)) ids.push(e.id);
            this.send(cmds, 'attackMove', ids, s.tx, s.ty);
          }
        }
        break;
      }
      case 'retreat': {
        if (dist(cx, cy, staging.x, staging.y) < 8 || tick - s.since > 40 * SEC) this.dissolve(s);
        else if (tick - s.lastOrder > 5 * SEC) {
          s.lastOrder = tick;
          this.send(cmds, 'move', all, staging.x, staging.y);
        }
        break;
      }
    }
  }

  /** What an assaulting squad should shoot right now (visible things only). */
  private pickFocus(cs: Census, s: Squad, cx: number, cy: number): Entity | null {
    let best: Entity | null = null;
    let bestScore = -Infinity;
    const hard = this.P.focusFire;
    for (const b of cs.enemyBuildings) {
      const def = BUILDINGS[b.defId];
      const d = dist(b.x, b.y, cx, cy);
      if (!def || d > 13) continue;
      let score = buildingPriority(def) * 2 - d;
      if (b.id === s.targetId) score += 6;
      // Turrets that are shooting at us go first on hard.
      if (hard && def.category === 'defense' && def.weapon && WEAPONS[def.weapon]?.targetsGround && d < defenseRange(def) + 2) score += 12;
      if (def.wall) score -= 40;
      if (s.kind === 'harass' && !def.refinery) score -= 30;
      score += (1 - b.hp / b.maxHp) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    for (const e of cs.enemies) {
      const def = UNITS[e.defId];
      const d = dist(e.x, e.y, cx, cy);
      if (!def || !def.harvester || def.movement === 'air' || d > 10) continue;
      const score = 24 - d + (s.kind === 'harass' ? 20 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  // ── aircraft ──

  private updateAir(world: World, cs: Census, threat: Threat | null, cmds: Command[]): void {
    if (cs.air.length === 0 || world.tick < this.nextAirAt) return;
    this.nextAirAt = world.tick + 3 * SEC;
    if (threat) return; // already sent with the defenders
    const home = this.home!;
    const ids = cs.air.map((e) => e.id);
    // Too few to strike, or the enemy is bristling with anti-air: stay home as a defence reserve.
    if (!this.allIn && (cs.air.length < Math.min(2, this.P.aircraftMax) || this.enemyAA >= 3)) {
      const far = cs.air.filter((e) => dist(e.x, e.y, home.x, home.y) > 10).map((e) => e.id);
      this.send(cmds, 'move', far, home.x, home.y);
      return;
    }
    // Known anti-air positions to stay away from.
    const aa: { x: number; y: number; r: number }[] = [];
    for (const s of this.seen.values()) {
      const def = BUILDINGS[s.defId];
      const w = def?.weapon ? WEAPONS[def.weapon] : undefined;
      if (w?.targetsAir) aa.push({ x: s.x, y: s.y, r: w.range + 1 });
    }
    const covered = (x: number, y: number): boolean => aa.some((a) => dist(a.x, a.y, x, y) < a.r);
    const c = this.centroid(world, ids);
    // Harvesters in the open are the best prey.
    let prey: Entity | null = null;
    let preyD = Infinity;
    for (const e of cs.enemies) {
      if (!UNITS[e.defId]?.harvester || covered(e.x, e.y)) continue;
      const d = dist(e.x, e.y, c.x, c.y);
      if (d < preyD) {
        preyD = d;
        prey = e;
      }
    }
    if (prey) {
      cmds.push({ type: 'attack', player: this.player, ids, targetId: prey.id });
      return;
    }
    let best: SeenBuilding | null = null;
    let bestScore = -Infinity;
    for (const s of this.seen.values()) {
      const def = BUILDINGS[s.defId];
      if (!def || def.wall || covered(s.x, s.y)) continue;
      const score = buildingPriority(def) * 3 - dist(s.x, s.y, c.x, c.y) * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) {
      const far = cs.air.filter((e) => isIdle(e) && dist(e.x, e.y, home.x, home.y) > 10).map((e) => e.id);
      this.send(cmds, 'move', far, home.x, home.y);
      return;
    }
    const ent = world.entities.get(best.id);
    const me = world.players[this.player];
    const visible = !!ent && (!world.setup.options.fog || me.visible[Math.floor(ent.y) * world.map.width + Math.floor(ent.x)] > 0);
    const free = cs.air.filter((e) => e.targetId === null || isIdle(e)).map((e) => e.id);
    if (visible && ent) {
      if (free.length) cmds.push({ type: 'attack', player: this.player, ids: free, targetId: ent.id });
    } else this.send(cmds, 'attackMove', free, best.x, best.y);
  }

  // ── support powers ──

  private usePowers(world: World, me: Player, cmds: Command[]): void {
    const tick = world.tick;
    if (tick < this.nextPowerAt || me.powers.length === 0) return;
    this.nextPowerAt = tick + 2 * SEC;
    for (const p of me.powers) {
      if (!p.ready) continue;
      const def = SUPPORT_POWERS[p.id];
      if (!def) continue;
      if (def.damage > 0) {
        // Best cluster of remembered enemy buildings.
        let best: SeenBuilding | null = null;
        let bestScore = 0;
        for (const a of this.seen.values()) {
          let score = 0;
          for (const b of this.seen.values()) {
            const bd = BUILDINGS[b.defId];
            if (!bd || dist(a.x, a.y, b.x, b.y) > def.radius) continue;
            score += bd.cost * (0.5 + buildingPriority(bd) / 10);
          }
          if (score > bestScore) {
            bestScore = score;
            best = a;
          }
        }
        if (best && bestScore >= 1500) cmds.push({ type: 'usePower', player: this.player, power: p.id, x: best.x, y: best.y });
      } else {
        // Recon: look where a wave is heading, else somewhere we have never seen.
        const wave = this.squads.find((s) => s.kind === 'wave');
        const at = wave ? { x: wave.tx, y: wave.ty } : this.searchPoint(world, me, this.home!, true);
        if (at) cmds.push({ type: 'usePower', player: this.player, power: p.id, x: at.x, y: at.y });
      }
    }
  }
}
