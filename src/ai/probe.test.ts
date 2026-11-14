// Exploratory match dump. Skipped unless AI_PROBE is set:
//   AI_PROBE="map,seed|from-to,diffA,diffB,ticks,factionA,factionB" npx vitest run src/ai/probe.test.ts
import { it } from 'vitest';
import type { Difficulty, FactionId } from '../core/types';
import { MAPS } from '../maps/index';
import { sim } from '../sim/index';
import { runMatch } from './match';

const spec = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AI_PROBE;

it.skipIf(!spec)(
  'probe',
  () => {
    const [mapId, seedS, da, db, ticksS, fa, fb] = (spec ?? '').split(',');
    const info = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
    const n = info.maxPlayers;
    const diffs = [da || 'normal', db || 'easy'] as Difficulty[];
    const facs = [(fa || 'helion') as FactionId, (fb || 'ferrum') as FactionId];
    const players = Array.from({ length: n }, (_, k) => ({ faction: facs[k % 2], difficulty: diffs[k % 2] }));
    const range = (seedS || '1').split('-').map(Number);
    const s0 = range[0];
    const s1 = range[1] ?? range[0];
    for (let seed = s0; seed <= s1; seed++) {
      const t0 = Date.now();
      const r = runMatch(sim, info, seed, players, Number(ticksS) || 30000);
      console.log(
        `map ${info.id} seed ${seed} ticks ${r.ticks} (${(r.ticks / 1200).toFixed(1)} min) winner ${r.winnerTeam} wall ${Date.now() - t0}ms think avg ${r.thinkMsAvg.toFixed(4)}ms max ${r.thinkMsMax.toFixed(2)}ms`,
      );
      if (s0 !== s1) {
        console.log('   ' + r.world.players.map((p, k) => `P${k} ${p.faction}/${p.difficulty}${p.defeated ? ' X' : ''} maxArmy ${r.maxArmyValue[k]} ore ${p.stats.oreHarvested} kills ${p.stats.kills} bLost ${p.stats.buildingsLost}`).join(' | '));
        continue;
      }
      for (let k = 0; k < n; k++) {
        const p = r.world.players[k];
        console.log(`P${k} ${p.faction}/${p.difficulty} defeated=${p.defeated} built: ${[...r.everBuilt[k]].join(',')}`);
        console.log(`   maxArmy ${r.maxArmyValue[k]} maxHarv ${r.maxHarvesters[k]} cmds ${JSON.stringify(r.commands[k])}`);
        console.log(`   stats ${JSON.stringify(p.stats)} deaths ${JSON.stringify(r.unitDeaths[k])}`);
        console.log('   ' + r.samples[k].map((s) => `${s.tick / 1200}m $${s.credits} b${s.buildings} h${s.harvesters} a${s.armyValue}`).join(' | '));
        console.log('   log: ' + r.logs[k].slice(0, 40).join('\n        '));
      }
    }
  },
  900000,
);
