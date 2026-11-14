// A tiny scripted player for tests: drives the sim purely through Commands, like the UI / AI would.
import type { Command, World } from '../core/types';
import { BUILDINGS, FACTIONS, UNITS } from '../data';
import { sim } from './index';

export interface BotPlan {
  /** Structures in build order (duplicates allowed). */
  build: string[];
  /** Desired army: unit def id → count. */
  units: Record<string, number>;
  /** Tick from which the army attack-moves at the enemy (Infinity = never). */
  attackAt: number;
}

function findSpot(world: World, pid: number, defId: string, cx: number, cy: number): { tx: number; ty: number } | null {
  const fp = BUILDINGS[defId].footprint;
  let best: { tx: number; ty: number } | null = null;
  let bestD = Infinity;
  for (let dy = -14; dy <= 14; dy++) {
    for (let dx = -14; dx <= 14; dx++) {
      const tx = Math.floor(cx) + dx;
      const ty = Math.floor(cy) + dy;
      const d = Math.hypot(tx + fp.w / 2 - cx, ty + fp.h / 2 - cy);
      if (d >= bestD) continue;
      if (!sim.canPlaceBuilding(world, pid, defId, tx, ty).ok) continue;
      // keep a one-tile lane around every building so units can always get through
      let lane = true;
      for (let y = ty - 1; y <= ty + fp.h && lane; y++) {
        for (let x = tx - 1; x <= tx + fp.w && lane; x++) {
          if (!sim.isPassable(world, x, y, 'track') || world.map.ore[y * world.map.width + x] > 0) lane = false;
        }
      }
      if (!lane) continue;
      best = { tx, ty };
      bestD = d;
    }
  }
  return best;
}

export function botCommands(world: World, pid: number, plan: BotPlan): Command[] {
  const cmds: Command[] = [];
  const p = world.players[pid];
  if (p.defeated || world.winnerTeam !== null) return cmds;
  const fac = FACTIONS[p.faction];
  const t = world.tick;
  if (t === 2) {
    for (const e of world.entities.values()) if (e.owner === pid && e.defId === fac.baseVehicle) cmds.push({ type: 'deploy', player: pid, ids: [e.id] });
    return cmds;
  }
  if (t % 10 !== pid) return cmds;
  const mine = [...world.entities.values()].filter((e) => e.owner === pid);
  const yard = mine.find((e) => e.defId === fac.conyard);
  const count = (defId: string) => mine.filter((e) => e.defId === defId).length;
  const options = new Set(sim.getBuildOptions(world, pid).filter((o) => o.available).map((o) => o.defId));

  if (yard) {
    // one structure and one defence at a time; place whatever is ready
    let queued = false;
    for (const cat of ['structure', 'defense'] as const) {
      const q = p.queues[cat];
      if (q.ready) {
        const spot = findSpot(world, pid, q.items[0].defId, yard.x, yard.y);
        if (spot) cmds.push({ type: 'placeBuilding', player: pid, defId: q.items[0].defId, tx: spot.tx, ty: spot.ty });
      }
      if (q.items.length > 0) queued = true;
    }
    if (!queued) {
      const want = new Map<string, number>();
      for (const d of plan.build) {
        want.set(d, (want.get(d) ?? 0) + 1);
        if (count(d) < want.get(d)!) {
          if (options.has(d)) cmds.push({ type: 'produce', player: pid, defId: d });
          break;
        }
      }
    }
  }
  for (const [defId, n] of Object.entries(plan.units)) {
    const cat = UNITS[defId].category;
    if (p.queues[cat].items.length === 0 && count(defId) < n && options.has(defId)) {
      cmds.push({ type: 'produce', player: pid, defId });
    }
  }
  if (t >= plan.attackAt && t % 100 === pid) {
    const army = mine.filter((e) => e.kind === 'unit' && UNITS[e.defId].weapon).map((e) => e.id);
    let target: { x: number; y: number } | null = null;
    for (const e of world.entities.values()) {
      if (!sim.isEnemy(world, pid, e.owner)) continue;
      if (e.kind === 'building') {
        target = e;
        break;
      }
      target ??= e;
    }
    if (army.length > 0 && target) cmds.push({ type: 'attackMove', player: pid, ids: army, x: target.x, y: target.y });
  }
  return cmds;
}
