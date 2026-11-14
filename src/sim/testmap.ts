// Small hand-built maps for sim tests (no dependency on src/maps).
import { Terrain } from '../core/types';
import type { FactionId, GameMap, GameSetup, TerrainId } from '../core/types';

export function makeMap(w: number, h: number, starts: { x: number; y: number }[] = [{ x: 8, y: 8 }, { x: w - 9, y: h - 9 }]): GameMap {
  return { id: 'test', name: 'test', width: w, height: h, terrain: new Uint8Array(w * h), ore: new Uint8Array(w * h), variant: new Uint8Array(w * h), starts };
}

export function fillRect(map: GameMap, x0: number, y0: number, x1: number, y1: number, t: TerrainId = Terrain.Rock): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.terrain[y * map.width + x] = t;
}

export function oreRect(map: GameMap, x0: number, y0: number, x1: number, y1: number, amount = 12): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.ore[y * map.width + x] = amount;
}

export function makeSetup(map: GameMap, factions: FactionId[] = ['helion', 'ferrum'], opts: Partial<GameSetup['options']> = {}, credits = 10000): GameSetup {
  return {
    map,
    seed: 12345,
    startingCredits: credits,
    options: { fog: true, shortGame: true, superweapons: true, ...opts },
    players: factions.map((faction, i) => ({ name: `P${i}`, faction, color: '#ffffff', team: i, controller: 'human' as const, difficulty: 'normal' as const, startIndex: i })),
  };
}
