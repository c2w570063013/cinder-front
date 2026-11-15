// In-memory transport for tests: a simulated LAN with controllable latency. Delivery is ordered per
// connection direction (like TCP), jittered by a seeded RNG, and driven by a Clock (VirtualClock in tests).
import type { NativeNetEvent } from '../core/api';
import { makeRng } from '../core/rng';
import type { Clock } from './clock';
import { Emitter, type Transport } from './transport';

interface End {
  t: MemoryTransport;
  conn: number;
  /** Time the last event towards this end is scheduled for (keeps per-direction order). */
  lastAt: number;
}

interface Link {
  a: End; // client side
  b: End; // host side
  open: boolean;
}

export interface MemoryNetOptions {
  minDelay?: number;
  maxDelay?: number;
  seed?: number;
}

export class MemoryNetwork {
  private rng: () => number;
  private minDelay: number;
  private maxDelay: number;
  private readonly hosts = new Map<string, { t: MemoryTransport; name: string; info: string }>();
  private readonly all = new Set<MemoryTransport>();
  private nextTransport = 1;
  /** Messages sent through the network, for assertions. */
  sent = 0;

  constructor(
    readonly clock: Clock,
    opts: MemoryNetOptions = {},
  ) {
    this.rng = makeRng(opts.seed ?? 1).next;
    this.minDelay = opts.minDelay ?? 1;
    this.maxDelay = opts.maxDelay ?? 5;
  }

  setDelay(min: number, max: number): void {
    this.minDelay = min;
    this.maxDelay = Math.max(min, max);
  }

  createTransport(): MemoryTransport {
    const t = new MemoryTransport(this, this.nextTransport++);
    this.all.add(t);
    return t;
  }

  /** The machine behind `t` vanishes: every peer sees its connections close; `t` itself hears nothing more. */
  cut(t: MemoryTransport): void {
    t.dead = true;
    for (const conn of [...t.links.keys()]) this.close(t, conn);
    this.stopHost(t);
    t.browsing = false;
  }

  // ── internals used by MemoryTransport ──

  private delay(): number {
    return this.minDelay + Math.floor(this.rng() * (this.maxDelay - this.minDelay + 1));
  }

  private deliver(end: End | MemoryTransport, e: NativeNetEvent, ordered: boolean): void {
    const t = end instanceof MemoryTransport ? end : end.t;
    const now = this.clock.now();
    let at = now + this.delay();
    if (ordered && !(end instanceof MemoryTransport)) {
      at = Math.max(at, end.lastAt);
      end.lastAt = at;
    }
    this.clock.after(at - now, () => {
      if (!t.dead) t.em.emit(e);
    });
  }

  hostId(t: MemoryTransport): string {
    return `mem-${t.id}`;
  }

  host(t: MemoryTransport, name: string, info: string): void {
    if (t.dead) return;
    const id = this.hostId(t);
    this.hosts.set(id, { t, name, info });
    this.deliver(t, { type: 'hosting', port: 40000 + t.id }, false);
    for (const b of this.all) if (b.browsing && b !== t) this.deliver(b, { type: 'found', id, name, info }, false);
  }

  updateInfo(t: MemoryTransport, info: string): void {
    const id = this.hostId(t);
    const h = this.hosts.get(id);
    if (!h) return;
    h.info = info;
    for (const b of this.all) if (b.browsing && b !== t) this.deliver(b, { type: 'found', id, name: h.name, info }, false);
  }

  stopHost(t: MemoryTransport): void {
    const id = this.hostId(t);
    if (!this.hosts.delete(id)) return;
    for (const b of this.all) if (b.browsing && b !== t) this.deliver(b, { type: 'lost', id }, false);
  }

  browse(t: MemoryTransport): void {
    if (t.dead) return;
    t.browsing = true;
    for (const [id, h] of this.hosts) if (h.t !== t) this.deliver(t, { type: 'found', id, name: h.name, info: h.info }, false);
  }

  connect(t: MemoryTransport, hostId: string): void {
    if (t.dead) return;
    const h = this.hosts.get(hostId);
    if (!h || h.t.dead) {
      this.deliver(t, { type: 'closed', conn: -1, hostId, reason: 'no such host' }, false);
      return;
    }
    const now = this.clock.now();
    const link: Link = {
      a: { t, conn: t.nextConn++, lastAt: 0 },
      b: { t: h.t, conn: h.t.nextConn++, lastAt: 0 },
      open: true,
    };
    t.links.set(link.a.conn, link);
    h.t.links.set(link.b.conn, link);
    const hostOpenAt = now + this.delay();
    const clientOpenAt = hostOpenAt + this.delay();
    link.b.lastAt = hostOpenAt;
    link.a.lastAt = clientOpenAt;
    this.clock.after(hostOpenAt - now, () => {
      if (!h.t.dead) h.t.em.emit({ type: 'open', conn: link.b.conn, incoming: true });
    });
    this.clock.after(clientOpenAt - now, () => {
      if (!t.dead) t.em.emit({ type: 'open', conn: link.a.conn, incoming: false, hostId });
    });
  }

  send(t: MemoryTransport, conn: number, text: string): void {
    if (t.dead) return;
    const link = t.links.get(conn);
    if (!link || !link.open) return;
    const dest = link.a.t === t && link.a.conn === conn ? link.b : link.a;
    this.sent++;
    this.deliver(dest, { type: 'message', conn: dest.conn, text }, true);
  }

  close(t: MemoryTransport, conn: number): void {
    const link = t.links.get(conn);
    if (!link) return;
    t.links.delete(conn);
    if (!link.open) return;
    link.open = false;
    const dest = link.a.t === t && link.a.conn === conn ? link.b : link.a;
    // the far side learns about it after everything already in flight
    const now = this.clock.now();
    const at = Math.max(now + this.delay(), dest.lastAt);
    dest.lastAt = at;
    this.clock.after(at - now, () => {
      dest.t.links.delete(dest.conn);
      if (!dest.t.dead) dest.t.em.emit({ type: 'closed', conn: dest.conn, reason: 'remote closed' });
    });
  }
}

export class MemoryTransport implements Transport {
  readonly kind = 'memory' as const;
  readonly em = new Emitter();
  readonly links = new Map<number, Link>();
  nextConn = 1;
  browsing = false;
  dead = false;

  constructor(
    private readonly net: MemoryNetwork,
    readonly id: number,
  ) {}

  /** Room id other transports see for this one when it hosts. */
  get hostId(): string {
    return this.net.hostId(this);
  }
  /** Currently open connection numbers (tests use this to inject raw wire messages). */
  openConns(): number[] {
    return [...this.links.keys()];
  }

  host(name: string, info: string): void {
    this.net.host(this, name, info);
  }
  updateInfo(info: string): void {
    this.net.updateInfo(this, info);
  }
  stopHost(): void {
    this.net.stopHost(this);
  }
  browse(): void {
    this.net.browse(this);
  }
  stopBrowse(): void {
    this.browsing = false;
  }
  connect(hostId: string): void {
    this.net.connect(this, hostId);
  }
  send(conn: number, text: string): void {
    this.net.send(this, conn, text);
  }
  close(conn: number): void {
    this.net.close(this, conn);
  }
  reset(): void {
    for (const c of [...this.links.keys()]) this.close(c);
    this.stopHost();
    this.stopBrowse();
  }
  listen(cb: (e: NativeNetEvent) => void): () => void {
    return this.em.on(cb);
  }
  dispose(): void {
    this.reset();
    this.em.clear();
  }
}
