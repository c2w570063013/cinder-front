// Synthesised sound effects. Every recipe is original and built from oscillators, noise and filters.
// `r` in params is a small random pitch factor (≈ 0.94..1.06) supplied by the caller.
import type { SupportPowerId } from '../core/types';
import type { Engine, Recipe } from './engine';
import { clamp, midiToHz } from './logic';

type E = Engine;

// ───────────────────────────── small building blocks ─────────────────────────────

/** Short filtered noise burst. */
function burst(e: E, out: AudioNode, t: number, kind: 'white' | 'pink' | 'brown', type: BiquadFilterType, freq: number, q: number, peak: number, a: number, d: number): void {
  const g = e.gain(out);
  e.ad(g.gain, t, peak, a, d);
  const f = e.filter(type, freq, q, g);
  e.noise(kind, t, t + a + d, f);
}

/** Pitched blip with an optional sweep. */
function tone(e: E, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, sweepDur: number, peak: number, a: number, d: number): OscillatorNode {
  const g = e.gain(out);
  e.ad(g.gain, t, peak, a, d);
  const o = e.osc(type, f0, t, t + a + d, g);
  if (f1 !== f0) e.sweep(o.frequency, t, f0, f1, sweepDur);
  return o;
}

/** Inharmonic struck-metal partials. */
function clang(e: E, out: AudioNode, t: number, base: number, peak: number, d: number): void {
  const ratios = [1, 1.483, 2.214, 2.89];
  for (let i = 0; i < ratios.length; i++) {
    tone(e, out, t, i === 0 ? 'triangle' : 'sine', base * ratios[i], base * ratios[i], 0, peak / (1 + i * 0.7), 0.001, d * (1 - i * 0.15));
  }
  burst(e, out, t, 'white', 'bandpass', base * 3.1, 2, peak * 0.8, 0.0005, 0.02);
}

/** A soft bell: fundamental + quiet inharmonic overtone. */
function bell(e: E, out: AudioNode, t: number, f: number, peak: number, d: number): void {
  tone(e, out, t, 'sine', f, f, 0, peak, 0.003, d);
  tone(e, out, t, 'sine', f * 2.76, f * 2.76, 0, peak * 0.22, 0.002, d * 0.35);
  tone(e, out, t, 'triangle', f * 2, f * 2, 0, peak * 0.12, 0.003, d * 0.6);
}

// ───────────────────────────── weapons: firing ─────────────────────────────

export interface FireP {
  power: number;
  helion: boolean;
  r: number;
  warhead?: string;
  /** bomb: seconds of fall. */
  fall?: number;
}

/** Small arms — tracer kinds. Helion: tight, bright snap. Ferrum: gritty, lower chug. */
export const fireTracer: Recipe<FireP> = (e, out, t, p) => {
  const d = 0.07 + 0.08 * p.power;
  const band = (p.helion ? 3400 : 1650) * (1 - 0.4 * p.power) * p.r;
  burst(e, out, t, 'white', 'bandpass', band, p.helion ? 1.1 : 0.7, 0.55 + 0.3 * p.power, 0.0008, d);
  if (p.helion) tone(e, out, t, 'triangle', 980 * p.r, 240 * p.r, 0.045, 0.3, 0.0008, d * 0.8);
  else tone(e, out, t, 'square', 300 * p.r, 85 * p.r, 0.06, 0.22, 0.0008, d);
  if (p.warhead === 'ap') tone(e, out, t, 'sine', 170 * p.r, 60, 0.07, 0.55, 0.001, 0.11);
  return d + 0.03;
};

/** Cannons — shell kinds. Scales from a light tank gun to a siege battery. */
export const fireShell: Recipe<FireP> = (e, out, t, p) => {
  const d = (p.helion ? 0.3 : 0.38) + 0.5 * p.power;
  // chest thump
  tone(e, out, t, 'sine', (150 - 50 * p.power) * p.r, 36, 0.16 + 0.2 * p.power, 0.95, 0.002, d);
  // muzzle blast
  const g = e.gain(out);
  e.ad(g.gain, t, 0.7, 0.002, d * 0.85);
  const lp = e.filter('lowpass', 5000, 0.6, g);
  e.sweep(lp.frequency, t, (5200 - 1600 * p.power) * p.r, 280, d * 0.75);
  const sh = e.shaper(p.helion ? 0.3 : 0.7, lp);
  e.noise('pink', t, t + d, e.gain(sh, 1.6));
  burst(e, out, t, 'white', 'highpass', 2200, 0.5, 0.45, 0.0005, 0.035);
  if (p.helion) {
    // clean breech ring
    tone(e, out, t, 'triangle', 1250 * p.r, 1250 * p.r, 0, 0.07, 0.001, 0.22);
    tone(e, out, t, 'sine', 1873 * p.r, 1873 * p.r, 0, 0.05, 0.001, 0.16);
  } else {
    // extra sub + diesel grit
    tone(e, out, t, 'sine', 58, 30, d, 0.5, 0.004, d * 1.25);
    const gg = e.gain(out);
    e.ad(gg.gain, t, 0.2, 0.002, 0.2);
    e.osc('square', 68 * p.r, t, t + 0.22, e.filter('lowpass', 420, 0.7, gg));
    return d * 1.25 + 0.05;
  }
  return d + 0.05;
};

/** Railgun — a dry supersonic crack, a falling zap and a ringing capacitor tail. */
export const fireBeam: Recipe<FireP> = (e, out, t, p) => {
  burst(e, out, t, 'white', 'highpass', 2600, 0.5, 0.95, 0.0004, 0.06);
  tone(e, out, t, 'sawtooth', 7200 * p.r, 170, 0.15, 0.4, 0.0008, 0.2);
  tone(e, out, t, 'sine', 230 * p.r, 48, 0.12, 0.7, 0.001, 0.22);
  tone(e, out, t + 0.01, 'sine', 1480 * p.r, 1480 * p.r, 0, 0.11, 0.004, 0.75);
  tone(e, out, t + 0.01, 'sine', 2227 * p.r, 2227 * p.r, 0, 0.07, 0.004, 0.5);
  // electrical fizz
  burst(e, out, t + 0.03, 'white', 'bandpass', 5200, 3, 0.14, 0.01, 0.3);
  return 0.8;
};

/** Lobbed rounds — heavy howitzer boom vs. hollow grenade-launcher pop. */
export const fireArc: Recipe<FireP> = (e, out, t, p) => {
  if (p.power > 0.6) {
    tone(e, out, t, 'sine', 96 * p.r, 31, 0.4, 1.0, 0.003, 0.95);
    const g = e.gain(out);
    e.ad(g.gain, t, 0.6, 0.003, 0.7);
    const lp = e.filter('lowpass', 1300, 0.6, g);
    e.sweep(lp.frequency, t, 1300 * p.r, 140, 0.65);
    e.noise('pink', t, t + 0.75, e.shaper(0.5, lp));
    burst(e, out, t, 'brown', 'lowpass', 300, 0.5, 0.6, 0.03, 1.0);
    burst(e, out, t, 'white', 'highpass', 1800, 0.5, 0.3, 0.0005, 0.04);
    return 1.1;
  }
  tone(e, out, t, 'sine', 430 * p.r, 135, 0.07, 0.6, 0.001, 0.12);
  burst(e, out, t, 'white', 'bandpass', 720 * p.r, 3, 0.5, 0.001, 0.08);
  return 0.17;
};

/** Missiles — ignition tick then a rising whoosh. AA missiles are thin and fast, rockets heavy. */
export const fireMissile: Recipe<FireP> = (e, out, t, p) => {
  const flak = p.warhead === 'flak';
  const d = flak ? 0.42 : 0.55 + 0.3 * p.power;
  burst(e, out, t, 'white', 'highpass', 3000, 0.5, 0.3, 0.0008, 0.03);
  const g = e.gain(out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.045);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  const bp = e.filter('bandpass', 600, 1.3, g);
  if (flak) e.sweep(bp.frequency, t, 900 * p.r, 4400 * p.r, d * 0.8);
  else e.sweep(bp.frequency, t, 340 * p.r, 2300 * p.r, d * 0.85);
  e.noise('white', t, t + d, e.gain(bp, 2.2));
  if (!flak) {
    const rg = e.gain(out);
    e.ad(rg.gain, t, 0.22, 0.02, d * 0.8);
    const o = e.osc('sawtooth', 62 * p.r, t, t + d, e.filter('lowpass', 320, 0.7, rg));
    e.sweep(o.frequency, t, 62 * p.r, 96 * p.r, d);
  }
  if (p.helion) tone(e, out, t + 0.02, 'sine', 1750 * p.r, 2700 * p.r, 0.18, 0.05, 0.01, 0.2);
  return d + 0.03;
};

/** Flamethrower — overlapping roar segments with a fluttering gain. */
export const fireFlame: Recipe<FireP> = (e, out, t, p) => {
  const d = 0.4;
  const g = e.gain(out);
  const pk = 0.3 + 0.16 * p.power;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pk, t + 0.07);
  g.gain.setValueAtTime(pk, t + 0.2);
  g.gain.linearRampToValueAtTime(0, t + d);
  const lp = e.filter('lowpass', (700 + 500 * p.power) * p.r, 0.6, g);
  e.noise('brown', t, t + d, e.gain(lp, 2.4));
  const hiss = e.filter('bandpass', 2600 * p.r, 0.7, g);
  e.noise('white', t, t + d, e.gain(hiss, 0.22));
  // flutter: LFO → roar gain
  const depth = e.gain(g.gain, pk * 0.35);
  e.osc('sine', e.vary(19, 0.2), t, t + d, depth);
  return d;
};

/** Flak gun — a dry "pom". The airburst itself is the impact sound. */
export const fireFlak: Recipe<FireP> = (e, out, t, p) => {
  tone(e, out, t, 'sine', 270 * p.r, 88, 0.06, 0.65, 0.001, 0.1);
  burst(e, out, t, 'white', 'bandpass', 1150 * p.r, 1, 0.5, 0.0008, 0.07);
  burst(e, out, t, 'white', 'highpass', 4000, 0.5, 0.2, 0.0005, 0.02);
  return 0.13;
};

/** Bomb release — a falling whistle that lasts as long as the drop. */
export const fireBomb: Recipe<FireP> = (e, out, t, p) => {
  const d = clamp(p.fall ?? 0.5, 0.25, 1.2);
  const g = e.gain(out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.13, t + d * 0.75);
  g.gain.linearRampToValueAtTime(0, t + d);
  const o = e.osc('sine', 2100, t, t + d, g);
  e.sweep(o.frequency, t, 2100 * p.r, 680 * p.r, d);
  const vib = e.gain(o.frequency, 28);
  e.osc('sine', 9, t, t + d, vib);
  burst(e, out, t, 'white', 'bandpass', 3000, 2, 0.05, d * 0.5, d * 0.5);
  return d;
};

// ───────────────────────────── impacts & explosions ─────────────────────────────

export interface ImpactP {
  r: number;
}

/** Bullet strike — tick, sometimes a ricochet ping. */
export const impactTick: Recipe<ImpactP> = (e, out, t, p) => {
  burst(e, out, t, 'white', 'highpass', 4200 * p.r, 0.6, 0.3, 0.0004, 0.025);
  if (e.rng.next() < 0.3) {
    const f = e.vary(3000, 0.25);
    tone(e, out, t + 0.005, 'sine', f, f * 0.45, 0.09, 0.12, 0.001, 0.1);
  }
  return 0.12;
};

/** Energy beam strike — sizzle and a short thump. */
export const impactBeam: Recipe<ImpactP> = (e, out, t, p) => {
  burst(e, out, t, 'white', 'bandpass', 3800 * p.r, 2, 0.45, 0.001, 0.18);
  tone(e, out, t, 'sawtooth', 900 * p.r, 120, 0.12, 0.25, 0.001, 0.14);
  tone(e, out, t, 'sine', 125, 44, 0.15, 0.6, 0.002, 0.22);
  return 0.26;
};

/** Flak airburst — a cluster of dry pops. */
export const impactFlak: Recipe<ImpactP & { size: number }> = (e, out, t, p) => {
  const n = 2 + Math.floor(e.rng.next() * 2);
  for (let i = 0; i < n; i++) {
    const tt = t + i * e.vary(0.045, 0.4);
    burst(e, out, tt, 'white', 'bandpass', e.vary(1250, 0.3) * p.r, 1.2, 0.5 * p.size, 0.0006, 0.07);
    tone(e, out, tt, 'sine', 210 * p.r, 80, 0.05, 0.35 * p.size, 0.001, 0.09);
  }
  return 0.3;
};

export interface BoomP {
  size: number;
  r: number;
  metal?: boolean;
  debris?: boolean;
}

/** General explosion; size 0.2 (pop) … 2 (building). */
export const explosion: Recipe<BoomP> = (e, out, t, p) => {
  const s = clamp(p.size, 0.15, 2.2);
  const d = 0.28 + 0.75 * s;
  let total = d;
  tone(e, out, t, 'sine', (112 - 30 * Math.min(s, 1.5)) * p.r, 27, 0.14 + 0.2 * s, Math.min(1, 0.55 + 0.4 * s), 0.002, d);
  const g = e.gain(out);
  e.ad(g.gain, t, 0.5 + 0.25 * Math.min(s, 1.5), 0.003, d * 0.9);
  const lp = e.filter('lowpass', 4500, 0.5, g);
  e.sweep(lp.frequency, t, 4600 * p.r, 170, d * 0.7);
  e.noise('pink', t, t + d, e.gain(e.shaper(0.5, lp), 1.8));
  if (s > 0.5) burst(e, out, t, 'white', 'highpass', 1800, 0.5, 0.42, 0.0004, 0.05);
  if (s > 0.9) {
    burst(e, out, t + 0.02, 'brown', 'lowpass', 190, 0.5, 0.6, 0.05, d * 1.6);
    total = d * 1.6 + 0.08;
  }
  if (p.metal) clang(e, out, t + 0.015, e.vary(440, 0.15), 0.13, 0.32);
  if (p.debris || s > 1.15) {
    const n = 4 + Math.floor(s * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + 0.1 + e.rng.next() * d * 1.1;
      burst(e, out, tt, 'white', 'bandpass', e.vary(3000, 0.55), 4, 0.13 * e.rng.next() + 0.03, 0.001, e.vary(0.05, 0.4));
    }
    total = Math.max(total, d * 1.25 + 0.15);
  }
  return total;
};

/** Infantry down — a soft thud, no voice. */
export const infantryDown: Recipe<ImpactP> = (e, out, t, p) => {
  tone(e, out, t, 'sine', 175 * p.r, 58, 0.1, 0.5, 0.002, 0.16);
  burst(e, out, t, 'pink', 'lowpass', 900 * p.r, 0.6, 0.35, 0.002, 0.12);
  return 0.2;
};

/** Aircraft down — explosion with a falling engine whine. */
export const aircraftDown: Recipe<BoomP> = (e, out, t, p) => {
  const d = explosion(e, out, t, { ...p, metal: true });
  const g = e.gain(out);
  e.ad(g.gain, t, 0.2, 0.02, 0.75);
  const o = e.osc('sawtooth', 900, t, t + 0.8, e.filter('lowpass', 2000, 0.7, g));
  e.sweep(o.frequency, t, 920 * p.r, 170, 0.75);
  return Math.max(d, 0.85);
};

/** Building destroyed — big blast, secondary booms and a rumbling collapse. */
export const buildingCollapse: Recipe<BoomP> = (e, out, t, p) => {
  explosion(e, out, t, { ...p, debris: true });
  tone(e, out, t + 0.24, 'sine', 84 * p.r, 30, 0.2, 0.6, 0.003, 0.5);
  tone(e, out, t + 0.52, 'sine', 70 * p.r, 28, 0.22, 0.5, 0.003, 0.6);
  // collapse rumble with an irregular envelope
  const len = 1.5 + 0.4 * p.size;
  const g = e.gain(out);
  const n = 28;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    curve[i] = i === 0 || i === n - 1 ? 0 : (0.25 + 0.75 * e.rng.next()) * Math.pow(1 - k, 1.3) * 0.7;
  }
  g.gain.setValueAtTime(0, t);
  g.gain.setValueCurveAtTime(curve, t + 0.12, len);
  const lp = e.filter('lowpass', 300, 0.6, g);
  e.noise('brown', t + 0.1, t + 0.15 + len, e.gain(lp, 2.5));
  return 0.2 + len;
};

/** Wall segment crumbling. */
export const wallCrumble: Recipe<ImpactP> = (e, out, t, p) => {
  tone(e, out, t, 'sine', 130 * p.r, 45, 0.12, 0.5, 0.002, 0.2);
  burst(e, out, t, 'pink', 'lowpass', 1400, 0.6, 0.45, 0.002, 0.25);
  for (let i = 0; i < 4; i++) burst(e, out, t + 0.05 + e.rng.next() * 0.25, 'white', 'bandpass', e.vary(2200, 0.4), 4, 0.1, 0.001, 0.04);
  return 0.4;
};

// ───────────────────────────── base events ─────────────────────────────

export interface BaseP {
  helion: boolean;
  r: number;
}

export const buildingPlaced: Recipe<BaseP> = (e, out, t, p) => {
  clang(e, out, t, (p.helion ? 620 : 410) * p.r, 0.16, 0.2);
  clang(e, out, t + 0.14, (p.helion ? 560 : 370) * p.r, 0.13, 0.25);
  const g = e.gain(out);
  e.trap(g.gain, t + 0.05, 0.14, 0.05, 0.42, 0.1);
  const o = e.osc(p.helion ? 'triangle' : 'sawtooth', 100, t + 0.05, t + 0.5, e.filter('lowpass', p.helion ? 1600 : 900, 0.8, g));
  e.sweep(o.frequency, t + 0.05, p.helion ? 180 : 90, p.helion ? 360 : 180, 0.4);
  tone(e, out, t + 0.42, 'sine', 120, 50, 0.1, 0.45, 0.002, 0.16);
  return 0.62;
};

export const buildingComplete: Recipe<BaseP> = (e, out, t, p) => {
  if (p.helion) {
    [74, 81, 86].forEach((m, i) => bell(e, out, t + i * 0.09, midiToHz(m), 0.2, 0.55));
    return 0.85;
  }
  [57, 64, 69].forEach((m, i) => {
    const g = e.gain(out);
    e.ad(g.gain, t + i * 0.1, 0.2, 0.008, 0.4);
    const lp = e.filter('lowpass', 1900, 1, g);
    e.osc('sawtooth', midiToHz(m), t + i * 0.1, t + i * 0.1 + 0.45, lp);
    e.osc('square', midiToHz(m) * 0.5, t + i * 0.1, t + i * 0.1 + 0.45, e.gain(lp, 0.4));
  });
  clang(e, out, t + 0.3, 520, 0.1, 0.3);
  return 0.85;
};

export const buildingSold: Recipe<BaseP> = (e, out, t, p) => {
  tone(e, out, t, 'triangle', 660 * p.r, 215, 0.3, 0.26, 0.01, 0.35);
  burst(e, out, t, 'pink', 'lowpass', 1200, 0.6, 0.2, 0.01, 0.3);
  [2400, 3000, 3600].forEach((f, i) => tone(e, out, t + 0.2 + i * 0.055, 'sine', f, f, 0, 0.1, 0.001, 0.05));
  return 0.5;
};

export const buildingCaptured: Recipe<{ gained: boolean; r: number }> = (e, out, t, p) => {
  const seq = p.gained ? [72, 79, 84] : [79, 72, 67];
  seq.forEach((m, i) => {
    const g = e.gain(out);
    e.ad(g.gain, t + i * 0.11, 0.2, 0.004, 0.14);
    e.osc('square', midiToHz(m), t + i * 0.11, t + i * 0.11 + 0.16, e.filter('lowpass', 2200, 0.7, g));
  });
  return 0.5;
};

export const deploy: Recipe<BaseP> = (e, out, t, p) => {
  const g = e.gain(out);
  e.trap(g.gain, t, 0.17, 0.06, 0.62, 0.1);
  const o = e.osc(p.helion ? 'triangle' : 'sawtooth', 70, t, t + 0.65, e.filter('lowpass', p.helion ? 1800 : 1100, 0.8, g));
  e.sweep(o.frequency, t, (p.helion ? 110 : 70) * p.r, (p.helion ? 330 : 210) * p.r, 0.6);
  [0.1, 0.32, 0.55].forEach((dt, i) => clang(e, out, t + dt, (p.helion ? 560 : 380) * (1 + i * 0.08), 0.13, 0.18));
  tone(e, out, t + 0.62, 'sine', 125, 44, 0.12, 0.6, 0.002, 0.22);
  burst(e, out, t + 0.62, 'pink', 'lowpass', 700, 0.6, 0.3, 0.003, 0.2);
  return 0.9;
};

export const unloadChime: Recipe<BaseP> = (e, out, t, p) => {
  const a = p.helion ? 88 : 84;
  bell(e, out, t, midiToHz(a), 0.12, 0.25);
  bell(e, out, t + 0.075, midiToHz(a + 5), 0.12, 0.3);
  burst(e, out, t, 'white', 'highpass', 6000, 0.5, 0.06, 0.005, 0.08);
  return 0.42;
};

export const promotion: Recipe<{ rank: number; r: number }> = (e, out, t, p) => {
  const notes = p.rank >= 2 ? [79, 84, 88, 91] : [79, 84, 88];
  notes.forEach((m, i) => tone(e, out, t + i * 0.06, 'triangle', midiToHz(m), midiToHz(m), 0, 0.17, 0.003, 0.3));
  burst(e, out, t + 0.1, 'white', 'highpass', 7000, 0.5, 0.04, 0.02, 0.3);
  return 0.62;
};

/** Unit rolled out of a factory. */
export const unitReady: Recipe<BaseP> = (e, out, t, p) => {
  const base = p.helion ? 76 : 69;
  tone(e, out, t, p.helion ? 'triangle' : 'square', midiToHz(base), midiToHz(base), 0, p.helion ? 0.16 : 0.1, 0.004, 0.09);
  tone(e, out, t + 0.09, p.helion ? 'triangle' : 'square', midiToHz(base + 7), midiToHz(base + 7), 0, p.helion ? 0.16 : 0.1, 0.004, 0.16);
  return 0.3;
};

/** A structure finished in the queue and is waiting to be placed. */
export const constructionReady: Recipe<BaseP> = (e, out, t, p) => {
  const base = p.helion ? 76 : 72;
  bell(e, out, t, midiToHz(base), 0.16, 0.4);
  bell(e, out, t + 0.12, midiToHz(base + 7), 0.16, 0.5);
  return 0.7;
};

export const powerReadyChime: Recipe<ImpactP> = (e, out, t) => {
  [72, 76, 79, 84].forEach((m, i) => bell(e, out, t + i * 0.08, midiToHz(m), 0.14, 0.5));
  burst(e, out, t + 0.2, 'white', 'highpass', 6500, 0.5, 0.05, 0.1, 0.5);
  return 1.0;
};

/** Alert for "you are under attack". */
export const alertKlaxon: Recipe<{ base: boolean }> = (e, out, t, p) => {
  const n = p.base ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const tt = t + i * 0.2;
    const g = e.gain(out);
    e.trap(g.gain, tt, 0.17, 0.01, 0.15, 0.03);
    const lp = e.filter('lowpass', 2400, 0.7, g);
    const o = e.osc('square', 880, tt, tt + 0.16, lp);
    o.frequency.setValueAtTime(880, tt);
    o.frequency.setValueAtTime(660, tt + 0.075);
  }
  return n * 0.2 + 0.05;
};

/** Short "denied" buzz (insufficient funds / cannot place). */
export const denied: Recipe<ImpactP> = (e, out, t) => {
  for (let i = 0; i < 2; i++) {
    const g = e.gain(out);
    e.trap(g.gain, t + i * 0.11, 0.2, 0.004, 0.08, 0.02);
    e.osc('square', 138, t + i * 0.11, t + i * 0.11 + 0.09, e.filter('lowpass', 900, 0.7, g));
  }
  return 0.24;
};

/** Base power failing: a hum winding down. `up` = power restored. */
export const powerHum: Recipe<{ up: boolean }> = (e, out, t, p) => {
  if (p.up) {
    const g = e.gain(out);
    e.trap(g.gain, t, 0.2, 0.05, 0.55, 0.12);
    const lp = e.filter('lowpass', 300, 0.8, g);
    e.sweep(lp.frequency, t, 300, 1700, 0.5);
    const o = e.osc('sawtooth', 50, t, t + 0.6, lp);
    e.sweep(o.frequency, t, 50, 120, 0.5);
    burst(e, out, t + 0.5, 'white', 'highpass', 3000, 0.5, 0.2, 0.0005, 0.02);
    return 0.62;
  }
  burst(e, out, t, 'white', 'highpass', 3000, 0.5, 0.25, 0.0005, 0.02);
  const g = e.gain(out);
  e.trap(g.gain, t, 0.3, 0.02, 1.2, 0.5);
  const lp = e.filter('lowpass', 1500, 0.8, g);
  e.sweep(lp.frequency, t, 1500, 190, 1.1);
  const o = e.osc('sawtooth', 120, t, t + 1.25, lp);
  e.sweep(o.frequency, t, 120, 37, 1.15);
  const o2 = e.osc('triangle', 240, t, t + 1.25, e.gain(lp, 0.6));
  e.sweep(o2.frequency, t, 240, 74, 1.15);
  return 1.25;
};

// ───────────────────────────── support powers ─────────────────────────────

export interface PowerP {
  power: SupportPowerId;
  /** charge: seconds until impact; impact: seconds the effect lasts. */
  seconds: number;
}

export const powerCharge: Recipe<PowerP> = (e, out, t, p) => {
  const d = Math.max(0.5, p.seconds);
  if (p.power === 'orbital_lance') {
    // rising, quickening shimmer from the sky
    const g = e.gain(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + d * 0.95);
    g.gain.linearRampToValueAtTime(0, t + d);
    const lp = e.filter('lowpass', 400, 2, g);
    e.sweep(lp.frequency, t, 400, 6500, d);
    const o = e.osc('sawtooth', 110, t, t + d, lp);
    e.sweep(o.frequency, t, 110, 880, d);
    const o2 = e.osc('sawtooth', 165.4, t, t + d, e.gain(lp, 0.6));
    e.sweep(o2.frequency, t, 165.4, 1322, d);
    const trem = e.gain(g.gain, 0.12);
    const lfo = e.osc('sine', 3, t, t + d, trem);
    e.sweep(lfo.frequency, t, 3, 26, d);
    const sg = e.gain(out);
    e.trap(sg.gain, t, 0.3, d * 0.6, d, 0.05);
    e.osc('sine', 55, t, t + d, sg);
    return d;
  }
  if (p.power === 'tremor') {
    // the ground starts to growl, thumps closing in
    const g = e.gain(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.75, t + d * 0.97);
    g.gain.linearRampToValueAtTime(0, t + d);
    const lp = e.filter('lowpass', 110, 0.7, g);
    e.sweep(lp.frequency, t, 110, 320, d);
    e.noise('brown', t, t + d, e.gain(lp, 3));
    const o = e.osc('sine', 34, t, t + d, e.gain(g, 0.8));
    const wob = e.gain(o.frequency, 5);
    e.osc('sine', 2.3, t, t + d, wob);
    let tt = 0.2;
    let gap = 0.7;
    while (tt < d - 0.1) {
      tone(e, out, t + tt, 'sine', 64, 30, 0.12, 0.25 + 0.5 * (tt / d), 0.003, 0.25);
      tt += gap;
      gap = Math.max(0.16, gap * 0.82);
    }
    return d;
  }
  // recon sweep: sonar ping + echo
  tone(e, out, t, 'sine', 1210, 1210, 0, 0.26, 0.004, 0.55);
  tone(e, out, t, 'sine', 620, 2450, 0.35, 0.13, 0.01, 0.36);
  tone(e, out, t + 0.45, 'sine', 1210, 1210, 0, 0.1, 0.004, 0.5);
  return 1.1;
};

export const powerImpact: Recipe<PowerP> = (e, out, t, p) => {
  const d = Math.max(0.6, p.seconds);
  if (p.power === 'orbital_lance') {
    // the beam lands: crack, sustained searing roar, sub drop, then the blast
    burst(e, out, t, 'white', 'highpass', 800, 0.5, 1.0, 0.0006, 0.14);
    const g = e.gain(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.75, t + 0.03);
    g.gain.setValueAtTime(0.7, t + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.3);
    const bp = e.filter('bandpass', 1400, 0.5, g);
    const sh = e.shaper(0.8, bp);
    e.noise('white', t, t + d + 1.3, e.gain(sh, 0.9));
    e.noise('pink', t, t + d + 1.3, e.gain(sh, 1.2));
    const bg = e.gain(out);
    e.trap(bg.gain, t, 0.3, 0.03, d + 0.2, 0.25);
    const lp = e.filter('lowpass', 3200, 1.2, bg);
    [55, 110.6, 220.9, 331.7].forEach((f) => e.osc('sawtooth', f, t, t + d + 0.25, lp));
    const trem = e.gain(bg.gain, 0.12);
    e.osc('square', 31, t, t + d + 0.25, trem);
    tone(e, out, t, 'sine', 92, 24, 1.5, 1.0, 0.004, 2.4);
    explosion(e, out, t + d * 0.92, { size: 2, r: 1, debris: true });
    return d + 2.2;
  }
  if (p.power === 'tremor') {
    explosion(e, out, t, { size: 1.7, r: 0.9, debris: true });
    const g = e.gain(out);
    const n = 40;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const shape = k < 0.05 ? k / 0.05 : k < 0.6 ? 1 : Math.pow(1 - (k - 0.6) / 0.4, 1.6);
      curve[i] = i === n - 1 ? 0 : shape * (0.6 + 0.4 * e.rng.next()) * 0.9;
    }
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(curve, t + 0.01, d + 1.6);
    const o = e.osc('sine', 38, t, t + d + 1.7, g);
    const wob = e.gain(o.frequency, 7);
    e.osc('sine', 3.1, t, t + d + 1.7, wob);
    e.osc('triangle', 57, t, t + d + 1.7, e.gain(g, 0.4));
    const lp = e.filter('lowpass', 230, 0.7, g);
    e.noise('brown', t, t + d + 1.7, e.gain(lp, 3));
    for (let i = 0; i < 12; i++) {
      const tt = t + 0.1 + e.rng.next() * (d + 0.6);
      burst(e, out, tt, 'pink', 'bandpass', e.vary(700, 0.6), 3, 0.3 * e.rng.next() + 0.1, 0.002, e.vary(0.12, 0.4));
    }
    return d + 1.75;
  }
  // recon sweep lands: a soft shimmer
  [2000, 2520, 3010].forEach((f, i) => tone(e, out, t + i * 0.04, 'sine', f, f * 1.02, 0.8, 0.06, 0.2, 0.8));
  return 1.05;
};

// ───────────────────────────── game over stingers ─────────────────────────────

export const stinger: Recipe<{ win: boolean }> = (e, out, t, p) => {
  if (p.win) {
    const g = e.gain(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.08);
    g.gain.setValueAtTime(0.16, t + 1.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    const lp = e.filter('lowpass', 600, 1, g);
    e.sweep(lp.frequency, t, 600, 3800, 0.6);
    [50, 57, 62, 66, 69, 74].forEach((m) => {
      e.osc('sawtooth', midiToHz(m) * e.vary(1, 0.003), t, t + 2.6, lp);
    });
    tone(e, out, t, 'sine', 75, 52, 0.2, 0.8, 0.003, 0.6);
    tone(e, out, t + 0.26, 'sine', 75, 52, 0.2, 0.7, 0.003, 0.9);
    burst(e, out, t, 'white', 'highpass', 5000, 0.5, 0.12, 0.3, 1.6);
    return 2.7;
  }
  const g = e.gain(out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.17, t + 0.15);
  g.gain.setValueAtTime(0.17, t + 1.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
  const lp = e.filter('lowpass', 2600, 1, g);
  e.sweep(lp.frequency, t, 2600, 260, 2.4);
  [36, 48, 51, 55, 60].forEach((m) => {
    const o = e.osc('sawtooth', midiToHz(m), t, t + 2.9, lp);
    o.frequency.setValueAtTime(midiToHz(m), t + 0.7);
    o.frequency.exponentialRampToValueAtTime(midiToHz(m - 2), t + 2.2);
  });
  tone(e, out, t, 'sine', 62, 30, 0.5, 0.9, 0.004, 1.6);
  return 3.0;
};

/** A distant low drum for "a player was eliminated". */
export const eliminated: Recipe<ImpactP> = (e, out, t) => {
  tone(e, out, t, 'sine', 90, 38, 0.3, 0.7, 0.004, 0.9);
  burst(e, out, t, 'pink', 'lowpass', 500, 0.6, 0.3, 0.004, 0.4);
  tone(e, out, t + 0.3, 'sine', 80, 34, 0.3, 0.5, 0.004, 1.0);
  return 1.4;
};
