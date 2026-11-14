// In-game UI: HUD overlays, world input (selection, smart commands, modes), camera and keyboard.
import type { CreateGameUi, GameUi, ViewState } from '../core/api';
import { TICK_RATE } from '../core/constants';
import type { Entity, EntityId, MovementType, Player, SimEvent, SupportPowerId, World } from '../core/types';
import { SUPPORT_POWERS } from '../data';
import { applyCursor, type CursorName } from './cursors';
import { buildingDef, button, clamp, el, fmtTime, glyph, hexToRgbTriplet, isMac, nameOf, unitDef } from './dom';
import { createFeed } from './hud/feed';
import { createPanel } from './hud/panel';
import { createPauseMenu } from './hud/pause';
import { createSelectionPanel, type SelCommand } from './hud/selection';
import { onSettingsChange, settings } from './settings';
import { injectStyle } from './style';

type Mode =
  | { kind: 'normal' }
  | { kind: 'placement'; defId: string }
  | { kind: 'sell' }
  | { kind: 'repair' }
  | { kind: 'attackMove' }
  | { kind: 'power'; power: SupportPowerId };

type Intent =
  | { k: 'none' }
  | { k: 'select'; id: EntityId }
  | { k: 'move'; x: number; y: number; blocked: boolean }
  | { k: 'attack'; id: EntityId }
  | { k: 'harvest'; tx: number; ty: number; x: number; y: number }
  | { k: 'dock'; id: EntityId }
  | { k: 'capture'; id: EntityId; hostile: boolean }
  | { k: 'deploy'; id: EntityId }
  | { k: 'rally'; x: number; y: number };

interface SelInfo {
  unitIds: EntityId[];
  harvesters: EntityId[];
  engineers: EntityId[];
  fighters: EntityId[];
  armed: boolean;
  producers: Entity[];
  movement: MovementType | null;
  firstUnitDef: string | null;
}

interface Drag {
  type: 'select' | 'secondary' | 'pan';
  x0: number;
  y0: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  shift: boolean;
}

const DRAG_THRESHOLD = 5;
const DOUBLE_MS = 340;
const EDGE_PX = 6;
const BUILD_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO'];

export const createGameUi: CreateGameUi = (deps) => {
  injectStyle();
  const { root, canvas, renderer, sim, audio } = deps;
  const me = deps.viewer;
  try {
    deps.setSpeed(settings.gameSpeed);
  } catch {
    /* main not ready */
  }

  const view: ViewState = {
    viewer: me,
    selection: new Set<EntityId>(),
    hoverId: null,
    placement: null,
    dragRect: null,
    powerTarget: null,
    showAllHealth: false,
    markers: [],
    time: performance.now(),
  };

  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  // ───────────────────────── DOM ─────────────────────────
  const hud = el('div', 'cf-root cf-hud');
  root.append(hud);

  const top = el('div', 'cf-top cf-glass');
  const menuBtn = button('cf-icon-btn', glyph('menu', 18), () => {
    audio.playUi('click');
    pause.open();
  });
  menuBtn.title = '選單 (Esc)';
  const clock = el('span', 'cf-clock', '00:00');
  clock.title = '作戰時間 Mission clock';
  const fps = el('span', 'cf-fps');
  const fsBtn = button('cf-icon-btn', glyph('fullscreen', 16), () => {
    audio.playUi('click');
    toggleFullscreen();
  });
  fsBtn.title = '全螢幕 (F)';
  top.append(menuBtn, clock, fps, fsBtn);

  const banner = el('div', 'cf-banner cf-glass');
  banner.style.display = 'none';

  const feed = createFeed((pos) => centerOn(pos.x, pos.y));

  let mode: Mode = { kind: 'normal' };
  const modeKey = () => (mode.kind === 'power' ? 'power:' + mode.power : mode.kind);

  const panel = createPanel({
    deps,
    view,
    hud,
    modeKind: modeKey,
    enterPlacement: (defId) => setMode({ kind: 'placement', defId }),
    enterPower: (power) => setMode({ kind: 'power', power }),
    toggleMode: (kind) => setMode(mode.kind === kind ? { kind: 'normal' } : { kind }),
    panTo: (x, y) => centerOn(x, y),
    commandAt: (x, y, queue) => commandAtWorld(x, y, queue),
  });

  const selPanel = createSelectionPanel({
    deps,
    view,
    modeKind: modeKey,
    command: (kind) => runCommand(kind),
    selectOnly: (ids) => setSelection(ids),
  });

  let userPaused = false;
  const pause = createPauseMenu(deps, {
    onOpen: () => {
      resetInput();
      deps.setPaused(true);
    },
    onClose: () => deps.setPaused(userPaused),
    surrender: () => {
      deps.send({ type: 'surrender', player: me });
    },
    canSurrender: () => !!world && !ended && !world.players[me]?.defeated,
  });

  hud.append(top, banner, feed.el, selPanel.el, panel.el, pause.el);

  // ───────────────────────── state ─────────────────────────
  let world: World | null = null;
  let ended = false;
  let destroyed = false;
  let rect = canvas.getBoundingClientRect();
  let rectAt = 0;
  const ptr = { x: 0, y: 0, inside: false };
  const edge = { x: -1, y: -1, active: false };
  let drag: Drag | null = null;
  const held = new Set<string>();
  let spaceDown = false;
  let spaceAt = 0;
  let spaceUsed = false;
  let cursor: CursorName | '' = '';
  let lastClick = { at: 0, defId: '', id: -1 };
  const groups: EntityId[][] = [];
  let lastGroupTap = { n: -1, at: 0 };
  const alerts: { x: number; y: number }[] = [];
  let alertCursor = 0;
  let placementCheckAt = 0;
  let lastTrackpadAt = -1e9;
  let gestureScale = 1;
  let bannerText = '';
  let clockText = '';
  let fpsFrames = 0;
  let fpsAt = performance.now();
  let fpsShown = false;

  const offs: (() => void)[] = [];
  function on<T extends EventTarget>(target: T, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions | boolean): void {
    target.addEventListener(type, fn as EventListener, opts);
    offs.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  // ───────────────────────── layout / theme ─────────────────────────
  let tintFor = '';
  function applyTint(color: string): void {
    if (color === tintFor) return;
    tintFor = color;
    hud.style.setProperty('--cf-accent', color);
    hud.style.setProperty('--cf-accent-rgb', hexToRgbTriplet(color));
  }
  function applyLayout(): void {
    const w = hud.clientWidth;
    const h = hud.clientHeight;
    hud.classList.toggle('is-compact', w < 1180 || h < 720);
    hud.classList.toggle('is-tiny', h < 600);
    hud.classList.toggle('is-large', w >= 1800 && h >= 1000);
    hud.classList.toggle('is-left', settings.panelSide === 'left');
    rect = canvas.getBoundingClientRect();
    panel.resize();
    panel.hideTooltip();
  }
  applyLayout();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(hud);
    offs.push(() => ro.disconnect());
  } else on(window, 'resize', applyLayout);
  offs.push(
    onSettingsChange(() => {
      applyLayout();
      fpsShown = false;
      fps.textContent = '';
    }),
  );

  // ───────────────────────── camera ─────────────────────────
  const cam = renderer.camera;
  function clampCam(): void {
    if (world) {
      try {
        renderer.clampCamera(world);
      } catch {
        /* ignore */
      }
    }
  }
  /** Shift the view by a screen-space delta (css px). */
  function panScreen(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const a = renderer.screenToWorld(cx, cy);
    const b = renderer.screenToWorld(cx + dx, cy + dy);
    cam.x += b.x - a.x;
    cam.y += b.y - a.y;
    clampCam();
  }
  function zoomAt(factor: number, sx: number, sy: number): void {
    const z = clamp(cam.zoom * factor, 0.5, 2);
    if (z === cam.zoom) return;
    const before = renderer.screenToWorld(sx, sy);
    cam.zoom = z;
    const after = renderer.screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    clampCam();
  }
  function centerOn(x: number, y: number): void {
    cam.x = x;
    cam.y = y;
    clampCam();
  }

  // ───────────────────────── helpers ─────────────────────────
  const player = (): Player | undefined => world?.players[me];
  function isEnemy(w: World, other: number): boolean {
    if (other === me) return false;
    try {
      return sim.isEnemy(w, me, other);
    } catch {
      return w.players[other]?.team !== w.players[me]?.team;
    }
  }
  function pick(sx: number, sy: number): EntityId | null {
    if (!world) return null;
    try {
      return renderer.pickEntity(world, sx, sy, me);
    } catch {
      return null;
    }
  }
  function marker(x: number, y: number, kind: 'move' | 'attack' | 'rally'): void {
    view.markers.push({ x, y, kind, at: view.time });
  }
  function refreshRect(now: number): void {
    if (now - rectAt > 500) {
      rectAt = now;
      rect = canvas.getBoundingClientRect();
    }
  }
  function setPtr(e: { clientX: number; clientY: number }): void {
    ptr.x = e.clientX - rect.left;
    ptr.y = e.clientY - rect.top;
  }
  function isSecondary(e: PointerEvent | MouseEvent): boolean {
    return e.button === 2 || (isMac && e.button === 0 && e.ctrlKey);
  }

  function analyze(w: World): SelInfo {
    const s: SelInfo = { unitIds: [], harvesters: [], engineers: [], fighters: [], armed: false, producers: [], movement: null, firstUnitDef: null };
    for (const id of view.selection) {
      const e = w.entities.get(id);
      if (!e || e.owner !== me) continue;
      if (e.kind === 'unit') {
        const d = unitDef(e.defId);
        s.unitIds.push(id);
        if (!s.firstUnitDef) s.firstUnitDef = e.defId;
        if (d?.harvester) s.harvesters.push(id);
        if (d?.engineer) s.engineers.push(id);
        else s.fighters.push(id);
        if (d?.weapon || d?.secondary) s.armed = true;
        if (d && s.movement !== 'foot') {
          // the most restrictive ground type decides the no-go cursor
          s.movement = d.movement === 'air' && s.movement ? s.movement : d.movement;
        }
      } else if (buildingDef(e.defId)?.produces?.length || buildingDef(e.defId)?.conyard) {
        if (e.buildProgress >= 1) s.producers.push(e);
      }
    }
    return s;
  }

  // ───────────────────────── selection ─────────────────────────
  function pruneSelection(w: World): void {
    for (const id of view.selection) if (!w.entities.has(id)) view.selection.delete(id);
  }
  function ackSelect(e: Entity | undefined): void {
    if (e && e.owner === me && e.kind === 'unit') audio.playAck(e.defId, 'select');
    else audio.playUi('select');
  }
  function setSelection(ids: EntityId[], add = false): void {
    if (!add) view.selection.clear();
    for (const id of ids) view.selection.add(id);
  }
  function dropForeign(w: World): void {
    for (const id of view.selection) {
      const e = w.entities.get(id);
      if (!e || e.owner !== me) view.selection.delete(id);
    }
  }
  function onScreenOwn(w: World, pred: (e: Entity) => boolean): EntityId[] {
    let ids: EntityId[] = [];
    try {
      ids = renderer.entitiesInRect(w, 0, 0, rect.width, rect.height, me);
    } catch {
      ids = [];
    }
    return ids.filter((id) => {
      const e = w.entities.get(id);
      return !!e && e.owner === me && pred(e);
    });
  }
  function selectClick(w: World, id: EntityId, shift: boolean): void {
    const e = w.entities.get(id);
    if (!e) return;
    const now = performance.now();
    if (e.owner !== me) {
      setSelection([id]);
      audio.playUi('select');
      lastClick = { at: now, defId: '', id };
      return;
    }
    const dbl = now - lastClick.at < DOUBLE_MS && lastClick.defId === e.defId;
    lastClick = { at: now, defId: e.defId, id };
    dropForeign(w);
    if (dbl) {
      const same = onScreenOwn(w, (x) => x.defId === e.defId);
      setSelection(same.length ? same : [id], shift);
      ackSelect(e);
      return;
    }
    if (shift) {
      if (view.selection.has(id)) view.selection.delete(id);
      else {
        // keep selections homogeneous: units and buildings don't mix
        const first = view.selection.values().next().value as EntityId | undefined;
        const fe = first !== undefined ? w.entities.get(first) : undefined;
        if (fe && fe.kind !== e.kind) view.selection.clear();
        view.selection.add(id);
      }
    } else setSelection([id]);
    ackSelect(e);
  }
  function boxSelect(w: World, d: Drag): void {
    const x0 = Math.min(d.x0, ptr.x);
    const y0 = Math.min(d.y0, ptr.y);
    const x1 = Math.max(d.x0, ptr.x);
    const y1 = Math.max(d.y0, ptr.y);
    let ids: EntityId[] = [];
    try {
      ids = renderer.entitiesInRect(w, x0, y0, x1, y1, me);
    } catch {
      ids = [];
    }
    const own = ids.map((id) => w.entities.get(id)).filter((e): e is Entity => !!e && e.owner === me);
    const units = own.filter((e) => e.kind === 'unit');
    const chosen = units.length ? units : own.filter((e) => e.kind === 'building').slice(0, 1);
    if (chosen.length === 0) {
      if (!d.shift) view.selection.clear();
      return;
    }
    dropForeign(w);
    if (d.shift) {
      const first = view.selection.values().next().value as EntityId | undefined;
      const fe = first !== undefined ? w.entities.get(first) : undefined;
      if (fe && fe.kind !== chosen[0].kind) view.selection.clear();
    }
    setSelection(
      chosen.map((e) => e.id),
      d.shift,
    );
    ackSelect(chosen[0]);
  }

  // ───────────────────────── smart command ─────────────────────────
  function resolve(w: World, sx: number, sy: number, picked: EntityId | null, allowSelect: boolean): Intent {
    const s = analyze(w);
    const hasUnits = s.unitIds.length > 0;
    const target = picked != null ? w.entities.get(picked) : undefined;
    if (target) {
      const mine = target.owner === me;
      if (mine && hasUnits) {
        const bd = target.kind === 'building' ? buildingDef(target.defId) : undefined;
        const done = target.buildProgress >= 1;
        if (bd?.refinery && s.harvesters.length && done) return { k: 'dock', id: target.id };
        if (bd && s.engineers.length && done && target.hp < target.maxHp) return { k: 'capture', id: target.id, hostile: false };
        if (view.selection.size === 1 && view.selection.has(target.id) && unitDef(target.defId)?.deploysTo) return { k: 'deploy', id: target.id };
      }
      if (!mine && hasUnits && isEnemy(w, target.owner)) {
        if (target.kind === 'building' && s.engineers.length) return { k: 'capture', id: target.id, hostile: true };
        if (s.armed) return { k: 'attack', id: target.id };
        return { k: 'move', x: target.x, y: target.y, blocked: false };
      }
      if (allowSelect) return { k: 'select', id: target.id };
      if (hasUnits && target.kind === 'unit') return { k: 'move', x: target.x, y: target.y, blocked: false };
      if (!hasUnits) return { k: 'none' };
    }
    const p = renderer.screenToWorld(sx, sy);
    if (p.x < 0 || p.y < 0 || p.x >= w.map.width || p.y >= w.map.height) return { k: 'none' };
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (hasUnits) {
      const idx = ty * w.map.width + tx;
      const explored = !w.setup.options.fog || !!w.players[me]?.explored[idx];
      if (s.harvesters.length && explored && w.map.ore[idx] > 0) return { k: 'harvest', tx, ty, x: p.x, y: p.y };
      let blocked = false;
      if (explored && s.movement && s.movement !== 'air') {
        try {
          blocked = !sim.isPassable(w, tx, ty, s.movement);
        } catch {
          blocked = false;
        }
      }
      return { k: 'move', x: p.x, y: p.y, blocked };
    }
    if (s.producers.length) return { k: 'rally', x: p.x, y: p.y };
    return { k: 'none' };
  }

  function issue(w: World, it: Intent, queue: boolean): void {
    const s = analyze(w);
    const q = queue || undefined;
    switch (it.k) {
      case 'move':
        if (!s.unitIds.length) return;
        deps.send({ type: 'move', player: me, ids: s.unitIds, x: it.x, y: it.y, queue: q });
        marker(it.x, it.y, 'move');
        if (s.firstUnitDef) audio.playAck(s.firstUnitDef, 'move');
        break;
      case 'attack': {
        const ids = s.fighters.length ? s.fighters : s.unitIds;
        if (!ids.length) return;
        deps.send({ type: 'attack', player: me, ids, targetId: it.id, queue: q });
        const t = w.entities.get(it.id);
        if (t) marker(t.x, t.y, 'attack');
        if (s.firstUnitDef) audio.playAck(s.firstUnitDef, 'attack');
        break;
      }
      case 'harvest': {
        deps.send({ type: 'harvest', player: me, ids: s.harvesters, tx: it.tx, ty: it.ty });
        const rest = s.unitIds.filter((id) => !s.harvesters.includes(id));
        if (rest.length) deps.send({ type: 'move', player: me, ids: rest, x: it.x, y: it.y, queue: q });
        marker(it.tx + 0.5, it.ty + 0.5, 'move');
        const hd = w.entities.get(s.harvesters[0])?.defId;
        if (hd) audio.playAck(hd, 'move');
        break;
      }
      case 'dock': {
        deps.send({ type: 'dock', player: me, ids: s.harvesters, targetId: it.id });
        const t = w.entities.get(it.id);
        if (t) marker(t.x, t.y, 'move');
        const hd = w.entities.get(s.harvesters[0])?.defId;
        if (hd) audio.playAck(hd, 'move');
        break;
      }
      case 'capture': {
        deps.send({ type: 'capture', player: me, ids: s.engineers, targetId: it.id });
        const t = w.entities.get(it.id);
        if (t) marker(t.x, t.y, it.hostile ? 'attack' : 'move');
        const ed = w.entities.get(s.engineers[0])?.defId;
        if (ed) audio.playAck(ed, 'move');
        break;
      }
      case 'deploy':
        deps.send({ type: 'deploy', player: me, ids: [it.id] });
        audio.playUi('click');
        break;
      case 'rally':
        for (const b of s.producers) deps.send({ type: 'setRally', player: me, buildingId: b.id, x: it.x, y: it.y });
        marker(it.x, it.y, 'rally');
        audio.playUi('click');
        break;
      default:
        break;
    }
  }

  /** Order from the minimap (secondary click): move / attack-move / rally at a world point. */
  function commandAtWorld(x: number, y: number, queue: boolean): void {
    if (!world || ended) return;
    const s = analyze(world);
    if (s.unitIds.length) {
      if (mode.kind === 'attackMove') {
        deps.send({ type: 'attackMove', player: me, ids: s.unitIds, x, y, queue: queue || undefined });
        if (s.firstUnitDef) audio.playAck(s.firstUnitDef, 'attack');
        if (!queue) setMode({ kind: 'normal' });
      } else issue(world, { k: 'move', x, y, blocked: false }, queue);
    } else if (s.producers.length) issue(world, { k: 'rally', x, y }, false);
  }

  function runCommand(kind: SelCommand): void {
    if (!world || ended) return;
    const w = world;
    const s = analyze(w);
    switch (kind) {
      case 'stop':
        if (s.unitIds.length) {
          deps.send({ type: 'stop', player: me, ids: s.unitIds });
          audio.playUi('click');
        }
        break;
      case 'guard':
        if (s.unitIds.length) {
          deps.send({ type: 'guard', player: me, ids: s.unitIds });
          audio.playUi('click');
        }
        break;
      case 'attackMove':
        if (s.unitIds.length) setMode(mode.kind === 'attackMove' ? { kind: 'normal' } : { kind: 'attackMove' });
        break;
      case 'deploy': {
        const ids = s.unitIds.filter((id) => unitDef(w.entities.get(id)?.defId ?? '')?.deploysTo);
        if (ids.length) {
          deps.send({ type: 'deploy', player: me, ids });
          audio.playUi('click');
        }
        break;
      }
      case 'scatter':
        for (const id of s.unitIds) {
          const e = w.entities.get(id);
          if (!e || unitDef(e.defId)?.movement === 'air') continue;
          const a = Math.random() * Math.PI * 2;
          const r = 1.2 + Math.random() * 1.6;
          const x = clamp(e.x + Math.cos(a) * r, 0.5, w.map.width - 0.5);
          const y = clamp(e.y + Math.sin(a) * r, 0.5, w.map.height - 0.5);
          deps.send({ type: 'move', player: me, ids: [id], x, y });
        }
        if (s.firstUnitDef) audio.playAck(s.firstUnitDef, 'move');
        break;
      case 'primary':
      case 'repair':
      case 'sell': {
        const first = view.selection.values().next().value as EntityId | undefined;
        const b = first !== undefined ? w.entities.get(first) : undefined;
        if (!b || b.owner !== me || b.kind !== 'building') return;
        if (kind === 'primary') deps.send({ type: 'setPrimary', player: me, buildingId: b.id });
        else if (kind === 'repair') deps.send({ type: 'toggleRepair', player: me, buildingId: b.id });
        else {
          deps.send({ type: 'sell', player: me, buildingId: b.id });
          view.selection.delete(b.id);
        }
        break;
      }
    }
  }

  // ───────────────────────── modes ─────────────────────────
  function setMode(m: Mode): void {
    if (ended && m.kind !== 'normal') return;
    mode = m;
    view.placement = null;
    view.powerTarget = null;
    placementCheckAt = 0;
    if (m.kind !== 'normal') view.dragRect = null;
    let text = '';
    switch (m.kind) {
      case 'placement':
        text = `放置 ${nameOf(m.defId)} — 點擊確認位置`;
        break;
      case 'sell':
        text = '變賣模式 — 點擊己方建築';
        break;
      case 'repair':
        text = '修理模式 — 點擊受損的己方建築';
        break;
      case 'attackMove':
        text = '攻擊移動 — 點擊目的地';
        break;
      case 'power':
        text = `${SUPPORT_POWERS[m.power]?.name ?? ''} — 指定目標區域`;
        break;
      default:
        break;
    }
    setBanner(text ? text : userPaused ? '已暫停' : '', text ? 'Esc / 次鍵 取消' : userPaused ? '按 P 繼續' : '');
  }
  function setBanner(text: string, hint: string): void {
    const key = text + '|' + hint;
    if (key === bannerText) return;
    bannerText = key;
    if (!text) {
      banner.style.display = 'none';
      return;
    }
    banner.replaceChildren(el('b', '', text));
    if (hint) banner.append(el('small', '', hint));
    banner.style.display = '';
  }
  function cancelMode(): void {
    if (mode.kind === 'normal') return;
    audio.playUi('cancel');
    setMode({ kind: 'normal' });
  }

  function updateGhost(w: World, now: number, force: boolean): void {
    if (mode.kind !== 'placement') return;
    const def = buildingDef(mode.defId);
    if (!def) return;
    let tx = view.placement?.tx ?? Math.round(cam.x - def.footprint.w / 2);
    let ty = view.placement?.ty ?? Math.round(cam.y - def.footprint.h / 2);
    if (ptr.inside) {
      const p = renderer.screenToWorld(ptr.x, ptr.y);
      tx = Math.round(p.x - def.footprint.w / 2);
      ty = Math.round(p.y - def.footprint.h / 2);
    }
    const cur = view.placement;
    if (!force && cur && cur.defId === mode.defId && cur.tx === tx && cur.ty === ty && now - placementCheckAt < 180) return;
    placementCheckAt = now;
    let check = { ok: false, cells: [] as { tx: number; ty: number; ok: boolean }[] };
    try {
      check = sim.canPlaceBuilding(w, me, mode.defId, tx, ty);
    } catch {
      /* keep red */
    }
    view.placement = { defId: mode.defId, tx, ty, check };
  }

  function modeClick(w: World, e: PointerEvent): void {
    const raw = renderer.screenToWorld(ptr.x, ptr.y);
    const p = { x: clamp(raw.x, 0.01, w.map.width - 0.01), y: clamp(raw.y, 0.01, w.map.height - 0.01) };
    switch (mode.kind) {
      case 'placement': {
        const def = buildingDef(mode.defId);
        const pl = player();
        if (!def || !pl) return;
        updateGhost(w, performance.now(), true);
        const q = pl.queues[def.category];
        const ready = q.ready && q.items[0]?.defId === mode.defId;
        const g = view.placement;
        if (!ready || !g) {
          audio.playUi('error');
          return;
        }
        if (!g.check.ok) {
          audio.playUi('error');
          feed.push('無法在此建造', 'warn', { key: 'cannotPlace' });
          return;
        }
        deps.send({ type: 'placeBuilding', player: me, defId: mode.defId, tx: g.tx, ty: g.ty });
        audio.playUi('place');
        if (def.wall) {
          // keep painting walls: queue the next segment and stay in placement mode
          deps.send({ type: 'produce', player: me, defId: mode.defId });
          wallChainUntil = performance.now() + 4000 + def.buildTime * 2000;
        } else setMode({ kind: 'normal' });
        break;
      }
      case 'sell':
      case 'repair': {
        const id = pick(ptr.x, ptr.y);
        const b = id != null ? w.entities.get(id) : undefined;
        if (!b || b.owner !== me || b.kind !== 'building') {
          audio.playUi('error');
          return;
        }
        if (mode.kind === 'sell') {
          deps.send({ type: 'sell', player: me, buildingId: b.id });
          view.selection.delete(b.id);
          audio.playUi('click');
        } else if (b.hp < b.maxHp || b.repairing) {
          deps.send({ type: 'toggleRepair', player: me, buildingId: b.id });
          audio.playUi('click');
        } else audio.playUi('error');
        break;
      }
      case 'attackMove': {
        const s = analyze(w);
        if (!s.unitIds.length) {
          setMode({ kind: 'normal' });
          return;
        }
        const id = pick(ptr.x, ptr.y);
        const t = id != null ? w.entities.get(id) : undefined;
        const q = e.shiftKey || undefined;
        if (t && isEnemy(w, t.owner)) {
          deps.send({ type: 'attack', player: me, ids: s.unitIds, targetId: t.id, queue: q });
          marker(t.x, t.y, 'attack');
        } else {
          deps.send({ type: 'attackMove', player: me, ids: s.unitIds, x: p.x, y: p.y, queue: q });
          marker(p.x, p.y, 'attack');
        }
        if (s.firstUnitDef) audio.playAck(s.firstUnitDef, 'attack');
        if (!e.shiftKey) setMode({ kind: 'normal' });
        break;
      }
      case 'power': {
        const ps = player()?.powers.find((x) => x.id === (mode as { power: SupportPowerId }).power);
        if (!ps?.ready) {
          audio.playUi('error');
          setMode({ kind: 'normal' });
          return;
        }
        deps.send({ type: 'usePower', player: me, power: mode.power, x: p.x, y: p.y });
        marker(p.x, p.y, 'attack');
        audio.playUi('click');
        setMode({ kind: 'normal' });
        break;
      }
      default:
        break;
    }
  }
  let wallChainUntil = 0;

  // ───────────────────────── pointer ─────────────────────────
  let unlocked = false;
  function unlock(): void {
    if (unlocked) return;
    unlocked = true;
    try {
      audio.unlock();
    } catch {
      /* ignore */
    }
  }

  function onPointerDown(e: PointerEvent): void {
    unlock();
    if (e.pointerType === 'touch' && !e.isPrimary) return;
    e.preventDefault();
    if (!world || pause.isOpen) return;
    rect = canvas.getBoundingClientRect();
    setPtr(e);
    ptr.inside = true;
    panel.hideTooltip();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const base = { x0: ptr.x, y0: ptr.y, lastX: ptr.x, lastY: ptr.y, moved: false, shift: e.shiftKey };
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      spaceUsed = true;
      drag = { type: 'pan', ...base };
      return;
    }
    if (isSecondary(e)) {
      drag = { type: 'secondary', ...base };
      return;
    }
    if (e.button !== 0) return;
    if (ended) return;
    if (mode.kind !== 'normal') {
      modeClick(world, e);
      return;
    }
    drag = { type: 'select', ...base };
  }

  function onPointerMove(e: PointerEvent): void {
    setPtr(e);
    if (!drag || !world) return;
    const dx = ptr.x - drag.lastX;
    const dy = ptr.y - drag.lastY;
    drag.lastX = ptr.x;
    drag.lastY = ptr.y;
    if (!drag.moved && Math.hypot(ptr.x - drag.x0, ptr.y - drag.y0) > DRAG_THRESHOLD) drag.moved = true;
    if (drag.type === 'pan' || (drag.type === 'secondary' && drag.moved)) {
      panScreen(-dx, -dy);
    } else if (drag.type === 'select' && drag.moved) {
      view.dragRect = { x0: drag.x0, y0: drag.y0, x1: ptr.x, y1: ptr.y };
    }
  }

  function onPointerUp(e: PointerEvent): void {
    setPtr(e);
    const d = drag;
    drag = null;
    view.dragRect = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d || !world || pause.isOpen) return;
    const w = world;
    if (d.type === 'select') {
      if (d.moved) boxSelect(w, d);
      else primaryClick(w, e.shiftKey);
    } else if (d.type === 'secondary' && !d.moved) secondaryClick(w, e.shiftKey);
  }

  function primaryClick(w: World, shift: boolean): void {
    const picked = pick(ptr.x, ptr.y);
    if (settings.scheme === 'classic') {
      const it = resolve(w, ptr.x, ptr.y, picked, true);
      if (it.k === 'select') selectClick(w, it.id, shift);
      else if (it.k !== 'none') issue(w, it, shift);
    } else if (picked != null) selectClick(w, picked, shift);
    else if (!shift) view.selection.clear();
  }

  function secondaryClick(w: World, shift: boolean): void {
    if (mode.kind !== 'normal') {
      cancelMode();
      return;
    }
    if (ended) return;
    if (settings.scheme === 'classic') {
      if (view.selection.size) {
        view.selection.clear();
        audio.playUi('cancel');
      }
      return;
    }
    const it = resolve(w, ptr.x, ptr.y, pick(ptr.x, ptr.y), false);
    if (it.k !== 'none' && it.k !== 'select') issue(w, it, shift);
  }

  on(canvas, 'pointerdown', onPointerDown);
  on(canvas, 'pointermove', onPointerMove);
  on(canvas, 'pointerup', onPointerUp);
  on(canvas, 'pointercancel', () => {
    drag = null;
    view.dragRect = null;
  });
  on(canvas, 'pointerenter', () => {
    ptr.inside = true;
  });
  on(canvas, 'pointerleave', () => {
    if (!drag) ptr.inside = false;
  });
  // browser artefacts: context menu, middle-click autoscroll, text selection, image drags
  on(root, 'contextmenu', (e: Event) => e.preventDefault());
  on(canvas, 'mousedown', (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  });
  on(canvas, 'auxclick', (e: Event) => e.preventDefault());
  on(hud, 'selectstart', (e: Event) => e.preventDefault());
  on(root, 'dragstart', (e: Event) => e.preventDefault());
  on(hud, 'pointerdown', unlock);
  // HUD buttons never take keyboard focus, so Space / Enter keep their game meaning after a panel click.
  on(hud, 'mousedown', (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest('button')) e.preventDefault();
  });

  // edge scrolling follows the pointer anywhere in the window
  on(window, 'pointermove', (e: PointerEvent) => {
    edge.x = e.clientX;
    edge.y = e.clientY;
    edge.active = true;
  });
  on(document, 'pointerleave', () => {
    edge.active = false;
  });
  on(document.documentElement, 'mouseleave', () => {
    edge.active = false;
  });

  // ───────────────────────── wheel / pinch ─────────────────────────
  function isNotchedWheel(e: WheelEvent): boolean {
    if (settings.wheelMode === 'zoom') return true;
    if (settings.wheelMode === 'pan') return false;
    if (e.deltaMode === 1) return true;
    const now = e.timeStamp;
    if (now - lastTrackpadAt < 350) {
      lastTrackpadAt = now;
      return false;
    }
    const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    const notched =
      e.deltaX === 0 &&
      (typeof wd === 'number' && wd !== 0 ? Math.abs(wd) >= 120 && wd % 120 === 0 : Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (!notched) lastTrackpadAt = now;
    return notched;
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!world || pause.isOpen) return;
    setPtr(e);
    if (e.ctrlKey) {
      // trackpad pinch as delivered by Chromium / Firefox
      zoomAt(Math.exp(-clamp(e.deltaY, -60, 60) * 0.012), ptr.x, ptr.y);
      return;
    }
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (isNotchedWheel(e)) zoomAt(Math.exp(-clamp(dy, -200, 200) * 0.0018), ptr.x, ptr.y);
    else panScreen(dx, dy);
  }
  on(canvas, 'wheel', onWheel, { passive: false });
  on(
    hud,
    'wheel',
    (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault(); // never let a pinch zoom the page itself
    },
    { passive: false },
  );
  // WebKit (Safari / WKWebView) pinch gestures
  on(root, 'gesturestart', (e: Event & { scale?: number }) => {
    e.preventDefault();
    gestureScale = e.scale ?? 1;
  });
  on(root, 'gesturechange', (e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
    e.preventDefault();
    if (!world || pause.isOpen) return;
    const s = e.scale ?? 1;
    if (s <= 0 || gestureScale <= 0) return;
    const sx = typeof e.clientX === 'number' ? e.clientX - rect.left : ptr.x;
    const sy = typeof e.clientY === 'number' ? e.clientY - rect.top : ptr.y;
    zoomAt(s / gestureScale, sx, sy);
    gestureScale = s;
  });
  on(root, 'gestureend', (e: Event) => e.preventDefault());

  // ───────────────────────── keyboard ─────────────────────────
  function toggleFullscreen(): void {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    // Mac app bridge (see mac/README.md): native window fullscreen instead of the element Fullscreen API.
    const native = (window as unknown as { cinderNative?: { toggleFullscreen?: () => void } }).cinderNative;
    try {
      if (native?.toggleFullscreen) native.toggleFullscreen();
      else if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d);
      else if (de.requestFullscreen) void de.requestFullscreen().catch(() => undefined);
      else de.webkitRequestFullscreen?.();
    } catch {
      /* fullscreen unavailable */
    }
  }
  // Mac app Help menu → in-game controls reference.
  on(window, 'cinder:help', (e: Event) => {
    e.preventDefault();
    pause.openHelp();
  });

  function jumpToBase(): void {
    if (!world) return;
    let best: Entity | null = null;
    let score = -1;
    for (const e of world.entities.values()) {
      if (e.owner !== me) continue;
      const s = e.kind === 'building' ? (buildingDef(e.defId)?.conyard ? 3 : 2) : unitDef(e.defId)?.deploysTo ? 1 : 0;
      if (s > score) {
        score = s;
        best = e;
      }
    }
    if (best) centerOn(best.x, best.y);
  }
  function jumpToAlert(): void {
    if (!alerts.length) return;
    const a = alerts[alerts.length - 1 - (alertCursor % alerts.length)];
    alertCursor++;
    centerOn(a.x, a.y);
  }
  function addAlert(x: number, y: number): void {
    alerts.push({ x, y });
    if (alerts.length > 6) alerts.shift();
    alertCursor = 0;
  }
  function groupKey(n: number, assign: boolean, add: boolean): void {
    if (!world) return;
    const w = world;
    if (assign) {
      groups[n] = [...view.selection].filter((id) => w.entities.get(id)?.owner === me);
      if (groups[n].length) {
        audio.playUi('click');
        feed.push(`編隊 ${n} 已設定`, 'info', { key: 'group' + n });
      }
      return;
    }
    const g = (groups[n] ?? []).filter((id) => w.entities.has(id));
    groups[n] = g;
    if (!g.length) return;
    const now = performance.now();
    const dbl = lastGroupTap.n === n && now - lastGroupTap.at < 380;
    lastGroupTap = { n, at: now };
    if (add) dropForeign(w);
    setSelection(g, add);
    ackSelect(w.entities.get(g[0]));
    if (dbl) {
      let x = 0;
      let y = 0;
      for (const id of g) {
        const e = w.entities.get(id)!;
        x += e.x;
        y += e.y;
      }
      centerOn(x / g.length, y / g.length);
    }
  }
  function selectArmy(): void {
    if (!world) return;
    const w = world;
    const isArmy = (e: Entity) => {
      const d = unitDef(e.defId);
      return e.kind === 'unit' && !!d && !!(d.weapon || d.secondary);
    };
    let ids = onScreenOwn(w, isArmy);
    if (!ids.length) for (const e of w.entities.values()) if (e.owner === me && isArmy(e)) ids.push(e.id);
    if (ids.length) {
      setSelection(ids);
      ackSelect(w.entities.get(ids[0]));
    }
  }
  function togglePause(): void {
    userPaused = !userPaused;
    deps.setPaused(userPaused);
    audio.playUi('click');
    if (mode.kind === 'normal') setBanner(userPaused ? '已暫停' : '', userPaused ? '按 P 繼續' : '');
  }
  function resetInput(): void {
    held.clear();
    spaceDown = false;
    drag = null;
    view.dragRect = null;
    view.showAllHealth = false;
    edge.active = false;
    panel.hideTooltip();
  }

  function onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (typing && e.code !== 'Escape') return;
    view.showAllHealth = e.altKey && !pause.isOpen;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (typing) t!.blur();
      if (pause.isOpen) pause.back();
      else if (mode.kind !== 'normal') cancelMode();
      else {
        audio.playUi('click');
        pause.open();
      }
      return;
    }
    if (pause.isOpen || !world) return;
    const mod = e.metaKey || e.ctrlKey;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      if (e.repeat) return;
      if (e.altKey) return;
      e.preventDefault();
      groupKey(Number(digit[1]), mod, e.shiftKey);
      return;
    }
    if (mod) {
      // leave every other ⌘/Ctrl combination (⌘Q, ⌘W, ⌘F, ⌘R…) to the system
      if (e.code === 'KeyA' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat && !ended) selectArmy();
      }
      return;
    }
    switch (e.code) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        held.add(e.code);
        return;
      case 'Space':
        e.preventDefault();
        if (!e.repeat) {
          spaceDown = true;
          spaceUsed = false;
          spaceAt = performance.now();
        }
        return;
      case 'Tab':
        e.preventDefault();
        panel.cycleTab(e.shiftKey ? -1 : 1);
        return;
      default:
        break;
    }
    if (e.repeat || e.altKey) return;
    switch (e.code) {
      case 'KeyS':
        if (!ended) runCommand('stop');
        break;
      case 'KeyG':
        if (!ended) runCommand('guard');
        break;
      case 'KeyA':
        if (!ended) {
          audio.playUi('click');
          runCommand('attackMove');
        }
        break;
      case 'KeyD':
        if (!ended) runCommand('deploy');
        break;
      case 'KeyX':
        if (!ended) runCommand('scatter');
        break;
      case 'KeyH':
        jumpToBase();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'KeyP':
        togglePause();
        break;
      case 'Equal':
      case 'NumpadAdd':
        zoomAt(1.2, rect.width / 2, rect.height / 2);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        zoomAt(1 / 1.2, rect.width / 2, rect.height / 2);
        break;
      default: {
        const i = BUILD_KEYS.indexOf(e.code);
        if (i < 0 || ended) return;
        panel.hotkey(i, e.shiftKey);
        break;
      }
    }
    e.preventDefault();
  }
  function onKeyUp(e: KeyboardEvent): void {
    view.showAllHealth = e.altKey && !pause.isOpen;
    held.delete(e.code);
    if (e.code === 'Space' && spaceDown) {
      spaceDown = false;
      if (!spaceUsed && performance.now() - spaceAt < 450 && !pause.isOpen) jumpToAlert();
    }
  }
  on(window, 'keydown', onKeyDown);
  on(window, 'keyup', onKeyUp);
  on(window, 'blur', resetInput);

  // ───────────────────────── per-frame ─────────────────────────
  function updateCamera(dtMs: number): void {
    if (pause.isOpen) return;
    let vx = 0;
    let vy = 0;
    if (held.has('ArrowLeft')) vx -= 1;
    if (held.has('ArrowRight')) vx += 1;
    if (held.has('ArrowUp')) vy -= 1;
    if (held.has('ArrowDown')) vy += 1;
    let speed = 1100;
    if (vx === 0 && vy === 0 && settings.edgeScroll > 0 && edge.active && !drag && document.hasFocus()) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (edge.x <= EDGE_PX) vx = -1;
      else if (edge.x >= w - EDGE_PX - 1) vx = 1;
      if (edge.y <= EDGE_PX) vy = -1;
      else if (edge.y >= h - EDGE_PX - 1) vy = 1;
      speed = 900 * settings.edgeScroll;
    }
    if (vx !== 0 || vy !== 0) {
      const k = (speed * Math.min(dtMs, 50)) / 1000 / (vx !== 0 && vy !== 0 ? Math.SQRT2 : 1);
      panScreen(vx * k, vy * k);
    }
  }

  function setCursor(name: CursorName): void {
    if (name === cursor) return;
    cursor = name;
    applyCursor(canvas, name);
  }

  function updateHover(w: World): void {
    if (pause.isOpen || !ptr.inside) {
      view.hoverId = null;
      if (mode.kind === 'power') view.powerTarget = null;
      return;
    }
    if (drag && (drag.type === 'pan' || (drag.type === 'secondary' && drag.moved))) {
      view.hoverId = null;
      setCursor('grab');
      return;
    }
    if (spaceDown) {
      view.hoverId = null;
      setCursor('grab');
      return;
    }
    const picked = mode.kind === 'placement' || mode.kind === 'power' ? null : pick(ptr.x, ptr.y);
    const target = picked != null ? w.entities.get(picked) : undefined;
    view.hoverId = picked;
    switch (mode.kind) {
      case 'placement':
        setCursor('select');
        return;
      case 'power': {
        const p = renderer.screenToWorld(ptr.x, ptr.y);
        view.powerTarget = { power: mode.power, x: p.x, y: p.y };
        setCursor('target');
        return;
      }
      case 'sell':
        setCursor(target && target.owner === me && target.kind === 'building' ? 'sell' : 'nogo');
        return;
      case 'repair':
        setCursor(target && target.owner === me && target.kind === 'building' && (target.hp < target.maxHp || target.repairing) ? 'repair' : 'nogo');
        return;
      case 'attackMove':
        setCursor('attack');
        return;
      default:
        break;
    }
    if (ended || (drag && drag.type === 'select' && drag.moved)) {
      setCursor('select');
      return;
    }
    const classic = settings.scheme === 'classic';
    const it = resolve(w, ptr.x, ptr.y, picked, classic);
    let c: CursorName = 'select';
    switch (it.k) {
      case 'move':
        c = classic ? (it.blocked ? 'nogo' : 'move') : 'select';
        break;
      case 'rally':
        c = classic ? 'move' : 'select';
        break;
      case 'attack':
        c = 'attack';
        break;
      case 'harvest':
        c = 'harvest';
        break;
      case 'dock':
        c = 'enter';
        break;
      case 'capture':
        c = 'enter';
        break;
      case 'deploy':
        c = 'deploy';
        break;
      default:
        break;
    }
    setCursor(c);
  }

  function update(w: World, dtMs: number): void {
    if (destroyed) return;
    world = w;
    const now = performance.now();
    view.time = now;
    refreshRect(now);
    const p = w.players[me];
    if (p) applyTint(p.color);

    pruneSelection(w);
    if (view.markers.length) {
      let n = 0;
      for (const m of view.markers) if (now - m.at < 2000) view.markers[n++] = m;
      view.markers.length = n;
    }

    updateCamera(dtMs);

    if (mode.kind === 'placement' && p) {
      const def = buildingDef(mode.defId);
      const inQueue = !!def && p.queues[def.category].items.some((it) => it.defId === (mode as { defId: string }).defId);
      if (!inQueue && now > wallChainUntil) setMode({ kind: 'normal' });
      else updateGhost(w, now, false);
    } else if (mode.kind === 'attackMove' && analyze(w).unitIds.length === 0) setMode({ kind: 'normal' });
    else if (mode.kind === 'power' && p && !p.powers.some((x) => x.id === (mode as { power: SupportPowerId }).power)) setMode({ kind: 'normal' });

    updateHover(w);

    if (p) panel.update(w, p, now, dtMs);
    selPanel.update(w, now);
    feed.update(now);

    const t = fmtTime(w.tick / TICK_RATE);
    if (t !== clockText) {
      clockText = t;
      clock.textContent = t;
    }
    fpsFrames++;
    if (now - fpsAt >= 500) {
      if (settings.showFps) {
        fps.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsAt))} fps`;
        fpsShown = true;
      } else if (fpsShown) {
        fps.textContent = '';
        fpsShown = false;
      }
      fpsFrames = 0;
      fpsAt = now;
    }
  }

  // ───────────────────────── sim events ─────────────────────────
  let lastFundsAt = -1e9;
  function handleEvents(events: SimEvent[], w: World): void {
    if (destroyed) return;
    world = w;
    for (const ev of events) {
      switch (ev.type) {
        case 'underAttack':
          if (ev.player !== me) break;
          addAlert(ev.x, ev.y);
          panel.ping(ev.x, ev.y, 'bad');
          feed.push(ev.base ? '基地遭受攻擊' : '部隊遭受攻擊', 'bad', { key: ev.base ? 'ua-base' : 'ua-unit', pos: { x: ev.x, y: ev.y } });
          break;
        case 'constructionReady':
          if (ev.owner !== me) break;
          panel.invalidate();
          feed.push(`建造完成:${nameOf(ev.defId)}`, 'good', { key: 'cr-' + ev.defId, sub: '點擊圖示並選擇放置位置' });
          break;
        case 'unitReady':
          if (ev.owner !== me) break;
          feed.push(`單位就緒:${nameOf(ev.defId)}`, 'good', { key: 'ur-' + ev.defId });
          break;
        case 'lowPower':
          if (ev.player !== me) break;
          if (ev.low) feed.push('電力不足', 'warn', { key: 'lowpower', sub: '生產減速,部分防禦停擺' });
          else feed.push('電力已恢復', 'good', { key: 'powerok' });
          break;
        case 'insufficientFunds':
          if (ev.player !== me) break;
          if (performance.now() - lastFundsAt > 4000) {
            lastFundsAt = performance.now();
            feed.push('資金不足', 'warn', { key: 'funds' });
          }
          break;
        case 'cannotPlace':
          if (ev.player !== me) break;
          feed.push('無法在此建造', 'warn', { key: 'cannotPlace' });
          audio.playUi('error');
          break;
        case 'powerReady':
          if (ev.player !== me) break;
          panel.invalidate();
          feed.push(`${SUPPORT_POWERS[ev.power]?.name ?? '支援能力'} 已就緒`, 'good', { key: 'pr-' + ev.power });
          break;
        case 'powerUsed':
          if (ev.player === me) break;
          if (isEnemy(w, ev.player) && ev.power !== 'recon_sweep') {
            addAlert(ev.x, ev.y);
            panel.ping(ev.x, ev.y, 'warn');
            feed.push(`偵測到敵方${SUPPORT_POWERS[ev.power]?.name ?? '超級武器'}啟動`, 'bad', { key: 'pu-' + ev.power, pos: { x: ev.x, y: ev.y } });
          }
          break;
        case 'playerDefeated': {
          const pl = w.players[ev.player];
          if (!pl) break;
          if (ev.player === me) feed.push('我方已被擊敗', 'bad', { key: 'def-me' });
          else feed.push(`${pl.name} 已被擊敗`, isEnemy(w, ev.player) ? 'good' : 'warn', { key: 'def-' + ev.player, sub: isEnemy(w, ev.player) ? '敵方勢力瓦解' : '友軍陣亡' });
          break;
        }
        case 'buildingCaptured':
          if (ev.to === me) feed.push(`已佔領:${nameOf(ev.defId)}`, 'good', { key: 'cap-' + ev.id });
          else if (ev.from === me) feed.push(`建築遭敵方佔領:${nameOf(ev.defId)}`, 'bad', { key: 'lost-' + ev.id });
          if (ev.to === me || ev.from === me) panel.invalidate();
          break;
        case 'entityDestroyed':
          if (ev.owner !== me) break;
          if (ev.kind === 'building') {
            panel.invalidate();
            if (!buildingDef(ev.defId)?.wall) feed.push(`失去建築:${nameOf(ev.defId)}`, 'bad', { key: 'bd-' + ev.defId, pos: { x: ev.x, y: ev.y } });
          } else if (unitDef(ev.defId)?.harvester) {
            addAlert(ev.x, ev.y);
            feed.push(`失去${nameOf(ev.defId)}`, 'bad', { key: 'hl', pos: { x: ev.x, y: ev.y } });
          }
          break;
        case 'unitPromoted':
          if (ev.owner !== me) break;
          {
            const e = w.entities.get(ev.id);
            if (e) feed.push(`${nameOf(e.defId)} 晉升為${ev.rank === 2 ? '菁英' : '老兵'}`, 'info', { key: 'promo' });
          }
          break;
        case 'unitDeployed':
          if (ev.owner !== me) break;
          panel.invalidate();
          // keep the freshly deployed base selected so the player can set a rally point / see its state
          if (view.selection.has(ev.unitId)) {
            view.selection.delete(ev.unitId);
            if (view.selection.size === 0) view.selection.add(ev.buildingId);
          }
          break;
        case 'buildingComplete':
        case 'buildingSold':
          if (ev.owner === me) panel.invalidate();
          break;
        case 'gameOver':
          ended = true;
          setMode({ kind: 'normal' });
          resetInput();
          break;
        default:
          break;
      }
    }
  }

  const api: GameUi = {
    view,
    update,
    handleEvents,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) off();
      offs.length = 0;
      hud.remove();
      canvas.style.cursor = '';
      view.selection.clear();
      view.placement = null;
      view.dragRect = null;
      view.powerTarget = null;
      view.hoverId = null;
    },
  };
  return api;
};

export type { GameUi };
