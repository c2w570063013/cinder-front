// Test helpers (tests may reach into sim internals).
import type { Command, Entity, GameSetup, SimEvent, World } from '../core/types';
import { removeEntity, spawnBuilding, spawnUnit } from './entities';
import { sim } from './index';
import { getSim, type SimEntity } from './state';
import { makeMap, makeSetup } from './testmap';
import type { GameMap } from '../core/types';

export interface Scenario {
  world: World;
  /** All events emitted so far by `run`. */
  events: SimEvent[];
}

/**
 * A 2-player world (player 0 helion, player 1 ferrum) with only each side's base vehicle left,
 * parked at the map corners so shortGame doesn't end the match.
 */
export function scenario(map: GameMap = makeMap(40, 40, [{ x: 2, y: 2 }, { x: 37, y: 37 }]), opts: Partial<GameSetup['options']> = {}, credits = 10000): Scenario {
  const world = sim.createWorld(makeSetup(map, ['helion', 'ferrum'], opts, credits));
  const S = getSim(world);
  for (const e of [...world.entities.values()]) {
    if (!e.defId.endsWith('_crawler')) removeEntity(world, S, e as SimEntity);
  }
  return { world, events: [] };
}

export function unit(sc: Scenario, defId: string, owner: number, x: number, y: number): SimEntity {
  return spawnUnit(sc.world, getSim(sc.world), defId, owner, x, y, 0);
}

/** Operational building with its top-left tile at (tx,ty). */
export function building(sc: Scenario, defId: string, owner: number, tx: number, ty: number, progress = 1): SimEntity {
  return spawnBuilding(sc.world, getSim(sc.world), defId, owner, tx, ty, progress);
}

export function run(sc: Scenario, ticks: number, cmds: Command[] = []): void {
  for (let i = 0; i < ticks; i++) {
    sim.step(sc.world, i === 0 ? cmds : []);
    for (const ev of sc.world.events) sc.events.push(ev);
  }
}

/** Step until `pred` holds or `maxTicks` elapse; returns whether it held. */
export function runUntil(sc: Scenario, maxTicks: number, pred: () => boolean): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return true;
    sim.step(sc.world, []);
    for (const ev of sc.world.events) sc.events.push(ev);
  }
  return pred();
}

export function alive(sc: Scenario, e: Entity): boolean {
  return sc.world.entities.has(e.id);
}

export function has(sc: Scenario, type: SimEvent['type']): boolean {
  return sc.events.some((e) => e.type === type);
}

export function find(sc: Scenario, defId: string, owner?: number): SimEntity | undefined {
  for (const e of sc.world.entities.values()) if (e.defId === defId && (owner === undefined || e.owner === owner)) return e as SimEntity;
  return undefined;
}
