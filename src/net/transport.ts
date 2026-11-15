// Transport abstraction. Every transport speaks the NativeNetBridge model (host / browse / connect,
// numbered connections, whole-string messages, NativeNetEvent callbacks) so the lobby and lockstep
// code are identical over the mac app's Bonjour+TCP, BroadcastChannel (two tabs) and in-memory (tests).
import type { NativeNetBridge, NativeNetEvent } from '../core/api';
import { isObj, parseNativeEvent } from './wire';

export type TransportKind = 'native' | 'loopback' | 'memory';

export interface Transport extends NativeNetBridge {
  readonly kind: TransportKind;
  /** Subscribe to transport events. Events are always delivered asynchronously. */
  listen(cb: (e: NativeNetEvent) => void): () => void;
  /** Release everything (also calls reset()). */
  dispose(): void;
}

export class Emitter {
  private readonly l = new Set<(e: NativeNetEvent) => void>();
  on(cb: (e: NativeNetEvent) => void): () => void {
    this.l.add(cb);
    return () => {
      this.l.delete(cb);
    };
  }
  emit(e: NativeNetEvent): void {
    for (const cb of [...this.l]) {
      try {
        cb(e);
      } catch (err) {
        console.error('[net] listener failed', err);
      }
    }
  }
  clear(): void {
    this.l.clear();
  }
}

const BRIDGE_METHODS = ['host', 'updateInfo', 'stopHost', 'browse', 'stopBrowse', 'connect', 'send', 'close', 'reset'] as const;

/** `window.cinderNative.net` if the mac app injected a complete bridge, else null. */
export function findNativeBridge(): NativeNetBridge | null {
  if (typeof window === 'undefined') return null;
  const cn = (window as unknown as { cinderNative?: unknown }).cinderNative;
  if (!isObj(cn)) return null;
  const n = cn.net;
  if (typeof n !== 'object' || n === null) return null;
  const rec = n as Record<string, unknown>;
  for (const k of BRIDGE_METHODS) if (typeof rec[k] !== 'function') return null;
  return n as NativeNetBridge;
}

/** Wraps the mac app's bridge. Events arrive as `CustomEvent<NativeNetEvent>` named 'cinder:net' on `target`. */
export function createNativeTransport(bridge: NativeNetBridge, target: EventTarget = window): Transport {
  const em = new Emitter();
  const onEvent = (ev: Event): void => {
    const e = parseNativeEvent((ev as CustomEvent<unknown>).detail);
    if (e) em.emit(e);
  };
  target.addEventListener('cinder:net', onEvent);
  const call = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      console.error('[net] native bridge call failed', err);
      // keep the "always async" promise of the event model
      setTimeout(() => em.emit({ type: 'error', message: '區域網路功能發生錯誤。' }), 0);
    }
  };
  return {
    kind: 'native',
    host: (name, info) => call(() => bridge.host(name, info)),
    updateInfo: (info) => call(() => bridge.updateInfo(info)),
    stopHost: () => call(() => bridge.stopHost()),
    browse: () => call(() => bridge.browse()),
    stopBrowse: () => call(() => bridge.stopBrowse()),
    connect: (hostId) => call(() => bridge.connect(hostId)),
    send: (conn, text) => call(() => bridge.send(conn, text)),
    close: (conn) => call(() => bridge.close(conn)),
    reset: () => call(() => bridge.reset()),
    listen: (cb) => em.on(cb),
    dispose() {
      call(() => bridge.reset());
      target.removeEventListener('cinder:net', onEvent);
      em.clear();
    },
  };
}
