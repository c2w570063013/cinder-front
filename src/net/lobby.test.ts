import { describe, expect, it } from 'vitest';
import type { NetSlot } from '../core/api';
import { MAPS } from '../maps';
import { createNet } from './index';
import { addPeer, errors, makeLan, notices, pump, setupRoom, startRoom } from './testkit';
import { PALETTE } from './wire';

const occupiedColors = (slots: NetSlot[]): string[] => slots.flatMap((s) => (s.kind === 'human' || s.kind === 'ai' ? [s.color] : []));
const human = (slots: NetSlot[], name: string) => slots.find((s): s is Extract<NetSlot, { kind: 'human' }> => s.kind === 'human' && s.name === name);

describe('net api basics', () => {
  it('reports no transport in a plain non-browser environment and refuses politely', () => {
    const net = createNet({ maps: MAPS, buildId: 'x' });
    expect(net.transport).toBe('none');
    const errs: string[] = [];
    net.on((e) => e.type === 'error' && errs.push(e.text));
    net.host('A', 'B');
    net.browse();
    expect(errs.length).toBe(2);
    expect(errs[0]).toMatch(/區域網路/);
    expect(net.getState().phase).toBe('idle');
    net.leave();
    net.destroy();
  });

  it('getState returns a new object after every change', () => {
    const lan = makeLan();
    const a = addPeer(lan, 'A');
    const s0 = a.net.getState();
    const seen: unknown[] = [];
    a.net.subscribe((s) => seen.push(s));
    a.net.host('Alice', 'R');
    const s1 = a.net.getState();
    expect(s1).not.toBe(s0);
    expect(s1.phase).toBe('lobby');
    expect(seen[seen.length - 1]).toBe(s1);
    a.net.setRoom({ seed: 99 });
    expect(a.net.getState()).not.toBe(s1);
    expect(a.net.getState().room?.seed).toBe(99);
  });
});

describe('discovery and handshake', () => {
  it('advertises the room with players / map / compatibility', () => {
    const lan = makeLan();
    const [host] = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    const watcher = addPeer(lan, 'W');
    watcher.net.browse();
    pump(lan, 100);
    const rooms = watcher.net.getState().rooms;
    expect(rooms.length).toBe(1);
    expect(rooms[0]).toMatchObject({ name: 'Alice room', hostName: 'Alice', mapName: MAPS.find((m) => m.id === 'cross_mesa')!.name, players: 2, maxPlayers: 4, compatible: true, inMatch: false });
    expect(watcher.net.getState().phase).toBe('browsing');
    host.net.leave();
    pump(lan, 100);
    expect(watcher.net.getState().rooms.length).toBe(0);
  });

  it('a different buildId is flagged incompatible and refused (locally and in the handshake)', () => {
    const lan = makeLan();
    const [host] = setupRoom(lan, ['Alice'], 'cinder_pass');
    const other = addPeer(lan, 'Eve', 'some-other-build');
    other.net.browse();
    pump(lan, 100);
    const ad = other.net.getState().rooms[0];
    expect(ad.compatible).toBe(false);
    other.net.join(ad.id, 'Eve');
    expect(errors(other)).toEqual(['對方的遊戲版本與你不同,無法加入此房間。']);
    expect(other.net.getState().phase).toBe('browsing');
    // bypass the advertisement check → the host refuses in the handshake
    other.net.stopBrowse();
    other.net.join(host.tp.hostId, 'Eve');
    expect(other.net.getState().phase).toBe('connecting');
    pump(lan, 200);
    expect(errors(other)[1]).toBe('遊戲版本不同,無法加入此房間。');
    expect(other.net.getState().phase).toBe('idle');
    expect(host.net.getState().room!.slots.filter((s) => s.kind === 'human').length).toBe(1);
  });

  it('a full room refuses the next player', () => {
    const lan = makeLan();
    setupRoom(lan, ['Alice', 'Bob'], 'cinder_pass');
    const c = addPeer(lan, 'Carol');
    c.net.browse();
    pump(lan, 100);
    expect(c.net.getState().rooms[0].players).toBe(2);
    c.net.join(c.net.getState().rooms[0].id, 'Carol');
    pump(lan, 200);
    expect(errors(c)).toEqual(['房間已滿。']);
    expect(c.net.getState().phase).toBe('idle');
  });

  it('connecting to a room that is gone fails with an error', () => {
    const lan = makeLan();
    const c = addPeer(lan, 'Carol');
    c.net.join('mem-404', 'Carol');
    pump(lan, 100);
    expect(errors(c)).toEqual(['無法連線到房間。']);
    expect(c.net.getState().phase).toBe('idle');
  });

  it('join / leave produce notices for everyone; duplicate names get a suffix', () => {
    const lan = makeLan();
    const [host, bob] = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    const bob2 = addPeer(lan, 'Bob');
    bob2.net.browse();
    pump(lan, 100);
    bob2.net.join(bob2.net.getState().rooms[0].id, 'Bob');
    pump(lan, 200);
    expect(notices(host)).toEqual(['Bob 加入了房間', 'Bob 2 加入了房間']);
    expect(notices(bob)).toContain('Bob 2 加入了房間');
    expect(human(bob2.net.getState().room!.slots, 'Bob 2')?.isLocal).toBe(true);
    bob2.net.leave();
    pump(lan, 200);
    expect(notices(host)).toContain('Bob 2 離開了房間');
    expect(notices(bob)).toContain('Bob 2 離開了房間');
    expect(host.net.getState().room!.slots.filter((s) => s.kind === 'human').length).toBe(2);
  });

  it('host leaving the lobby sends everyone back to idle with an error', () => {
    const lan = makeLan();
    const [host, bob] = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    host.net.leave();
    pump(lan, 200);
    expect(errors(bob)).toEqual(['房主已關閉房間。']);
    expect(bob.net.getState().phase).toBe('idle');
  });

  it('a lost connection in the lobby frees the seat with a notice', () => {
    const lan = makeLan();
    const [host, , carol] = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    lan.network.cut(carol.tp);
    pump(lan, 200);
    expect(notices(host)).toContain('Carol 已離線');
    expect(human(host.net.getState().room!.slots, 'Carol')).toBeUndefined();
  });
});

describe('lobby rules', () => {
  it('room state is mirrored on clients with isHost / isLocal per machine', () => {
    const lan = makeLan();
    const [host, bob] = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    const hr = host.net.getState().room!;
    const br = bob.net.getState().room!;
    expect(hr.isHost).toBe(true);
    expect(br.isHost).toBe(false);
    expect(hr.slots.length).toBe(4);
    expect(human(hr.slots, 'Alice')).toMatchObject({ isHost: true, isLocal: true, ready: true });
    expect(human(hr.slots, 'Bob')).toMatchObject({ isHost: false, isLocal: false, ready: false });
    expect(human(br.slots, 'Alice')).toMatchObject({ isHost: true, isLocal: false });
    expect(human(br.slots, 'Bob')).toMatchObject({ isHost: false, isLocal: true });
    expect(br.mapId).toBe('cross_mesa');
    expect(br.seed).toBe(4242);
  });

  it('colours stay unique across occupied slots', () => {
    const lan = makeLan();
    const [host, bob] = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const slots = () => host.net.getState().room!.slots;
    expect(new Set(occupiedColors(slots())).size).toBe(3);
    const aliceColor = human(slots(), 'Alice')!.color;
    const bobColor = human(slots(), 'Bob')!.color;
    bob.net.setMe({ color: aliceColor }); // taken → refused
    pump(lan, 100);
    expect(human(slots(), 'Bob')!.color).toBe(bobColor);
    expect(human(bob.net.getState().room!.slots, 'Bob')!.color).toBe(bobColor);
    const free = PALETTE.find((c) => !occupiedColors(slots()).includes(c))!;
    bob.net.setMe({ color: free });
    pump(lan, 100);
    expect(human(slots(), 'Bob')!.color).toBe(free);
    bob.net.setMe({ color: '#123456' }); // not in the palette → refused
    pump(lan, 100);
    expect(human(slots(), 'Bob')!.color).toBe(free);
    // an AI asking for a taken colour gets a free one
    host.net.setSlot(3, { kind: 'ai', faction: 'random', color: aliceColor, team: 4, difficulty: 'hard' });
    const ai = slots()[3];
    expect(ai.kind).toBe('ai');
    expect(new Set(occupiedColors(slots())).size).toBe(4);
    host.net.setMe({ color: free }); // Bob has it
    expect(human(slots(), 'Alice')!.color).toBe(aliceColor);
    // palette = every faction colour
    expect(PALETTE.length).toBe(8);
  });

  it('canStart needs every human ready and at least two teams; clients never canStart', () => {
    const lan = makeLan();
    const [host, bob] = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    expect(host.net.getState().room!.canStart).toBe(false);
    host.net.startMatch();
    expect(errors(host)).toEqual(['尚有玩家未準備,或隊伍少於兩隊,無法開始。']);
    bob.net.setMe({ ready: true });
    pump(lan, 100);
    expect(host.net.getState().room!.canStart).toBe(true);
    expect(bob.net.getState().room!.canStart).toBe(false);
    bob.net.setMe({ team: 1 }); // same team as the host → one team
    pump(lan, 100);
    expect(host.net.getState().room!.canStart).toBe(false);
    host.net.setSlot(2, { kind: 'ai', faction: 'ferrum', color: PALETTE[5], team: 2, difficulty: 'normal' });
    expect(host.net.getState().room!.canStart).toBe(true); // humans vs AI
    host.net.setMe({ ready: false }); // the host is always ready
    expect(host.net.getState().room!.canStart).toBe(true);
  });

  it('map change resizes the seats and refuses a map that is too small', () => {
    const lan = makeLan();
    const [host, bob, carol] = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    bob.net.setMe({ ready: true });
    pump(lan, 100);
    host.net.setRoom({ mapId: 'cinder_pass' }); // 2 seats, 3 occupied
    expect(errors(host)).toEqual(['此地圖最多只能容納 2 名玩家,請先空出座位。']);
    expect(host.net.getState().room!.mapId).toBe('cross_mesa');
    expect(host.net.getState().room!.slots.length).toBe(4);
    const carolSeat = host.net.getState().room!.slots.findIndex((s) => s.kind === 'human' && s.name === 'Carol');
    host.net.setSlot(carolSeat, { kind: 'closed' }); // kicks Carol
    pump(lan, 500);
    expect(errors(carol)).toEqual(['你已被房主移出房間。']);
    expect(carol.net.getState().phase).toBe('idle');
    expect(notices(bob)).toContain('Carol 已被移出房間');
    host.net.setRoom({ mapId: 'cinder_pass' });
    pump(lan, 100);
    const r = host.net.getState().room!;
    expect(r.mapId).toBe('cinder_pass');
    expect(r.slots.map((s) => s.kind)).toEqual(['human', 'human']);
    expect(bob.net.getState().room!.slots.length).toBe(2);
    expect(human(r.slots, 'Bob')!.ready).toBe(false); // settings changed → confirm again
    host.net.setRoom({ mapId: 'ember_basin' });
    expect(host.net.getState().room!.slots.map((s) => s.kind)).toEqual(['human', 'human', 'open', 'open']);
    host.net.setRoom({ mapId: 'no_such_map' });
    expect(host.net.getState().room!.mapId).toBe('ember_basin');
  });

  it('setRoom / setSlot are host-only; settings validated', () => {
    const lan = makeLan();
    const [host, bob] = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    bob.net.setRoom({ seed: 1 });
    bob.net.setSlot(2, { kind: 'closed' });
    pump(lan, 100);
    expect(host.net.getState().room!.seed).toBe(4242);
    expect(host.net.getState().room!.slots[2].kind).toBe('open');
    host.net.setRoom({ startingCredits: -50, options: { fog: false, shortGame: true, superweapons: false } });
    pump(lan, 100);
    expect(bob.net.getState().room!.startingCredits).toBe(0);
    expect(bob.net.getState().room!.options).toEqual({ fog: false, shortGame: true, superweapons: false });
    host.net.setSlot(0, { kind: 'closed' }); // cannot remove yourself
    expect(host.net.getState().room!.slots[0].kind).toBe('human');
  });

  it('chat is relayed to everyone with the sender name and colour', () => {
    const lan = makeLan();
    const [host, bob, carol] = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    bob.net.chat('  大家好\u0007  ');
    host.net.chat('歡迎');
    pump(lan, 200);
    const chats = (p: typeof host) => p.events.flatMap((e) => (e.type === 'chat' ? [`${e.from}:${e.text}`] : []));
    for (const p of [host, bob, carol]) {
      expect(chats(p)).toContain('Bob:大家好');
      expect(chats(p)).toContain('Alice:歡迎');
    }
    const bobColor = human(host.net.getState().room!.slots, 'Bob')!.color;
    expect(carol.events.find((e) => e.type === 'chat' && e.from === 'Bob')).toMatchObject({ color: bobColor });
  });

  it('measures ping for every guest', () => {
    const lan = makeLan({ minDelay: 10, maxDelay: 20, seed: 1 });
    const [host] = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    pump(lan, 2500);
    const p = human(host.net.getState().room!.slots, 'Bob')!.pingMs;
    expect(p).toBeGreaterThanOrEqual(20);
    expect(p).toBeLessThanOrEqual(45);
  });

  it('match start: random factions and start positions resolved once, identical setup everywhere', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host] = peers;
    host.net.setSlot(3, { kind: 'ai', faction: 'random', color: PALETTE[7], team: 4, difficulty: 'easy' });
    pump(lan, 100);
    startRoom(lan, peers);
    const setups = peers.map((p) => p.match!.setup);
    const players = setups[0].players;
    expect(players.map((p) => p.controller)).toEqual(['human', 'human', 'human', 'ai']);
    expect(players[3].name).toBe('電腦 1');
    expect(players[3].difficulty).toBe('easy');
    for (const p of players) expect(['helion', 'ferrum']).toContain(p.faction);
    expect(new Set(players.map((p) => p.startIndex)).size).toBe(4);
    expect(new Set(players.map((p) => p.color)).size).toBe(4);
    for (const s of setups) {
      expect(JSON.stringify(s.players)).toBe(JSON.stringify(players));
      expect(s.seed).toBe(4242);
      expect(s.map.id).toBe('cross_mesa');
      expect(Array.from(s.map.terrain)).toEqual(Array.from(setups[0].map.terrain));
      expect(Array.from(s.map.ore)).toEqual(Array.from(setups[0].map.ore));
    }
    expect(peers.map((p) => p.match!.localPlayer)).toEqual([0, 1, 2]);
    expect(peers.map((p) => p.match!.isHost)).toEqual([true, false, false]);
    expect(peers.map((p) => p.net.getState().phase)).toEqual(['match', 'match', 'match']);
    expect(host.net.match).toBe(host.match);
    // same seed + same room → same resolution (deterministic from the seed)
    const lan2 = makeLan({ minDelay: 5, maxDelay: 50, seed: 77 });
    const peers2 = setupRoom(lan2, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    peers2[0].net.setSlot(3, { kind: 'ai', faction: 'random', color: PALETTE[7], team: 4, difficulty: 'easy' });
    pump(lan2, 200);
    startRoom(lan2, peers2);
    expect(JSON.stringify(peers2[0].match!.setup.players)).toBe(JSON.stringify(players));
  });
});
