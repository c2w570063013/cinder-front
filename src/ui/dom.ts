// Small DOM helpers shared by the HUD and the menus. No framework, no dependencies.
import type { BuildingDef, EntityDef, UnitDef } from '../core/types';
import { BUILDINGS, UNITS } from '../data';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Button with a click handler. `html` may contain our own inline SVG glyphs. */
export function button(cls: string, html: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  b.innerHTML = html;
  b.addEventListener('click', onClick);
  return b;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

/** Label for the platform command modifier. */
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl';

export function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** '#rrggbb' → 'r,g,b' for use in rgba(var(--x), a). Falls back to a neutral blue. */
export function hexToRgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return '90,170,255';
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

/** Def lookup that never throws (data `getDef` throws on unknown ids). */
export function defOf(defId: string): EntityDef | undefined {
  return UNITS[defId] ?? BUILDINGS[defId];
}
export function unitDef(defId: string): UnitDef | undefined {
  return UNITS[defId];
}
export function buildingDef(defId: string): BuildingDef | undefined {
  return BUILDINGS[defId];
}
export function nameOf(defId: string): string {
  return defOf(defId)?.name ?? defId;
}

/** Copy a (cached, renderer-owned) icon canvas into one of ours. */
export function blitIcon(target: HTMLCanvasElement, source: HTMLCanvasElement | null, cssSize: number, dpr: number): void {
  const px = Math.max(1, Math.round(cssSize * dpr));
  if (target.width !== px) target.width = px;
  if (target.height !== px) target.height = px;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, px, px);
  if (source && source.width > 0 && source.height > 0) {
    try {
      ctx.drawImage(source, 0, 0, px, px);
    } catch {
      /* icon not drawable yet */
    }
  }
}

export function safeDpr(): number {
  return clamp(window.devicePixelRatio || 1, 1, 3);
}

/** Inline SVG glyph (24×24 viewBox, stroke-based, our own drawings). */
export function glyph(name: keyof typeof GLYPHS, size = 16): string {
  return `<svg class="cf-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`;
}

export const GLYPHS = {
  credit: '<path d="M12 2.5 20 12l-8 9.5L4 12Z"/><path d="M12 7.5 15.8 12 12 16.5 8.2 12Z" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13.5 2.5 5.5 13.5h5.5l-1 8 8.5-11.5h-5.6Z" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  guard: '<path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.900 7-5.300 7-9.500V6Z"/><path d="M12 8v7"/>',
  attackMove: '<circle cx="10" cy="14" r="5.500"/><path d="M10 6.500V10M10 18v3.500M2.500 14H6M14 14h1.500"/><path d="M15 9l6-6M21 3h-4M21 3v4"/>',
  deploy: '<rect x="8.500" y="8.500" width="7" height="7"/><path d="M12 2.500v4M12 17.500v4M2.500 12h4M17.500 12h4"/><path d="M10.200 4.300 12 2.500l1.800 1.800M10.200 19.700 12 21.500l1.800-1.800M4.300 10.200 2.500 12l1.800 1.800M19.700 10.200 21.500 12l-1.800 1.800"/>',
  scatter: '<circle cx="12" cy="12" r="1.600" fill="currentColor"/><path d="M12 8V3M12 3 10 5M12 3l2 2M15.500 14l4.300 2.500M19.800 16.500l-2.700.3M19.800 16.500l-1-2.500M8.500 14l-4.300 2.500M4.200 16.500l2.700.3M4.200 16.500l1-2.500"/>',
  primary: '<path d="M6 21V3.500"/><path d="M6 4.500h11l-2.500 4 2.500 4H6" fill="currentColor" fill-opacity=".25"/>',
  sell: '<path d="M12 3 19 11l-7 8-7-8Z"/><path d="M12 14.500v7M9 19l3 2.500L15 19"/>',
  repair: '<path d="M14.500 5.200a4.200 4.200 0 0 0-5.300 5.300L3.500 16.200l2.800 2.800 5.700-5.700a4.200 4.200 0 0 0 5.300-5.300l-2.600 2.600-2.300-.5-.5-2.300Z"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M14.500 5 7.500 12l7 7"/>',
  alert: '<path d="M12 3.500 21.500 20h-19Z"/><path d="M12 10v4.500M12 17.300v.2"/>',
  ok: '<path d="M5 12.500 10 17.500 19.500 7"/>',
  info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.500M12 7.700v.2"/>',
  recon_sweep: '<circle cx="12" cy="12" r="8.500"/><path d="M12 12 18 6"/><circle cx="12" cy="12" r="3.500"/>',
  orbital_lance: '<path d="M12 2v13"/><path d="M8.500 5.500 12 2l3.500 3.500"/><path d="M5 19c2-2.500 4.300-3.800 7-3.800s5 1.300 7 3.800"/><path d="M8 21.500h8"/>',
  tremor: '<path d="M2.500 13h3.500l2-6 3.500 12 3-9 2 3h5"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.200" fill="currentColor"/><circle cx="15" cy="15" r="1.200" fill="currentColor"/><circle cx="15" cy="9" r="1.200" fill="currentColor"/><circle cx="9" cy="15" r="1.200" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5h12l-3 4 3 4H6"/>',
  pause: '<path d="M8.500 5v14M15.500 5v14"/>',
  chat: '<path d="M4 5.500h16v10H11l-4.500 3.500V15.500H4Z"/><path d="M8 10.500h8"/>',
  link: '<path d="M5 12h3l2-5 4 10 2-5h3"/>',
} as const;
