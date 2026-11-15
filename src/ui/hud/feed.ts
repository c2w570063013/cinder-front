// Alert / toast feed. Located alerts can be clicked (or Space) to jump the camera there.
import { el, glyph } from '../dom';

export type ToastKind = 'info' | 'good' | 'warn' | 'bad' | 'chat';

export interface Feed {
  el: HTMLElement;
  /** `key` coalesces repeats within a short window into a ×N counter. */
  push(text: string, kind: ToastKind, opts?: { key?: string; pos?: { x: number; y: number }; sub?: string; from?: { name: string; color: string } }): void;
  update(now: number): void;
  clear(): void;
}

interface Toast {
  key: string;
  root: HTMLElement;
  countEl: HTMLElement;
  count: number;
  until: number;
  leaving: boolean;
  urgent: boolean;
}

const LIFE = 5200;
const MAX = 6;

export function createFeed(onJump: (pos: { x: number; y: number }) => void): Feed {
  const root = el('div', 'cf-feed');
  let toasts: Toast[] = [];

  function drop(t: Toast): void {
    if (t.leaving) return;
    t.leaving = true;
    t.root.classList.add('is-out');
    window.setTimeout(() => t.root.remove(), 260);
  }

  return {
    el: root,
    push(text, kind, opts) {
      const now = performance.now();
      const key = opts?.key ?? text;
      const existing = toasts.find((t) => t.key === key && !t.leaving);
      if (existing) {
        existing.count++;
        existing.countEl.textContent = '×' + existing.count;
        existing.until = now + LIFE;
        existing.root.classList.remove('is-bump');
        void existing.root.offsetWidth;
        existing.root.classList.add('is-bump');
        return;
      }
      const item = el('div', 'cf-toast is-' + kind);
      const ic = el('span', 'cf-toast-ic');
      ic.innerHTML = glyph(kind === 'good' ? 'ok' : kind === 'info' ? 'info' : kind === 'chat' ? 'chat' : 'alert', 15);
      const body = el('div', 'cf-toast-body');
      const line = el('b');
      if (opts?.from) {
        item.style.setProperty('--cf-chat', opts.from.color);
        line.append(el('span', 'cf-toast-from', opts.from.name));
      }
      line.append(text);
      body.append(line);
      if (opts?.sub) body.append(el('small', '', opts.sub));
      const countEl = el('span', 'cf-toast-n');
      item.append(ic, body, countEl);
      const pos = opts?.pos;
      if (pos) {
        item.classList.add('is-link');
        const kbd = el('kbd', '', '空白鍵');
        item.append(kbd);
        item.title = '點擊或按空白鍵前往';
        item.addEventListener('click', () => onJump(pos));
      }
      root.append(item);
      const t: Toast = { key, root: item, countEl, count: 1, until: now + (kind === 'chat' ? LIFE * 1.6 : LIFE), leaving: false, urgent: kind === 'bad' };
      toasts.push(t);
      const live = toasts.filter((x) => !x.leaving);
      // over capacity: evict the oldest routine message before any urgent alert
      if (live.length > MAX) drop(live.find((x) => !x.urgent && x !== t) ?? live[0]);
    },
    update(now) {
      if (toasts.length === 0) return;
      let changed = false;
      for (const t of toasts) {
        if (!t.leaving && now > t.until) {
          drop(t);
          changed = true;
        }
      }
      if (changed || toasts.some((t) => t.leaving)) toasts = toasts.filter((t) => !t.leaving || t.root.isConnected);
    },
    clear() {
      for (const t of toasts) t.root.remove();
      toasts = [];
    },
  };
}
