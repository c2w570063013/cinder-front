// Original generative soundtrack: a step sequencer driving synthesised instruments.
// Every mood is a composed song (chord progression, sections, written melodies and drum patterns)
// with small deterministic variations per pass so long loops don't feel mechanical.
import type { MusicMood } from '../core/api';
import { makeRng } from '../core/rng';
import type { Engine } from './engine';
import { midiToHz } from './logic';

// ───────────────────────────── harmony helpers ─────────────────────────────

export interface Chord {
  /** Bass note (MIDI, A1..A2 range). */
  root: number;
  /** Close pad voicing around middle C (MIDI). */
  notes: number[];
}

const PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUAL: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '5': [0, 7, 12],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
};

/** Parse a chord symbol such as 'Dm9', 'Bbmaj7', 'Asus4', 'Cm/Bb'. */
export function chord(sym: string): Chord {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m || !(m[1] in PC) || !(m[2] in QUAL)) throw new Error(`bad chord ${sym}`);
  const pc = PC[m[1]];
  const notes = QUAL[m[2]].map((iv) => {
    let n = 48 + pc + iv;
    while (n > 66) n -= 12;
    while (n < 55) n += 12;
    return n;
  });
  const uniq = [...new Set(notes)].sort((a, b) => a - b);
  let root = 36 + PC[m[3] ?? m[1]];
  if (root > 45) root -= 12;
  return { root, notes: uniq };
}

/** 'X' accent, 'x' normal, 'o' ghost, anything else rest. */
function hit(pat: string, s: number): number {
  const c = pat.charCodeAt(s % pat.length);
  return c === 88 ? 1 : c === 120 ? 0.62 : c === 111 ? 0.32 : 0;
}

/** [step, midi, length in 16ths] */
type Note = [number, number, number];

// ───────────────────────────── instruments ─────────────────────────────

class Kit {
  private mel: GainNode;
  private pads: GainNode;
  private drums: GainNode;
  readonly nodes: AudioNode[] = [];

  constructor(
    private e: Engine,
    out: GainNode,
    d16: number,
  ) {
    const ctx = e.ctx;
    // tempo-synced feedback delay (dotted 8th) for melodic parts
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = Math.min(1.4, d16 * 3);
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dwet = ctx.createGain();
    dwet.gain.value = 0.42;
    delay.connect(dlp);
    dlp.connect(fb);
    fb.connect(delay);
    dlp.connect(dwet);
    dwet.connect(out);

    const rev = ctx.createGain();
    rev.gain.value = 1;
    rev.connect(e.reverbIn);

    const bus = (dly: number, rv: number): GainNode => {
      const g = ctx.createGain();
      g.connect(out);
      if (dly > 0) {
        const s = ctx.createGain();
        s.gain.value = dly;
        g.connect(s);
        s.connect(delay);
        this.nodes.push(s);
      }
      if (rv > 0) {
        const s = ctx.createGain();
        s.gain.value = rv;
        g.connect(s);
        s.connect(rev);
        this.nodes.push(s);
      }
      this.nodes.push(g);
      return g;
    };
    this.mel = bus(0.4, 0.3);
    this.pads = bus(0, 0.45);
    this.drums = bus(0, 0.1);
    this.nodes.push(delay, dlp, fb, dwet, rev);
  }

  pad(t: number, notes: number[], dur: number, vel: number, bright = 1): void {
    const e = this.e;
    const end = t + dur + 0.9;
    const a = Math.min(0.7, dur * 0.3);
    const g = e.gain(this.pads);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.085 * vel, t + a);
    g.gain.setValueAtTime(0.085 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, end);
    const lp = e.filter('lowpass', 600 * bright, 0.7, g);
    lp.frequency.setValueAtTime(600 * bright, t);
    lp.frequency.linearRampToValueAtTime(1500 * bright, t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(700 * bright, end);
    for (const n of notes) {
      const f = midiToHz(n);
      e.osc('sawtooth', f, t, end, lp).detune.value = -7;
      e.osc('triangle', f, t, end, lp).detune.value = 8;
    }
  }

  bass(t: number, note: number, dur: number, vel: number, style: 'sub' | 'saw'): void {
    const e = this.e;
    const f = midiToHz(note);
    const g = e.gain(this.drums);
    if (style === 'sub') {
      e.trap(g.gain, t, 0.2 * vel, 0.03, dur, Math.min(0.25, dur * 0.4));
      e.osc('sine', f, t, t + dur, g);
      e.osc('triangle', f * 2, t, t + dur, e.gain(g, 0.18));
      return;
    }
    e.trap(g.gain, t, 0.3 * vel, 0.004, dur, Math.min(0.04, dur * 0.3));
    const lp = e.filter('lowpass', 1400, 3, g);
    lp.frequency.setValueAtTime(500 + 1300 * vel, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + Math.min(dur, 0.16));
    e.osc('sawtooth', f, t, t + dur, lp);
    e.osc('square', f * 0.5, t, t + dur, e.gain(lp, 0.5));
  }

  pluck(t: number, note: number, dur: number, vel: number, bright = 1, wave: OscillatorType = 'triangle'): void {
    const e = this.e;
    const d = Math.max(0.08, dur);
    const g = e.gain(this.mel);
    e.ad(g.gain, t, (wave === 'triangle' ? 0.3 : 0.14) * vel, 0.003, d * 1.6);
    const lp = e.filter('lowpass', 3000, 1.5, g);
    lp.frequency.setValueAtTime(3600 * bright, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + d * 1.2);
    e.osc(wave, midiToHz(note), t, t + d * 1.6, lp);
  }

  lead(t: number, note: number, dur: number, vel: number, wave: OscillatorType = 'triangle'): void {
    const e = this.e;
    const f = midiToHz(note);
    const end = t + dur + 0.14;
    const g = e.gain(this.mel);
    const pk = (wave === 'sawtooth' ? 0.1 : 0.2) * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.03);
    g.gain.setValueAtTime(pk * 0.85, t + Math.max(0.04, dur - 0.04));
    g.gain.linearRampToValueAtTime(0, end);
    const lp = e.filter('lowpass', wave === 'sawtooth' ? 2800 : 4200, 0.8, g);
    const o1 = e.osc(wave, f, t, end, lp);
    const o2 = e.osc(wave === 'sawtooth' ? 'sawtooth' : 'sine', f, t, end, e.gain(lp, 0.6));
    o2.detune.value = 9;
    if (dur > 0.3) {
      // vibrato that blooms on held notes
      const vib = e.gain(o1.frequency, 0);
      vib.gain.setValueAtTime(0, t + 0.18);
      vib.gain.linearRampToValueAtTime(f * 0.006, t + 0.4);
      vib.connect(o2.frequency);
      e.osc('sine', 5.4, t, end, vib);
    }
  }

  stab(t: number, notes: number[], dur: number, vel: number): void {
    const e = this.e;
    const g = e.gain(this.mel);
    e.ad(g.gain, t, 0.085 * vel, 0.004, dur);
    const lp = e.filter('lowpass', 2400, 1.2, g);
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    for (const n of notes) {
      const f = midiToHz(n);
      e.osc('sawtooth', f, t, t + dur, lp).detune.value = -9;
      e.osc('sawtooth', f, t, t + dur, lp).detune.value = 9;
    }
  }

  bell(t: number, note: number, dur: number, vel: number): void {
    const e = this.e;
    const f = midiToHz(note);
    const d = Math.max(0.35, dur * 1.4);
    const mk = (ff: number, pk: number, dd: number, type: OscillatorType = 'sine') => {
      const g = e.gain(this.mel);
      e.ad(g.gain, t, pk * vel, 0.004, dd);
      e.osc(type, ff, t, t + dd, g);
    };
    mk(f, 0.2, d);
    mk(f * 2.76, 0.04, d * 0.3);
    mk(f * 2, 0.03, d * 0.6, 'triangle');
  }

  kick(t: number, vel: number): void {
    const e = this.e;
    const g = e.gain(this.drums);
    e.ad(g.gain, t, 0.8 * vel, 0.002, 0.22);
    const o = e.osc('sine', 150, t, t + 0.24, g);
    e.sweep(o.frequency, t, 150, 42, 0.09);
    this.nz(t, 'bandpass', 2500, 1.5, 0.12 * vel, 0.012);
  }

  snare(t: number, vel: number): void {
    const e = this.e;
    this.nz(t, 'bandpass', 1900, 0.8, 0.42 * vel, 0.15);
    const g = e.gain(this.drums);
    e.ad(g.gain, t, 0.28 * vel, 0.001, 0.09);
    const o = e.osc('triangle', 190, t, t + 0.1, g);
    e.sweep(o.frequency, t, 190, 140, 0.08);
  }

  hat(t: number, vel: number, open = false): void {
    this.nz(t, 'highpass', 7500, 0.6, 0.15 * vel, open ? 0.2 : 0.035);
  }

  shaker(t: number, vel: number): void {
    this.nz(t, 'bandpass', 6000, 1.2, 0.07 * vel, 0.045, 0.008);
  }

  rim(t: number, vel: number): void {
    const e = this.e;
    const g = e.gain(this.drums);
    e.ad(g.gain, t, 0.22 * vel, 0.0005, 0.03);
    e.osc('triangle', 1720, t, t + 0.035, g);
    this.nz(t, 'bandpass', 3200, 2, 0.14 * vel, 0.02);
  }

  tom(t: number, freq: number, vel: number): void {
    const e = this.e;
    const g = e.gain(this.drums);
    e.ad(g.gain, t, 0.6 * vel, 0.002, 0.28);
    const o = e.osc('sine', freq, t, t + 0.3, g);
    e.sweep(o.frequency, t, freq, freq * 0.6, 0.16);
  }

  taiko(t: number, vel: number, freq = 84): void {
    const e = this.e;
    const g = e.gain(this.pads); // via the reverb-heavy bus for size
    e.ad(g.gain, t, 0.85 * vel, 0.003, 0.5);
    const o = e.osc('sine', freq, t, t + 0.52, g);
    e.sweep(o.frequency, t, freq, freq * 0.5, 0.25);
    this.nz(t, 'lowpass', 520, 0.6, 0.3 * vel, 0.12);
  }

  riser(t: number, dur: number, vel: number): void {
    const e = this.e;
    const g = e.gain(this.mel);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * vel, t + dur * 0.97);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const bp = e.filter('bandpass', 300, 1.5, g);
    e.sweep(bp.frequency, t, 300, 6500, dur);
    e.noise('white', t, t + dur, bp);
  }

  private nz(t: number, type: BiquadFilterType, freq: number, q: number, pk: number, d: number, a = 0.001): void {
    const e = this.e;
    const g = e.gain(this.drums);
    e.ad(g.gain, t, pk, a, d);
    e.noise('white', t, t + a + d, e.filter(type, freq, q, g));
  }
}

// ───────────────────────────── songs ─────────────────────────────

interface StepCtx {
  /** Scheduled time of this 16th. */
  t: number;
  /** 0..15 within the bar. */
  s: number;
  /** Section name and bar index inside it. */
  sec: string;
  bar: number;
  lastBar: boolean;
  chord: Chord;
  /** How many times the whole form has looped. */
  pass: number;
  /** Absolute bar counter since the track started. */
  abs: number;
  d16: number;
  barDur: number;
  rnd: () => number;
}

interface Song {
  bpm: number;
  swing: number;
  /** Overall level trim so all moods sit at a similar loudness. */
  level: number;
  fadeIn: number;
  form: [name: string, chords: string[]][];
  step(k: Kit, c: StepCtx): void;
}

const ARP1 = [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 4, 2];
const ARP2 = [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1];
const arpNote = (ch: Chord, i: number, oct = 12): number => ch.notes[i % ch.notes.length] + 12 * Math.floor(i / ch.notes.length) + oct;
const playMel = (bar: Note[] | undefined, c: StepCtx, fn: (midi: number, dur: number) => void): void => {
  if (!bar) return;
  for (const [st, m, len] of bar) if (st === c.s) fn(m, len * c.d16);
};

// — menu: brooding, wide, D minor —
const MENU_THEME: Note[][] = [
  [[0, 69, 4], [6, 74, 2], [8, 77, 6]],
  [[2, 76, 2], [4, 74, 8]],
  [[0, 74, 4], [6, 77, 2], [8, 81, 6]],
  [[2, 79, 2], [4, 77, 8]],
  [[0, 70, 4], [6, 74, 2], [8, 79, 6]],
  [[2, 77, 2], [4, 74, 8]],
  [[0, 76, 6], [8, 74, 4], [12, 76, 4]],
  [[0, 73, 12]],
];
const MENU_B: Note[][] = [
  [[0, 81, 8], [8, 84, 8]],
  [[0, 79, 12]],
  [[0, 82, 8], [8, 81, 8]],
  [[0, 77, 12]],
  [[0, 81, 8], [8, 84, 8]],
  [[0, 88, 6], [8, 86, 6]],
  [[0, 86, 8], [8, 82, 8]],
  [[0, 76, 12]],
];
const menu: Song = {
  bpm: 76,
  swing: 0,
  level: 0.85,
  fadeIn: 2.5,
  form: [
    ['A', ['Dm9', 'Dm9', 'Bbmaj7', 'Bbmaj7', 'Gm7', 'Gm7', 'Asus4', 'A']],
    ['A2', ['Dm9', 'Dm9', 'Bbmaj7', 'Bbmaj7', 'Gm7', 'Gm7', 'Asus4', 'A']],
    ['B', ['Fadd9', 'C', 'Gm7', 'Dm', 'Fadd9', 'C', 'Bbmaj7', 'Asus4']],
    ['A2', ['Dm9', 'Dm9', 'Bbmaj7', 'Bbmaj7', 'Gm7', 'Gm7', 'Asus4', 'A']],
    ['C', ['Dm', 'Dm', 'Bbmaj7', 'Asus4']],
  ],
  step(k, c) {
    const { t, s, sec, d16 } = c;
    if (s === 0) {
      k.pad(t, c.chord.notes, c.barDur, 0.85, sec === 'C' ? 0.7 : 1);
      k.bass(t, c.chord.root, c.barDur * 0.92, 0.9, 'sub');
    }
    if (sec !== 'C' && s === 10) k.bass(t, c.chord.root + 12, d16 * 4, 0.45, 'sub');
    if (sec === 'A' || sec === 'A2') {
      // second time round the theme moves to a soft lead, bells answer an octave up
      const alt = sec === 'A2' && c.pass % 2 === 1;
      playMel(MENU_THEME[c.bar], c, (m, d) => (alt ? k.lead(t, m, d, 0.7) : k.bell(t, m, d, 0.9)));
      if (sec === 'A2' && s % 2 === 0) k.pluck(t, arpNote(c.chord, ARP2[s / 2], 0), d16 * 2, s % 8 === 0 ? 0.4 : 0.26, 0.6);
    }
    if (sec === 'B') {
      playMel(MENU_B[c.bar], c, (m, d) => k.lead(t, m, d, 0.75));
      if (s % 2 === 0) k.pluck(t, arpNote(c.chord, ARP1[s / 2], 0), d16 * 2, s % 8 === 0 ? 0.42 : 0.28, 0.7);
    }
    if (sec === 'A2' || sec === 'B') {
      if (s === 0) k.kick(t, 0.6);
      if (s === 3) k.kick(t, 0.38);
      if (c.bar % 4 === 3) {
        if (s === 8) k.taiko(t, 0.45);
        if (s === 11) k.taiko(t, 0.6);
        if (s === 14) k.taiko(t, 0.8, 76);
      }
    }
    if (sec === 'C' && s % 4 === 2 && c.rnd() < 0.6) {
      k.bell(t, arpNote(c.chord, Math.floor(c.rnd() * 5), 12), d16 * 6, 0.55);
    }
  },
};

// — calm: industrious, hopeful pulse in A minor —
const CALM_B: Note[][] = [
  [[0, 77, 6], [8, 76, 2], [10, 74, 6]],
  [[4, 69, 4], [8, 74, 8]],
  [[0, 76, 6], [8, 74, 2], [10, 72, 6]],
  [[4, 69, 4], [8, 72, 8]],
  [[0, 81, 6], [8, 79, 2], [10, 77, 6]],
  [[0, 79, 4], [4, 83, 4], [8, 86, 8]],
  [[0, 84, 8], [8, 83, 4], [12, 81, 4]],
  [[0, 83, 12]],
];
const CALM_A2: Note[][] = [
  [[0, 76, 6], [8, 72, 6]],
  [[4, 69, 4], [8, 72, 8]],
  [[0, 77, 6], [8, 72, 6]],
  [[4, 69, 4], [8, 76, 8]],
  [[0, 79, 6], [8, 74, 6]],
  [[4, 72, 4], [8, 76, 8]],
  [[0, 74, 6], [8, 71, 6]],
  [[0, 71, 8], [8, 67, 8]],
];
const calm: Song = {
  bpm: 100,
  swing: 0.08,
  level: 1,
  fadeIn: 1.8,
  form: [
    ['I', ['Am7', 'Am7', 'Am7', 'Am7']],
    ['A', ['Am7', 'Am7', 'Fmaj7', 'Fmaj7', 'Cadd9', 'Cadd9', 'G', 'Em7']],
    ['B', ['Dm7', 'Dm7', 'Am7', 'Am7', 'Fmaj7', 'G', 'Asus2', 'Esus4']],
    ['A2', ['Am7', 'Am7', 'Fmaj7', 'Fmaj7', 'Cadd9', 'Cadd9', 'G', 'Em7']],
    ['C', ['Fmaj7', 'Fmaj7', 'Em7', 'Em7', 'Dm7', 'Dm7', 'Esus4', 'E']],
    ['B', ['Dm7', 'Dm7', 'Am7', 'Am7', 'Fmaj7', 'G', 'Asus2', 'Esus4']],
  ],
  step(k, c) {
    const { t, s, sec, d16 } = c;
    const bright = 0.85 + 0.3 * Math.sin((c.abs / 8) * Math.PI * 2);
    if (s === 0) k.pad(t, c.chord.notes, c.barDur, sec === 'C' ? 0.9 : 0.7, sec === 'C' ? 0.8 : 1);

    // pulse arpeggio — the engine of the track
    const acc = (s % 4 === 0 ? 0.5 : 0.3) * (0.85 + 0.15 * c.rnd());
    if (sec === 'I') {
      if (s % 2 === 0) k.pluck(t, arpNote(c.chord, ARP1[s]), d16 * 2, acc * (0.4 + 0.2 * c.bar), bright);
    } else if (sec === 'A') {
      const sparse = c.pass % 2 === 0;
      if (!sparse || s % 2 === 0) k.pluck(t, arpNote(c.chord, ARP1[s]), d16 * (sparse ? 2 : 1), acc, bright);
    } else if (sec === 'B') {
      k.pluck(t, arpNote(c.chord, ARP2[s]), d16, acc * 0.85, bright);
    } else if (sec === 'A2') {
      k.pluck(t, arpNote(c.chord, (c.pass % 2 ? ARP2 : ARP1)[s]), d16, acc, bright);
    } else if (s % 4 === 0 && c.rnd() < 0.7) {
      k.bell(t, arpNote(c.chord, Math.floor(c.rnd() * 5), 12), d16 * 6, 0.5);
    }

    // bass
    const r = c.chord.root;
    if (sec === 'C') {
      if (s === 0) k.bass(t, r, c.barDur * 0.9, 0.8, 'sub');
    } else if (sec !== 'I' || c.bar >= 2) {
      if (s === 0) k.bass(t, r, d16 * 5, 1, 'saw');
      if (s === 6) k.bass(t, r, d16 * 3, 0.7, 'saw');
      if (s === 10) k.bass(t, r + 7, d16 * 3, 0.75, 'saw');
      if (s === 14) k.bass(t, r + 12, d16 * 1.6, 0.6, 'saw');
    }

    // percussion
    if (sec === 'C') {
      if (s === 4 || s === 12) k.hat(t, 0.5);
    } else if (sec !== 'I') {
      const v = hit('X.......x.X.....', s);
      if (v) k.kick(t, v * 0.75);
      if (s % 4 === 2) k.hat(t, 0.6);
      if (s === 12 && c.bar % 2 === 1) k.rim(t, 0.7);
      if (sec === 'B' || sec === 'A2') k.shaker(t, s % 2 === 0 ? 0.6 : 0.3);
      if (c.lastBar && s >= 12) k.tom(t, 150 - (s - 12) * 16, 0.35 + (s - 12) * 0.08);
    } else if (c.bar === 3 && s >= 12) {
      k.tom(t, 150 - (s - 12) * 16, 0.3 + (s - 12) * 0.08);
    }

    // melodies
    if (sec === 'B') playMel(CALM_B[c.bar], c, (m, d) => k.lead(t, m - (c.pass % 2 ? 0 : 12), d, 0.7));
    if (sec === 'A2') playMel(CALM_A2[c.bar], c, (m, d) => k.bell(t, m, d, 0.7));
  },
};

// — battle: driving C minor, war drums and brass —
const BATTLE_B: Note[][] = [
  [[0, 75, 3], [3, 75, 1], [4, 77, 4], [8, 79, 8]],
  [[0, 77, 3], [3, 77, 1], [4, 79, 4], [8, 82, 8]],
  [[0, 84, 6], [6, 82, 2], [8, 79, 8]],
  [[0, 75, 4], [4, 79, 4], [8, 72, 8]],
  [[0, 75, 3], [3, 75, 1], [4, 77, 4], [8, 80, 8]],
  [[0, 82, 6], [6, 80, 2], [8, 77, 8]],
  [[0, 79, 8], [8, 83, 4], [12, 86, 4]],
  [[0, 86, 12]],
];
const battle: Song = {
  bpm: 138,
  swing: 0,
  level: 0.95,
  fadeIn: 0.4,
  form: [
    ['I', ['Cm', 'Cm']],
    ['A', ['Cm', 'Cm', 'Ab', 'Bb', 'Cm', 'Cm', 'Fm', 'G']],
    ['B', ['Ab', 'Bb', 'Cm', 'Cm', 'Ab', 'Bb', 'G', 'G']],
    ['A2', ['Cm', 'Cm', 'Ab', 'Bb', 'Cm', 'Cm', 'Fm', 'G']],
    ['C', ['Cm', 'Cm', 'Db', 'G']],
    ['B', ['Ab', 'Bb', 'Cm', 'Cm', 'Ab', 'Bb', 'G', 'G']],
  ],
  step(k, c) {
    const { t, s, sec, d16 } = c;
    const r = c.chord.root;
    if (s === 0) k.pad(t, c.chord.notes, c.barDur, 0.5, 1.3);

    // bass ostinato
    if (sec === 'C') {
      if (s === 0) k.bass(t, r, c.barDur * 0.95, 1, 'sub');
      const v = hit('X..X..X.X..X..X.', s);
      if (v) k.bass(t, r, d16 * 1.5, 0.8 * v, 'saw');
    } else {
      const pat = sec === 'B' ? 'xxox.xox.xox.xxo' : 'x.xx.xx.x.xx.xox';
      const ch = pat[s];
      if (ch !== '.') k.bass(t, ch === 'o' ? r + 12 : r, d16 * 0.9, s % 4 === 0 ? 1 : 0.72, 'saw');
    }

    // drums
    const fill = c.lastBar && s >= 10 && sec !== 'I';
    if (sec === 'I' || sec === 'C') {
      const v = hit('X..X..X.X..X..X.', s);
      if (v) k.taiko(t, v * (sec === 'I' ? 0.75 : 0.9), s % 8 === 0 ? 84 : 98);
      if (sec === 'I' && s === 0) k.kick(t, 1);
    } else {
      const kv = hit(sec === 'B' ? 'X...X...X...X.x.' : 'X..x..X...x.X...', s);
      if (kv) k.kick(t, kv);
      if (!fill && (s === 4 || s === 12)) k.snare(t, 1);
      if (s === 15 && c.bar % 2 === 1) k.snare(t, 0.35);
      if (sec === 'A') {
        if (s % 4 === 2) k.hat(t, 0.8);
      } else k.hat(t, s % 4 === 2 ? 0.85 : s % 2 === 0 ? 0.45 : 0.3);
      if (sec === 'A2' && s % 8 === 0) k.taiko(t, 0.6);
    }
    if (fill) k.tom(t, [160, 160, 138, 124, 104, 92][s - 10], 0.6 + (s - 10) * 0.07);
    if ((sec === 'I' && c.bar === 1) || (sec === 'C' && c.lastBar)) {
      if (s === 0) k.riser(t, c.barDur, 1);
    }

    // harmony stabs
    const sv = sec === 'B' ? hit('X..X..X.........', s) : sec === 'A' || sec === 'A2' ? hit('X.....X...X.....', s) : 0;
    if (sv) k.stab(t, c.chord.notes, d16 * 2.2, sv);
    if (sec === 'C' && s === 0) k.stab(t, c.chord.notes, d16 * 6, 0.8);

    // brass theme + a restless arp the second time through
    if (sec === 'B') playMel(BATTLE_B[c.bar], c, (m, d) => k.lead(t, m - 12, d * 0.92, 1, 'sawtooth'));
    if (sec === 'A2') k.pluck(t, arpNote(c.chord, ARP1[s]), d16, s % 4 === 0 ? 0.5 : 0.3, 1.1, 'square');
    if (sec === 'A' && c.pass % 2 === 1 && s % 2 === 0) k.pluck(t, arpNote(c.chord, ARP2[s]), d16 * 2, 0.35, 1, 'square');
  },
};

// — victory: D major fanfare that settles into an easy, bright groove —
const VIC_F: Note[][] = [
  [[0, 74, 2], [2, 74, 1], [3, 74, 1], [4, 78, 4], [8, 81, 8]],
  [[0, 83, 6], [6, 81, 2], [8, 79, 8]],
  [[0, 81, 2], [2, 81, 1], [3, 81, 1], [4, 86, 4], [8, 90, 8]],
  [[0, 88, 12]],
];
const VIC_A: Note[][] = [
  [[0, 78, 6], [6, 81, 2], [8, 86, 8]],
  [[0, 86, 4], [4, 83, 4], [8, 78, 8]],
  [[0, 79, 6], [6, 81, 2], [8, 83, 8]],
  [[0, 81, 4], [4, 85, 4], [8, 88, 8]],
  [[0, 78, 6], [6, 81, 2], [8, 86, 8]],
  [[0, 86, 4], [4, 88, 4], [8, 90, 8]],
  [[0, 91, 6], [6, 90, 2], [8, 88, 8]],
  [[0, 88, 4], [4, 85, 4], [8, 81, 8]],
];
const victory: Song = {
  bpm: 112,
  swing: 0,
  level: 0.85,
  fadeIn: 0.25,
  form: [
    ['F', ['D', 'G', 'D', 'Asus4']],
    ['A', ['D', 'Bm7', 'Gadd9', 'A', 'D', 'Bm7', 'Em7', 'A7']],
    ['B', ['G', 'A', 'F#m7', 'Bm7', 'G', 'A', 'Dsus4', 'D']],
  ],
  step(k, c) {
    const { t, s, sec, d16 } = c;
    const r = c.chord.root;
    const first = c.pass === 0;
    if (s === 0) k.pad(t, c.chord.notes, c.barDur, 0.8, 1.4);
    if (s === 0) k.bass(t, r, d16 * 5, 1, 'saw');
    if (s === 6) k.bass(t, r, d16 * 2, 0.7, 'saw');
    if (s === 8) k.bass(t, r + 7, d16 * 5, 0.8, 'saw');
    if (s === 14) k.bass(t, r + 12, d16 * 1.6, 0.6, 'saw');

    if (sec === 'F') {
      playMel(VIC_F[c.bar], c, (m, d) => (first ? k.lead(t, m - 12, d * 0.92, 1, 'sawtooth') : k.bell(t, m - 12, d, 0.8)));
      if (first) {
        playMel(VIC_F[c.bar], c, (m, d) => k.lead(t, m, d * 0.92, 0.45, 'triangle'));
        const v = hit('x.oox.oox.oox.xx', s);
        if (v) k.snare(t, v * 0.45);
        if (s === 0 && c.bar === 0) k.hat(t, 1, true);
        if (c.bar === 3 && (s === 8 || s === 12)) k.taiko(t, 0.8);
      }
      if (s === 0 || s === 8) k.kick(t, first ? 0.9 : 0.6);
    } else {
      const kv = hit('X.....x.X.......', s);
      if (kv) k.kick(t, kv * 0.8);
      if (s === 4 || s === 12) k.snare(t, 0.5);
      if (s % 4 === 2) k.hat(t, 0.6);
      if (c.lastBar && s >= 12) k.tom(t, 170 - (s - 12) * 18, 0.4 + (s - 12) * 0.08);
    }
    if (sec === 'A') {
      playMel(VIC_A[c.bar], c, (m, d) => (c.pass % 2 === 0 ? k.lead(t, m - 12, d, 0.8) : k.bell(t, m - 12, d, 0.8)));
      if (s % 2 === 0) k.pluck(t, arpNote(c.chord, ARP1[s]), d16 * 2, s % 8 === 0 ? 0.45 : 0.3, 1);
    }
    if (sec === 'B') {
      k.pluck(t, arpNote(c.chord, ARP2[s]), d16, s % 4 === 0 ? 0.45 : 0.28, 1);
      if (s === 0) k.bell(t, c.chord.notes[c.chord.notes.length - 1] + 12, d16 * 8, 0.6);
    }
  },
};

// — defeat: slow C minor lament —
const DEF_MEL: Note[][] = [
  [[0, 79, 8], [8, 75, 8]],
  [[0, 74, 8], [8, 72, 8]],
  [[0, 75, 8], [8, 72, 8]],
  [[0, 68, 16]],
  [[0, 77, 8], [8, 75, 8]],
  [[0, 72, 8], [8, 68, 8]],
  [[0, 74, 8], [8, 72, 8]],
  [[0, 71, 16]],
];
const defeat: Song = {
  bpm: 58,
  swing: 0,
  level: 0.8,
  fadeIn: 0.8,
  form: [['A', ['Cm', 'Cm/Bb', 'Abmaj7', 'Abmaj7', 'Fm7', 'Fm7', 'Gsus4', 'G']]],
  step(k, c) {
    const { t, s } = c;
    if (s === 0) {
      k.pad(t, c.chord.notes, c.barDur, 0.9, 0.6);
      k.bass(t, c.chord.root, c.barDur * 0.95, 0.9, 'sub');
      if (c.bar % 2 === 0) k.taiko(t, 0.5, 70);
    }
    if (c.bar === 7 && s === 12) k.taiko(t, 0.3, 70);
    playMel(DEF_MEL[c.bar], c, (m, d) => {
      k.bell(t, m, d, 0.8);
      if (c.pass % 2 === 1) k.lead(t, m - 12, d, 0.4);
    });
  },
};

export const SONGS: Record<Exclude<MusicMood, 'off'>, Song> = { menu, calm, battle, victory, defeat };

// ───────────────────────────── sequencer ─────────────────────────────

interface FlatBar {
  sec: string;
  bar: number;
  lastBar: boolean;
  chord: Chord;
}

class Track {
  readonly gain: GainNode;
  readonly kit: Kit;
  readonly bars: FlatBar[] = [];
  readonly d16: number;
  step = 0;
  nextT: number;
  killAt = Infinity;
  private rng = makeRng(0xc1de);

  constructor(
    private e: Engine,
    readonly song: Song,
    t0: number,
  ) {
    this.d16 = 60 / song.bpm / 4;
    this.gain = e.ctx.createGain();
    this.gain.gain.setValueAtTime(0, t0);
    this.gain.gain.linearRampToValueAtTime(song.level, t0 + song.fadeIn);
    this.gain.connect(e.musicBus);
    this.kit = new Kit(e, this.gain, this.d16);
    this.nextT = t0;
    for (const [sec, chords] of song.form) {
      chords.forEach((sym, bar) => this.bars.push({ sec, bar, lastBar: bar === chords.length - 1, chord: chord(sym) }));
    }
  }

  /** Schedule every step that starts before `until`. */
  pump(now: number, until: number): void {
    const lim = Math.min(until, this.killAt);
    if (this.nextT < now - 0.05) {
      // the timer was throttled (background tab): skip ahead instead of bunching notes up
      const n = Math.ceil((now + 0.03 - this.nextT) / this.d16);
      this.step += n;
      this.nextT += n * this.d16;
    }
    while (this.nextT < lim) {
      const s = this.step % 16;
      const abs = Math.floor(this.step / 16);
      const fb = this.bars[abs % this.bars.length];
      const c: StepCtx = {
        t: this.nextT + (s % 2 === 1 ? this.song.swing * this.d16 : 0),
        s,
        sec: fb.sec,
        bar: fb.bar,
        lastBar: fb.lastBar,
        chord: fb.chord,
        pass: Math.floor(abs / this.bars.length),
        abs,
        d16: this.d16,
        barDur: this.d16 * 16,
        rnd: this.rng.next,
      };
      try {
        this.song.step(this.kit, c);
      } catch {
        /* never let a bad note stop the sequencer */
      }
      this.step++;
      this.nextT += this.d16;
    }
  }

  fadeOut(now: number, tc: number): void {
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0, now, tc);
    this.killAt = Math.min(this.killAt, now + tc * 5);
  }

  dispose(): void {
    for (const n of [this.gain, ...this.kit.nodes]) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

export class Music {
  private tracks: Track[] = [];
  mood: MusicMood = 'off';

  constructor(private e: Engine) {}

  /** Crossfade to another mood. The old track fades while the new one starts from its top. */
  setMood(mood: MusicMood): void {
    if (mood === this.mood) return;
    const now = this.e.now;
    const quick = mood === 'battle' || mood === 'victory' || mood === 'defeat';
    for (const tr of this.tracks) tr.fadeOut(now, mood === 'off' ? 0.5 : quick ? 0.3 : 0.7);
    this.mood = mood;
    if (mood !== 'off') this.tracks.push(new Track(this.e, SONGS[mood], now + 0.06));
  }

  /** Schedule notes up to `until` (context time). Call regularly with a little lookahead. */
  pump(until: number): void {
    const now = this.e.now;
    this.tracks = this.tracks.filter((tr) => {
      if (tr.killAt <= now) {
        tr.dispose();
        return false;
      }
      return true;
    });
    for (const tr of this.tracks) tr.pump(now, until);
  }

  get activeTracks(): number {
    return this.tracks.length;
  }
}
