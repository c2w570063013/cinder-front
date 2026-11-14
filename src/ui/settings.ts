// Persisted player preferences (localStorage, guarded — WKWebView file:// may refuse storage).

export type ControlScheme = 'classic' | 'modern';
export type WheelMode = 'auto' | 'zoom' | 'pan';

export interface UiSettings {
  /** classic: primary click selects AND commands, secondary deselects. modern: primary selects, secondary commands. */
  scheme: ControlScheme;
  /** Edge-scroll speed multiplier, 0 = off. */
  edgeScroll: number;
  /** How a plain wheel event is interpreted. auto = trackpad/Magic Mouse pans, notched wheel zooms. */
  wheelMode: WheelMode;
  panelSide: 'right' | 'left';
  showFps: boolean;
  gameSpeed: number;
  volume: { master: number; sfx: number; music: number; voice: number };
}

const KEY = 'cinderfront.ui.settings.v1';

const DEFAULTS: UiSettings = {
  scheme: 'classic',
  edgeScroll: 1,
  wheelMode: 'auto',
  panelSide: 'right',
  showFps: false,
  gameSpeed: 1,
  volume: { master: 0.8, sfx: 0.8, music: 0.5, voice: 0.8 },
};

function load(): UiSettings {
  const s: UiSettings = { ...DEFAULTS, volume: { ...DEFAULTS.volume } };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<UiSettings>;
      if (p.scheme === 'classic' || p.scheme === 'modern') s.scheme = p.scheme;
      if (typeof p.edgeScroll === 'number' && isFinite(p.edgeScroll)) s.edgeScroll = Math.min(2, Math.max(0, p.edgeScroll));
      if (p.wheelMode === 'auto' || p.wheelMode === 'zoom' || p.wheelMode === 'pan') s.wheelMode = p.wheelMode;
      if (p.panelSide === 'left' || p.panelSide === 'right') s.panelSide = p.panelSide;
      if (typeof p.showFps === 'boolean') s.showFps = p.showFps;
      if (typeof p.gameSpeed === 'number' && p.gameSpeed >= 0.25 && p.gameSpeed <= 4) s.gameSpeed = p.gameSpeed;
      if (p.volume && typeof p.volume === 'object') {
        for (const k of ['master', 'sfx', 'music', 'voice'] as const) {
          const v = (p.volume as Record<string, unknown>)[k];
          if (typeof v === 'number' && isFinite(v)) s.volume[k] = Math.min(1, Math.max(0, v));
        }
      }
    }
  } catch {
    /* storage unavailable — defaults */
  }
  return s;
}

/** Live singleton; mutate through `updateSettings` so listeners and storage stay in sync. */
export const settings: UiSettings = load();

type Listener = (s: UiSettings) => void;
const listeners = new Set<Listener>();

export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function updateSettings(patch: Partial<UiSettings>): void {
  Object.assign(settings, patch);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(settings);
}

/** Generic guarded JSON storage for other small bits (lobby choices). */
export function loadJson<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}
export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
