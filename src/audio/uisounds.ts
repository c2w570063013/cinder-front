// Interface sounds and unit acknowledgement blips (tones only — no speech).
import type { UiSound } from '../core/api';
import type { Engine, Recipe } from './engine';
import { type AckClass, midiToHz } from './logic';

function blip(e: Engine, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, d: number, lp = 0): void {
  const g = e.gain(out);
  e.ad(g.gain, t, peak, 0.003, d);
  const dest = lp > 0 ? e.filter('lowpass', lp, 0.7, g) : g;
  const o = e.osc(type, f0, t, t + d + 0.01, dest);
  if (f1 !== f0) e.sweep(o.frequency, t, f0, f1, d * 0.8);
}

function tick(e: Engine, out: AudioNode, t: number, freq: number, peak: number, d = 0.02): void {
  const g = e.gain(out);
  e.ad(g.gain, t, peak, 0.0005, d);
  e.noise('white', t, t + d, e.filter('bandpass', freq, 2.5, g));
}

export const uiSound: Recipe<UiSound> = (e, out, t, s) => {
  switch (s) {
    case 'click':
      tick(e, out, t, 2600, 0.8);
      blip(e, out, t, 'sine', 1750, 1500, 0.4, 0.035);
      return 0.06;
    case 'select':
      blip(e, out, t, 'sine', 660, 660, 0.2, 0.06);
      blip(e, out, t + 0.045, 'sine', 990, 990, 0.16, 0.08);
      return 0.15;
    case 'move':
      blip(e, out, t, 'triangle', 440, 440, 0.24, 0.06);
      blip(e, out, t + 0.06, 'triangle', 587, 587, 0.24, 0.1);
      return 0.18;
    case 'attack':
      blip(e, out, t, 'square', 520, 500, 0.15, 0.055, 2600);
      blip(e, out, t + 0.065, 'square', 392, 360, 0.17, 0.1, 2600);
      tick(e, out, t, 3400, 0.2);
      return 0.19;
    case 'place':
      blip(e, out, t, 'sine', 165, 72, 0.6, 0.14);
      tick(e, out, t, 1400, 0.4, 0.03);
      blip(e, out, t + 0.03, 'triangle', 880, 880, 0.08, 0.12);
      return 0.2;
    case 'error':
      blip(e, out, t, 'square', 142, 142, 0.2, 0.09, 1000);
      blip(e, out, t + 0.11, 'square', 142, 132, 0.2, 0.12, 1000);
      return 0.26;
    case 'tab':
      tick(e, out, t, 3800, 0.7, 0.015);
      blip(e, out, t, 'sine', 1250, 1250, 0.28, 0.04);
      return 0.05;
    case 'queue':
      blip(e, out, t, 'sine', 700, 1020, 0.45, 0.085);
      tick(e, out, t, 2400, 0.2);
      return 0.1;
    case 'cancel':
      blip(e, out, t, 'sine', 820, 480, 0.45, 0.11);
      return 0.12;
  }
  return 0;
};

export interface AckP {
  cls: AckClass;
  helion: boolean;
  kind: 'select' | 'move' | 'attack';
  /** Per-def hash → each unit type gets its own little signature. */
  seed: number;
}

// Helion blips walk a major-pentatonic set, Ferrum a darker minor one.
const H_SCALE = [0, 2, 4, 7, 9, 12, 14];
const F_SCALE = [0, 3, 5, 7, 10, 12, 15];
const BASE: Record<AckClass, number> = { infantry: 79, vehicle: 62, aircraft: 74, building: 55 };
// Scale-step contours per order kind.
const CONTOUR: Record<AckP['kind'], number[]> = {
  select: [0, 1],
  move: [0, 2, 3],
  attack: [3, 0, 3, 4],
};

export const ackSound: Recipe<AckP> = (e, out, t, p) => {
  const scale = p.helion ? H_SCALE : F_SCALE;
  const start = p.seed % 3;
  const root = BASE[p.cls] + (p.helion ? 2 : -2) + ((p.seed >>> 3) % 3) - 1;
  const steps = CONTOUR[p.kind];
  const noteAt = (i: number) => midiToHz(root + scale[(start + steps[i]) % scale.length]);
  const wave: OscillatorType = p.helion ? 'triangle' : 'square';
  const peak = p.helion ? 0.2 : 0.11;
  const lp = p.helion ? 0 : 2400;
  let end = 0.1;

  switch (p.cls) {
    case 'infantry': {
      // radio chirps with a squelch tick
      const gap = p.kind === 'attack' ? 0.05 : 0.065;
      tick(e, out, t, 4200, 0.12, 0.012);
      steps.forEach((_, i) => blip(e, out, t + 0.012 + i * gap, wave, noteAt(i), noteAt(i), peak, 0.045, lp));
      end = 0.03 + steps.length * gap + 0.05;
      break;
    }
    case 'vehicle': {
      // lower notes over a short engine rev
      const gap = p.kind === 'attack' ? 0.07 : 0.09;
      const g = e.gain(out);
      e.ad(g.gain, t, 0.12, 0.02, 0.22);
      const o = e.osc('sawtooth', 55, t, t + 0.25, e.filter('lowpass', p.helion ? 500 : 340, 0.8, g));
      e.sweep(o.frequency, t, p.helion ? 62 : 48, p.helion ? 96 : 70, 0.2);
      steps.forEach((_, i) => blip(e, out, t + i * gap, wave, noteAt(i), noteAt(i), peak, 0.075, lp || 3200));
      end = steps.length * gap + 0.12;
      break;
    }
    case 'aircraft': {
      // airy gliding whoop
      const f0 = noteAt(0);
      const f1 = noteAt(steps.length - 1) * (p.kind === 'attack' ? 1.5 : 1.25);
      const d = p.kind === 'select' ? 0.16 : 0.24;
      const g = e.gain(out);
      e.ad(g.gain, t, peak * (p.helion ? 1.8 : 3), 0.02, d);
      const o = e.osc(p.helion ? 'sine' : 'sawtooth', f0, t, t + d + 0.03, lp ? e.filter('lowpass', 2000, 0.7, g) : g);
      e.sweep(o.frequency, t, f0, f1, d * 0.7);
      const vib = e.gain(o.frequency, f0 * 0.02);
      e.osc('sine', 14, t, t + d + 0.03, vib);
      const ng = e.gain(out);
      e.ad(ng.gain, t, 0.07, 0.03, d);
      const bp = e.filter('bandpass', 2500, 1.5, ng);
      e.sweep(bp.frequency, t, 1800, 5200, d);
      e.noise('white', t, t + d + 0.03, bp);
      if (p.kind === 'attack') blip(e, out, t + d * 0.7, wave, f1, f1, peak * 0.8, 0.06, lp);
      end = d + 0.12;
      break;
    }
    case 'building': {
      // hollow two-note "bong"
      const f = noteAt(0);
      const f2 = noteAt(steps.length - 1) * (p.helion ? 1.5 : 1.4983 * 0.944);
      blip(e, out, t, 'sine', f, f, 0.26, 0.3);
      blip(e, out, t, 'triangle', f * 2.01, f * 2.01, 0.06, 0.18);
      blip(e, out, t + 0.07, p.helion ? 'sine' : 'triangle', f2, f2, 0.14, 0.26);
      tick(e, out, t, 900, 0.12, 0.02);
      end = 0.4;
      break;
    }
  }
  return end;
};
