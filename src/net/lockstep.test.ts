import { describe, expect, it } from 'vitest';
import { makeRng } from '../core/rng';
import { sim } from '../sim';
import { DROP_MS } from './lockstep';
import { addPeer, makeLan, notices, pump, run, setupRoom, startRoom, type Lan, type TestPeer } from './testkit';

const allAt = (peers: TestPeer[], tick: number): boolean => peers.every((p) => p.world!.tick >= tick);

function runUntilAll(lan: Lan, peers: TestPeer[], tick: number, maxFrames: number, skip?: (p: TestPeer, f: number) => boolean): void {
  for (let f = 0; f < maxFrames && !allAt(peers, tick); f++) run(lan, 1, { untilTick: tick, skip: skip ? (p) => skip(p, f) : undefined });
}

describe('lockstep end to end', () => {
  it('host + 2 clients + host-run AI stay bit-identical for 6000 ticks over a jittery network', () => {
    const lan = makeLan({ minDelay: 2, maxDelay: 90, seed: 11 });
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host, bob, carol] = peers;
    host.net.setSlot(3, { kind: 'ai', faction: 'ferrum', color: '#7bd148', team: 4, difficulty: 'normal' });
    host.net.setMe({ faction: 'helion' });
    bob.net.setMe({ faction: 'ferrum' });
    carol.net.setMe({ faction: 'helion' });
    pump(lan, 100);
    startRoom(lan, peers);
    for (const p of peers) p.bot = true;
    const statesSeen = new Set<string>();
    for (const p of peers) p.net.subscribe((s) => s.match && statesSeen.add(s.match.state));

    // random frame hiccups so clients fall behind and have to catch up
    const rng = makeRng(99);
    runUntilAll(lan, peers, 6000, 16000, (p) => p !== host && rng.next() < 0.15);

    expect(peers.map((p) => p.world!.tick)).toEqual([6000, 6000, 6000]);
    const hashes = peers.map((p) => sim.hashWorld(p.world!));
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(hashes[0]);
    expect(statesSeen.has('desync')).toBe(false);
    for (const p of peers) expect(p.match!.status.state).not.toBe('desync');

    // identical command lists, identical order, on every tick
    for (let t = 0; t < 6000; t++) {
      const ref = JSON.stringify(host.applied.get(t));
      expect(JSON.stringify(bob.applied.get(t))).toBe(ref);
      expect(JSON.stringify(carol.applied.get(t))).toBe(ref);
    }
    // everyone (3 humans + the AI) actually commanded something, and the match did something
    const issuers = new Set<number>();
    for (const cmds of host.applied.values()) for (const c of cmds) issuers.add(c.player);
    expect([...issuers].sort()).toEqual([0, 1, 2, 3]);
    const w = host.world!;
    for (let i = 0; i < 4; i++) expect(w.players[i].stats.buildingsBuilt).toBeGreaterThan(0);
    // the hiccups really forced clients to catch up (several steps in one frame)
    expect(bob.steps).toBe(6000);
    expect(bob.maxBurst).toBeGreaterThan(1);
    expect(carol.maxBurst).toBeGreaterThan(1);
    expect(w.entities.size).toBeGreaterThan(30);
  }, 180_000);
});

describe('lockstep authority and failure handling', () => {
  function twoPlayer(lan: Lan): TestPeer[] {
    const peers = setupRoom(lan, ['Alice', 'Bob'], 'cinder_pass');
    startRoom(lan, peers);
    return peers;
  }

  it('forged cmd.player is rewritten to the sender; garbage is ignored', () => {
    const lan = makeLan();
    const [host, bob] = twoPlayer(lan);
    run(lan, 20);
    const conn = bob.tp.openConns()[0];
    bob.tp.send(conn, JSON.stringify({ t: 'cmd', c: [{ type: 'stop', player: 0, ids: [] }, { type: 'surrender', player: 0, extra: 'x' }] }));
    bob.tp.send(conn, 'not json');
    bob.tp.send(conn, JSON.stringify({ t: 'turn', k: 5, c: [] }));
    bob.tp.send(conn, JSON.stringify({ t: 'ack', k: 1e9 }));
    bob.tp.send(conn, JSON.stringify({ t: 'cmd', c: [{ type: 'nuke', player: 1 }, null, 7] }));
    bob.tp.send(conn, 'x'.repeat(300_000));
    // the host's own UI cannot command Bob either; the client API cannot command the host
    host.match!.send({ type: 'stop', player: 1, ids: [] });
    bob.match!.send({ type: 'guard', player: 0, ids: [] });
    run(lan, 40);
    const applied = [...host.applied.values()].flat();
    const stop = applied.filter((c) => c.type === 'stop');
    expect(stop.map((c) => c.player).sort()).toEqual([0, 1]); // host's own (→0) and Bob's forged (→1)
    expect(applied.filter((c) => c.type === 'guard').map((c) => c.player)).toEqual([1]);
    expect(applied.filter((c) => c.type === 'surrender').map((c) => c.player)).toEqual([1]);
    expect(applied.some((c) => (c as { type: string }).type === 'nuke')).toBe(false);
    expect(host.world!.players[0].defeated).toBe(false);
    expect(host.world!.players[1].defeated).toBe(true);
    expect(bob.world!.players[1].defeated).toBe(true);
    expect(host.match!.status.state).toBe('running');
  });

  it('host-run AI commands are accepted only from the host', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    const [host, bob] = peers;
    host.net.setSlot(2, { kind: 'ai', faction: 'helion', color: '#e5484d', team: 3, difficulty: 'easy' });
    pump(lan, 50);
    startRoom(lan, peers);
    run(lan, 10);
    host.match!.send({ type: 'stop', player: 2, ids: [] }); // host → AI seat: accepted
    bob.tp.send(bob.tp.openConns()[0], JSON.stringify({ t: 'cmd', c: [{ type: 'guard', player: 2, ids: [] }] })); // client → AI seat: rewritten
    run(lan, 30);
    const applied = [...host.applied.values()].flat();
    expect(applied.filter((c) => c.type === 'stop').map((c) => c.player)).toEqual([2]);
    expect(applied.filter((c) => c.type === 'guard').map((c) => c.player)).toEqual([1]);
  });

  it('a client that drops is surrendered by the host and the match goes on', () => {
    const lan = makeLan({ minDelay: 1, maxDelay: 30, seed: 5 });
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host, bob, carol] = peers;
    host.net.setMe({ faction: 'helion' });
    bob.net.setMe({ faction: 'ferrum' });
    carol.net.setMe({ faction: 'ferrum' });
    pump(lan, 50);
    startRoom(lan, peers);
    for (const p of peers) p.bot = true;
    run(lan, 200);
    const cutAt = host.world!.tick;
    lan.network.cut(carol.tp);
    lan.peers.splice(lan.peers.indexOf(carol), 1);
    runUntilAll(lan, [host, bob], cutAt + 400, 2000);
    expect(host.world!.tick).toBe(cutAt + 400);
    expect(host.world!.players[2].defeated).toBe(true);
    expect(bob.world!.players[2].defeated).toBe(true);
    expect(sim.hashWorld(bob.world!)).toBe(sim.hashWorld(host.world!));
    expect(host.match!.status.state).toBe('running');
    expect(host.match!.status.players[2].connected).toBe(false);
    pump(lan, 1100); // next stats broadcast
    expect(bob.match!.status.players[2].connected).toBe(false);
    expect(notices(host).some((n) => n.includes('Carol') && n.includes('離線'))).toBe(true);
    expect(notices(bob).some((n) => n.includes('Carol') && n.includes('離線'))).toBe(true);
  }, 60_000);

  it('a hung client stalls the host ("waiting"), then is dropped after the timeout', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host, bob, carol] = peers;
    startRoom(lan, peers);
    run(lan, 40);
    carol.frozen = true;
    run(lan, 40);
    expect(host.match!.status.state).toBe('waiting');
    expect(host.match!.status.waitingFor).toEqual(['Carol']);
    expect(bob.match!.status.state).toBe('waiting');
    expect(bob.match!.status.waitingFor).toEqual(['Carol']);
    const stalledAt = host.world!.tick;
    run(lan, 40);
    expect(host.world!.tick).toBe(stalledAt); // really stalled
    run(lan, Math.ceil(DROP_MS / 50) + 20);
    expect(host.match!.status.state).toBe('running');
    run(lan, 40);
    expect(host.world!.tick).toBeGreaterThan(stalledAt + 20);
    expect(host.world!.players[2].defeated).toBe(true);
    expect(host.match!.status.players[2].connected).toBe(false);
    expect(bob.match!.status.state).toBe('running');
    expect(carol.match!.status.state).toBe('hostLost'); // its connection was closed by the host
  }, 60_000);

  it('host loss → hostLost on every client', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host, bob, carol] = peers;
    startRoom(lan, peers);
    run(lan, 60);
    lan.network.cut(host.tp);
    run(lan, 20);
    expect(bob.match!.status.state).toBe('hostLost');
    expect(carol.match!.status.state).toBe('hostLost');
    expect(bob.net.getState().match?.state).toBe('hostLost');
    const t = bob.world!.tick;
    run(lan, 20);
    expect(bob.world!.tick).toBe(t);
    expect(bob.match!.takeTurn(bob.world!.tick)).toBeNull();
  });

  it('host silently gone (no TCP close) → hostLost after the heartbeat timeout', () => {
    const lan = makeLan();
    const [host, bob] = twoPlayer(lan);
    run(lan, 20);
    host.frozen = true;
    lan.peers.splice(lan.peers.indexOf(host), 1);
    // keep the host's sockets open but stop all its traffic: detach its listener and timers by destroying silently
    host.tp.dead = true;
    run(lan, 240);
    expect(bob.match!.status.state).toBe('hostLost');
  });

  it('a deliberately diverged world is reported as desync on every peer', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host, bob, carol] = peers;
    startRoom(lan, peers);
    run(lan, 100);
    expect(host.match!.status.state).toBe('running');
    bob.world!.players[1].credits += 1; // one credit off on one machine
    run(lan, 60);
    for (const p of peers) {
      expect(p.match!.status.state).toBe('desync');
      expect(p.net.getState().match?.state).toBe('desync');
    }
    expect(host.match!.takeTurn(host.world!.tick)).toBeNull();
    void carol;
  });

  it('leave() ends the match locally and surrenders the leaver on the others', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host, bob, carol] = peers;
    startRoom(lan, peers);
    run(lan, 30);
    const m = carol.match!;
    m.leave();
    expect(m.status.state).toBe('ended');
    expect(carol.net.getState().phase).toBe('idle');
    lan.peers.splice(lan.peers.indexOf(carol), 1);
    run(lan, 60);
    expect(host.world!.players[2].defeated).toBe(true);
    expect(bob.world!.players[2].defeated).toBe(true);
    expect(notices(bob).some((n) => n.includes('Carol') && n.includes('離開了對戰'))).toBe(true);
    // host leaving: host 'ended', Bob 'hostLost'
    const hm = host.match!;
    host.net.leave();
    expect(hm.status.state).toBe('ended');
    run(lan, 20);
    expect(bob.match!.status.state).toBe('hostLost');
  });

  it('status objects are fresh on change and mirrored in NetState.match', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob', 'Carol'], 'cross_mesa');
    const [host, , carol] = peers;
    startRoom(lan, peers);
    run(lan, 20);
    const before = host.match!.status;
    expect(host.net.getState().match).toBe(before);
    carol.frozen = true;
    run(lan, 40);
    const after = host.match!.status;
    expect(after).not.toBe(before);
    expect(before.state).toBe('running');
    expect(after.state).toBe('waiting');
    expect(host.net.getState().match).toBe(after);
  });

  it('a peer with nothing to do: unknown peer added after start cannot join', () => {
    const lan = makeLan();
    const peers = setupRoom(lan, ['Alice', 'Bob'], 'cross_mesa');
    startRoom(lan, peers);
    const late = addPeer(lan, 'Dave');
    late.net.browse();
    pump(lan, 50);
    const ad = late.net.getState().rooms[0];
    expect(ad.inMatch).toBe(true);
    late.net.join(ad.id, 'Dave');
    expect(late.events.some((e) => e.type === 'error' && e.text.includes('對戰中'))).toBe(true);
    // bypassing the advertisement: the host refuses during the handshake
    late.net.stopBrowse();
    late.net.join(peers[0].tp.hostId, 'Dave');
    pump(lan, 100);
    expect(late.events.filter((e) => e.type === 'error' && e.text.includes('對戰中')).length).toBe(2);
    expect(late.net.getState().phase).toBe('idle');
  });
});
