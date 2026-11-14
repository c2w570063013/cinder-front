// Skirmish AI entry point. See brain.ts for the controller; decide.ts / placement.ts for the
// pure decision logic; knowledge.ts for everything derived from src/data.
import type { CreateAi } from '../core/api';
import { Brain } from './brain';

export const createAi: CreateAi = (player, difficulty, seed, sim) => new Brain(player, difficulty, seed, sim);
