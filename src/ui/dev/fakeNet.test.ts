import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetEvent, NetMatch, NetState } from '../../core/api';
import { FAKE_MAPS } from './fakeMisc';
import { createFakeNet } from './fakeNet';

// The fake drives the dev page; these tests keep it honest against the contract the UI relies on.
describe('fake NetApi', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('browses, hosts, adds an AI and starts a match', () => {
    const net = createFakeNet({ maps: FAKE_MAPS });
    net.dev.quiet();
    const states: NetState['phase'][] = [];
    const events: NetEvent[] = [];
    net.subscribe((s) => states.push(s.phase));
    net.on((e) => events.push(e));

    net.browse();
    expect(net.getState().phase).toBe('browsing');
    expect(net.getState().rooms.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(10000);
    expect(net.getState().rooms.some((r) => !r.compatible)).toBe(true);

    net.host('我', '測試房');
    expect(net.getState().phase).toBe('connecting');
    vi.advanceTimersByTime(1000);
    const room = net.getState().room!;
    expect(net.getState().phase).toBe('lobby');
    expect(room.isHost).toBe(true);
    expect(room.canStart).toBe(false);

    net.setSlot(1, { kind: 'ai', faction: 'ferrum', color: room.slots[0].kind === 'human' ? room.slots[0].color : '#000', team: 2, difficulty: 'hard' });
    const r2 = net.getState().room!;
    // colour clash with the host is resolved
    const colors = r2.slots.filter((s) => s.kind === 'human' || s.kind === 'ai').map((s) => (s as { color: string }).color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(r2.canStart).toBe(true);

    net.startMatch();
    const start = events.find((e): e is Extract<NetEvent, { type: 'matchStart' }> => e.type === 'matchStart');
    expect(start).toBeTruthy();
    const m: NetMatch = start!.match;
    expect(net.getState().phase).toBe('match');
    expect(m.setup.players).toHaveLength(2);
    expect(m.setup.players[m.localPlayer].controller).toBe('human');
    expect(new Set(m.setup.players.map((p) => p.startIndex)).size).toBe(2);

    m.send({ type: 'stop', ids: [1] } as never);
    expect(m.takeTurn(0)).toHaveLength(1);
    expect(m.takeTurn(1)).toHaveLength(0);
    net.dev.setStatus('waiting');
    expect(m.status.state).toBe('waiting');
    expect(m.status.waitingFor.length).toBeGreaterThan(0);
    expect(m.takeTurn(2)).toBeNull();
    net.dev.setStatus('running');
    expect(m.takeTurn(2)).toEqual([]);

    net.leave();
    expect(net.getState().phase).toBe('idle');
    expect(m.status.state).toBe('ended');
    expect(states).toContain('lobby');
    net.destroy();
  });

  it('reports failed joins and kicks as errors', () => {
    const net = createFakeNet({ maps: FAKE_MAPS });
    net.dev.quiet();
    const errors: string[] = [];
    net.on((e) => e.type === 'error' && errors.push(e.text));
    net.browse();
    vi.advanceTimersByTime(5000);
    const old = net.getState().rooms.find((r) => !r.compatible)!;
    net.join(old.id, '我');
    vi.advanceTimersByTime(1500);
    expect(net.getState().phase).toBe('idle');
    expect(errors).toHaveLength(1);

    net.browse();
    const ok = net.getState().rooms.find((r) => r.compatible && !r.inMatch && r.id === 'r-fri')!;
    net.join(ok.id, '我');
    vi.advanceTimersByTime(1500);
    expect(net.getState().phase).toBe('lobby');
    const room = net.getState().room!;
    expect(room.isHost).toBe(false);
    expect(room.slots.some((s) => s.kind === 'human' && s.isLocal)).toBe(true);
    // client cannot change the rules
    net.setRoom({ startingCredits: 5000 });
    expect(net.getState().room!.startingCredits).toBe(10000);
    net.setMe({ ready: true });
    expect(net.getState().room!.slots.some((s) => s.kind === 'human' && s.isLocal && s.ready)).toBe(true);

    net.dev.kicked();
    expect(net.getState().phase).toBe('idle');
    expect(errors.at(-1)).toContain('移出');
    net.destroy();
  });
});
