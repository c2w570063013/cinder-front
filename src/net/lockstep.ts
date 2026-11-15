// Deterministic lockstep, host-sequenced.
//
// The host owns the command stream. Every command (its own UI, the AIs it runs, and what clients send
// it) goes into one pending list; when the host takes turn t it seals the pending list as turn
// t + INPUT_DELAY and broadcasts it. So a command executes INPUT_DELAY ticks after the host received
// it, on every peer, in the order the host received it. Clients may only step turns the host has
// sealed. The host does not step turn t while a connected client has acknowledged less than
// t - MAX_LEAD (it shows 'waiting' after WAIT_SHOW_MS and drops the laggard after DROP_MS).
//
// The host also turns its own sealed turn back through the very same JSON parse the clients use, so
// all peers apply bit-identical command objects (e.g. -0 → 0 happens everywhere, not just remotely).
import type { NetMatch, NetMatchStatus } from '../core/api';
import type { Command, GameSetup, PlayerId } from '../core/types';
import { T } from './text';
import { MAX_CMDS_PER_TURN, parseHostMsg, sanitizeCommand, type WireStat } from './wire';

/** Ticks between a command reaching the host and its execution (150 ms at 20 Hz). */
export const INPUT_DELAY = 3;
/** The host may run at most this many ticks ahead of the slowest connected client. */
export const MAX_LEAD = 10;
/** World hashes are compared on every tick divisible by this. */
export const HASH_EVERY = 20;
/** A stall shorter than this is not shown as 'waiting' (avoids flicker on jitter). */
export const WAIT_SHOW_MS = 250;
/** A client that keeps the host stalled this long is dropped and surrendered. */
export const DROP_MS = 30_000;
/** A client that has had no turn from the host for this long shows 'waiting' for the host. */
export const STARVE_SHOW_MS = 1000;
/** Max commands one client can get into a single turn. */
const CLIENT_TURN_BUDGET = 64;
/** Room for host-injected surrenders on top of the normal cap. */
const PENDING_CAP = MAX_CMDS_PER_TURN - 16;

export interface MatchPlayerInfo {
  player: PlayerId;
  name: string;
  controller: 'human' | 'ai';
  /** Peer id (host = 0), -1 for AI. */
  pid: number;
}

const terminal = (s: NetMatchStatus): boolean => s.state === 'desync' || s.state === 'hostLost' || s.state === 'ended';
const sameStatus = (a: NetMatchStatus, b: NetMatchStatus): boolean => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────────── host ─────────────────────────────

export interface HostIo {
  now(): number;
  /** Send to every connected client of this match. */
  broadcast(text: string): void;
  /** Close a client's connection (it has already been surrendered). */
  drop(pid: number): void;
  notice(text: string): void;
  /** `status` changed. */
  changed(): void;
  leave(): void;
}

interface HostClient {
  pid: number;
  player: PlayerId;
  name: string;
  connected: boolean;
  ping: number;
  /** Highest world.tick the client reported reaching. */
  acked: number;
  behindSince: number | null;
  /** Client hashes for check ticks the host has not reached yet. */
  hashes: Map<number, number>;
  budget: number;
}

export class HostMatch implements NetMatch {
  readonly isHost = true;
  private st: NetMatchStatus;
  private readonly clients = new Map<number, HostClient>();
  private readonly ai = new Set<PlayerId>();
  private readonly turns = new Map<number, Command[]>();
  private pending: Command[] = [];
  /** Turns [0, sealed) have been broadcast. Invariant: sealed === next + INPUT_DELAY. */
  private sealed = 0;
  /** The next tick takeTurn will hand out. */
  private next = 0;
  private readonly ownHash = new Map<number, number>();
  private lastHashTick = -1;
  private stallSince: number | null = null;
  private behind: HostClient[] = [];
  private waitNames: string[] = [];
  private readonly surrendered = new Set<PlayerId>();

  constructor(
    readonly setup: GameSetup,
    readonly localPlayer: PlayerId,
    private readonly players: MatchPlayerInfo[],
    private readonly io: HostIo,
  ) {
    for (const p of players) {
      if (p.controller === 'ai') this.ai.add(p.player);
      else if (p.pid !== 0)
        this.clients.set(p.pid, { pid: p.pid, player: p.player, name: p.name, connected: true, ping: 0, acked: 0, behindSince: null, hashes: new Map(), budget: CLIENT_TURN_BUDGET });
    }
    this.st = this.build('running', []);
    for (let k = 0; k < INPUT_DELAY; k++) this.seal();
  }

  get status(): NetMatchStatus {
    return this.st;
  }

  send(cmd: Command): void {
    if (terminal(this.st)) return;
    const c = sanitizeCommand(cmd);
    if (!c) return;
    // the host's UI may command only the local player; the AIs it runs command their own seats
    if (c.player !== this.localPlayer && !this.ai.has(c.player)) c.player = this.localPlayer;
    if (this.pending.length < PENDING_CAP) this.pending.push(c);
  }

  takeTurn(tick: number): Command[] | null {
    if (terminal(this.st) || tick !== this.next) return null;
    const now = this.io.now();
    this.behind = this.computeBehind(tick);
    for (const cl of this.clients.values()) cl.behindSince = this.behind.includes(cl) ? (cl.behindSince ?? now) : null;
    if (this.behind.length > 0) {
      this.stallSince ??= now;
      this.updateWait(now);
      return null;
    }
    this.stallSince = null;
    this.updateWait(now);
    this.seal();
    const cmds = this.turns.get(tick) ?? [];
    this.turns.delete(tick);
    this.next = tick + 1;
    return cmds;
  }

  ready(tick: number): number {
    if (terminal(this.st) || tick !== this.next) return 0;
    return this.computeBehind(tick).length === 0 ? 1 : 0;
  }

  afterStep(tick: number, hash: () => number): void {
    if (terminal(this.st) || tick % HASH_EVERY !== 0) return;
    const h = hash();
    this.ownHash.set(tick, h);
    this.lastHashTick = tick;
    for (const k of this.ownHash.keys()) if (k < tick - 16 * HASH_EVERY) this.ownHash.delete(k);
    for (const cl of this.clients.values()) {
      const ch = cl.hashes.get(tick);
      if (ch === undefined) continue;
      cl.hashes.delete(tick);
      if (ch !== h) this.desync(tick);
    }
  }

  leave(): void {
    this.io.leave();
  }

  // ── called by the lobby core ──

  /** Commands a client sent; the player field is forced to that client's own seat. */
  onCmds(pid: number, cmds: Command[]): void {
    const cl = this.clients.get(pid);
    if (!cl || !cl.connected || terminal(this.st)) return;
    for (const c of cmds) {
      if (cl.budget <= 0 || this.pending.length >= PENDING_CAP) break;
      cl.budget--;
      this.pending.push({ ...c, player: cl.player } as Command);
    }
  }

  onAck(pid: number, k: number, h: number | undefined): void {
    const cl = this.clients.get(pid);
    if (!cl || !cl.connected || terminal(this.st)) return;
    if (k > this.sealed) return; // cannot have stepped a turn that was never sent
    if (k > cl.acked) cl.acked = k;
    if (h === undefined || k % HASH_EVERY !== 0) return;
    const own = this.ownHash.get(k);
    if (own !== undefined) {
      if (own !== h) this.desync(k);
    } else if (k > this.lastHashTick) {
      cl.hashes.set(k, h);
      if (cl.hashes.size > 32) cl.hashes.delete(cl.hashes.keys().next().value as number);
    }
  }

  setPing(pid: number, ms: number): void {
    const cl = this.clients.get(pid);
    if (!cl || cl.ping === ms) return;
    cl.ping = ms;
    this.refresh();
  }

  /** A client went away (left / connection lost / timed out): surrender it, keep playing. */
  peerGone(pid: number, why: 'left' | 'lost' | 'timeout'): void {
    const cl = this.clients.get(pid);
    if (!cl || !cl.connected) return;
    cl.connected = false;
    cl.behindSince = null;
    cl.hashes.clear();
    if (terminal(this.st)) return;
    this.injectSurrender(cl.player);
    this.io.notice(why === 'left' ? T.matchLeft(cl.name) : why === 'timeout' ? T.matchTimeout(cl.name) : T.matchLost(cl.name));
    this.behind = this.behind.filter((c) => c !== cl);
    this.updateWait(this.io.now());
    this.refresh();
    this.broadcastStats();
  }

  /** Periodic housekeeping (drop timeouts, wait overlay). */
  poll(): void {
    if (terminal(this.st)) return;
    const now = this.io.now();
    for (const cl of [...this.clients.values()]) {
      if (cl.connected && cl.behindSince !== null && now - cl.behindSince > DROP_MS) {
        this.peerGone(cl.pid, 'timeout');
        this.io.drop(cl.pid);
      }
    }
    if (this.stallSince !== null) this.updateWait(now);
  }

  broadcastStats(): void {
    if (terminal(this.st)) return;
    const p: WireStat[] = this.st.players.map((x) => ({ player: x.player, connected: x.connected, ping: x.pingMs }));
    this.io.broadcast(JSON.stringify({ t: 'mstat', p }));
  }

  end(state: 'ended' | 'hostLost'): void {
    if (this.st.state === 'ended') return;
    this.setStatus({ ...this.build(state, []), state });
  }

  // ── internals ──

  private computeBehind(tick: number): HostClient[] {
    const out: HostClient[] = [];
    for (const cl of this.clients.values()) if (cl.connected && cl.acked < tick - MAX_LEAD) out.push(cl);
    return out;
  }

  private seal(): void {
    const k = this.sealed++;
    const text = JSON.stringify({ t: 'turn', k, c: this.pending });
    this.pending = [];
    for (const cl of this.clients.values()) cl.budget = CLIENT_TURN_BUDGET;
    const back = parseHostMsg(text);
    this.turns.set(k, back && back.t === 'turn' ? back.c : []);
    this.io.broadcast(text);
  }

  private injectSurrender(player: PlayerId): void {
    if (this.surrendered.has(player)) return;
    this.surrendered.add(player);
    this.pending.push({ type: 'surrender', player });
  }

  private desync(_tick: number): void {
    if (terminal(this.st)) return;
    this.io.broadcast(JSON.stringify({ t: 'desync', k: _tick }));
    this.setStatus({ ...this.build('desync', []), state: 'desync' });
  }

  private updateWait(now: number): void {
    const names = this.stallSince !== null && now - this.stallSince >= WAIT_SHOW_MS ? this.behind.filter((c) => c.connected).map((c) => c.name) : [];
    if (names.join('\n') === this.waitNames.join('\n')) return;
    this.waitNames = names;
    this.io.broadcast(JSON.stringify({ t: 'wait', names }));
    this.refresh();
  }

  private refresh(): void {
    if (terminal(this.st)) return;
    this.setStatus(this.build(this.waitNames.length > 0 ? 'waiting' : 'running', this.waitNames));
  }

  private build(state: NetMatchStatus['state'], waitingFor: string[]): NetMatchStatus {
    return {
      state,
      waitingFor: waitingFor.slice(),
      players: this.players.map((p) => {
        const cl = p.controller === 'human' ? [...this.clients.values()].find((c) => c.player === p.player) : undefined;
        return { player: p.player, name: p.name, controller: p.controller, connected: cl ? cl.connected : true, pingMs: cl ? cl.ping : 0 };
      }),
    };
  }

  private setStatus(next: NetMatchStatus): void {
    if (sameStatus(next, this.st)) return;
    this.st = next;
    this.io.changed();
  }
}

// ───────────────────────────── client ─────────────────────────────

export interface ClientIo {
  now(): number;
  sendHost(text: string): void;
  changed(): void;
  leave(): void;
}

export class ClientMatch implements NetMatch {
  readonly isHost = false;
  private st: NetMatchStatus;
  private readonly turns = new Map<number, Command[]>();
  /** Next turn index expected from the host (turns arrive in order over one connection). */
  private expect = 0;
  private hostWait: string[] = [];
  private starvedSince: number | null = null;
  private readonly stats = new Map<PlayerId, { connected: boolean; ping: number }>();
  private readonly myName: string;
  private readonly hostName: string;

  constructor(
    readonly setup: GameSetup,
    readonly localPlayer: PlayerId,
    private readonly players: MatchPlayerInfo[],
    private readonly io: ClientIo,
  ) {
    this.myName = players.find((p) => p.player === localPlayer)?.name ?? '';
    this.hostName = players.find((p) => p.pid === 0)?.name ?? '';
    this.st = this.build('running', []);
  }

  get status(): NetMatchStatus {
    return this.st;
  }

  send(cmd: Command): void {
    if (terminal(this.st)) return;
    const c = sanitizeCommand(cmd);
    if (!c) return;
    this.io.sendHost(JSON.stringify({ t: 'cmd', c: [{ ...c, player: this.localPlayer }] }));
  }

  takeTurn(tick: number): Command[] | null {
    if (terminal(this.st)) return null;
    const c = this.turns.get(tick);
    if (c === undefined) {
      this.starvedSince ??= this.io.now();
      this.refresh();
      return null;
    }
    this.turns.delete(tick);
    for (const k of this.turns.keys()) if (k < tick) this.turns.delete(k);
    if (this.starvedSince !== null) {
      this.starvedSince = null;
      this.refresh();
    }
    return c;
  }

  ready(tick: number): number {
    if (terminal(this.st)) return 0;
    let n = 0;
    while (this.turns.has(tick + n)) n++;
    return n;
  }

  afterStep(tick: number, hash: () => number): void {
    if (terminal(this.st)) return;
    this.io.sendHost(JSON.stringify(tick % HASH_EVERY === 0 ? { t: 'ack', k: tick, h: hash() } : { t: 'ack', k: tick }));
  }

  leave(): void {
    this.io.leave();
  }

  // ── called by the lobby core ──

  onTurn(k: number, cmds: Command[]): void {
    if (terminal(this.st) || k !== this.expect || this.turns.size >= 4096) return;
    this.turns.set(k, cmds);
    this.expect++;
  }

  onWait(names: string[]): void {
    this.hostWait = names;
    this.refresh();
  }

  onStats(p: WireStat[]): void {
    for (const s of p) this.stats.set(s.player, { connected: s.connected, ping: s.ping });
    this.refresh();
  }

  onDesync(): void {
    if (terminal(this.st)) return;
    this.setStatus({ ...this.build('desync', []), state: 'desync' });
  }

  poll(): void {
    this.refresh();
  }

  end(state: 'ended' | 'hostLost'): void {
    if (this.st.state === 'ended') return;
    if (state === 'hostLost' && terminal(this.st)) return; // desync stays desync
    this.setStatus({ ...this.build(state, []), state });
  }

  private refresh(): void {
    if (terminal(this.st)) return;
    let waitingFor = this.hostWait.filter((n) => n !== this.myName);
    if (waitingFor.length === 0 && this.starvedSince !== null && this.io.now() - this.starvedSince >= STARVE_SHOW_MS) waitingFor = [this.hostName];
    this.setStatus(this.build(waitingFor.length > 0 ? 'waiting' : 'running', waitingFor));
  }

  private build(state: NetMatchStatus['state'], waitingFor: string[]): NetMatchStatus {
    return {
      state,
      waitingFor: waitingFor.slice(),
      players: this.players.map((p) => {
        const s = this.stats.get(p.player);
        return { player: p.player, name: p.name, controller: p.controller, connected: s ? s.connected : true, pingMs: s ? s.ping : 0 };
      }),
    };
  }

  private setStatus(next: NetMatchStatus): void {
    if (sameStatus(next, this.st)) return;
    this.st = next;
    this.io.changed();
  }
}
