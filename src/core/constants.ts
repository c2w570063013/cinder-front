// FROZEN CONTRACT — owned by the commander session. See CLAUDE.md.

/** Simulation runs at a fixed rate; rendering interpolates between ticks. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/** Isometric diamond tile size in screen pixels at zoom 1. */
export const TILE_W = 64;
export const TILE_H = 32;

/** One unit of `GameMap.ore[i]` is worth this many credits when refined. */
export const ORE_UNIT_VALUE = 25;
/** Max ore units a single tile can hold. */
export const ORE_TILE_MAX = 12;

/** Fraction of cost refunded when a building is sold (scaled by hp ratio). */
export const SELL_REFUND = 0.5;
/** New buildings must be placed within this many tiles (edge-to-edge) of an existing own building. */
export const BUILD_ADJACENCY = 3;
/** Production speed multiplier while the owner is in low power. */
export const LOW_POWER_BUILD_FACTOR = 0.5;
/** Max queued items per unit production category. */
export const MAX_QUEUE = 20;

/** Converts seconds (as used in data defs) to whole ticks. */
export const secToTicks = (s: number): number => Math.max(1, Math.round(s * TICK_RATE));
