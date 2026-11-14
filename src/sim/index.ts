// Deterministic simulation — public surface (see core/api.ts → SimApi).
import type { PlacementCheck, SimApi } from '../core/api';
import type { Command, GameSetup, MovementType, Player, PlayerId, World } from '../core/types';
import { BUILDINGS, FACTIONS, WEAPONS } from '../data';
import { acquire, shoot, updateProjectiles } from './combat';
import { regrowOre } from './economy';
import { checkPlacement, findFreeTile, spawnUnit } from './entities';
import { updateFog } from './fog';
import { hashWorld } from './hash';
import { updateMovement } from './move';
import { applyCommands, updateUnit } from './orders';
import { processPathQueue } from './path';
import { buildOptions, refreshPlayers, updateBuilding, updatePowers, updateProduction } from './production';
import { attachSim, getSim, isEnemyP, rebuildHash, type SimEntity, type SimProjectile } from './state';
import { checkVictory } from './victory';

function createWorld(setup: GameSetup): World {
  // The sim mutates ore, so the world gets its own copy and `setup.map` stays reusable.
  const map = { ...setup.map, ore: setup.map.ore.slice() };
  const n = map.width * map.height;
  const teamArrays = new Map<number, { visible: Uint8Array; explored: Uint8Array }>();
  const players: Player[] = setup.players.map((ps, id) => {
    let ta = teamArrays.get(ps.team);
    if (!ta) {
      ta = { visible: new Uint8Array(n), explored: new Uint8Array(n) };
      teamArrays.set(ps.team, ta);
    }
    return {
      id,
      name: ps.name,
      faction: ps.faction,
      color: ps.color,
      team: ps.team,
      controller: ps.controller,
      difficulty: ps.difficulty,
      credits: Math.max(0, Math.floor(setup.startingCredits)),
      powerProduced: 0,
      powerConsumed: 0,
      lowPower: false,
      hasRadar: false,
      queues: {
        structure: { items: [], paused: false, ready: false },
        defense: { items: [], paused: false, ready: false },
        infantry: { items: [], paused: false, ready: false },
        vehicle: { items: [], paused: false, ready: false },
        aircraft: { items: [], paused: false, ready: false },
      },
      powers: [],
      // teammates share the same fog arrays
      explored: ta.explored,
      visible: ta.visible,
      defeated: false,
      stats: { unitsBuilt: 0, unitsLost: 0, buildingsBuilt: 0, buildingsLost: 0, kills: 0, oreHarvested: 0, creditsSpent: 0 },
    };
  });
  const world: World = {
    tick: 0,
    rngState: setup.seed | 0,
    setup,
    map,
    players,
    entities: new Map(),
    nextEntityId: 1,
    projectiles: [],
    events: [],
    winnerTeam: null,
  };
  const S = attachSim(world);
  const taken = new Set<number>();
  for (let pi = 0; pi < players.length; pi++) {
    const ps = setup.players[pi];
    const fac = FACTIONS[ps.faction];
    const starts = map.starts;
    const st = starts.length > 0 ? starts[((ps.startIndex % starts.length) + starts.length) % starts.length] : { x: map.width / 2, y: map.height / 2 };
    const bt = findFreeTile(S, Math.floor(st.x) + 0.5, Math.floor(st.y) + 0.5, 12, taken);
    const bx = bt >= 0 ? (bt % S.w) + 0.5 : Math.floor(st.x) + 0.5;
    const by = bt >= 0 ? ((bt / S.w) | 0) + 0.5 : Math.floor(st.y) + 0.5;
    const face = Math.atan2(map.height / 2 - by, map.width / 2 - bx);
    spawnUnit(world, S, fac.baseVehicle, pi, bx, by, face);
    // keep the deploy footprint (3×3 around the base vehicle) clear
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) taken.add(((by | 0) + dy) * S.w + ((bx | 0) + dx));
    const m = fac.startingUnits.length;
    for (let k = 0; k < m; k++) {
      const ang = face + ((k - (m - 1) / 2) * Math.PI) / Math.max(3, m);
      const t = findFreeTile(S, bx + Math.cos(ang) * 3.6, by + Math.sin(ang) * 3.6, 10, taken);
      if (t < 0) continue;
      taken.add(t);
      spawnUnit(world, S, fac.startingUnits[k], pi, (t % S.w) + 0.5, ((t / S.w) | 0) + 0.5, face);
    }
  }
  world.events.length = 0;
  rebuildHash(world, S);
  refreshPlayers(world, S, false);
  updateFog(world, S, true);
  return world;
}

function step(world: World, commands: Command[]): void {
  const S = getSim(world);
  world.tick++;
  world.events = [];
  S.deaths = 0;
  for (const e of world.entities.values()) {
    e.px = e.x;
    e.py = e.y;
  }
  rebuildHash(world, S);
  refreshPlayers(world, S, true);
  applyCommands(world, S, commands);
  updateProduction(world, S);
  updatePowers(world, S);

  const list = S.list;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) continue;
    if (e.kind === 'unit') {
      updateUnit(world, S, e);
      continue;
    }
    const def = BUILDINGS[e.defId];
    updateBuilding(world, S, e, def);
    if (def.weapon && e.buildProgress >= 1) {
      if (e.powered || !def.needsPower) {
        const wd = WEAPONS[def.weapon];
        acquire(world, S, e, wd, undefined, 0);
        shoot(world, S, e, wd, undefined);
      } else {
        e.targetId = null;
      }
    }
  }

  processPathQueue(world, S);
  updateMovement(world, S);
  updateProjectiles(world, S);
  regrowOre(world, S);
  updateFog(world, S, false);
  checkVictory(world, S);

  if (S.deaths > 0) {
    const ents = world.entities;
    for (const ent of ents.values()) {
      const e = ent as SimEntity;
      if (e.targetId !== null && !ents.has(e.targetId)) e.targetId = null;
      if (e.tgt1 !== null && !ents.has(e.tgt1)) e.tgt1 = null;
    }
    for (const p of world.projectiles as SimProjectile[]) {
      if (p.targetId !== null && !ents.has(p.targetId)) p.targetId = null;
    }
  }
}

function canPlaceBuilding(world: World, player: PlayerId, defId: string, tx: number, ty: number): PlacementCheck {
  if (!BUILDINGS[defId] || !world.players[player]) return { ok: false, cells: [] };
  return checkPlacement(world, getSim(world), player, defId, tx, ty);
}

function isPassable(world: World, tx: number, ty: number, movement: MovementType): boolean {
  const S = getSim(world);
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  if (!(tx >= 0 && ty >= 0 && tx < S.w && ty < S.h)) return false;
  if (movement === 'air') return true;
  return S.blocked[ty * S.w + tx] === 0;
}

export const sim: SimApi = {
  createWorld,
  step,
  canPlaceBuilding,
  getBuildOptions: (world, player) => buildOptions(world, player),
  isPassable,
  isEnemy: (world, a, b) => isEnemyP(world, a, b),
  hashWorld,
};

