// Command console (the side panel): faction-skinned frame, rolling credit counter, radar screen with power-on /
// power-off, vertical power gauge, category tabs, two-column portrait build grid, tool row and support powers.
// DOM is built once and only patched on change; the radar canvas is redrawn ~10×/s (every frame while animating).
import type { UiDeps, ViewState } from '../../core/api';
import { TICK_RATE } from '../../core/constants';
import type { Player, QueueCategory, SupportPowerId, World } from '../../core/types';
import { SUPPORT_POWERS, WEAPONS } from '../../data';
import { blitIcon, buildingDef, button, clamp, defOf, el, fmtNum, fmtTime, glyph, nameOf, safeDpr, unitDef, type GLYPHS } from '../dom';

export interface PanelHooks {
  deps: UiDeps;
  view: ViewState;
  hud: HTMLElement;
  modeKind(): string;
  enterPlacement(defId: string): void;
  enterPower(power: SupportPowerId): void;
  toggleMode(kind: 'sell' | 'repair'): void;
  /** Centre the camera on a world point (minimap click/drag). */
  panTo(x: number, y: number): void;
  /** Secondary click on the minimap: order the selection there. */
  commandAt(x: number, y: number, queue: boolean): void;
}

export interface Panel {
  el: HTMLElement;
  update(world: World, player: Player, now: number, dtMs: number): void;
  /** Force a rebuild check of the build options on the next update. */
  invalidate(): void;
  cycleTab(dir: 1 | -1): void;
  /** Classic sidebar keys: switch to the first available of these categories (R toggles vehicle ⇄ aircraft). */
  tabKey(cats: QueueCategory[]): void;
  /** Numpad 8 / 2: scroll the build grid one row up (-1) or down (1). */
  scrollGrid(dir: 1 | -1): void;
  ping(x: number, y: number, kind: 'bad' | 'warn' | 'good'): void;
  resize(): void;
  hideTooltip(): void;
}

type GlyphName = keyof typeof GLYPHS;
const CATS: { id: QueueCategory; label: string; en: string; key: string; glyph: GlyphName }[] = [
  { id: 'structure', label: '建築', en: 'Structures', key: 'Q', glyph: 'cat_structure' },
  { id: 'defense', label: '防禦', en: 'Defences', key: 'W', glyph: 'cat_defense' },
  { id: 'infantry', label: '步兵', en: 'Infantry', key: 'E', glyph: 'cat_infantry' },
  { id: 'vehicle', label: '載具', en: 'Vehicles', key: 'R', glyph: 'cat_vehicle' },
  { id: 'aircraft', label: '航空', en: 'Aircraft', key: 'R', glyph: 'cat_aircraft' },
];
const ARMOR_ZH: Record<string, string> = { infantry: '步兵', light: '輕甲', heavy: '重甲', building: '建築', air: '飛行' };
const ODO_DIGITS = 7;
const BOOT_MS = 950;
const DOWN_MS = 620;

interface Cell {
  defId: string;
  cat: QueueCategory;
  cost: number;
  root: HTMLButtonElement;
  icon: HTMLCanvasElement;
  sweep: HTMLElement;
  count: HTMLElement;
  stamp: HTMLElement;
  lastP: number;
  lastCount: number;
  lastState: string;
  lastPoor: boolean;
}

interface PowerBtn {
  id: SupportPowerId;
  root: HTMLButtonElement;
  fill: HTMLElement;
  label: HTMLElement;
  lastText: string;
  lastP: number;
  lastReady: boolean;
}

/** Four screw heads / light studs in the corners of a framed element (styled per faction in CSS). */
function bolts(target: HTMLElement): void {
  for (const pos of ['tl', 'tr', 'bl', 'br']) target.append(el('i', 'cf-bolt is-' + pos));
}

export function createPanel(h: PanelHooks): Panel {
  const { deps, view } = h;
  const audio = deps.audio;
  const me = deps.viewer;

  const root = el('div', 'cf-panel cf-console');
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  bolts(root);
  root.append(el('i', 'cf-con-strip is-a'), el('i', 'cf-con-strip is-b'));

  // ── head: faction mark + rolling credits ──
  const head = el('div', 'cf-con-head');
  const emblem = el('div', 'cf-con-emblem');
  const odo = el('div', 'cf-odo');
  odo.title = '資金 Credits';
  const odoIc = el('span', 'cf-odo-ic');
  odoIc.innerHTML = glyph('credit', 16);
  odo.append(odoIc);
  const odoDigits: { strip: HTMLElement; slot: HTMLElement; d: number; lead: boolean }[] = [];
  for (let i = 0; i < ODO_DIGITS; i++) {
    const slot = el('span', 'cf-odo-d');
    const strip = el('span', 'cf-odo-strip');
    for (let n = 0; n <= 9; n++) strip.append(el('b', '', String(n)));
    slot.append(strip);
    odo.append(slot);
    odoDigits.push({ strip, slot, d: -1, lead: false });
    const left = ODO_DIGITS - 1 - i;
    if (left > 0 && left % 3 === 0) odo.append(el('span', 'cf-odo-sep', ','));
  }
  head.append(emblem, odo);

  // ── radar screen ──
  const radar = el('div', 'cf-radar');
  bolts(radar);
  const radarCanvas = el('canvas', 'cf-radar-canvas');
  const radarScan = el('div', 'cf-radar-scan');
  const radarOff = el('div', 'cf-radar-off');
  const radarOffTitle = el('b', '', '雷達離線');
  const radarOffSub = el('small', '', 'NO SIGNAL');
  radarOff.append(radarOffTitle, radarOffSub);
  const pings = el('div', 'cf-radar-pings');
  radar.append(radarCanvas, pings, radarScan, radarOff);
  const rctx = radarCanvas.getContext('2d');

  // ── tools: repair / sell / support powers ──
  const tools = el('div', 'cf-tools');
  const repairBtn = button('cf-tool', `${glyph('repair', 18)}<span>修理</span><kbd>K</kbd>`, () => {
    audio.playUi('click');
    h.toggleMode('repair');
  });
  repairBtn.title = '修理模式 (K):點擊受損的己方建築  Repair';
  const sellBtn = button('cf-tool', `${glyph('sell', 18)}<span>變賣</span><kbd>L</kbd>`, () => {
    audio.playUi('click');
    h.toggleMode('sell');
  });
  sellBtn.title = '變賣模式 (L):點擊己方建築換回部分資金  Sell';
  const powersBox = el('div', 'cf-powers');
  tools.append(repairBtn, sellBtn, powersBox);

  // ── tabs ──
  const tabs = el('div', 'cf-tabs');

  // ── body: power gauge + build grid ──
  const body = el('div', 'cf-con-body');
  const gauge = el('div', 'cf-gauge');
  const gaugeIc = el('span', 'cf-gauge-ic');
  gaugeIc.innerHTML = glyph('bolt', 13);
  const gaugeTrack = el('div', 'cf-gauge-track');
  const gaugeFill = el('i', 'cf-gauge-fill');
  const gaugeUse = el('i', 'cf-gauge-use');
  gaugeTrack.append(gaugeFill, gaugeUse);
  gauge.append(gaugeIc, gaugeTrack);
  const gridWell = el('div', 'cf-grid-well');
  const grid = el('div', 'cf-grid');
  gridWell.append(grid);
  body.append(gauge, gridWell);
  const empty = el('div', 'cf-grid-empty');
  empty.append(el('b', '', '尚無可建造項目'), el('span', '', '選取基地車並按 D 部署,建立指揮核心。'));

  root.append(head, radar, tools, tabs, body);

  // ── tooltip (lives in the HUD root so the panel never clips it) ──
  const tip = el('div', 'cf-tip cf-glass');
  tip.style.display = 'none';
  h.hud.append(tip);
  let tipFor: HTMLElement | null = null;

  function showTip(target: HTMLElement, content: HTMLElement): void {
    tipFor = target;
    tip.replaceChildren(content);
    tip.style.display = 'block';
    const hudRect = h.hud.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const pr = root.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const onRight = pr.left + pr.width / 2 > hudRect.left + hudRect.width / 2;
    let x = onRight ? pr.left - hudRect.left - tw - 10 : pr.right - hudRect.left + 10;
    x = clamp(x, 8, Math.max(8, hudRect.width - tw - 8));
    const y = clamp(r.top - hudRect.top - 6, 8, Math.max(8, hudRect.height - th - 8));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function hideTooltip(): void {
    if (!tipFor) return;
    tipFor = null;
    tip.style.display = 'none';
  }
  function hover(target: HTMLElement, make: () => HTMLElement): void {
    target.addEventListener('pointerenter', () => showTip(target, make()));
    target.addEventListener('pointerleave', () => {
      if (tipFor === target) hideTooltip();
    });
  }

  function statLine(label: string, value: string, cls = ''): HTMLElement {
    const s = el('span', 'cf-tip-stat ' + cls);
    s.append(el('small', '', label), el('b', '', value));
    return s;
  }

  function defTip(defId: string): HTMLElement {
    const box = el('div');
    const def = defOf(defId);
    if (!def) {
      box.textContent = defId;
      return box;
    }
    const headEl = el('div', 'cf-tip-head');
    const title = el('div', 'cf-tip-title');
    title.append(el('b', '', def.name), el('small', '', def.nameEn));
    headEl.append(title);
    box.append(headEl);

    const stats = el('div', 'cf-tip-stats');
    stats.append(statLine('造價', `◆ ${fmtNum(def.cost)}`, 'is-cost'));
    stats.append(statLine('工期', `${Math.round(def.buildTime)} 秒`));
    if (def.kind === 'building' && def.power !== 0) {
      stats.append(statLine('電力', (def.power > 0 ? '+' : '') + def.power, def.power > 0 ? 'is-good' : 'is-warn'));
    }
    stats.append(statLine('耐久', `${def.hp}`));
    stats.append(statLine('裝甲', ARMOR_ZH[def.armor] ?? def.armor));
    const w = def.weapon ? WEAPONS[def.weapon] : undefined;
    if (w) {
      stats.append(statLine('射程', `${w.range}`));
      const tg = w.targetsGround && w.targetsAir ? '對地/對空' : w.targetsAir ? '僅對空' : '對地';
      stats.append(statLine('目標', tg));
    }
    if (def.kind === 'unit') stats.append(statLine('速度', def.speed.toFixed(1)));
    box.append(stats);
    box.append(el('p', 'cf-tip-desc', def.desc));
    if (def.prereqs.length) {
      const pr = el('p', 'cf-tip-req');
      pr.append(el('small', '', '需求 '), document.createTextNode(def.prereqs.map(nameOf).join('、')));
      box.append(pr);
    }
    box.append(el('p', 'cf-tip-hint', '點擊:生產(⇧ 五個)· 右鍵:暫停/取消'));
    return box;
  }

  function powerTip(id: SupportPowerId): HTMLElement {
    const p = SUPPORT_POWERS[id];
    const box = el('div');
    const headEl = el('div', 'cf-tip-head');
    const title = el('div', 'cf-tip-title');
    title.append(el('b', '', p.name), el('small', '', p.nameEn));
    headEl.append(title);
    box.append(headEl);
    const stats = el('div', 'cf-tip-stats');
    stats.append(statLine('充能', fmtTime(p.recharge)));
    stats.append(statLine('半徑', `${p.radius} 格`));
    if (p.damage > 0) stats.append(statLine('傷害', `${p.damage}`, 'is-warn'));
    box.append(stats, el('p', 'cf-tip-desc', p.desc), el('p', 'cf-tip-hint', '就緒後點擊,再於地圖上指定目標'));
    return box;
  }

  function gaugeTip(): HTMLElement {
    const p = lastPlayer;
    const box = el('div');
    const headEl = el('div', 'cf-tip-head');
    const title = el('div', 'cf-tip-title');
    title.append(el('b', '', '電力'), el('small', '', 'Power'));
    headEl.append(title);
    box.append(headEl);
    const stats = el('div', 'cf-tip-stats');
    const prod = p?.powerProduced ?? 0;
    const used = p?.powerConsumed ?? 0;
    stats.append(statLine('產出', String(prod), 'is-good'), statLine('消耗', String(used), used > prod ? 'is-warn' : ''));
    stats.append(statLine('餘裕', String(prod - used), prod - used < 0 ? 'is-warn' : 'is-good'));
    box.append(stats);
    box.append(
      el(
        'p',
        'cf-tip-desc',
        p?.lowPower ? '電力不足:生產減速、雷達離線、部分防禦停擺。興建電站或變賣耗電建築。' : '綠色柱為發電量,亮線為目前用電量。用電接近發電上限時轉為黃色。',
      ),
    );
    return box;
  }
  hover(gauge, gaugeTip);

  // ── build options state ──
  let optionsSig = '';
  let optionsAt = -1e9;
  let dirty = true;
  let availableCats: QueueCategory[] = [];
  const optionsByCat = new Map<QueueCategory, string[]>();
  let activeCat: QueueCategory = 'structure';
  let cells: Cell[] = [];
  const tabEls = new Map<QueueCategory, { b: HTMLButtonElement; last: string }>();
  let lastWorld: World | null = null;
  let lastPlayer: Player | null = null;
  let iconColor = '#888';
  let iconCss = 0;

  function iconInto(canvas: HTMLCanvasElement, defId: string, cssSize: number): void {
    const dpr = safeDpr();
    let src: HTMLCanvasElement | null = null;
    try {
      src = deps.renderer.getIcon(defId, iconColor, Math.round(cssSize * dpr));
    } catch {
      src = null;
    }
    blitIcon(canvas, src, cssSize, dpr);
    if (!src) {
      const c = canvas.getContext('2d');
      if (c) {
        c.fillStyle = 'rgba(255,255,255,.08)';
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.fillStyle = 'rgba(255,255,255,.7)';
        c.font = `600 ${Math.round(canvas.width * 0.4)}px -apple-system, 'PingFang TC', sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(nameOf(defId).slice(0, 1), canvas.width / 2, canvas.height / 2);
      }
    }
  }
  /** Portrait size follows the column width; re-request icons only when it really changed. */
  function cellCss(): number {
    const w = grid.clientWidth;
    if (w <= 0) return 110;
    return Math.max(56, Math.floor((w - 8) / 2));
  }
  function refreshIcons(force: boolean): void {
    const size = cellCss();
    if (!force && Math.abs(size - iconCss) < 6) return;
    iconCss = size;
    for (const c of cells) iconInto(c.icon, c.defId, size);
  }

  function clickCell(cell: Cell, secondary: boolean, shift: boolean): void {
    const p = lastPlayer;
    if (!p) return;
    const q = p.queues[cell.cat];
    const headItem = q.items[0];
    const isHead = !!headItem && headItem.defId === cell.defId;
    if (secondary) {
      if (!q.items.some((it) => it.defId === cell.defId)) return;
      deps.send({ type: 'cancelProduction', player: me, defId: cell.defId });
      audio.playUi('cancel');
      return;
    }
    if (isHead && q.ready) {
      audio.playUi('click');
      h.enterPlacement(cell.defId);
      return;
    }
    if (isHead && q.paused) {
      deps.send({ type: 'resumeProduction', player: me, category: cell.cat });
      audio.playUi('queue');
      return;
    }
    const isUnit = cell.cat === 'infantry' || cell.cat === 'vehicle' || cell.cat === 'aircraft';
    const n = shift && isUnit ? 5 : 1;
    for (let i = 0; i < n; i++) deps.send({ type: 'produce', player: me, defId: cell.defId });
    audio.playUi('queue');
  }

  function buildGrid(): void {
    hideTooltip();
    grid.replaceChildren();
    cells = [];
    const ids = optionsByCat.get(activeCat) ?? [];
    if (availableCats.length === 0) {
      grid.append(empty);
      return;
    }
    const size = cellCss();
    iconCss = size;
    for (const defId of ids) {
      const def = defOf(defId);
      if (!def) continue;
      const b = el('button', 'cf-cell');
      b.type = 'button';
      const pic = el('div', 'cf-cell-pic');
      const icon = el('canvas', 'cf-cell-icon');
      const sweep = el('div', 'cf-cell-sweep');
      const count = el('span', 'cf-cell-count');
      const stamp = el('span', 'cf-cell-stamp');
      pic.append(icon, sweep, stamp, count);
      const foot = el('div', 'cf-cell-foot');
      foot.append(el('span', 'cf-cell-name', def.name), el('span', 'cf-cell-cost', fmtNum(def.cost)));
      b.append(pic, foot);
      const cell: Cell = { defId, cat: activeCat, cost: def.cost, root: b, icon, sweep, count, stamp, lastP: -2, lastCount: -1, lastState: '', lastPoor: false };
      b.addEventListener('click', (e) => clickCell(cell, false, e.shiftKey));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        clickCell(cell, true, false);
      });
      hover(b, () => defTip(defId));
      grid.append(b);
      cells.push(cell);
      iconInto(icon, defId, size);
    }
    grid.scrollTop = 0;
  }

  function setTab(cat: QueueCategory, sound: boolean): void {
    if (cat === activeCat && cells.length) return;
    activeCat = cat;
    for (const [id, t] of tabEls) t.b.classList.toggle('is-on', id === cat);
    if (sound) audio.playUi('tab');
    buildGrid();
  }

  function refreshOptions(world: World, player: Player): void {
    let opts: { defId: string; category: QueueCategory; available: boolean }[] = [];
    try {
      opts = deps.sim.getBuildOptions(world, me);
    } catch {
      opts = [];
    }
    const avail = opts.filter((o) => o.available && defOf(o.defId));
    const sig = player.color + '|' + avail.map((o) => o.category + ':' + o.defId).join(',');
    if (sig === optionsSig) return;
    optionsSig = sig;
    iconColor = player.color;
    optionsByCat.clear();
    for (const o of avail) {
      let list = optionsByCat.get(o.category);
      if (!list) optionsByCat.set(o.category, (list = []));
      list.push(o.defId);
    }
    availableCats = CATS.map((c) => c.id).filter((c) => optionsByCat.has(c));
    // tabs: every category of the faction is shown; the ones not unlocked yet are dark
    if (!tabEls.size) {
      for (const c of CATS) {
        const b = button('cf-tab', `${glyph(c.glyph, 20)}<span>${c.label}</span><b class="cf-tab-key">${c.key}</b><i></i>`, () => {
          if (b.disabled) return;
          setTab(c.id, true);
        });
        b.title = `${c.label} ${c.en} (${c.key})`;
        tabs.append(b);
        tabEls.set(c.id, { b, last: '' });
      }
    }
    for (const [id, t] of tabEls) {
      const on = optionsByCat.has(id);
      t.b.disabled = !on;
      // the aircraft tab only exists once the faction can make aircraft at all
      if (id === 'aircraft') t.b.style.display = on ? '' : 'none';
    }
    if (!optionsByCat.has(activeCat)) activeCat = availableCats[0] ?? 'structure';
    for (const [id, t] of tabEls) t.b.classList.toggle('is-on', id === activeCat && optionsByCat.has(id));
    buildGrid();
  }

  function updateCells(player: Player): void {
    const q = player.queues[activeCat];
    if (!q) return;
    const headItem = q.items[0];
    for (const cell of cells) {
      let count = 0;
      for (const it of q.items) if (it.defId === cell.defId) count++;
      const isHead = !!headItem && headItem.defId === cell.defId;
      const st = isHead ? (q.ready ? 'ready' : q.paused ? 'paused' : 'building') : count > 0 ? 'queued' : 'idle';
      const p = isHead ? (q.ready ? 100 : Math.round(clamp(headItem.progress, 0, 1) * 400) / 4) : -1;
      if (st !== cell.lastState) {
        cell.lastState = st;
        cell.root.className = 'cf-cell is-' + st;
        cell.lastPoor = false;
        cell.stamp.textContent = st === 'ready' ? '就緒' : st === 'paused' ? '暫停' : '';
        if (st === 'ready') audio.playUi('select');
      }
      if (p !== cell.lastP) {
        cell.lastP = p;
        cell.sweep.style.setProperty('--p', String(Math.max(0, p)));
      }
      if (count !== cell.lastCount) {
        cell.lastCount = count;
        cell.count.textContent = count > 1 || (count === 1 && !isHead) ? String(count) : '';
      }
      const poor = (st === 'idle' || st === 'queued') && player.credits < cell.cost;
      if (poor !== cell.lastPoor) {
        cell.lastPoor = poor;
        cell.root.classList.toggle('is-poor', poor);
      }
    }
    for (const [cat, t] of tabEls) {
      const tq = player.queues[cat];
      const s = !tq || tq.items.length === 0 ? '' : tq.ready ? 'is-ready' : tq.paused ? 'is-paused' : 'is-busy';
      if (s !== t.last) {
        if (t.last) t.b.classList.remove(t.last);
        if (s) t.b.classList.add(s);
        t.last = s;
      }
    }
  }

  // ── support powers ──
  let powersSig = '';
  let powerBtns: PowerBtn[] = [];
  function updatePowers(player: Player): void {
    const sig = player.powers.map((p) => p.id).join(',');
    if (sig !== powersSig) {
      powersSig = sig;
      powersBox.replaceChildren();
      powerBtns = [];
      for (const ps of player.powers) {
        if (!SUPPORT_POWERS[ps.id]) continue;
        const b = el('button', 'cf-pow');
        b.type = 'button';
        const ic = el('span', 'cf-pow-ic');
        ic.innerHTML = glyph(ps.id, 18);
        const bar = el('span', 'cf-pow-bar');
        const fill = el('i');
        bar.append(fill);
        const label = el('span', 'cf-pow-t');
        b.append(ic, label, bar);
        const pb: PowerBtn = { id: ps.id, root: b, fill, label, lastText: '', lastP: -1, lastReady: false };
        b.addEventListener('click', () => {
          const cur = lastPlayer?.powers.find((x) => x.id === ps.id);
          if (cur?.ready) {
            audio.playUi('click');
            h.enterPower(ps.id);
          } else audio.playUi('error');
        });
        hover(b, () => powerTip(ps.id));
        powersBox.append(b);
        powerBtns.push(pb);
      }
      tools.classList.toggle('has-powers', powerBtns.length > 0);
    }
    for (const pb of powerBtns) {
      const ps = player.powers.find((x) => x.id === pb.id);
      if (!ps) continue;
      const frac = ps.chargeMax > 0 ? clamp(ps.charge / ps.chargeMax, 0, 1) : 1;
      const p = ps.ready ? 100 : Math.floor(frac * 100);
      if (p !== pb.lastP) {
        pb.lastP = p;
        pb.fill.style.transform = `scaleX(${(p / 100).toFixed(2)})`;
      }
      const text = ps.ready ? '就緒' : fmtTime(Math.ceil((ps.chargeMax - ps.charge) / TICK_RATE));
      if (text !== pb.lastText) {
        pb.lastText = text;
        pb.label.textContent = text;
      }
      if (ps.ready !== pb.lastReady) {
        pb.lastReady = ps.ready;
        pb.root.classList.toggle('is-ready', ps.ready);
      }
    }
  }

  // ── radar ──
  let mmW = 0; // device px
  let mmH = 0;
  let cssW = 0; // css px — the units handed to the renderer
  let cssH = 0;
  let mmDpr = 1;
  let mmAt = -1e9;
  let noise: HTMLCanvasElement | null = null;
  /** off → boot (noise → band reveal) → on → down (CRT collapse) → off */
  let radarState: 'off' | 'boot' | 'on' | 'down' = 'off';
  let radarT0 = 0;
  let radarFirst = true;
  let snapshot: HTMLCanvasElement | null = null;
  let offReason = '';

  function resize(): void {
    const w = radar.clientWidth;
    const hh = radar.clientHeight;
    if (w > 0 && hh > 0) {
      mmDpr = safeDpr();
      cssW = w;
      cssH = hh;
      mmW = Math.round(w * mmDpr);
      mmH = Math.round(hh * mmDpr);
      if (radarCanvas.width !== mmW) radarCanvas.width = mmW;
      if (radarCanvas.height !== mmH) radarCanvas.height = mmH;
      mmAt = -1e9;
    }
    if (cells.length) refreshIcons(false);
  }

  function drawNoise(alpha = 1): void {
    if (!rctx) return;
    if (!noise) {
      noise = document.createElement('canvas');
      noise.width = 72;
      noise.height = 72;
    }
    const nc = noise.getContext('2d');
    if (!nc) return;
    const img = nc.createImageData(72, 72);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 12 + Math.random() * 40;
      img.data[i] = v;
      img.data[i + 1] = v + 5;
      img.data[i + 2] = v + 7;
      img.data[i + 3] = 255;
    }
    nc.putImageData(img, 0, 0);
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.globalAlpha = alpha;
    rctx.imageSmoothingEnabled = false;
    rctx.drawImage(noise, 0, 0, mmW, mmH);
    rctx.globalAlpha = 1;
  }
  function drawRollBar(now: number): void {
    if (!rctx) return;
    const y = ((now / 14) % (mmH + 40)) - 20;
    const g = rctx.createLinearGradient(0, y - 20, 0, y + 20);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.fillStyle = g;
    rctx.fillRect(0, y - 20, mmW, 40);
  }
  function drawPicture(world: World): void {
    if (!rctx) return;
    // CSS-unit drawing on a dpr-scaled context: crisp on Retina, same convention as the renderer's own dev page.
    rctx.setTransform(mmDpr, 0, 0, mmDpr, 0, 0);
    rctx.imageSmoothingEnabled = true;
    rctx.clearRect(0, 0, cssW, cssH);
    rctx.save();
    try {
      deps.renderer.drawMinimap(rctx, world, view, cssW, cssH);
    } catch {
      /* renderer not ready */
    }
    rctx.restore();
    rctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function setRadarClass(): void {
    radar.classList.toggle('is-off', radarState === 'off');
    radar.classList.toggle('is-anim', radarState === 'boot' || radarState === 'down');
  }

  let dishAt = -1e9;
  let dish = false;
  /** The sim clears hasRadar on low power; look for an own finished radar building to say why it is dark. */
  function ownsRadarBuilding(world: World, now: number): boolean {
    if (now - dishAt < 500) return dish;
    dishAt = now;
    dish = false;
    for (const e of world.entities.values()) {
      if (e.owner === me && e.kind === 'building' && e.buildProgress >= 1 && buildingDef(e.defId)?.radar) {
        dish = true;
        break;
      }
    }
    return dish;
  }

  function stepRadar(world: World, player: Player, now: number): void {
    const want = player.hasRadar && !player.lowPower;
    const reason = want ? '' : player.hasRadar || (player.lowPower && ownsRadarBuilding(world, now)) ? 'power' : 'none';
    if (reason && reason !== offReason) {
      offReason = reason;
      radarOffTitle.textContent = reason === 'power' ? '電力不足' : '雷達離線';
      radarOffSub.textContent = reason === 'power' ? 'LOW POWER' : 'NO SIGNAL';
    }
    if (radarFirst) {
      radarFirst = false;
      radarState = want ? 'on' : 'off';
      setRadarClass();
    } else if (want && (radarState === 'off' || radarState === 'down')) {
      radarState = 'boot';
      radarT0 = now;
      setRadarClass();
      audio.playUi('select');
    } else if (!want && (radarState === 'on' || radarState === 'boot')) {
      // keep the last picture to collapse it like a tube switching off
      if (mmW > 0) {
        snapshot = snapshot ?? document.createElement('canvas');
        snapshot.width = mmW;
        snapshot.height = mmH;
        snapshot.getContext('2d')?.drawImage(radarCanvas, 0, 0);
      }
      radarState = 'down';
      radarT0 = now;
      setRadarClass();
      pings.replaceChildren();
      audio.playUi('cancel');
    }
  }

  function drawRadar(world: World, now: number): void {
    if (!rctx || mmW <= 0) return;
    const t = (now - radarT0) / (radarState === 'boot' ? BOOT_MS : DOWN_MS);
    if (radarState === 'boot') {
      if (t >= 1) {
        radarState = 'on';
        setRadarClass();
        drawPicture(world);
        return;
      }
      // noise, then a bright band opening from the centre line reveals the picture
      if (t < 0.35) {
        drawNoise(0.6 + t);
        rctx.fillStyle = `rgba(160,255,220,${(0.08 + 0.3 * Math.random() * t).toFixed(3)})`;
        rctx.fillRect(0, 0, mmW, mmH);
        return;
      }
      const k = (t - 0.35) / 0.65;
      const e = 1 - (1 - k) * (1 - k);
      drawPicture(world);
      const band = Math.max(2, mmH * e);
      const top = (mmH - band) / 2;
      rctx.fillStyle = '#05080a';
      rctx.fillRect(0, 0, mmW, top);
      rctx.fillRect(0, top + band, mmW, mmH - top - band);
      rctx.fillStyle = `rgba(190,255,230,${(0.75 * (1 - e)).toFixed(3)})`;
      rctx.fillRect(0, top - 1, mmW, 2 * mmDpr);
      rctx.fillRect(0, top + band - 1, mmW, 2 * mmDpr);
      rctx.fillStyle = `rgba(140,255,210,${(0.18 * (1 - e)).toFixed(3)})`;
      rctx.fillRect(0, top, mmW, band);
      return;
    }
    if (radarState === 'down') {
      if (t >= 1) {
        radarState = 'off';
        setRadarClass();
        drawNoise();
        return;
      }
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.fillStyle = '#030405';
      rctx.fillRect(0, 0, mmW, mmH);
      const squash = Math.min(1, t / 0.55);
      const hgt = Math.max(2 * mmDpr, mmH * (1 - squash * squash));
      const wid = t < 0.55 ? mmW : Math.max(2 * mmDpr, mmW * (1 - (t - 0.55) / 0.45));
      if (snapshot && t < 0.55) rctx.drawImage(snapshot, 0, (mmH - hgt) / 2, mmW, hgt);
      rctx.fillStyle = `rgba(220,255,240,${(0.25 + 0.6 * squash).toFixed(3)})`;
      rctx.fillRect((mmW - wid) / 2, (mmH - Math.min(hgt, 3 * mmDpr)) / 2, wid, Math.min(hgt, 3 * mmDpr));
      return;
    }
    if (radarState === 'on') drawPicture(world);
    else {
      drawNoise();
      drawRollBar(now);
    }
  }

  function miniToWorld(e: PointerEvent): { x: number; y: number } | null {
    if (!lastWorld || mmW <= 0) return null;
    const r = radarCanvas.getBoundingClientRect();
    if (r.width <= 0) return null;
    const mx = ((e.clientX - r.left) / r.width) * cssW;
    const my = ((e.clientY - r.top) / r.height) * cssH;
    try {
      const w = deps.renderer.minimapToWorld(lastWorld, mx, my, cssW, cssH);
      return { x: clamp(w.x, 0, lastWorld.map.width), y: clamp(w.y, 0, lastWorld.map.height) };
    } catch {
      return null;
    }
  }

  /** Forward mapping derived from the renderer's inverse (assumed affine), in CSS fractions of the radar box. */
  function worldToMiniFrac(x: number, y: number): { fx: number; fy: number } | null {
    if (!lastWorld || mmW <= 0) return null;
    try {
      const o = deps.renderer.minimapToWorld(lastWorld, 0, 0, cssW, cssH);
      const a = deps.renderer.minimapToWorld(lastWorld, cssW, 0, cssW, cssH);
      const b = deps.renderer.minimapToWorld(lastWorld, 0, cssH, cssW, cssH);
      const ax = a.x - o.x;
      const ay = a.y - o.y;
      const bx = b.x - o.x;
      const by = b.y - o.y;
      const det = ax * by - bx * ay;
      if (Math.abs(det) < 1e-9) return null;
      const dx = x - o.x;
      const dy = y - o.y;
      return { fx: (dx * by - bx * dy) / det, fy: (ax * dy - dx * ay) / det };
    } catch {
      return null;
    }
  }

  let mmDrag = false;
  radarCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (radarState !== 'on') return;
    const w = miniToWorld(e);
    if (!w) return;
    if (e.button === 2) {
      h.commandAt(w.x, w.y, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    mmDrag = true;
    try {
      radarCanvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    h.panTo(w.x, w.y);
  });
  radarCanvas.addEventListener('pointermove', (e) => {
    if (!mmDrag) return;
    const w = miniToWorld(e);
    if (w) h.panTo(w.x, w.y);
  });
  const endDrag = () => {
    mmDrag = false;
  };
  radarCanvas.addEventListener('pointerup', endDrag);
  radarCanvas.addEventListener('pointercancel', endDrag);

  // ── credits (odometer) / power gauge ──
  let shownCredits = -1;
  let shownInt = -1;
  let creditDir = 0;
  let powerSig = '';
  let faction = '';

  function paintOdometer(value: number): void {
    const s = String(Math.max(0, Math.min(10 ** ODO_DIGITS - 1, value))).padStart(ODO_DIGITS, '0');
    let leading = true;
    for (let i = 0; i < ODO_DIGITS; i++) {
      const d = s.charCodeAt(i) - 48;
      if (d !== 0 || i === ODO_DIGITS - 1) leading = false;
      const slot = odoDigits[i];
      if (slot.d !== d) {
        slot.d = d;
        slot.strip.style.transform = `translateY(${-d * 10}%)`;
      }
      if (slot.lead !== leading) {
        slot.lead = leading;
        slot.slot.classList.toggle('is-lead', leading);
        const sep = slot.slot.nextElementSibling;
        if (sep && sep.classList.contains('cf-odo-sep')) sep.classList.toggle('is-lead', leading);
      }
    }
  }

  function updateResources(player: Player, dtMs: number): void {
    const target = player.credits;
    if (shownCredits < 0) shownCredits = target;
    const diff = target - shownCredits;
    let dir = 0;
    if (Math.abs(diff) < 1) shownCredits = target;
    else {
      // tick toward the real value: fast for big jumps, but never slower than ~400 credits/s
      const stepMin = Math.sign(diff) * Math.min(Math.abs(diff), Math.max(1, dtMs * 0.4));
      const eased = diff * (1 - Math.exp(-dtMs / 260));
      shownCredits += Math.abs(eased) > Math.abs(stepMin) ? eased : stepMin;
      dir = diff > 0 ? 1 : -1;
    }
    const v = Math.floor(shownCredits);
    if (v !== shownInt) {
      shownInt = v;
      paintOdometer(v);
    }
    if (dir !== creditDir) {
      creditDir = dir;
      odo.classList.toggle('is-up', dir > 0);
      odo.classList.toggle('is-down', dir < 0);
    }
    const sig = `${player.powerProduced}|${player.powerConsumed}|${player.lowPower ? 1 : 0}`;
    if (sig !== powerSig) {
      powerSig = sig;
      const prod = player.powerProduced;
      const used = player.powerConsumed;
      const scale = Math.max(100, prod, used) * 1.15;
      gaugeFill.style.transform = `scaleY(${clamp(prod / scale, 0, 1).toFixed(3)})`;
      gaugeUse.style.bottom = `${(clamp(used / scale, 0, 1) * 100).toFixed(1)}%`;
      const tight = !player.lowPower && prod > 0 && used / prod > 0.85;
      gauge.classList.toggle('is-low', player.lowPower);
      gauge.classList.toggle('is-tight', tight);
      gridWell.classList.toggle('is-lowpow', player.lowPower);
      if (tipFor === gauge) showTip(gauge, gaugeTip());
    }
  }

  function applyFaction(player: Player): void {
    const f = player.faction === 'helion' ? 'helion' : 'ferrum';
    if (f === faction) return;
    faction = f;
    root.classList.toggle('is-helion', f === 'helion');
    root.classList.toggle('is-ferrum', f === 'ferrum');
    emblem.innerHTML = glyph(f === 'helion' ? 'emblem_helion' : 'emblem_ferrum', 26);
    emblem.title = f === 'helion' ? '赫利昂 Helion' : '鐵燼 Ferrum';
  }

  let lastMode = '';

  return {
    el: root,
    update(world, player, now, dtMs) {
      lastWorld = world;
      lastPlayer = player;
      applyFaction(player);
      if (mmW === 0) resize();
      updateResources(player, dtMs);
      if (dirty || now - optionsAt > 250) {
        dirty = false;
        optionsAt = now;
        refreshOptions(world, player);
        updatePowers(player);
      }
      updateCells(player);
      stepRadar(world, player, now);
      const animating = radarState === 'boot' || radarState === 'down';
      if (animating || now - mmAt > (radarState === 'on' ? 100 : 140)) {
        mmAt = now;
        drawRadar(world, now);
      }
      const mode = h.modeKind();
      if (mode !== lastMode) {
        lastMode = mode;
        repairBtn.classList.toggle('is-on', mode === 'repair');
        sellBtn.classList.toggle('is-on', mode === 'sell');
        for (const pb of powerBtns) pb.root.classList.toggle('is-on', mode === 'power:' + pb.id);
      }
    },
    invalidate() {
      dirty = true;
    },
    cycleTab(dir) {
      if (availableCats.length < 2) return;
      const i = availableCats.indexOf(activeCat);
      const n = availableCats.length;
      setTab(availableCats[(i + dir + n) % n], true);
    },
    scrollGrid(dir) {
      const row = (grid.firstElementChild as HTMLElement | null)?.offsetHeight || 64;
      grid.scrollBy({ top: dir * row, behavior: 'smooth' });
    },
    tabKey(cats) {
      const avail = cats.filter((c) => availableCats.includes(c));
      if (!avail.length) {
        audio.playUi('error');
        return;
      }
      // pressing the key of the tab that is already open moves on to its sibling (R: vehicles ⇄ aircraft)
      const at = avail.indexOf(activeCat);
      setTab(avail[at < 0 ? 0 : (at + 1) % avail.length], true);
    },
    ping(x, y, kind) {
      if (radarState !== 'on') return;
      const f = worldToMiniFrac(x, y);
      if (!f || f.fx < 0 || f.fx > 1 || f.fy < 0 || f.fy > 1) return;
      const p = el('i', 'cf-ping is-' + kind);
      p.style.left = (f.fx * 100).toFixed(2) + '%';
      p.style.top = (f.fy * 100).toFixed(2) + '%';
      pings.append(p);
      window.setTimeout(() => p.remove(), 3200);
    },
    resize,
    hideTooltip,
  };
}

/** Unit/building def helpers re-exported for the selection panel. */
export { buildingDef, unitDef };
