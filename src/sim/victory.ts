// Defeat / victory conditions.
import type { PlayerId, World } from '../core/types';
import { UNITS } from '../data';
import { destroyEntity } from './entities';
import type { SimEntity, SimState } from './state';

/** Mark a player defeated and destroy everything they still own. */
export function defeatPlayer(world: World, S: SimState, player: PlayerId): void {
  const p = world.players[player];
  if (!p || p.defeated) return;
  p.defeated = true;
  for (const q of Object.values(p.queues)) {
    q.items.length = 0;
    q.paused = false;
    q.ready = false;
  }
  p.powers.length = 0;
  world.events.push({ type: 'playerDefeated', player });
  const mine: SimEntity[] = [];
  for (const e of world.entities.values()) if (e.owner === player) mine.push(e as SimEntity);
  for (const e of mine) destroyEntity(world, S, e, null, 0);
}

/**
 * shortGame: a player is out when they have no buildings and no deployable base vehicle left.
 * Otherwise: when they have no entities at all. One team left → gameOver.
 */
export function checkVictory(world: World, S: SimState): void {
  if (world.winnerTeam !== null || !S.multiTeam) return;
  const short = world.setup.options.shortGame;
  const alive = world.players.map(() => false);
  for (const e of world.entities.values()) {
    if (alive[e.owner]) continue;
    if (!short || e.kind === 'building' || UNITS[e.defId]?.deploysTo) alive[e.owner] = true;
  }
  for (let i = 0; i < world.players.length; i++) {
    if (!world.players[i].defeated && !alive[i]) defeatPlayer(world, S, i);
  }
  const teams: number[] = [];
  for (const p of world.players) if (!p.defeated && !teams.includes(p.team)) teams.push(p.team);
  if (teams.length > 1) return;
  // -1 = everybody was eliminated on the same tick (draw)
  const winner = teams.length === 1 ? teams[0] : -1;
  world.winnerTeam = winner;
  world.events.push({ type: 'gameOver', winnerTeam: winner });
}
