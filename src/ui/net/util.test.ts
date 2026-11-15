import { describe, expect, it } from 'vitest';
import type { NetRoom, NetSlot } from '../../core/api';
import { ALL_COLORS, cleanName, defaultPlayerName, freeColor, freeTeam, joinBlocker, localSeat, seatsKey, startBlocker } from './util';

const human = (name: string, extra: Partial<Extract<NetSlot, { kind: 'human' }>> = {}): NetSlot => ({
  kind: 'human',
  name,
  faction: 'random',
  color: ALL_COLORS[0],
  team: 1,
  ready: false,
  isHost: false,
  isLocal: false,
  pingMs: 30,
  ...extra,
});

const room = (slots: NetSlot[], canStart = false): NetRoom => ({
  name: 'r',
  isHost: true,
  mapId: 'm',
  seed: 1,
  startingCredits: 10000,
  options: { fog: true, shortGame: false, superweapons: true },
  slots,
  canStart,
});

describe('net ui helpers', () => {
  it('cleans names', () => {
    expect(cleanName('  a\u0007  b  ')).toBe('a b');
    expect(cleanName('一二三四五六七八九十一二三四五六七八')).toHaveLength(16);
    expect(cleanName('   ')).toBe('');
    expect(defaultPlayerName(() => 0.5)).toBe('指揮官-5500');
  });

  it('picks colours and teams nobody else uses', () => {
    const slots: NetSlot[] = [human('a', { color: ALL_COLORS[0] }), { kind: 'ai', faction: 'random', color: ALL_COLORS[1], team: 2, difficulty: 'easy' }, { kind: 'open' }];
    const c = freeColor(slots, 2, 'random');
    expect(c).not.toBe(ALL_COLORS[0]);
    expect(c).not.toBe(ALL_COLORS[1]);
    // its own colour is not counted as taken
    expect(freeColor(slots, 0, 'random')).toBe(ALL_COLORS[0]);
    expect(freeTeam(slots)).toBe(3);
  });

  it('explains why rooms cannot be joined / started', () => {
    const ad = { id: 'x', name: 'x', hostName: 'h', mapName: 'm', players: 1, maxPlayers: 2, compatible: true, inMatch: false };
    expect(joinBlocker(ad)).toBeNull();
    expect(joinBlocker({ ...ad, compatible: false })).toBe('不相容版本');
    expect(joinBlocker({ ...ad, inMatch: true })).toBe('對戰中');
    expect(joinBlocker({ ...ad, players: 2 })).toBe('已滿');

    expect(startBlocker(room([human('a', { isHost: true, isLocal: true }), { kind: 'open' }]))).toBe('至少需要兩名玩家');
    expect(startBlocker(room([human('a', { isHost: true }), human('b')]))).toBe('至少需要兩個不同的隊伍');
    expect(startBlocker(room([human('a', { isHost: true }), human('b', { team: 2 })]))).toContain('b');
    expect(startBlocker(room([human('a', { isHost: true }), human('b', { team: 2, ready: true })], true))).toBe('');
  });

  it('seat key ignores pings', () => {
    const a = room([human('a', { pingMs: 10, isLocal: true })]);
    const b = room([human('a', { pingMs: 90, isLocal: true })]);
    expect(seatsKey(a)).toBe(seatsKey(b));
    expect(localSeat(a)?.index).toBe(0);
  });
});
