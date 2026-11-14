// Pure audio logic — no WebAudio / DOM here so it can be unit-tested under node.
import type { Camera } from '../core/api';
import { TILE_H, TILE_W } from '../core/constants';
import type { PlayerId, ProjectileKind, World } from '../core/types';
import { BUILDINGS, UNITS, WEAPONS } from '../data';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ───────────────────────────── spatialisation ─────────────────────────────

export interface Spatial {
  /** 0..~1.3 linear gain. */
  gain: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Low-pass cutoff in Hz — distant sounds get duller. */
  cutoff: number;
  /** Normalised distance from the view centre: 1 = screen edge. */
  dist: number;
  audible: boolean;
}

/** Sounds are inaudible beyond this many half-screens from the view centre (for reach = 1). */
export const MAX_HEAR_DIST = 2.5;
export const MAX_PAN = 0.85;

/**
 * Screen-space spatialisation of a world event.
 * `reach` > 1 lets big sounds (explosions, superweapons) carry further off-screen;
 * `floor` is a minimum gain for sounds that should be heard map-wide.
 */
export function spatialize(
  ex: number,
  ey: number,
  cam: Camera,
  viewW: number,
  viewH: number,
  reach = 1,
  floor = 0,
): Spatial {
  const zoom = clamp(cam.zoom || 1, 0.25, 4);
  const wx = ex - cam.x;
  const wy = ey - cam.y;
  const sx = (wx - wy) * (TILE_W / 2) * zoom;
  const sy = (wx + wy) * (TILE_H / 2) * zoom;
  const nx = sx / Math.max(1, viewW / 2);
  const ny = sy / Math.max(1, viewH / 2);
  const dist = Math.max(Math.abs(nx), Math.abs(ny));
  const max = 1 + (MAX_HEAR_DIST - 1) * Math.max(0.2, reach);

  let g: number;
  if (dist <= 1) g = 1 - 0.3 * dist * dist;
  else if (dist < max) {
    const k = 1 - (dist - 1) / (max - 1);
    g = 0.7 * k * k;
  } else g = 0;

  // Zoomed out = the listener is further up; zoomed in = closer to the action.
  const zoomGain = clamp(0.55 + 0.45 * zoom, 0.7, 1.3);
  g = Math.max(g * zoomGain, floor);

  const far = clamp((dist - 1) / (max - 1), 0, 1);
  const cutoff = 20000 * Math.pow(900 / 20000, far);
  return { gain: g, pan: clamp(nx, -1, 1) * MAX_PAN, cutoff, dist, audible: g > 0.004 };
}

/** Fog check: can `viewer` currently see the tile containing (x, y)? */
export function isVisibleTo(world: World, viewer: PlayerId, x: number, y: number): boolean {
  if (!world.setup?.options?.fog) return true;
  const p = world.players[viewer] ?? world.players.find((q) => q.id === viewer);
  if (!p || !p.visible) return true;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const { width, height } = world.map;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false;
  return p.visible[ty * width + tx] > 0;
}

// ───────────────────────────── rate limiting ─────────────────────────────

interface LimiterSlot {
  allowed: number;
  seen: number;
  load: number;
}

/**
 * Per-key rate limiter with a leaky "load" counter. `hit` returns 0 when the sound must be
 * dropped, otherwise a gain scale in (0, 1] that shrinks as the same sound piles up
 * (≈ 1/sqrt(load)) so that N overlapping copies sum to roughly constant power.
 */
export class RateLimiter {
  private slots = new Map<string, LimiterSlot>();
  constructor(private tau = 0.5) {}

  hit(key: string, now: number, minInterval: number): number {
    let s = this.slots.get(key);
    if (!s) {
      s = { allowed: -Infinity, seen: now, load: 0 };
      this.slots.set(key, s);
    }
    const dt = Math.max(0, now - s.seen);
    s.load *= Math.exp(-dt / this.tau);
    s.seen = now;
    if (now - s.allowed < minInterval - 1e-9) return 0;
    s.allowed = now;
    s.load += 1;
    return 1 / Math.sqrt(Math.max(1, s.load));
  }

  /** Current decayed load for a key (for diagnostics). */
  loadOf(key: string, now: number): number {
    const s = this.slots.get(key);
    return s ? s.load * Math.exp(-Math.max(0, now - s.seen) / this.tau) : 0;
  }

  reset(): void {
    this.slots.clear();
  }
}

// ───────────────────────────── voice budget ─────────────────────────────

export interface VoiceSlot<H> {
  end: number;
  prio: number;
  handle: H;
}

/** Caps simultaneous voices; steals the least important / soonest-ending one when full. */
export class VoiceBudget<H> {
  readonly voices: VoiceSlot<H>[] = [];
  constructor(readonly max: number) {}

  /** Removes finished voices and returns their handles (so the caller can disconnect nodes). */
  prune(now: number): H[] {
    const done: H[] = [];
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].end <= now) {
        done.push(this.voices[i].handle);
        this.voices.splice(i, 1);
      }
    }
    return done;
  }

  /**
   * Ask for a slot. `ok: false` → drop the new sound. `stolen` → fade that handle out now.
   * Call `add` afterwards once the real end time is known.
   */
  request(now: number, prio: number): { ok: boolean; stolen: H | null } {
    if (this.voices.length < this.max) return { ok: true, stolen: null };
    let worst = 0;
    for (let i = 1; i < this.voices.length; i++) {
      const a = this.voices[i];
      const b = this.voices[worst];
      if (a.prio < b.prio || (a.prio === b.prio && a.end < b.end)) worst = i;
    }
    const w = this.voices[worst];
    if (w.prio > prio) return { ok: false, stolen: null };
    this.voices.splice(worst, 1);
    void now;
    return { ok: true, stolen: w.handle };
  }

  add(end: number, prio: number, handle: H): void {
    this.voices.push({ end, prio, handle });
  }

  get count(): number {
    return this.voices.length;
  }
}

// ───────────────────────────── announcer queue ─────────────────────────────

export interface AnnouncerLine {
  /** Dedup / cooldown key. */
  key: string;
  text: string;
  /** Higher = more important. Lines at or above INTERRUPT_PRIORITY cut off lower ones. */
  priority: number;
  /** Seconds a queued line stays relevant. */
  ttl: number;
  /** Seconds before the same key may be queued again. */
  cooldown: number;
}

export const INTERRUPT_PRIORITY = 4;

interface Queued {
  line: AnnouncerLine;
  at: number;
  seq: number;
}

export class AnnouncerQueue {
  private queue: Queued[] = [];
  private lastByKey = new Map<string, number>();
  private current: AnnouncerLine | null = null;
  private idleSince = -Infinity;
  private seq = 0;

  constructor(
    private maxQueue = 4,
    /** Global rate limit: minimum silence between two lines. */
    private minGap = 0.45,
  ) {}

  /** Returns true if the line was accepted (it may still go stale before being spoken). */
  push(line: AnnouncerLine, now: number): boolean {
    const last = this.lastByKey.get(line.key);
    if (last !== undefined && now - last < line.cooldown) return false;
    if (this.current?.key === line.key) return false;
    if (this.queue.some((q) => q.line.key === line.key)) return false;
    this.lastByKey.set(line.key, now);
    const item: Queued = { line, at: now, seq: this.seq++ };
    this.queue.push(item);
    if (this.queue.length > this.maxQueue) {
      // drop the least important; among equals the oldest
      let worst = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i];
        const b = this.queue[worst];
        if (a.line.priority < b.line.priority || (a.line.priority === b.line.priority && a.seq < b.seq)) worst = i;
      }
      const dropped = this.queue.splice(worst, 1)[0];
      if (dropped === item) return false;
    }
    return true;
  }

  private top(now: number): number {
    this.queue = this.queue.filter((q) => now - q.at <= q.line.ttl);
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      if (best < 0) best = i;
      else {
        const a = this.queue[i];
        const b = this.queue[best];
        if (a.line.priority > b.line.priority || (a.line.priority === b.line.priority && a.seq < b.seq)) best = i;
      }
    }
    return best;
  }

  /**
   * What should be spoken now, if anything. `interrupt` = cancel the current utterance first.
   * The returned line becomes the current one until `done` is called.
   */
  next(now: number): { line: AnnouncerLine; interrupt: boolean } | null {
    const i = this.top(now);
    if (i < 0) return null;
    const cand = this.queue[i].line;
    if (this.current) {
      if (cand.priority >= INTERRUPT_PRIORITY && cand.priority > this.current.priority) {
        this.queue.splice(i, 1);
        this.current = cand;
        return { line: cand, interrupt: true };
      }
      return null;
    }
    if (now - this.idleSince < this.minGap) return null;
    this.queue.splice(i, 1);
    this.current = cand;
    return { line: cand, interrupt: false };
  }

  /** The current utterance finished (or failed). */
  done(now: number): void {
    this.current = null;
    this.idleSince = now;
  }

  get speaking(): AnnouncerLine | null {
    return this.current;
  }
  get pending(): number {
    return this.queue.length;
  }
  clear(): void {
    this.queue.length = 0;
    this.current = null;
  }
}

export interface VoiceInfo {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

/** Index of the best Taiwanese-Mandarin voice, or -1 (→ the announcer stays silent). */
export function pickVoice(voices: readonly VoiceInfo[]): number {
  let best = -1;
  let bestScore = 0;
  voices.forEach((v, i) => {
    const lang = (v.lang || '').toLowerCase().replace(/_/g, '-');
    let score = 0;
    if (lang === 'zh-tw' || lang === 'zh-hant-tw' || lang === 'cmn-hant-tw') score = 100;
    else return;
    if (v.localService) score += 5;
    if (/premium|enhanced|高音質|優化/i.test(v.name)) score += 10;
    // macOS ships a set of low-fidelity multi-language character voices; prefer a natural one
    if (/^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i.test(v.name)) score -= 30;
    if (v.default) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// ───────────────────────────── adaptive music heat ─────────────────────────────

/** Tracks how much fighting the viewer is involved in; decides calm ↔ battle music. */
export class CombatHeat {
  heat = 0;
  inBattle = false;
  private last = 0;
  private battleSince = -Infinity;

  constructor(
    private halfLife = 6,
    private enter = 5,
    private exit = 1,
    private minBattle = 20,
  ) {}

  add(amount: number, now: number): void {
    this.decay(now);
    this.heat = Math.min(30, this.heat + amount);
  }

  private decay(now: number): void {
    const dt = Math.max(0, now - this.last);
    this.heat *= Math.pow(0.5, dt / this.halfLife);
    this.last = now;
  }

  update(now: number): boolean {
    this.decay(now);
    if (!this.inBattle && this.heat >= this.enter) {
      this.inBattle = true;
      this.battleSince = now;
    } else if (this.inBattle && this.heat < this.exit && now - this.battleSince >= this.minBattle) {
      this.inBattle = false;
    }
    return this.inBattle;
  }

  reset(): void {
    this.heat = 0;
    this.inBattle = false;
    this.battleSince = -Infinity;
  }
}

// ───────────────────────────── data-derived sound parameters ─────────────────────────────

export interface WeaponProfile {
  kind: ProjectileKind;
  /** Helion = clean / bright, Ferrum = gritty / heavy. */
  helion: boolean;
  /** 0..1 perceived weight, from damage. */
  power: number;
  warhead: string;
  splash: number;
  damage: number;
  projectileSpeed: number;
}

export function weaponProfile(weaponId: string, kind: ProjectileKind): WeaponProfile {
  const w = WEAPONS[weaponId];
  const damage = w?.damage ?? 30;
  return {
    kind: w?.projectile ?? kind,
    helion: weaponId.startsWith('h_'),
    power: Math.pow(clamp((damage - 8) / 150, 0, 1), 0.6),
    warhead: w?.warhead ?? 'bullet',
    splash: w?.splash ?? 0,
    damage,
    projectileSpeed: w?.projectileSpeed ?? 10,
  };
}

/** Explosion size for an impact: 0.2 (pop) .. ~1.6 (bomb). */
export function impactSize(weaponId: string, splash: number): number {
  const dmg = WEAPONS[weaponId]?.damage ?? 30;
  return clamp(0.22 + splash * 0.45 + dmg / 320, 0.2, 1.6);
}

export type DeathClass = 'infantry' | 'vehicle' | 'aircraft' | 'building' | 'wall';

/** What kind of death sound, and how big (0.25 .. 1.9), from the def's hp / footprint. */
export function deathProfile(defId: string): { cls: DeathClass; size: number; helion: boolean } {
  const helion = defId.startsWith('h_');
  const u = UNITS[defId];
  if (u) {
    if (u.category === 'infantry') return { cls: 'infantry', size: 0.25, helion };
    const size = clamp(0.55 + u.hp / 1400, 0.6, 1.3);
    return { cls: u.category === 'aircraft' ? 'aircraft' : 'vehicle', size, helion };
  }
  const b = BUILDINGS[defId];
  if (b) {
    if (b.wall) return { cls: 'wall', size: 0.4, helion };
    const area = b.footprint.w * b.footprint.h;
    return { cls: 'building', size: clamp(0.85 + b.hp / 2400 + area / 18, 1, 1.9), helion };
  }
  return { cls: 'vehicle', size: 0.8, helion };
}

export type AckClass = 'infantry' | 'vehicle' | 'aircraft' | 'building';

export function ackProfile(defId: string): { cls: AckClass; helion: boolean; seed: number } {
  const u = UNITS[defId];
  const cls: AckClass = u ? u.category : 'building';
  let h = 2166136261;
  for (let i = 0; i < defId.length; i++) h = Math.imul(h ^ defId.charCodeAt(i), 16777619);
  return { cls, helion: defId.startsWith('h_'), seed: h >>> 0 };
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
