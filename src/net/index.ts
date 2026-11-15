// LAN multiplayer: room discovery, lobby protocol and match start. Lockstep lives in lockstep.ts,
// the wire format in wire.ts, transports in transport.ts / loopback.ts / memory.ts.
import type { CreateNet, MapInfo, NativeNetEvent, NetApi, NetDeps, NetEvent, NetMatch, NetRoom, NetRoomAd, NetSlot, NetState } from '../core/api';
import type { GameSetup } from '../core/types';
import { makeRng } from '../core/rng';
import { realClock, type Clock } from './clock';
import { ClientMatch, HostMatch, type MatchPlayerInfo } from './lockstep';
import { createLoopbackTransport } from './loopback';
import { T } from './text';
import { createNativeTransport, findNativeBridge, type Transport } from './transport';
import * as W from './wire';

const POLL_MS = 250;
const PING_MS = 1000;
const HELLO_TIMEOUT_MS = 5000;
const PEER_TIMEOUT_MS = 20_000;
const HOST_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Give a farewell message (kick / refuse / bye) time to leave before closing the connection. */
const CLOSE_LINGER_MS = 300;
const CHAT_GAP_MS = 150;
const DEFAULT_CREDITS = 10_000;
const MAX_CREDITS = 1_000_000;

export interface NetOptions {
  /** Force a transport (tests: a MemoryTransport). `null` = none. Default: native bridge, else loopback in dev. */
  transport?: Transport | null;
  clock?: Clock;
  /** Initial room seed source (lobby only, never used by the sim). */
  randomSeed?: () => number;
}

interface Peer {
  conn: number;
  pid: number;
  name: string;
  joined: boolean;
  openedAt: number;
  lastSeen: number;
  lastChat: number;
}

function loopbackAllowed(): boolean {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return false;
  let query = false;
  try {
    query = new URLSearchParams(window.location.search).get('net') === 'loopback';
  } catch {
    query = false;
  }
  return query || import.meta.env?.DEV === true;
}

function pickTransport(): Transport | null {
  const bridge = findNativeBridge();
  if (bridge) return createNativeTransport(bridge);
  if (loopbackAllowed()) return createLoopbackTransport();
  return null;
}

function toNetSlot(s: W.WireSlot, me: number): NetSlot {
  switch (s.k) {
    case 'open':
      return { kind: 'open' };
    case 'closed':
      return { kind: 'closed' };
    case 'ai':
      return { kind: 'ai', faction: s.faction, color: s.color, team: s.team, difficulty: s.difficulty };
    case 'human':
      return { kind: 'human', name: s.name, faction: s.faction, color: s.color, team: s.team, ready: s.ready, isHost: s.pid === 0, isLocal: s.pid === me, pingMs: s.ping };
  }
}

class NetCore implements NetApi {
  readonly transport: NetApi['transport'];
  private state: NetState = { phase: 'idle', rooms: [], room: null, match: null };
  private readonly stateSubs = new Set<(s: NetState) => void>();
  private readonly eventSubs = new Set<(e: NetEvent) => void>();
  private readonly unlisten: () => void;
  private readonly myBuildHash: string;
  private readonly ads = new Map<string, NetRoomAd>();
  private browsing = false;
  private role: 'none' | 'host' | 'client' = 'none';
  private stopPoll: (() => void) | null = null;
  private lastPing = -Infinity;
  /** Host: the authoritative room. Client: the host's latest broadcast. */
  private room: W.WireRoom | null = null;
  // host
  private readonly peers = new Map<number, Peer>();
  private nextPid = 1;
  private lastAd = '';
  private hostMatch: HostMatch | null = null;
  // client
  private hostConn = -1;
  private joinTarget = '';
  private myPid = -1;
  private myName = '';
  private connectStarted = 0;
  private lastHostMsg = 0;
  private clientMatch: ClientMatch | null = null;

  constructor(
    private readonly deps: NetDeps,
    private readonly tp: Transport | null,
    private readonly clock: Clock,
    private readonly randomSeed: () => number,
  ) {
    this.transport = !tp ? 'none' : tp.kind === 'native' ? 'native' : 'loopback';
    this.myBuildHash = W.buildHash(deps.buildId);
    this.unlisten = tp ? tp.listen((e) => this.onTransport(e)) : () => {};
  }

  // ───────────── NetApi ─────────────

  get match(): NetMatch | null {
    return this.hostMatch ?? this.clientMatch;
  }

  getState(): NetState {
    return this.state;
  }

  subscribe(cb: (state: NetState) => void): () => void {
    this.stateSubs.add(cb);
    return () => {
      this.stateSubs.delete(cb);
    };
  }

  on(cb: (event: NetEvent) => void): () => void {
    this.eventSubs.add(cb);
    return () => {
      this.eventSubs.delete(cb);
    };
  }

  browse(): void {
    if (!this.tp) return this.error(T.noTransport);
    if (this.state.phase !== 'idle' && this.state.phase !== 'browsing') return;
    if (!this.browsing) {
      this.browsing = true;
      this.tp.browse();
    }
    this.set({ phase: 'browsing', rooms: this.roomList() });
  }

  stopBrowse(): void {
    if (!this.browsing) return;
    this.stopBrowsing();
    if (this.state.phase === 'browsing') this.set({ phase: 'idle', rooms: [] });
    else this.set({ rooms: [] });
  }

  host(playerName: string, roomName: string): void {
    if (!this.tp) return this.error(T.noTransport);
    const map = this.deps.maps[0];
    if (!map) return this.error(T.noMaps);
    this.teardown();
    this.stopBrowsing();
    const name = W.cleanText(playerName, W.MAX_NAME) || T.defaultPlayer;
    const rname = W.cleanText(roomName, W.MAX_ROOM_NAME) || W.cleanText(T.defaultRoom(name), W.MAX_ROOM_NAME);
    this.role = 'host';
    this.nextPid = 1;
    const slots: W.WireSlot[] = [];
    for (let i = 0; i < Math.min(W.MAX_SEATS, map.maxPlayers); i++) slots.push({ k: 'open' });
    slots[0] = { k: 'human', pid: 0, name, faction: 'random', color: W.PALETTE[0], team: 1, ready: true, ping: 0 };
    this.room = {
      name: rname,
      mapId: map.id,
      seed: this.randomSeed() | 0,
      credits: DEFAULT_CREDITS,
      options: { fog: true, shortGame: true, superweapons: true },
      slots,
    };
    this.lastAd = this.adText();
    this.tp.host(rname, this.lastAd);
    this.startPoll();
    this.set({ phase: 'lobby', rooms: [], room: this.view(), match: null });
  }

  join(roomId: string, playerName: string): void {
    if (!this.tp) return this.error(T.noTransport);
    if (typeof roomId !== 'string' || !roomId) return this.error(T.connectFailed);
    const ad = this.ads.get(roomId);
    if (ad && !ad.compatible) return this.error(T.incompatible);
    if (ad && ad.inMatch) return this.error(T.refuse.match);
    this.teardown();
    this.stopBrowsing();
    this.role = 'client';
    this.myName = W.cleanText(playerName, W.MAX_NAME) || T.defaultPlayer;
    this.joinTarget = roomId;
    this.connectStarted = this.clock.now();
    this.lastHostMsg = this.connectStarted;
    this.startPoll();
    this.set({ phase: 'connecting', rooms: [], room: null, match: null });
    this.tp.connect(roomId);
  }

  leave(): void {
    this.teardown();
    this.stopBrowsing();
    this.set({ phase: 'idle', rooms: [], room: null, match: null });
  }

  setRoom(patch: Partial<Pick<NetRoom, 'mapId' | 'seed' | 'startingCredits' | 'options'>>): void {
    const r = this.room;
    if (this.role !== 'host' || !r || this.hostMatch || !W.isObj(patch)) return;
    let changed = false;
    if (patch.mapId !== undefined && patch.mapId !== r.mapId) {
      const info = this.mapInfo(patch.mapId);
      if (!info) return;
      const occupied = r.slots.filter(W.isOccupied).length;
      const seats = Math.min(W.MAX_SEATS, info.maxPlayers);
      if (occupied > seats) return this.error(T.mapTooSmall(seats));
      r.mapId = info.id;
      this.resizeSlots(seats);
      changed = true;
    }
    if (W.isInt(patch.seed) && (patch.seed | 0) !== r.seed) {
      r.seed = patch.seed | 0;
      changed = true;
    }
    if (typeof patch.startingCredits === 'number' && Number.isFinite(patch.startingCredits)) {
      const c = Math.max(0, Math.min(MAX_CREDITS, Math.round(patch.startingCredits)));
      if (c !== r.credits) {
        r.credits = c;
        changed = true;
      }
    }
    if (W.isObj(patch.options)) {
      const o = { ...r.options };
      for (const k of ['fog', 'shortGame', 'superweapons'] as const) if (typeof patch.options[k] === 'boolean') o[k] = patch.options[k];
      if (o.fog !== r.options.fog || o.shortGame !== r.options.shortGame || o.superweapons !== r.options.superweapons) {
        r.options = o;
        changed = true;
      }
    }
    if (!changed) return;
    // settings changed under the guests' feet → they have to confirm again
    for (const s of r.slots) if (s.k === 'human' && s.pid !== 0) s.ready = false;
    this.roomChanged();
  }

  setSlot(index: number, slot: Exclude<NetSlot, { kind: 'human' }>): void {
    const r = this.room;
    if (this.role !== 'host' || !r || this.hostMatch || !W.isObj(slot)) return;
    if (!Number.isInteger(index) || index < 0 || index >= r.slots.length) return;
    const cur = r.slots[index];
    if (cur.k === 'human' && cur.pid === 0) return; // the host's own seat
    let next: W.WireSlot;
    if (slot.kind === 'open') next = { k: 'open' };
    else if (slot.kind === 'closed') next = { k: 'closed' };
    else if (slot.kind === 'ai') {
      const color = W.PALETTE.includes(slot.color) && !this.colorTaken(slot.color, index) ? slot.color : this.freeColor(index);
      next = {
        k: 'ai',
        faction: W.isFactionChoice(slot.faction) ? slot.faction : 'random',
        color,
        team: Number.isInteger(slot.team) && slot.team >= 1 && slot.team <= W.MAX_TEAM ? slot.team : this.freeTeam(),
        difficulty: W.isDifficulty(slot.difficulty) ? slot.difficulty : 'normal',
      };
    } else return;
    if (cur.k === 'human') {
      const p = this.peerByPid(cur.pid);
      if (p) {
        this.sendConn(p.conn, { t: 'kick' });
        this.peers.delete(p.conn);
        this.lingerClose(p.conn);
      }
      this.notice(T.kickedOther(cur.name), true);
    }
    r.slots[index] = next;
    this.roomChanged();
  }

  setMe(patch: { faction?: W.MePatch['faction']; color?: string; team?: number; ready?: boolean }): void {
    if (!W.isObj(patch) || !this.room || this.match) return;
    const p: W.MePatch = {};
    if (W.isFactionChoice(patch.faction)) p.faction = patch.faction;
    if (typeof patch.color === 'string') p.color = patch.color;
    if (typeof patch.team === 'number' && Number.isInteger(patch.team)) p.team = patch.team;
    if (typeof patch.ready === 'boolean') p.ready = patch.ready;
    if (this.role === 'host') this.applyMe(0, p);
    else if (this.role === 'client' && this.hostConn >= 0 && this.myPid > 0) this.sendConn(this.hostConn, { t: 'me', p });
  }

  chat(text: string): void {
    const clean = W.cleanText(text, W.MAX_CHAT);
    if (!clean || !this.room) return;
    if (this.role === 'host') this.relayChat(0, clean);
    else if (this.role === 'client' && this.hostConn >= 0 && this.myPid > 0) this.sendConn(this.hostConn, { t: 'chat', text: clean });
  }

  startMatch(): void {
    const r = this.room;
    if (this.role !== 'host' || !r || this.hostMatch) return;
    if (!this.canStart()) return this.error(T.cannotStart);
    const info = this.mapInfo(r.mapId);
    if (!info) return this.error(T.mapMissing);
    // Resolve random factions and start positions on the host, deterministically from the seed.
    const rng = makeRng((r.seed ^ 0x2c1b3c6d) | 0);
    const order = Array.from({ length: Math.min(W.MAX_SEATS, info.maxPlayers) }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    let aiN = 0;
    const players: W.WirePlayer[] = r.slots.filter(W.isOccupied).map((s, i) => ({
      name: s.k === 'human' ? s.name : T.aiName(++aiN),
      faction: s.faction === 'random' ? rng.pick(W.FACTION_IDS) : s.faction,
      color: s.color,
      team: s.team,
      controller: s.k === 'human' ? 'human' : 'ai',
      difficulty: s.k === 'ai' ? s.difficulty : 'normal',
      startIndex: order[i],
      pid: s.k === 'human' ? s.pid : -1,
    }));
    const text = JSON.stringify({ t: 'start', s: { mapId: r.mapId, seed: r.seed, credits: r.credits, options: r.options, players } satisfies W.WireStart });
    const back = W.parseHostMsg(text);
    if (!back || back.t !== 'start') return this.error(T.cannotStart);
    this.broadcastText(text);
    const setup = this.buildSetup(back.s, info);
    const mp = this.matchPlayers(back.s);
    const local = back.s.players.findIndex((p) => p.pid === 0);
    this.hostMatch = new HostMatch(setup, local, mp, {
      now: () => this.clock.now(),
      broadcast: (t) => this.broadcastText(t),
      drop: (pid) => {
        const p = this.peerByPid(pid);
        if (!p) return;
        this.peers.delete(p.conn);
        this.lingerClose(p.conn);
      },
      notice: (t) => this.notice(t, true),
      changed: () => {
        if (this.hostMatch) this.set({ match: this.hostMatch.status });
      },
      leave: () => this.leave(),
    });
    this.updateAd();
    this.set({ phase: 'match', room: this.view(), match: this.hostMatch.status });
    this.emit({ type: 'matchStart', match: this.hostMatch });
  }

  destroy(): void {
    this.leave();
    this.unlisten();
    this.tp?.dispose();
    this.stateSubs.clear();
    this.eventSubs.clear();
  }

  // ───────────── state helpers ─────────────

  private set(patch: Partial<NetState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of [...this.stateSubs]) {
      try {
        cb(this.state);
      } catch (err) {
        console.error('[net] state subscriber failed', err);
      }
    }
  }

  private emit(e: NetEvent): void {
    for (const cb of [...this.eventSubs]) {
      try {
        cb(e);
      } catch (err) {
        console.error('[net] event subscriber failed', err);
      }
    }
  }

  private error(text: string): void {
    this.emit({ type: 'error', text });
  }

  private notice(text: string, broadcast: boolean): void {
    if (broadcast && this.role === 'host') this.broadcastText(JSON.stringify({ t: 'notice', text }));
    this.emit({ type: 'notice', text });
  }

  private roomList(): NetRoomAd[] {
    return [...this.ads.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  private view(): NetRoom | null {
    const r = this.room;
    if (!r) return null;
    const isHost = this.role === 'host';
    const me = isHost ? 0 : this.myPid;
    return {
      name: r.name,
      isHost,
      mapId: r.mapId,
      seed: r.seed,
      startingCredits: r.credits,
      options: { ...r.options },
      slots: r.slots.map((s) => toNetSlot(s, me)),
      canStart: isHost && this.canStart(),
    };
  }

  private mapInfo(id: string): MapInfo | undefined {
    return this.deps.maps.find((m) => m.id === id);
  }

  private startPoll(): void {
    this.stopPoll?.();
    this.lastPing = -Infinity;
    this.stopPoll = this.clock.every(POLL_MS, () => this.poll());
  }

  private stopBrowsing(): void {
    if (this.browsing) this.tp?.stopBrowse();
    this.browsing = false;
    this.ads.clear();
  }

  /** Drop the current room / match without touching phase (callers set it). */
  private teardown(): void {
    this.hostMatch?.end('ended');
    this.clientMatch?.end('ended');
    const tp = this.tp;
    if (tp && this.role === 'host') {
      this.broadcastText(JSON.stringify({ t: 'bye' }));
      for (const conn of this.peers.keys()) this.lingerClose(conn);
      tp.stopHost();
    }
    if (tp && this.role === 'client' && this.hostConn >= 0) {
      this.sendConn(this.hostConn, { t: 'bye' });
      this.lingerClose(this.hostConn);
    }
    this.peers.clear();
    this.stopPoll?.();
    this.stopPoll = null;
    this.role = 'none';
    this.room = null;
    this.hostMatch = null;
    this.clientMatch = null;
    this.hostConn = -1;
    this.myPid = -1;
    this.joinTarget = '';
    this.lastAd = '';
  }

  private lingerClose(conn: number): void {
    const tp = this.tp;
    if (tp) this.clock.after(CLOSE_LINGER_MS, () => tp.close(conn));
  }

  private sendConn(conn: number, msg: W.HostMsg | W.ClientMsg): void {
    this.tp?.send(conn, JSON.stringify(msg));
  }

  private broadcastText(text: string): void {
    if (!this.tp) return;
    for (const p of this.peers.values()) if (p.joined) this.tp.send(p.conn, text);
  }

  private poll(): void {
    const now = this.clock.now();
    if (this.role === 'host') {
      for (const p of [...this.peers.values()]) {
        if (!p.joined && now - p.openedAt > HELLO_TIMEOUT_MS) {
          this.peers.delete(p.conn);
          this.tp?.close(p.conn);
        } else if (p.joined && now - p.lastSeen > PEER_TIMEOUT_MS) this.peerGone(p, 'lost', true);
      }
      if (now - this.lastPing >= PING_MS) {
        this.lastPing = now;
        this.broadcastText(JSON.stringify({ t: 'ping', at: now }));
        this.hostMatch?.broadcastStats();
      }
      this.hostMatch?.poll();
    } else if (this.role === 'client') {
      if (this.state.phase === 'connecting' && now - this.connectStarted > CONNECT_TIMEOUT_MS) this.fail(T.connectTimeout);
      else if (this.hostConn >= 0 && now - this.lastHostMsg > HOST_TIMEOUT_MS) this.hostGone(T.hostLostLobby);
      this.clientMatch?.poll();
    }
  }

  // ───────────── transport events ─────────────

  private onTransport(e: NativeNetEvent): void {
    switch (e.type) {
      case 'found': {
        if (!this.browsing) return;
        const d = W.decodeAd(e.info);
        if (!d) {
          if (this.ads.delete(e.id)) this.set({ rooms: this.roomList() });
          return;
        }
        this.ads.set(e.id, {
          id: e.id,
          name: d.name || W.cleanText(e.name, W.MAX_ROOM_NAME),
          hostName: d.hostName,
          mapName: d.mapName,
          players: d.players,
          maxPlayers: d.maxPlayers,
          compatible: d.protocol === W.PROTOCOL && d.build === this.myBuildHash,
          inMatch: d.inMatch,
        });
        this.set({ rooms: this.roomList() });
        return;
      }
      case 'lost':
        if (this.ads.delete(e.id)) this.set({ rooms: this.roomList() });
        return;
      case 'hosting':
        return;
      case 'hostFailed':
        if (this.role === 'host' && !this.hostMatch) {
          this.leave();
          this.error(T.hostFailed(W.cleanText(e.message, 120)));
        }
        return;
      case 'open':
        if (this.role === 'host' && e.incoming && this.room) {
          const now = this.clock.now();
          this.peers.set(e.conn, { conn: e.conn, pid: this.nextPid++, name: '', joined: false, openedAt: now, lastSeen: now, lastChat: -Infinity });
        } else if (this.role === 'client' && !e.incoming && this.hostConn < 0 && this.state.phase === 'connecting' && (e.hostId === undefined || e.hostId === this.joinTarget)) {
          this.hostConn = e.conn;
          this.lastHostMsg = this.clock.now();
          this.sendConn(e.conn, { t: 'hello', v: W.PROTOCOL, build: this.deps.buildId, name: this.myName });
        } else {
          this.tp?.close(e.conn);
        }
        return;
      case 'message':
        if (e.text.length > W.MAX_TEXT) return;
        if (this.role === 'host') {
          const p = this.peers.get(e.conn);
          if (p) this.onPeerText(p, e.text);
        } else if (this.role === 'client' && e.conn === this.hostConn) this.onHostText(e.text);
        return;
      case 'closed':
        if (this.role === 'host') {
          const p = this.peers.get(e.conn);
          if (p) this.peerGone(p, 'lost', false);
        } else if (this.role === 'client') {
          if (e.conn >= 0 && e.conn === this.hostConn) {
            this.hostConn = -1;
            this.hostGone(T.hostLostLobby);
          } else if (e.conn < 0 && this.state.phase === 'connecting' && this.hostConn < 0 && (e.hostId === undefined || e.hostId === this.joinTarget)) {
            this.fail(T.connectFailed);
          }
        }
        return;
      case 'error':
        this.error(W.cleanText(e.message, 200) || T.connectFailed);
        return;
    }
  }

  // ───────────── host side ─────────────

  private onPeerText(p: Peer, text: string): void {
    const m = W.parseClientMsg(text);
    if (!m) return;
    const now = this.clock.now();
    p.lastSeen = now;
    if (!p.joined) {
      if (m.t === 'hello') this.hello(p, m);
      return;
    }
    switch (m.t) {
      case 'me':
        if (!this.hostMatch) this.applyMe(p.pid, m.p);
        return;
      case 'chat':
        if (now - p.lastChat < CHAT_GAP_MS) return;
        p.lastChat = now;
        this.relayChat(p.pid, m.text);
        return;
      case 'pong':
        if (m.at <= now && now - m.at < 60_000) this.setPing(p.pid, Math.round(now - m.at));
        return;
      case 'bye':
        this.peerGone(p, 'left', true);
        return;
      case 'cmd':
        this.hostMatch?.onCmds(p.pid, m.c);
        return;
      case 'ack':
        this.hostMatch?.onAck(p.pid, m.k, m.h);
        return;
      case 'hello':
        return;
    }
  }

  private hello(p: Peer, m: Extract<W.ClientMsg, { t: 'hello' }>): void {
    const r = this.room;
    if (!r) return;
    let why: W.RefuseReason | null = null;
    if (m.v !== W.PROTOCOL) why = 'proto';
    else if (m.build !== this.deps.buildId) why = 'build';
    else if (this.hostMatch) why = 'match';
    const idx = r.slots.findIndex((s) => s.k === 'open');
    if (!why && idx < 0) why = 'full';
    if (why) {
      this.sendConn(p.conn, { t: 'refuse', why });
      this.peers.delete(p.conn);
      this.lingerClose(p.conn);
      return;
    }
    const name = this.uniqueName(m.name || T.defaultPlayer);
    p.joined = true;
    p.name = name;
    r.slots[idx] = { k: 'human', pid: p.pid, name, faction: 'random', color: this.freeColor(-1), team: this.freeTeam(), ready: false, ping: 0 };
    this.sendConn(p.conn, { t: 'welcome', pid: p.pid, room: r });
    this.notice(T.joined(name), true);
    this.roomChanged();
  }

  private peerGone(p: Peer, why: 'left' | 'lost' | 'timeout', closeIt: boolean): void {
    if (!this.peers.has(p.conn)) return;
    this.peers.delete(p.conn);
    if (closeIt) this.lingerClose(p.conn);
    if (!p.joined) return;
    if (this.hostMatch) {
      this.hostMatch.peerGone(p.pid, why);
      return;
    }
    const r = this.room;
    if (!r) return;
    const idx = r.slots.findIndex((s) => s.k === 'human' && s.pid === p.pid);
    if (idx >= 0) r.slots[idx] = { k: 'open' };
    this.notice(why === 'left' ? T.left(p.name) : T.lost(p.name), true);
    this.roomChanged();
  }

  private peerByPid(pid: number): Peer | undefined {
    for (const p of this.peers.values()) if (p.pid === pid) return p;
    return undefined;
  }

  private applyMe(pid: number, patch: W.MePatch): void {
    const r = this.room;
    if (!r || this.hostMatch) return;
    const i = r.slots.findIndex((s) => s.k === 'human' && s.pid === pid);
    if (i < 0) return;
    const s = r.slots[i] as Extract<W.WireSlot, { k: 'human' }>;
    const next = { ...s };
    if (patch.faction !== undefined) next.faction = patch.faction;
    if (patch.color !== undefined && W.PALETTE.includes(patch.color) && !this.colorTaken(patch.color, i)) next.color = patch.color;
    if (patch.team !== undefined && patch.team >= 1 && patch.team <= W.MAX_TEAM) next.team = patch.team;
    if (patch.ready !== undefined && pid !== 0) next.ready = patch.ready;
    if (JSON.stringify(next) === JSON.stringify(s)) {
      // refused change → resend so the requester's view snaps back
      if (pid !== 0) {
        const p = this.peerByPid(pid);
        if (p) this.sendConn(p.conn, { t: 'room', room: r });
      }
      return;
    }
    r.slots[i] = next;
    this.roomChanged();
  }

  private relayChat(pid: number, text: string): void {
    const s = this.room?.slots.find((x) => x.k === 'human' && x.pid === pid);
    const from = s && s.k === 'human' ? s.name : '';
    const color = s && s.k === 'human' ? s.color : '#cccccc';
    this.broadcastText(JSON.stringify({ t: 'chat', from, color, text }));
    this.emit({ type: 'chat', from, color, text });
  }

  private setPing(pid: number, ms: number): void {
    this.hostMatch?.setPing(pid, ms);
    const s = this.room?.slots.find((x) => x.k === 'human' && x.pid === pid);
    if (!s || s.k !== 'human' || s.ping === ms) return;
    s.ping = ms;
    if (!this.hostMatch) this.roomChanged();
  }

  private colorTaken(color: string, exceptIndex: number): boolean {
    return !!this.room?.slots.some((s, i) => i !== exceptIndex && W.isOccupied(s) && s.color === color);
  }

  private freeColor(exceptIndex: number): string {
    return W.PALETTE.find((c) => !this.colorTaken(c, exceptIndex)) ?? W.PALETTE[0];
  }

  private freeTeam(): number {
    const used = new Set(this.room?.slots.filter(W.isOccupied).map((s) => s.team));
    for (let t = 1; t <= W.MAX_TEAM; t++) if (!used.has(t)) return t;
    return 1;
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.room?.slots.filter((s) => s.k === 'human').map((s) => (s.k === 'human' ? s.name : '')));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const cand = Array.from(name).slice(0, W.MAX_NAME - suffix.length).join('') + suffix;
      if (!taken.has(cand)) return cand;
    }
  }

  /** Shrink (dropping free seats from the end first) or grow the seat list, keeping occupants seated. */
  private resizeSlots(n: number): void {
    const r = this.room;
    if (!r) return;
    while (r.slots.length < n) r.slots.push({ k: 'open' });
    while (r.slots.length > n) {
      let i = r.slots.length - 1;
      while (i >= 0 && W.isOccupied(r.slots[i])) i--;
      if (i < 0) break;
      r.slots.splice(i, 1);
    }
  }

  private canStart(): boolean {
    const r = this.room;
    if (!r || this.hostMatch || !this.mapInfo(r.mapId)) return false;
    const occ = r.slots.filter(W.isOccupied);
    if (occ.length < 2) return false;
    if (occ.some((s) => s.k === 'human' && !s.ready)) return false;
    return new Set(occ.map((s) => s.team)).size >= 2;
  }

  private adText(): string {
    const r = this.room;
    if (!r) return '';
    const host = r.slots.find((s) => s.k === 'human' && s.pid === 0);
    return W.encodeAd({
      room: r.name,
      host: host && host.k === 'human' ? host.name : '',
      map: this.mapInfo(r.mapId)?.name ?? r.mapId,
      players: r.slots.filter(W.isOccupied).length,
      max: r.slots.filter((s) => s.k !== 'closed').length,
      inMatch: this.hostMatch !== null,
      build: this.myBuildHash,
    });
  }

  private updateAd(): void {
    if (this.role !== 'host' || !this.tp) return;
    const text = this.adText();
    if (text === this.lastAd) return;
    this.lastAd = text;
    this.tp.updateInfo(text);
  }

  private roomChanged(): void {
    const r = this.room;
    if (this.role !== 'host' || !r) return;
    this.broadcastText(JSON.stringify({ t: 'room', room: r }));
    this.set({ room: this.view() });
    this.updateAd();
  }

  // ───────────── client side ─────────────

  private fail(text: string): void {
    this.leave();
    this.error(text);
  }

  private hostGone(lobbyText: string): void {
    if (this.role !== 'client') return;
    if (this.hostConn >= 0) {
      this.tp?.close(this.hostConn);
      this.hostConn = -1;
    }
    if (this.clientMatch) {
      this.clientMatch.end('hostLost');
      this.notice(T.hostGoneMatch, false);
      return;
    }
    this.fail(this.state.phase === 'connecting' ? T.connectFailed : lobbyText);
  }

  private onHostText(text: string): void {
    const m = W.parseHostMsg(text);
    if (!m) return;
    this.lastHostMsg = this.clock.now();
    if (this.myPid < 0) {
      if (m.t === 'welcome') {
        this.myPid = m.pid;
        this.room = m.room;
        this.set({ phase: 'lobby', room: this.view() });
      } else if (m.t === 'refuse') this.fail(T.refuse[m.why]);
      else if (m.t === 'ping') this.sendConn(this.hostConn, { t: 'pong', at: m.at });
      return;
    }
    switch (m.t) {
      case 'room':
        this.room = m.room;
        this.set({ room: this.view() });
        return;
      case 'chat':
        this.emit({ type: 'chat', from: m.from, color: m.color, text: m.text });
        return;
      case 'notice':
        this.emit({ type: 'notice', text: m.text });
        return;
      case 'kick':
        this.fail(T.kicked);
        return;
      case 'ping':
        this.sendConn(this.hostConn, { t: 'pong', at: m.at });
        return;
      case 'start':
        this.clientStart(m.s);
        return;
      case 'turn':
        this.clientMatch?.onTurn(m.k, m.c);
        return;
      case 'wait':
        this.clientMatch?.onWait(m.names);
        return;
      case 'mstat':
        this.clientMatch?.onStats(m.p);
        return;
      case 'desync':
        this.clientMatch?.onDesync();
        return;
      case 'bye':
        this.hostGone(T.hostClosed);
        return;
      case 'welcome':
      case 'refuse':
        return;
    }
  }

  private clientStart(s: W.WireStart): void {
    if (this.clientMatch || this.state.phase !== 'lobby') return;
    const info = this.mapInfo(s.mapId);
    if (!info) return this.fail(T.mapMissing);
    const local = s.players.findIndex((p) => p.pid === this.myPid);
    if (local < 0) return this.fail(T.noSeat);
    const setup = this.buildSetup(s, info);
    this.clientMatch = new ClientMatch(setup, local, this.matchPlayers(s), {
      now: () => this.clock.now(),
      sendHost: (t) => {
        if (this.hostConn >= 0) this.tp?.send(this.hostConn, t);
      },
      changed: () => {
        if (this.clientMatch) this.set({ match: this.clientMatch.status });
      },
      leave: () => this.leave(),
    });
    this.set({ phase: 'match', match: this.clientMatch.status });
    this.emit({ type: 'matchStart', match: this.clientMatch });
  }

  // ───────────── shared ─────────────

  private buildSetup(s: W.WireStart, info: MapInfo): GameSetup {
    return {
      map: info.generate(s.seed),
      seed: s.seed,
      players: s.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, team: p.team, controller: p.controller, difficulty: p.difficulty, startIndex: p.startIndex })),
      startingCredits: s.credits,
      options: { ...s.options },
    };
  }

  private matchPlayers(s: W.WireStart): MatchPlayerInfo[] {
    return s.players.map((p, i) => ({ player: i, name: p.name, controller: p.controller, pid: p.pid }));
  }
}

/** Build a NetApi with explicit internals (tests, dev page). */
export function createNetWith(deps: NetDeps, opts: NetOptions = {}): NetApi {
  const tp = opts.transport === undefined ? pickTransport() : opts.transport;
  return new NetCore(deps, tp, opts.clock ?? realClock, opts.randomSeed ?? (() => Math.floor(Math.random() * 0x7fffffff)));
}

export const createNet: CreateNet = (deps) => createNetWith(deps);
