import { describe, expect, it } from 'vitest';
import type { World } from '../core/types';
import { UNITS, WEAPONS } from '../data';
import { LINES, makeLine } from './announcer';
import {
  ackProfile,
  AnnouncerQueue,
  CombatHeat,
  deathProfile,
  impactSize,
  isVisibleTo,
  MAX_PAN,
  pickVoice,
  RateLimiter,
  spatialize,
  VoiceBudget,
  weaponProfile,
} from './logic';
import { chord, SONGS } from './music';

const cam = { x: 32, y: 32, zoom: 1 };
const W = 1440;
const H = 900;

describe('spatialize', () => {
  it('is centred and full gain at the camera centre', () => {
    const s = spatialize(32, 32, cam, W, H);
    expect(s.pan).toBeCloseTo(0);
    expect(s.gain).toBeCloseTo(1);
    expect(s.cutoff).toBeGreaterThan(18000);
    expect(s.audible).toBe(true);
  });

  it('pans by screen x: +x world goes right, +y world goes left (isometric)', () => {
    expect(spatialize(40, 32, cam, W, H).pan).toBeGreaterThan(0.2);
    expect(spatialize(32, 40, cam, W, H).pan).toBeLessThan(-0.2);
    // moving along the screen-vertical axis (x and y together) does not pan
    expect(spatialize(38, 38, cam, W, H).pan).toBeCloseTo(0);
    expect(Math.abs(spatialize(500, 32, cam, W, H).pan)).toBeLessThanOrEqual(MAX_PAN);
  });

  it('attenuates monotonically with distance and goes silent far off-screen', () => {
    let prev = Infinity;
    for (let d = 0; d < 80; d += 2) {
      const g = spatialize(32 + d, 32 - d, cam, W, H).gain;
      expect(g).toBeLessThanOrEqual(prev + 1e-9);
      prev = g;
    }
    const far = spatialize(32 + 80, 32 - 80, cam, W, H);
    expect(far.gain).toBe(0);
    expect(far.audible).toBe(false);
  });

  it('gets duller off-screen', () => {
    const edge = spatialize(32 + 30, 32 - 30, cam, W, H); // ~1.33 half-screens away
    expect(edge.dist).toBeGreaterThan(1);
    expect(edge.cutoff).toBeLessThan(12000);
  });

  it('is quieter when zoomed out and louder when zoomed in', () => {
    const out = spatialize(32, 32, { ...cam, zoom: 0.5 }, W, H).gain;
    const mid = spatialize(32, 32, cam, W, H).gain;
    const inn = spatialize(32, 32, { ...cam, zoom: 2 }, W, H).gain;
    expect(out).toBeLessThan(mid);
    expect(inn).toBeGreaterThan(mid);
  });

  it('reach and floor let big sounds carry', () => {
    const x = 32 + 45;
    const y = 32 - 45; // 2 half-screens to the right
    const normal = spatialize(x, y, cam, W, H).gain;
    const big = spatialize(x, y, cam, W, H, 3).gain;
    expect(big).toBeGreaterThan(normal);
    expect(spatialize(500, -400, cam, W, H, 1, 0.3).gain).toBeCloseTo(0.3);
  });
});

describe('isVisibleTo', () => {
  const mk = (fog: boolean): World => {
    const visible = new Uint8Array(16);
    visible[1 * 4 + 2] = 1;
    return {
      setup: { options: { fog } },
      map: { width: 4, height: 4 },
      players: [{ id: 0, visible }],
    } as unknown as World;
  };
  it('respects the fog grid', () => {
    const w = mk(true);
    expect(isVisibleTo(w, 0, 2.5, 1.5)).toBe(true);
    expect(isVisibleTo(w, 0, 0.5, 0.5)).toBe(false);
    expect(isVisibleTo(w, 0, -1, 9)).toBe(false);
  });
  it('sees everything when fog is disabled', () => {
    expect(isVisibleTo(mk(false), 0, 0.5, 0.5)).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('enforces the minimum interval per key', () => {
    const l = new RateLimiter(0.5);
    expect(l.hit('a', 0, 0.1)).toBe(1);
    expect(l.hit('a', 0.05, 0.1)).toBe(0);
    expect(l.hit('b', 0.05, 0.1)).toBe(1);
    expect(l.hit('a', 0.1, 0.1)).toBeGreaterThan(0);
  });

  it('ducks repeated sounds and recovers after silence', () => {
    const l = new RateLimiter(0.5);
    let g = 1;
    for (let i = 0; i < 40; i++) g = l.hit('gun', i * 0.07, 0.06);
    expect(g).toBeLessThan(0.5);
    expect(g).toBeGreaterThan(0.2);
    expect(l.hit('gun', 40 * 0.07 + 5, 0.06)).toBeCloseTo(1, 2);
  });

  it('40 tanks firing in the same tick collapse to one voice', () => {
    const l = new RateLimiter();
    let played = 0;
    for (let i = 0; i < 40; i++) if (l.hit('fire:f_hammer_cannon', 1, 0.07)) played++;
    expect(played).toBe(1);
  });
});

describe('VoiceBudget', () => {
  it('caps voices, steals the weakest and refuses weaker newcomers', () => {
    const b = new VoiceBudget<string>(2);
    expect(b.request(0, 3)).toEqual({ ok: true, stolen: null });
    b.add(1, 3, 'a');
    b.request(0, 5);
    b.add(2, 5, 'b');
    expect(b.request(0, 1)).toEqual({ ok: false, stolen: null });
    expect(b.request(0, 4)).toEqual({ ok: true, stolen: 'a' });
    b.add(3, 4, 'c');
    expect(b.count).toBe(2);
    expect(b.prune(2.5).sort()).toEqual(['b']);
    expect(b.count).toBe(1);
  });
});

describe('AnnouncerQueue', () => {
  const line = (key: string, priority: number, ttl = 5, cooldown = 0) => ({ key, text: key, priority, ttl, cooldown });

  it('speaks by priority and keeps a gap between lines', () => {
    const q = new AnnouncerQueue(4, 0.5);
    q.push(line('low', 1), 0);
    q.push(line('high', 3), 0);
    expect(q.next(0)?.line.key).toBe('high');
    expect(q.next(0.1)).toBeNull(); // still speaking
    q.done(1);
    expect(q.next(1.2)).toBeNull(); // global gap
    expect(q.next(1.6)?.line.key).toBe('low');
  });

  it('drops stale lines', () => {
    const q = new AnnouncerQueue();
    q.push(line('old', 1, 2), 0);
    expect(q.next(3)).toBeNull();
    expect(q.pending).toBe(0);
  });

  it('applies per-key cooldowns and dedups', () => {
    const q = new AnnouncerQueue();
    expect(q.push(line('unitLost', 2, 5, 8), 0)).toBe(true);
    expect(q.push(line('unitLost', 2, 5, 8), 1)).toBe(false);
    q.next(1);
    q.done(2);
    expect(q.push(line('unitLost', 2, 5, 8), 5)).toBe(false);
    expect(q.push(line('unitLost', 2, 5, 8), 9)).toBe(true);
  });

  it('urgent lines interrupt routine ones, routine ones never interrupt', () => {
    const q = new AnnouncerQueue();
    q.push(line('routine', 1), 0);
    expect(q.next(0)?.interrupt).toBe(false);
    q.push(line('other', 3), 0.1);
    expect(q.next(0.1)).toBeNull();
    q.push(line('urgent', 4), 0.2);
    const n = q.next(0.2);
    expect(n?.line.key).toBe('urgent');
    expect(n?.interrupt).toBe(true);
  });

  it('bounds the queue, dropping the least important', () => {
    const q = new AnnouncerQueue(2);
    q.push(line('a', 2), 0);
    q.push(line('b', 3), 0);
    expect(q.push(line('c', 1), 0)).toBe(false);
    expect(q.push(line('d', 5), 0)).toBe(true);
    expect(q.pending).toBe(2);
    expect(q.next(0)?.line.key).toBe('d');
  });

  it('every announcer line is well-formed Traditional Chinese text', () => {
    for (const id of Object.keys(LINES) as (keyof typeof LINES)[]) {
      const l = makeLine(id);
      expect(l.text.length).toBeGreaterThan(2);
      expect(/[一-鿿]/.test(l.text)).toBe(true);
      expect(l.ttl).toBeGreaterThan(0);
    }
    expect(makeLine('powerReady', 'orbital_lance').text).toContain('天基光矛');
  });
});

describe('pickVoice', () => {
  it('only accepts Taiwanese Mandarin voices', () => {
    expect(pickVoice([{ lang: 'en-US', name: 'A' }, { lang: 'zh-CN', name: 'B' }, { lang: 'zh-HK', name: 'C' }])).toBe(-1);
    expect(pickVoice([{ lang: 'en-US', name: 'A' }, { lang: 'zh_TW', name: 'B' }])).toBe(1);
  });
  it('prefers enhanced local voices', () => {
    const v = [
      { lang: 'zh-TW', name: 'Plain', localService: true },
      { lang: 'zh-TW', name: 'Plain (Enhanced)', localService: true },
    ];
    expect(pickVoice(v)).toBe(1);
  });
  it('prefers a natural voice over the multi-language character voices', () => {
    const v = [
      { lang: 'zh-TW', name: 'Eddy (Chinese (Taiwan))', localService: true, default: true },
      { lang: 'zh-TW', name: 'Meijia', localService: true },
    ];
    expect(pickVoice(v)).toBe(1);
    expect(pickVoice([v[0]])).toBe(0);
  });
});

describe('CombatHeat', () => {
  it('enters battle under sustained fire and relaxes later with hysteresis', () => {
    const h = new CombatHeat(6, 5, 1, 20);
    let t = 0;
    h.add(0.3, t);
    expect(h.update(t)).toBe(false);
    for (; t < 6; t += 0.25) h.add(0.5, t);
    expect(h.update(t)).toBe(true);
    // quiet, but the minimum battle time has not elapsed
    expect(h.update(t + 10)).toBe(true);
    expect(h.update(t + 60)).toBe(false);
  });
});

describe('data-derived profiles', () => {
  it('heavier weapons have more power; faction comes from the id prefix', () => {
    expect(weaponProfile('f_siege', 'shell').power).toBeGreaterThan(weaponProfile('h_javelin_cannon', 'shell').power);
    expect(weaponProfile('h_rifle', 'tracer').helion).toBe(true);
    expect(weaponProfile('f_smg', 'tracer').helion).toBe(false);
    expect(weaponProfile('nope', 'beam').kind).toBe('beam');
    for (const w of Object.values(WEAPONS)) {
      const p = weaponProfile(w.id, w.projectile).power;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('explosions scale with what died', () => {
    const inf = deathProfile('h_warden');
    const tank = deathProfile('f_hammer');
    const big = deathProfile('f_colossus');
    const hq = deathProfile('f_core');
    expect(inf.cls).toBe('infantry');
    expect(tank.cls).toBe('vehicle');
    expect(deathProfile('h_kestrel').cls).toBe('aircraft');
    expect(deathProfile('h_wall').cls).toBe('wall');
    expect(inf.size).toBeLessThan(tank.size);
    expect(tank.size).toBeLessThan(big.size);
    expect(big.size).toBeLessThan(hq.size);
    expect(impactSize('f_vulture_bomb', 1.5)).toBeGreaterThan(impactSize('f_grenade', 0.8));
  });

  it('ack profiles cover every unit', () => {
    for (const u of Object.values(UNITS)) expect(ackProfile(u.id).cls).toBe(u.category);
    expect(ackProfile('h_nexus').cls).toBe('building');
  });
});

describe('music data', () => {
  it('parses chord symbols into sane voicings', () => {
    const c = chord('Dm9');
    expect(c.root).toBe(38);
    expect(c.notes.every((n) => n >= 55 && n <= 66)).toBe(true);
    expect(chord('Cm/Bb').root).toBe(34);
    expect(() => chord('H7')).toThrow();
  });

  it('every song form uses valid chords and whole sections', () => {
    for (const song of Object.values(SONGS)) {
      expect(song.bpm).toBeGreaterThan(40);
      for (const [, chords] of song.form) {
        expect(chords.length).toBeGreaterThan(0);
        for (const sym of chords) expect(chord(sym).notes.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
