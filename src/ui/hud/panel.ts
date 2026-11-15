// Command panel: credits, power, radar minimap, tool/support-power buttons, build tabs + icon grid, tooltip.
import type { UiDeps, ViewState } from '../../core/api';
import { TICK_RATE } from '../../core/constants';
import type { Player, QueueCategory, SupportPowerId, World } from '../../core/types';
import { SUPPORT_POWERS, WEAPONS } from '../../data';
import { blitIcon, buildingDef, button, clamp, defOf, el, fmtNum, fmtTime, glyph, nameOf, safeDpr, unitDef } from '../dom';

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
  ping(x: number, y: number, kind: 'bad' | 'warn' | 'good'): void;
  resize(): void;
  hideTooltip(): void;
}

const CATS: { id: QueueCategory; label: string; en: string; key: string }[] = [
  { id: 'structure', label: '建築', en: 'Structures', key: 'Q' },
  { id: 'defense', label: '防禦', en: 'Defences', key: 'W' },
  { id: 'infantry', label: '步兵', en: 'Infantry', key: 'E' },
  { id: 'vehicle', label: '載具', en: 'Vehicles', key: 'R' },
  { id: 'aircraft', label: '航空', en: 'Aircraft', key: 'R' },
];
const ARMOR_ZH: Record<string, string> = { infantry: '步兵', light: '輕甲', heavy: '重甲', building: '建築', air: '飛行' };

interface Cell {
  defId: string;
  cat: QueueCategory;
  cost: number;
  root: HTMLButtonElement;
  sweep: HTMLElement;
  count: HTMLElement;
  state: HTMLElement;
  lastP: number;
  lastCount: number;
  lastState: string;
  lastPoor: boolean;
}

interface PowerBtn {
  id: SupportPowerId;
  root: HTMLButtonElement;
  ring: HTMLElement;
  label: HTMLElement;
  lastText: string;
  lastP: number;
  lastReady: boolean;
}

export function createPanel(h: PanelHooks): Panel {
  const { deps, view } = h;
  const audio = deps.audio;
  const me = deps.viewer;

  const root = el('div', 'cf-panel cf-glass');
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── resources ──
  const res = el('div', 'cf-res');
  const credits = el('div', 'cf-credits');
  credits.innerHTML = glyph('credit', 18);
  const creditsNum = el('span', 'cf-credits-num', '0');
  credits.append(creditsNum);
  credits.title = '資金 Credits';
  const power = el('div', 'cf-power');
  power.title = '電力:消耗 / 產出  Power: used / produced';
  const powerIcon = el('span', 'cf-power-icon');
  powerIcon.innerHTML = glyph('bolt', 14);
  const powerBar = el('div', 'cf-power-bar');
  const powerFill = el('i');
  powerBar.append(powerFill);
  const powerTxt = el('span', 'cf-power-txt', '0 / 0');
  power.append(powerIcon, powerBar, powerTxt);
  res.append(credits, power);

  // ── radar ──
  const radar = el('div', 'cf-radar');
  const radarCanvas = el('canvas', 'cf-radar-canvas');
  const radarOff = el('div', 'cf-radar-off');
  radarOff.append(el('b', '', '雷達離線'), el('small', '', 'NO SIGNAL'));
  const pings = el('div', 'cf-radar-pings');
  radar.append(radarCanvas, radarOff, pings);
  const rctx = radarCanvas.getContext('2d');

  // ── tools: repair / sell / support powers ──
  const tools = el('div', 'cf-tools');
  const repairBtn = button('cf-tool', `${glyph('repair', 16)}<span>修理</span>`, () => {
    audio.playUi('click');
    h.toggleMode('repair');
  });
  repairBtn.title = '修理模式 (K):點擊受損的己方建築  Repair';
  const sellBtn = button('cf-tool', `${glyph('sell', 16)}<span>變賣</span>`, () => {
    audio.playUi('click');
    h.toggleMode('sell');
  });
  sellBtn.title = '變賣模式 (L):點擊己方建築換回部分資金  Sell';
  const powersBox = el('div', 'cf-powers');
  tools.append(repairBtn, sellBtn, powersBox);

  // ── build tabs + grid ──
  const tabs = el('div', 'cf-tabs');
  const grid = el('div', 'cf-grid');
  const empty = el('div', 'cf-grid-empty');
  empty.append(el('b', '', '尚無可建造項目'), el('span', '', '選取基地車並按 D 部署,建立指揮核心。'));

  root.append(res, radar, tools, tabs, grid);

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

  function statLine(label: string, value: string, cls = ''): HTMLElement {
    const s = el('span', 'cf-tip-stat ' + cls);
    s.append(el('small', '', label), el('b', '', value));
    return s;
  }

  function defTip(defId: string, hotkey: string | null): HTMLElement {
    const box = el('div');
    const def = defOf(defId);
    if (!def) {
      box.textContent = defId;
      return box;
    }
    const head = el('div', 'cf-tip-head');
    const title = el('div', 'cf-tip-title');
    title.append(el('b', '', def.name), el('small', '', def.nameEn));
    head.append(title);
    if (hotkey) head.append(el('kbd', '', hotkey));
    box.append(head);

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
    box.append(el('p', 'cf-tip-hint', '點擊:生產 · 次鍵:暫停/取消'));
    return box;
  }

  function powerTip(id: SupportPowerId): HTMLElement {
    const p = SUPPORT_POWERS[id];
    const box = el('div');
    const head = el('div', 'cf-tip-head');
    const title = el('div', 'cf-tip-title');
    title.append(el('b', '', p.name), el('small', '', p.nameEn));
    head.append(title);
    box.append(head);
    const stats = el('div', 'cf-tip-stats');
    stats.append(statLine('充能', fmtTime(p.recharge)));
    stats.append(statLine('半徑', `${p.radius} 格`));
    if (p.damage > 0) stats.append(statLine('傷害', `${p.damage}`, 'is-warn'));
    box.append(stats, el('p', 'cf-tip-desc', p.desc), el('p', 'cf-tip-hint', '就緒後點擊,再於地圖上指定目標'));
    return box;
  }

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

  function clickCell(cell: Cell, secondary: boolean, shift: boolean): void {
    const p = lastPlayer;
    if (!p) return;
    const q = p.queues[cell.cat];
    const head = q.items[0];
    const isHead = !!head && head.defId === cell.defId;
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
    ids.forEach((defId, i) => {
      const def = defOf(defId);
      if (!def) return;
      const b = el('button', 'cf-cell');
      b.type = 'button';
      const icon = el('canvas', 'cf-cell-icon');
      const sweep = el('div', 'cf-cell-sweep');
      const count = el('span', 'cf-cell-count');
      const state = el('span', 'cf-cell-state');
      const foot = el('div', 'cf-cell-foot');
      foot.append(el('span', 'cf-cell-name', def.name), el('span', 'cf-cell-cost', fmtNum(def.cost)));
      b.append(icon, sweep, count, state, foot);
      const cell: Cell = { defId, cat: activeCat, cost: def.cost, root: b, sweep, count, state, lastP: -2, lastCount: -1, lastState: '', lastPoor: false };
      b.addEventListener('click', (e) => clickCell(cell, false, e.shiftKey));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        clickCell(cell, true, false);
      });
      b.addEventListener('pointerenter', () => showTip(b, defTip(defId, null)));
      b.addEventListener('pointerleave', () => {
        if (tipFor === b) hideTooltip();
      });
      grid.append(b);
      cells.push(cell);
      iconInto(icon, defId, 72);
    });
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
    tabs.replaceChildren();
    tabEls.clear();
    for (const c of CATS) {
      if (!optionsByCat.has(c.id)) continue;
      const b = button('cf-tab', `<span>${c.label}</span><b class="cf-tab-key">${c.key}</b><i></i>`, () => setTab(c.id, true));
      b.title = `${c.label} ${c.en} (${c.key})`;
      tabs.append(b);
      tabEls.set(c.id, { b, last: '' });
    }
    tabs.style.display = availableCats.length ? '' : 'none';
    if (!optionsByCat.has(activeCat)) activeCat = availableCats[0] ?? 'structure';
    for (const [id, t] of tabEls) t.b.classList.toggle('is-on', id === activeCat);
    buildGrid();
  }

  function updateCells(player: Player): void {
    const q = player.queues[activeCat];
    if (!q) return;
    const head = q.items[0];
    for (const cell of cells) {
      let count = 0;
      for (const it of q.items) if (it.defId === cell.defId) count++;
      const isHead = !!head && head.defId === cell.defId;
      const st = isHead ? (q.ready ? 'ready' : q.paused ? 'paused' : 'building') : count > 0 ? 'queued' : 'idle';
      const p = isHead ? (q.ready ? 100 : Math.round(clamp(head.progress, 0, 1) * 200) / 2) : -1;
      if (st !== cell.lastState) {
        cell.lastState = st;
        cell.root.className = 'cf-cell is-' + st;
        cell.lastPoor = false;
        cell.state.textContent = st === 'ready' ? '就緒' : st === 'paused' ? '暫停' : '';
      }
      if (p !== cell.lastP) {
        cell.lastP = p;
        cell.sweep.style.setProperty('--p', String(Math.max(0, p)));
      }
      if (count !== cell.lastCount) {
        cell.lastCount = count;
        cell.count.textContent = count > 1 || (count === 1 && !isHead) ? String(count) : '';
      }
      const poor = st === 'idle' && player.credits < cell.cost;
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
        const ring = el('div', 'cf-pow-ring');
        ring.innerHTML = glyph(ps.id, 18);
        const label = el('span', 'cf-pow-t');
        b.append(ring, label);
        const pb: PowerBtn = { id: ps.id, root: b, ring, label, lastText: '', lastP: -1, lastReady: false };
        b.addEventListener('click', () => {
          const cur = lastPlayer?.powers.find((x) => x.id === ps.id);
          if (cur?.ready) {
            audio.playUi('click');
            h.enterPower(ps.id);
          } else audio.playUi('error');
        });
        b.addEventListener('pointerenter', () => showTip(b, powerTip(ps.id)));
        b.addEventListener('pointerleave', () => {
          if (tipFor === b) hideTooltip();
        });
        powersBox.append(b);
        powerBtns.push(pb);
      }
    }
    for (const pb of powerBtns) {
      const ps = player.powers.find((x) => x.id === pb.id);
      if (!ps) continue;
      const frac = ps.chargeMax > 0 ? clamp(ps.charge / ps.chargeMax, 0, 1) : 1;
      const p = ps.ready ? 100 : Math.floor(frac * 100);
      if (p !== pb.lastP) {
        pb.lastP = p;
        pb.ring.style.setProperty('--p', String(p));
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

  // ── minimap ──
  let mmW = 0; // device px
  let mmH = 0;
  let cssW = 0; // css px — the units handed to the renderer
  let cssH = 0;
  let mmDpr = 1;
  let mmAt = -1e9;
  let radarOn: boolean | null = null;
  let noise: HTMLCanvasElement | null = null;

  function resize(): void {
    const w = radar.clientWidth;
    const hh = radar.clientHeight;
    if (w <= 0 || hh <= 0) return;
    mmDpr = safeDpr();
    cssW = w;
    cssH = hh;
    mmW = Math.round(w * mmDpr);
    mmH = Math.round(hh * mmDpr);
    if (radarCanvas.width !== mmW) radarCanvas.width = mmW;
    if (radarCanvas.height !== mmH) radarCanvas.height = mmH;
    mmAt = -1e9;
  }

  function drawStatic(now: number): void {
    if (!rctx) return;
    if (!noise) {
      noise = document.createElement('canvas');
      noise.width = 64;
      noise.height = 64;
    }
    const nc = noise.getContext('2d');
    if (!nc) return;
    const img = nc.createImageData(64, 64);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 14 + Math.random() * 34;
      img.data[i] = v;
      img.data[i + 1] = v + 4;
      img.data[i + 2] = v + 8;
      img.data[i + 3] = 255;
    }
    nc.putImageData(img, 0, 0);
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.imageSmoothingEnabled = false;
    rctx.drawImage(noise, 0, 0, mmW, mmH);
    const y = ((now / 14) % (mmH + 40)) - 20;
    const g = rctx.createLinearGradient(0, y - 20, 0, y + 20);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.fillStyle = g;
    rctx.fillRect(0, y - 20, mmW, 40);
  }

  function drawMinimap(world: World, player: Player, now: number): void {
    if (!rctx || mmW <= 0) return;
    if (player.hasRadar !== radarOn) {
      radarOn = player.hasRadar;
      radar.classList.toggle('is-off', !radarOn);
      if (!radarOn) pings.replaceChildren();
    }
    if (!player.hasRadar) {
      drawStatic(now);
      return;
    }
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
    if (!lastPlayer?.hasRadar) return;
    const w = miniToWorld(e);
    if (!w) return;
    const secondary = e.button === 2 || (e.button === 0 && e.ctrlKey);
    if (secondary) {
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

  // ── credits / power ──
  let shownCredits = -1;
  let shownCreditsText = '';
  let creditDir = 0;
  let powerSig = '';

  function updateResources(player: Player, dtMs: number): void {
    const target = player.credits;
    if (shownCredits < 0) shownCredits = target;
    const diff = target - shownCredits;
    let dir = 0;
    if (Math.abs(diff) < 1) shownCredits = target;
    else {
      const stepMin = Math.sign(diff) * Math.min(Math.abs(diff), Math.max(1, dtMs * 0.05));
      const eased = diff * (1 - Math.exp(-dtMs / 110));
      shownCredits += Math.abs(eased) > Math.abs(stepMin) ? eased : stepMin;
      dir = diff > 0 ? 1 : -1;
    }
    const text = fmtNum(Math.floor(shownCredits));
    if (text !== shownCreditsText) {
      shownCreditsText = text;
      creditsNum.textContent = text;
    }
    if (dir !== creditDir) {
      creditDir = dir;
      credits.classList.toggle('is-up', dir > 0);
      credits.classList.toggle('is-down', dir < 0);
    }
    const sig = `${player.powerProduced}|${player.powerConsumed}|${player.lowPower ? 1 : 0}`;
    if (sig !== powerSig) {
      powerSig = sig;
      const prod = player.powerProduced;
      const used = player.powerConsumed;
      powerTxt.textContent = `${used} / ${prod}`;
      const frac = prod > 0 ? clamp(used / prod, 0, 1) : used > 0 ? 1 : 0;
      powerFill.style.transform = `scaleX(${frac.toFixed(3)})`;
      power.classList.toggle('is-low', player.lowPower);
      power.classList.toggle('is-tight', !player.lowPower && prod > 0 && used / prod > 0.85);
    }
  }

  let lastMode = '';

  return {
    el: root,
    update(world, player, now, dtMs) {
      lastWorld = world;
      lastPlayer = player;
      if (mmW === 0) resize();
      updateResources(player, dtMs);
      if (dirty || now - optionsAt > 250) {
        dirty = false;
        optionsAt = now;
        refreshOptions(world, player);
        updatePowers(player);
      }
      updateCells(player);
      if (now - mmAt > (player.hasRadar ? 100 : 140)) {
        mmAt = now;
        drawMinimap(world, player, now);
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
      if (!lastPlayer?.hasRadar) return;
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
