// FROZEN CONTRACT — owned by the commander session. See CLAUDE.md.

/** mulberry32 step. Pure: returns the next state and a float in [0,1). */
export function rngNext(state: number): { state: number; value: number } {
  let s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** Convenience stateful generator for non-sim code (map generation, AI, visuals). */
export function makeRng(seed: number) {
  let state = seed | 0;
  const next = () => {
    const r = rngNext(state);
    state = r.state;
    return r.value;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}
