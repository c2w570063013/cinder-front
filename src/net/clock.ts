// Time source for the net module. Real timers in the game, a virtual clock in tests so message
// delivery, timeouts and pings can be pumped deterministically.

export interface Clock {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Run `fn` once after `ms`. Returns a cancel function. */
  after(ms: number, fn: () => void): () => void;
  /** Run `fn` every `ms`. Returns a cancel function. */
  every(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  after(ms, fn) {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
  every(ms, fn) {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
};

interface VTimer {
  at: number;
  seq: number;
  fn: () => void;
  every: number;
  dead: boolean;
}

/** Deterministic clock: nothing happens until `advance()` is called; timers fire in (time, creation) order. */
export class VirtualClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: VTimer[] = [];

  now(): number {
    return this.t;
  }

  after(ms: number, fn: () => void): () => void {
    const tm: VTimer = { at: this.t + Math.max(0, ms), seq: this.seq++, fn, every: 0, dead: false };
    this.timers.push(tm);
    return () => {
      tm.dead = true;
    };
  }

  every(ms: number, fn: () => void): () => void {
    const iv = Math.max(1, ms);
    const tm: VTimer = { at: this.t + iv, seq: this.seq++, fn, every: iv, dead: false };
    this.timers.push(tm);
    return () => {
      tm.dead = true;
    };
  }

  /** Advance time by `ms`, firing every timer that falls due (including ones scheduled meanwhile). */
  advance(ms: number): void {
    const end = this.t + Math.max(0, ms);
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.timers.length; i++) {
        const tm = this.timers[i];
        if (tm.dead || tm.at > end) continue;
        if (best < 0 || tm.at < this.timers[best].at || (tm.at === this.timers[best].at && tm.seq < this.timers[best].seq)) best = i;
      }
      if (best < 0) break;
      const tm = this.timers[best];
      if (tm.every > 0) {
        tm.at += tm.every;
        tm.seq = this.seq++;
      } else {
        tm.dead = true;
      }
      this.t = Math.max(this.t, tm.at - tm.every);
      tm.fn();
      if (this.timers.length > 64) this.timers = this.timers.filter((x) => !x.dead);
    }
    this.t = end;
    this.timers = this.timers.filter((x) => !x.dead);
  }
}
