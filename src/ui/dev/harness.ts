// Dev-only console harness for exercising key / mouse bindings without real input (works while the
// Browser pane is hidden and rAF is paused): `const T = (await import('/src/ui/dev/harness.ts')).install()`.
import type { Command } from '../../core/types';

interface Mods {
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  button?: number;
}
interface DevSession {
  world: { entities: Map<number, { x: number; y: number }> };
  renderer: { worldToScreen(x: number, y: number): { x: number; y: number }; camera: { x: number; y: number; zoom: number } };
  ui: { update(w: unknown, dt: number): void; handleEvents(ev: unknown[], w: unknown): void; view: { selection: Set<number>; showAllHealth: boolean } };
  cmds: Command[];
}

export function install() {
  const dev = (window as unknown as { __dev: { session: DevSession | null } }).__dev;
  const T = {
    get s(): DevSession {
      return dev.session!;
    },
    frame(n = 1) {
      for (let i = 0; i < n; i++) T.s.ui.update(T.s.world, 16);
    },
    key(code: string, o: Mods = {}) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, shiftKey: !!o.shift }));
    },
    up(code: string, o: Mods = {}) {
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true, ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, shiftKey: !!o.shift }));
    },
    tap(code: string, o: Mods = {}) {
      T.key(code, o);
      T.up(code, o);
    },
    click(sx: number, sy: number, o: Mods = {}) {
      const c = document.getElementById('game')!;
      const r = c.getBoundingClientRect();
      const init: PointerEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: r.left + sx,
        clientY: r.top + sy,
        button: o.button ?? 0,
        buttons: o.button === 2 ? 2 : 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        ctrlKey: !!o.ctrl,
        metaKey: !!o.meta,
        altKey: !!o.alt,
        shiftKey: !!o.shift,
      };
      c.dispatchEvent(new PointerEvent('pointermove', init));
      c.dispatchEvent(new PointerEvent('pointerdown', init));
      c.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    },
    clickWorld(x: number, y: number, o?: Mods) {
      const p = T.s.renderer.worldToScreen(x, y);
      T.click(p.x, p.y, o);
    },
    clickEnt(id: number, o?: Mods) {
      const e = T.s.world.entities.get(id)!;
      T.clickWorld(e.x, e.y, o);
    },
    cmds() {
      return T.s.cmds.splice(0).map((c) => {
        const { player: _p, ...rest } = c as Command & { player?: number };
        return rest;
      });
    },
    sel() {
      return [...T.s.ui.view.selection];
    },
    toasts() {
      return [...document.querySelectorAll('.cf-toast')].map((t) => (t as HTMLElement).innerText.replace(/\n/g, ' '));
    },
    cam() {
      const c = T.s.renderer.camera;
      return [+c.x.toFixed(2), +c.y.toFixed(2), c.zoom];
    },
  };
  (window as unknown as { T: typeof T }).T = T;
  T.frame(2);
  return T;
}
