// Test helpers: hand-made worlds and a tiny fake SimApi, so AI logic can be tested without src/sim.
import type { BuildOption, PlacementCheck, SimApi } from '../core/api';
import { BUILD_ADJACENCY } from '../core/constants';
import { Terrain, type Command, type Entity, type FactionId, type GameMap, type Player, type ProductionQueue, type QueueCategory, type World } from '../core/types';
import { BUILDINGS, FACTIONS, UNITS, factionDefs } from '../data';

export function flatMap(size = 64): GameMap {
  return {
    id: 'test',
    name: 'test',
    width: size,
    height: size,
    terrain: new Uint8Array(size * size).fill(Terrain.Ground),
    ore: new Uint8Array(size * size),
    variant: new Uint8Array(size * size),
    starts: [
      { x: 12, y: 12 },
      { x: size - 13, y: size - 13 },
    ],
  };
}

const queue = (): ProductionQueue => ({ items: [], paused: false, ready: false });

export function makePlayer(id: number, faction: FactionId, n: number, credits = 10000): Player {
  return {
    id,
    name: `P${id}`,
    faction,
    color: '#fff',
    team: id,
    controller: 'ai',
    difficulty: 'normal',
    credits,
    powerProduced: 0,
    powerConsumed: 0,
    lowPower: false,
    hasRadar: false,
    queues: { structure: queue(), defense: queue(), infantry: queue(), vehicle: queue(), aircraft: queue() },
    powers: [],
    explored: new Uint8Array(n),
    visible: new Uint8Array(n),
    defeated: false,
    stats: { unitsBuilt: 0, unitsLost: 0, buildingsBuilt: 0, buildingsLost: 0, kills: 0, oreHarvested: 0, creditsSpent: 0 },
  };
}

export function makeWorld(factions: FactionId[] = ['helion', 'ferrum'], map: GameMap = flatMap(), fog = true): World {
  const n = map.width * map.height;
  const players = factions.map((f, i) => makePlayer(i, f, n));
  return {
    tick: 0,
    rngState: 1,
    setup: {
      map,
      seed: 1,
      players: factions.map((f, i) => ({ name: `P${i}`, faction: f, color: '#fff', team: i, controller: 'ai', difficulty: 'normal', startIndex: i })),
      startingCredits: 10000,
      options: { fog, shortGame: true, superweapons: true },
    },
    map,
    players,
    entities: new Map(),
    nextEntityId: 1,
    projectiles: [],
    events: [],
    winnerTeam: null,
  };
}

export function addEntity(world: World, defId: string, owner: number, x: number, y: number): Entity {
  const b = BUILDINGS[defId];
  const u = UNITS[defId];
  const hp = (b ?? u).hp;
  const e: Entity = {
    id: world.nextEntityId++,
    defId,
    kind: b ? 'building' : 'unit',
    owner,
    x,
    y,
    px: x,
    py: y,
    facing: 0,
    turretFacing: 0,
    altitude: 0,
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
    buildProgress: 1,
    rally: null,
    primary: false,
    repairing: false,
    powered: true,
  };
  world.entities.set(e.id, e);
  return e;
}

/** Mark a disc of tiles visible + explored for a player. */
export function reveal(world: World, player: number, x: number, y: number, r: number): void {
  const p = world.players[player];
  const w = world.map.width;
  for (let ty = Math.max(0, Math.floor(y - r)); ty <= Math.min(world.map.height - 1, Math.ceil(y + r)); ty++) {
    for (let tx = Math.max(0, Math.floor(x - r)); tx <= Math.min(w - 1, Math.ceil(x + r)); tx++) {
      if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= r) {
        p.visible[ty * w + tx] = 1;
        p.explored[ty * w + tx] = 1;
      }
    }
  }
}

function footprint(e: Entity): { x: number; y: number; w: number; h: number } {
  const fp = BUILDINGS[e.defId].footprint;
  return { x: Math.round(e.x - fp.w / 2), y: Math.round(e.y - fp.h / 2), w: fp.w, h: fp.h };
}

/**
 * A fake sim: placement/tech rules straight from the data, and a `step` that resolves production
 * instantly (enough to exercise build orders and placement, no movement or combat).
 */
export function fakeSim(): SimApi & { placed: string[]; deployAllowed: boolean } {
  const api = {
    placed: [] as string[],
    deployAllowed: true,
    createWorld(): World {
      throw new Error('fake sim cannot create worlds; use makeWorld');
    },
    hashWorld: (): number => 0,
    isEnemy: (world: World, a: number, b: number): boolean => world.players[a].team !== world.players[b].team,
    isPassable(world: World, tx: number, ty: number): boolean {
      const m = world.map;
      if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return false;
      const t = m.terrain[ty * m.width + tx];
      return t === Terrain.Ground || t === Terrain.Rough || t === Terrain.Road;
    },
    canPlaceBuilding(world: World, player: number, defId: string, tx: number, ty: number): PlacementCheck {
      const def = BUILDINGS[defId];
      const cells: PlacementCheck['cells'] = [];
      if (!def) return { ok: false, cells };
      const m = world.map;
      let ok = true;
      let adjacent = false;
      const own = [...world.entities.values()].filter((e) => e.kind === 'building');
      for (let y = ty; y < ty + def.footprint.h; y++) {
        for (let x = tx; x < tx + def.footprint.w; x++) {
          let c = x >= 0 && y >= 0 && x < m.width && y < m.height && m.terrain[y * m.width + x] === Terrain.Ground && m.ore[y * m.width + x] === 0;
          for (const b of own) {
            const f = footprint(b);
            if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) c = false;
          }
          cells.push({ tx: x, ty: y, ok: c });
          if (!c) ok = false;
        }
      }
      for (const b of own) {
        if (b.owner !== player) continue;
        const f = footprint(b);
        const gx = Math.max(tx - (f.x + f.w), f.x - (tx + def.footprint.w), 0);
        const gy = Math.max(ty - (f.y + f.h), f.y - (ty + def.footprint.h), 0);
        if (Math.max(gx, gy) <= BUILD_ADJACENCY) adjacent = true;
      }
      return { ok: ok && adjacent, cells };
    },
    getBuildOptions(world: World, player: number): BuildOption[] {
      const p = world.players[player];
      const have = new Set<string>();
      const producers = new Set<QueueCategory>();
      for (const e of world.entities.values()) {
        if (e.owner !== player || e.kind !== 'building' || e.buildProgress < 1) continue;
        have.add(e.defId);
        for (const c of BUILDINGS[e.defId].produces ?? []) producers.add(c);
      }
      return factionDefs(p.faction).map((d) => ({
        defId: d.id,
        category: d.category,
        available: (d.kind === 'unit' || d.buildable) && producers.has(d.category) && d.prereqs.every((r) => have.has(r)),
      }));
    },
    /** Instant-resolution step: everything queued completes; costs are charged in full. */
    step(world: World, commands: Command[]): void {
      world.tick++;
      world.events = [];
      for (const c of commands) {
        const p = world.players[c.player];
        if (c.type === 'deploy' && api.deployAllowed) {
          for (const id of c.ids) {
            const e = world.entities.get(id);
            const to = e && UNITS[e.defId]?.deploysTo;
            if (!e || !to) continue;
            world.entities.delete(id);
            addEntity(world, to, e.owner, Math.floor(e.x) + 0.5, Math.floor(e.y) + 0.5);
          }
        } else if (c.type === 'produce') {
          const def = BUILDINGS[c.defId] ?? UNITS[c.defId];
          if (!def || p.credits < def.cost) continue;
          if (def.kind === 'building') {
            const q = p.queues[def.category];
            if (q.items.length > 0) continue;
            p.credits -= def.cost;
            q.items.push({ defId: c.defId, progress: 1, paid: def.cost });
            q.ready = true;
          } else {
            p.credits -= def.cost;
            const home = [...world.entities.values()].find((e) => e.owner === c.player && e.kind === 'building');
            addEntity(world, c.defId, c.player, (home?.x ?? 10) + 4 + (world.nextEntityId % 5), (home?.y ?? 10) + 5);
          }
        } else if (c.type === 'placeBuilding') {
          const def = BUILDINGS[c.defId];
          const q = def && p.queues[def.category];
          if (!def || !q || !q.ready || q.items[0]?.defId !== c.defId) continue;
          if (!api.canPlaceBuilding(world, c.player, c.defId, c.tx, c.ty).ok) continue;
          q.items.shift();
          q.ready = false;
          addEntity(world, c.defId, c.player, c.tx + def.footprint.w / 2, c.ty + def.footprint.h / 2);
          api.placed.push(c.defId);
          if (def.freeUnit) addEntity(world, def.freeUnit, c.player, c.tx - 1.5, c.ty + 1.5);
        }
      }
      // Power bookkeeping the AI reads.
      for (const p of world.players) {
        p.powerProduced = 0;
        p.powerConsumed = 0;
      }
      for (const e of world.entities.values()) {
        if (e.kind !== 'building') continue;
        const pw = BUILDINGS[e.defId].power;
        if (pw > 0) world.players[e.owner].powerProduced += pw;
        else world.players[e.owner].powerConsumed -= pw;
      }
      for (const p of world.players) p.lowPower = p.powerConsumed > p.powerProduced;
    },
  };
  return api;
}

export const baseVehicleOf = (f: FactionId): string => FACTIONS[f].baseVehicle;
