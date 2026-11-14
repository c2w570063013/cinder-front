// WebAudio graph + small synthesis toolkit. Works on any BaseAudioContext (live or offline),
// so every sound can also be rendered offline for verification.
import { makeRng } from '../core/rng';
import { clamp, VoiceBudget } from './logic';

export type NoiseKind = 'white' | 'pink' | 'brown';

interface VoiceHandle {
  nodes: AudioNode[];
  gain: GainNode;
}

export interface VoiceOpts {
  gain?: number;
  pan?: number;
  /** Low-pass cutoff Hz (>= 18000 = bypass). */
  cutoff?: number;
  /** Reverb send 0..1. */
  reverb?: number;
  prio?: number;
  bus?: 'sfx' | 'ui';
}

/** A synth recipe writes nodes into `out` starting at time `t` and returns its duration in seconds. */
export type Recipe<P> = (e: Engine, out: AudioNode, t: number, p: P) => number;

export const MAX_VOICES = 28;

export class Engine {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly sfxBus: GainNode;
  readonly uiBus: GainNode;
  readonly musicBus: GainNode;
  /** Ducked while the announcer speaks. */
  readonly musicDuck: GainNode;
  readonly reverbIn: GainNode;
  readonly analyser: AnalyserNode;
  readonly rng = makeRng(0x51ed5eed);
  readonly budget = new VoiceBudget<VoiceHandle>(MAX_VOICES);
  private noiseBufs: Record<NoiseKind, AudioBuffer>;
  private curves = new Map<number, Float32Array<ArrayBuffer>>();
  private hasPanner: boolean;
  /** Counters for the dev page. */
  stats = { played: 0, dropped: 0, stolen: 0 };

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.hasPanner = typeof (ctx as any).createStereoPanner === 'function';

    // master → compressor (limiter) → soft clip → analyser → destination
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 14;
    comp.attack.value = 0.002;
    comp.release.value = 0.22;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    const post = ctx.createGain();
    post.gain.value = 0.9;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(comp);
    comp.connect(clip);
    clip.connect(post);
    post.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicDuck = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.uiBus.connect(this.master);
    this.musicBus.connect(this.musicDuck);
    this.musicDuck.connect(this.master);

    // shared convolution reverb from a generated impulse
    this.reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 1.9);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverbIn.connect(conv);
    conv.connect(wet);
    wet.connect(this.master);

    this.noiseBufs = {
      white: makeNoise(ctx, 'white'),
      pink: makeNoise(ctx, 'pink'),
      brown: makeNoise(ctx, 'brown'),
    };
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  // ── voices ──

  /** Drop finished voices and disconnect their chains. */
  prune(): void {
    const now = this.now;
    for (const h of this.budget.prune(now)) disconnectAll(h.nodes);
    if (this.dying.length) {
      this.dying = this.dying.filter((d) => {
        if (d.end > now) return true;
        disconnectAll(d.handle.nodes);
        return false;
      });
    }
  }
  /** Stolen voices that are fading out — no longer counted against the budget. */
  private dying: { end: number; handle: VoiceHandle }[] = [];

  /**
   * Play a recipe through a spatialised, budgeted voice. Returns the duration, or 0 if dropped.
   * `at` = absolute context time (default: now).
   */
  play<P>(recipe: Recipe<P>, p: P, o: VoiceOpts = {}, at?: number): number {
    const ctx = this.ctx;
    const t = Math.max(at ?? 0, this.now) + 0.005;
    const prio = o.prio ?? 3;
    const ui = o.bus === 'ui';
    if (!ui) {
      this.prune();
      const r = this.budget.request(this.now, prio);
      if (!r.ok) {
        this.stats.dropped++;
        return 0;
      }
      if (r.stolen) {
        this.stats.stolen++;
        const g = r.stolen.gain.gain;
        g.cancelScheduledValues(this.now);
        g.setTargetAtTime(0, this.now, 0.012);
        // let the fade finish, then free the chain on a later prune
        this.dying.push({ end: this.now + 0.08, handle: r.stolen });
      }
    }

    const vg = ctx.createGain();
    vg.gain.value = clamp(o.gain ?? 1, 0, 2);
    const nodes: AudioNode[] = [vg];
    let tail: AudioNode = vg;
    if (o.cutoff !== undefined && o.cutoff < 18000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(200, o.cutoff);
      lp.Q.value = 0.5;
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }
    if (this.hasPanner && o.pan) {
      const pn = (ctx as any).createStereoPanner() as StereoPannerNode;
      pn.pan.value = clamp(o.pan, -1, 1);
      tail.connect(pn);
      tail = pn;
      nodes.push(pn);
    }
    tail.connect(ui ? this.uiBus : this.sfxBus);
    if (o.reverb && o.reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = clamp(o.reverb, 0, 1.5);
      tail.connect(send);
      send.connect(this.reverbIn);
      nodes.push(send);
    }

    let dur = 0.1;
    try {
      dur = recipe(this, vg, t, p);
    } catch {
      disconnectAll(nodes);
      return 0;
    }
    this.stats.played++;
    const handle: VoiceHandle = { nodes, gain: vg };
    if (ui) this.uiVoices.push({ end: t + dur + 0.1, handle });
    else this.budget.add(t + dur + 0.1, prio, handle);
    return dur;
  }

  private uiVoices: { end: number; handle: VoiceHandle }[] = [];
  pruneUi(): void {
    const now = this.now;
    this.uiVoices = this.uiVoices.filter((v) => {
      if (v.end > now) return true;
      disconnectAll(v.handle.nodes);
      return false;
    });
  }

  // ── synthesis toolkit (all nodes are started and scheduled to stop) ──

  /** ±pct random variation around v. */
  vary(v: number, pct: number): number {
    return v * (1 + (this.rng.next() * 2 - 1) * pct);
  }

  gain(dest: AudioNode | AudioParam, value = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest as AudioNode);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clamp(freq, 10, 20000);
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  osc(type: OscillatorType, freq: number, t0: number, t1: number, dest: AudioNode | AudioParam): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = clamp(freq, 1, 20000);
    o.connect(dest as AudioNode);
    o.start(t0);
    o.stop(t1 + 0.02);
    return o;
  }

  noise(kind: NoiseKind, t0: number, t1: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    const buf = this.noiseBufs[kind];
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t0, this.rng.next() * (buf.duration - 0.05));
    s.stop(t1 + 0.02);
    return s;
  }

  /** Soft-saturation waveshaper; amount 0..1. */
  shaper(amount: number, dest: AudioNode): WaveShaperNode {
    const key = Math.round(clamp(amount, 0, 1) * 20);
    let curve = this.curves.get(key);
    if (!curve) {
      const n = 1024;
      curve = new Float32Array(n);
      const k = 1 + key * 1.5;
      const norm = Math.tanh(k);
      for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * k) / norm;
      this.curves.set(key, curve);
    }
    const w = this.ctx.createWaveShaper();
    w.curve = curve;
    w.connect(dest);
    return w;
  }

  /** Attack-decay envelope: 0 → peak (linear, `a` s) → ~0 (exponential, `d` s). */
  ad(param: AudioParam, t: number, peak: number, a: number, d: number): void {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + Math.max(0.0005, a));
    param.exponentialRampToValueAtTime(0.0001, t + a + Math.max(0.005, d));
    param.setValueAtTime(0, t + a + d + 0.001);
  }

  /** Trapezoid envelope: rise `a`, hold until t+dur-r, fall `r`. */
  trap(param: AudioParam, t: number, peak: number, a: number, dur: number, r: number): void {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, Math.max(t + a, t + dur - r));
    param.linearRampToValueAtTime(0, t + dur);
  }

  /** Exponential frequency (or any positive param) sweep. */
  sweep(param: AudioParam, t: number, from: number, to: number, dur: number): void {
    param.setValueAtTime(Math.max(0.001, from), t);
    param.exponentialRampToValueAtTime(Math.max(0.001, to), t + Math.max(0.002, dur));
  }
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* already gone */
    }
  }
}

function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // linear up to ±0.7, then a smooth knee that never exceeds ±1
    const a = Math.abs(x);
    const y = a < 0.7 ? a : 0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

function makeNoise(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = makeRng(kind === 'white' ? 11 : kind === 'pink' ? 23 : 37);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = rng.next() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = rng.next() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
  } else {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = rng.next() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  // tiny crossfade so the loop point doesn't click
  const xf = 256;
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    d[len - xf + i] = d[len - xf + i] * (1 - k) + d[i] * k;
  }
  return buf;
}

/** Stereo decaying-noise impulse whose tail gets darker over time. */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rng = makeRng(101 + ch * 977);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      const w = rng.next() * 2 - 1;
      const coef = 0.25 + 0.7 * k; // more smoothing later → darker tail
      lp = lp * coef + w * (1 - coef);
      const early = i < ctx.sampleRate * 0.012 ? 0.3 : 1; // soften the direct spike
      d[i] = lp * Math.pow(1 - k, 2.6) * early * 0.9;
    }
  }
  return buf;
}
