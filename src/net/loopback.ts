// BroadcastChannel transport: lets several tabs (or several NetApi instances in one page) on the same
// origin find each other and play, emulating the native bridge. Dev builds / `?net=loopback` only.
import type { NativeNetEvent } from '../core/api';
import { realClock, type Clock } from './clock';
import { Emitter, type Transport } from './transport';
import { isObj } from './wire';

const CHANNEL = 'cinder-front-net-loopback-v1';
const AD_EVERY_MS = 1000;
const AD_EXPIRE_MS = 5000;
const CONNECT_TIMEOUT_MS = 3000;

type LbMsg =
  | { k: 'ad'; from: string; name: string; info: string }
  | { k: 'gone'; from: string }
  | { k: 'query'; from: string }
  | { k: 'conn'; from: string; to: string; cid: string }
  | { k: 'accept'; from: string; to: string; cid: string }
  | { k: 'reject'; from: string; to: string; cid: string }
  | { k: 'msg'; from: string; to: string; cid: string; text: string }
  | { k: 'close'; from: string; to: string; cid: string };

function parseLb(d: unknown): LbMsg | null {
  if (!isObj(d) || typeof d.from !== 'string') return null;
  const from = d.from;
  switch (d.k) {
    case 'ad':
      return typeof d.name === 'string' && typeof d.info === 'string' ? { k: 'ad', from, name: d.name, info: d.info } : null;
    case 'gone':
    case 'query':
      return { k: d.k, from };
    case 'conn':
    case 'accept':
    case 'reject':
    case 'close':
      return typeof d.to === 'string' && typeof d.cid === 'string' ? { k: d.k, from, to: d.to, cid: d.cid } : null;
    case 'msg':
      return typeof d.to === 'string' && typeof d.cid === 'string' && typeof d.text === 'string' ? { k: 'msg', from, to: d.to, cid: d.cid, text: d.text } : null;
    default:
      return null;
  }
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID().slice(0, 13);
  return Math.random().toString(36).slice(2, 12);
}

export function createLoopbackTransport(clock: Clock = realClock): Transport {
  const me = `lb-${randomId()}`;
  const em = new Emitter();
  const ch = new BroadcastChannel(CHANNEL);
  let hosting: { name: string; info: string } | null = null;
  let browsing = false;
  const seen = new Map<string, { name: string; info: string; at: number }>();
  const links = new Map<number, { cid: string; peer: string }>();
  const byCid = new Map<string, number>();
  const pending = new Map<string, { hostId: string; cancel: () => void }>();
  let nextConn = 1;
  let nextCid = 1;

  const post = (m: LbMsg): void => ch.postMessage(m);
  const emit = (e: NativeNetEvent): void => {
    // keep events asynchronous like the native bridge
    clock.after(0, () => em.emit(e));
  };
  const postAd = (): void => {
    if (hosting) post({ k: 'ad', from: me, name: hosting.name, info: hosting.info });
  };

  const stopTimer = clock.every(AD_EVERY_MS, () => {
    postAd();
    if (!browsing) return;
    const now = clock.now();
    for (const [id, s] of seen) {
      if (now - s.at > AD_EXPIRE_MS) {
        seen.delete(id);
        em.emit({ type: 'lost', id });
      }
    }
  });

  const addLink = (cid: string, peer: string): number => {
    const conn = nextConn++;
    links.set(conn, { cid, peer });
    byCid.set(cid, conn);
    return conn;
  };
  const dropLink = (conn: number): void => {
    const l = links.get(conn);
    if (!l) return;
    links.delete(conn);
    byCid.delete(l.cid);
  };

  ch.onmessage = (ev: MessageEvent<unknown>) => {
    const m = parseLb(ev.data);
    if (!m || m.from === me) return;
    if ('to' in m && m.to !== me) return;
    switch (m.k) {
      case 'ad': {
        if (!browsing) return;
        const prev = seen.get(m.from);
        seen.set(m.from, { name: m.name, info: m.info, at: clock.now() });
        if (!prev || prev.info !== m.info || prev.name !== m.name) em.emit({ type: 'found', id: m.from, name: m.name, info: m.info });
        return;
      }
      case 'gone':
        if (seen.delete(m.from)) em.emit({ type: 'lost', id: m.from });
        return;
      case 'query':
        postAd();
        return;
      case 'conn': {
        if (!hosting || byCid.has(m.cid)) {
          post({ k: 'reject', from: me, to: m.from, cid: m.cid });
          return;
        }
        const conn = addLink(m.cid, m.from);
        post({ k: 'accept', from: me, to: m.from, cid: m.cid });
        em.emit({ type: 'open', conn, incoming: true });
        return;
      }
      case 'accept': {
        const p = pending.get(m.cid);
        if (!p) {
          post({ k: 'close', from: me, to: m.from, cid: m.cid });
          return;
        }
        pending.delete(m.cid);
        p.cancel();
        const conn = addLink(m.cid, m.from);
        em.emit({ type: 'open', conn, incoming: false, hostId: p.hostId });
        return;
      }
      case 'reject': {
        const p = pending.get(m.cid);
        if (!p) return;
        pending.delete(m.cid);
        p.cancel();
        em.emit({ type: 'closed', conn: -1, hostId: p.hostId, reason: 'refused' });
        return;
      }
      case 'msg': {
        const conn = byCid.get(m.cid);
        if (conn !== undefined) em.emit({ type: 'message', conn, text: m.text });
        return;
      }
      case 'close': {
        const conn = byCid.get(m.cid);
        if (conn === undefined) return;
        dropLink(conn);
        em.emit({ type: 'closed', conn, reason: 'remote closed' });
        return;
      }
    }
  };

  const t: Transport = {
    kind: 'loopback',
    host(name, info) {
      hosting = { name, info };
      postAd();
      emit({ type: 'hosting', port: 0 });
    },
    updateInfo(info) {
      if (!hosting) return;
      hosting.info = info;
      postAd();
    },
    stopHost() {
      if (!hosting) return;
      hosting = null;
      post({ k: 'gone', from: me });
    },
    browse() {
      browsing = true;
      post({ k: 'query', from: me });
    },
    stopBrowse() {
      browsing = false;
      seen.clear();
    },
    connect(hostId) {
      const cid = `${me}/${nextCid++}`;
      const cancel = clock.after(CONNECT_TIMEOUT_MS, () => {
        if (!pending.delete(cid)) return;
        em.emit({ type: 'closed', conn: -1, hostId, reason: 'timeout' });
      });
      pending.set(cid, { hostId, cancel });
      post({ k: 'conn', from: me, to: hostId, cid });
    },
    send(conn, text) {
      const l = links.get(conn);
      if (l) post({ k: 'msg', from: me, to: l.peer, cid: l.cid, text });
    },
    close(conn) {
      const l = links.get(conn);
      if (!l) return;
      post({ k: 'close', from: me, to: l.peer, cid: l.cid });
      dropLink(conn);
    },
    reset() {
      for (const conn of [...links.keys()]) t.close(conn);
      for (const p of pending.values()) p.cancel();
      pending.clear();
      t.stopHost();
      t.stopBrowse();
    },
    listen: (cb) => em.on(cb),
    dispose() {
      t.reset();
      stopTimer();
      ch.close();
      em.clear();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
    },
  };
  const onHide = (): void => t.reset();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
  return t;
}
