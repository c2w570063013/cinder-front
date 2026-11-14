// Selection card: portrait, name, hp, rank, cargo, order + command buttons for whatever is selected.
import type { UiDeps, ViewState } from '../../core/api';
import type { Entity, EntityId, World } from '../../core/types';
import { blitIcon, buildingDef, button, clamp, defOf, el, glyph, safeDpr, unitDef } from '../dom';

export type SelCommand = 'stop' | 'guard' | 'attackMove' | 'deploy' | 'scatter' | 'primary' | 'repair' | 'sell';

export interface SelHooks {
  deps: UiDeps;
  view: ViewState;
  command(kind: SelCommand): void;
  selectOnly(ids: EntityId[]): void;
  modeKind(): string;
}

export interface SelPanel {
  el: HTMLElement;
  update(world: World, now: number): void;
}

const ORDER_ZH: Record<string, string> = {
  move: '移動中',
  attack: '攻擊目標',
  attackMove: '攻擊移動',
  harvest: '採集晶礦',
  dock: '返回卸貨',
  capture: '進入建築',
  deploy: '部署中',
  guard: '原地警戒',
};
const ACTION_ZH: Record<string, string> = {
  idle: '待命',
  move: '移動中',
  attack: '交戰中',
  harvest: '採集晶礦',
  unload: '卸貨中',
  deploy: '部署中',
  construct: '建造中',
};
const RANK_ZH = ['', '老兵', '菁英'];

export function createSelectionPanel(h: SelHooks): SelPanel {
  const { deps, view } = h;
  const me = deps.viewer;
  const root = el('div', 'cf-sel cf-glass');
  root.style.display = 'none';
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  let sig = '';
  let at = -1e9;
  let shown = false;

  // dynamic refs for the current skeleton
  let hpFill: HTMLElement | null = null;
  let hpText: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let rankEl: HTMLElement | null = null;
  let lastHp = '';
  let lastStatus = '';
  let lastRank = -1;
  let lastHpCls = '';
  let amBtn: HTMLButtonElement | null = null;
  let repairBtn: HTMLButtonElement | null = null;

  function icon(defId: string, color: string, css: number): HTMLCanvasElement {
    const cv = el('canvas');
    cv.style.width = css + 'px';
    cv.style.height = css + 'px';
    const dpr = safeDpr();
    let src: HTMLCanvasElement | null = null;
    try {
      src = deps.renderer.getIcon(defId, color, Math.round(css * dpr));
    } catch {
      src = null;
    }
    blitIcon(cv, src, css, dpr);
    return cv;
  }

  function cmd(kind: SelCommand, g: Parameters<typeof glyph>[0], label: string, key: string | null, title: string): HTMLButtonElement {
    const b = button('cf-cmd', `${glyph(g, 16)}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}`, () => {
      deps.audio.playUi('click');
      h.command(kind);
    });
    b.title = title;
    return b;
  }

  function rebuild(world: World, ents: Entity[]): void {
    root.replaceChildren();
    hpFill = hpText = status = rankEl = null;
    amBtn = repairBtn = null;
    lastHp = lastStatus = lastHpCls = '';
    lastRank = -1;
    const own = ents.filter((e) => e.owner === me);
    const ownUnits = own.filter((e) => e.kind === 'unit');
    const cmds = el('div', 'cf-sel-cmds');

    if (ents.length === 1) {
      const e = ents[0];
      const def = defOf(e.defId);
      const owner = world.players[e.owner];
      const main = el('div', 'cf-sel-main');
      const portrait = icon(e.defId, owner?.color ?? '#888', 54);
      portrait.className = 'cf-sel-portrait';
      const info = el('div', 'cf-sel-info');
      const name = el('div', 'cf-sel-name');
      name.append(el('b', '', def?.name ?? e.defId), el('small', '', def?.nameEn ?? ''));
      rankEl = el('span', 'cf-sel-rank');
      name.append(rankEl);
      const hp = el('div', 'cf-hp');
      hpFill = el('i');
      hp.append(hpFill);
      const meta = el('div', 'cf-sel-meta');
      hpText = el('span', 'cf-sel-hp');
      status = el('span', 'cf-sel-status');
      meta.append(hpText, status);
      info.append(name, hp, meta);
      main.append(portrait, info);
      root.append(main);
    } else {
      const groups = new Map<string, Entity[]>();
      for (const e of ents) {
        let g = groups.get(e.defId);
        if (!g) groups.set(e.defId, (g = []));
        g.push(e);
      }
      const box = el('div', 'cf-sel-groups');
      let n = 0;
      for (const [defId, list] of groups) {
        if (n++ >= 10) break;
        const owner = world.players[list[0].owner];
        const b = el('button', 'cf-sel-g');
        b.type = 'button';
        b.title = `${defOf(defId)?.name ?? defId} ×${list.length} — 點擊只選取此類`;
        b.append(icon(defId, owner?.color ?? '#888', 34), el('span', '', String(list.length)));
        b.addEventListener('click', () => {
          deps.audio.playUi('select');
          h.selectOnly(list.map((x) => x.id));
        });
        box.append(b);
      }
      const meta = el('div', 'cf-sel-meta');
      hpText = el('span', 'cf-sel-hp');
      status = el('span', 'cf-sel-status');
      meta.append(hpText, status);
      const hp = el('div', 'cf-hp');
      hpFill = el('i');
      hp.append(hpFill);
      root.append(box, hp, meta);
    }

    if (ownUnits.length > 0) {
      cmds.append(cmd('stop', 'stop', '停止', 'S', '停止目前行動 Stop'));
      cmds.append(cmd('guard', 'guard', '警戒', 'G', '原地警戒 Guard'));
      amBtn = cmd('attackMove', 'attackMove', '攻擊移動', 'A', '移動途中攻擊遭遇的敵人 Attack-move');
      cmds.append(amBtn);
      if (ownUnits.length > 1) cmds.append(cmd('scatter', 'scatter', '散開', 'X', '散開隊形 Scatter'));
      if (ownUnits.some((u) => unitDef(u.defId)?.deploysTo)) cmds.append(cmd('deploy', 'deploy', '部署', 'D', '部署基地車 Deploy'));
    } else if (own.length === 1 && own[0].kind === 'building') {
      const b = own[0];
      const bd = buildingDef(b.defId);
      const makesUnits = !!bd?.produces?.some((c) => c === 'infantry' || c === 'vehicle' || c === 'aircraft');
      if (makesUnits) cmds.append(cmd('primary', 'primary', '設為主要', null, '新單位由此建築出廠 Set primary'));
      repairBtn = cmd('repair', 'repair', '修理', null, '開始/停止修理 Toggle repair');
      cmds.append(repairBtn);
      cmds.append(cmd('sell', 'sell', '變賣', null, '變賣此建築 Sell'));
    }
    if (cmds.childElementCount) root.append(cmds);
  }

  function hpClass(frac: number): string {
    return frac > 0.5 ? 'is-good' : frac > 0.25 ? 'is-warn' : 'is-bad';
  }

  function refresh(world: World, ents: Entity[]): void {
    let hp = 0;
    let max = 0;
    for (const e of ents) {
      hp += e.hp;
      max += e.maxHp;
    }
    const frac = max > 0 ? clamp(hp / max, 0, 1) : 0;
    const hpStr = ents.length === 1 ? `${Math.max(0, Math.ceil(hp))} / ${Math.round(max)}` : `已選取 ${ents.length} 個`;
    const key = hpStr + '|' + frac.toFixed(3);
    if (key !== lastHp) {
      lastHp = key;
      if (hpText) hpText.textContent = hpStr;
      if (hpFill) hpFill.style.transform = `scaleX(${frac.toFixed(3)})`;
      const cls = hpClass(frac);
      if (cls !== lastHpCls && hpFill) {
        lastHpCls = cls;
        hpFill.className = cls;
      }
    }

    let st = '';
    if (ents.length === 1) {
      const e = ents[0];
      const owner = world.players[e.owner];
      if (e.owner !== me) {
        let hostile = true;
        try {
          hostile = deps.sim.isEnemy(world, me, e.owner);
        } catch {
          /* assume hostile */
        }
        st = `${owner?.name ?? ''} · ${hostile ? '敵方' : '友軍'}`;
      } else if (e.kind === 'unit') {
        const ud = unitDef(e.defId);
        const parts: string[] = [e.order ? (ORDER_ZH[e.order.type] ?? '') : (ACTION_ZH[e.action] ?? '待命')];
        if (e.queue.length) parts.push(`佇列 ${e.queue.length}`);
        if (ud?.harvester) parts.push(`載貨 ${Math.round(e.cargo)}/${ud.harvester.capacity}`);
        if (e.kills > 0) parts.push(`擊殺 ${e.kills}`);
        st = parts.filter(Boolean).join(' · ');
      } else {
        const bd = buildingDef(e.defId);
        const parts: string[] = [];
        if (e.buildProgress < 1) parts.push(`建造中 ${Math.round(e.buildProgress * 100)}%`);
        if (bd && bd.power !== 0) parts.push(`電力 ${bd.power > 0 ? '+' : ''}${bd.power}`);
        if (e.primary) parts.push('主要工廠');
        if (e.repairing) parts.push('修理中');
        if (!e.powered) parts.push('斷電');
        if (e.rally) parts.push('已設集結點');
        st = parts.join(' · ');
      }
      if (e.rank !== lastRank && rankEl) {
        lastRank = e.rank;
        rankEl.textContent = e.rank > 0 ? `${'▲'.repeat(e.rank)} ${RANK_ZH[e.rank]}` : '';
      }
      if (repairBtn) repairBtn.classList.toggle('is-on', e.repairing);
    } else {
      const units = ents.filter((e) => e.kind === 'unit').length;
      st = units === ents.length ? `部隊耐久 ${Math.round(frac * 100)}%` : `整體耐久 ${Math.round(frac * 100)}%`;
    }
    if (st !== lastStatus && status) {
      lastStatus = st;
      status.textContent = st;
    }
    if (amBtn) amBtn.classList.toggle('is-on', h.modeKind() === 'attackMove');
  }

  return {
    el: root,
    update(world, now) {
      const sel = view.selection;
      if (sel.size === 0) {
        if (shown) {
          shown = false;
          sig = '';
          root.style.display = 'none';
        }
        return;
      }
      if (now - at < 90 && shown) {
        // cheap check: only re-sync when the selection itself changed
        if (sig.length && sig.split(',').length === sel.size) return;
      }
      at = now;
      const ents: Entity[] = [];
      for (const id of sel) {
        const e = world.entities.get(id);
        if (e) ents.push(e);
      }
      if (ents.length === 0) {
        if (shown) {
          shown = false;
          sig = '';
          root.style.display = 'none';
        }
        return;
      }
      const s = ents.map((e) => e.id).join(',');
      if (s !== sig) {
        sig = s;
        rebuild(world, ents);
      }
      if (!shown) {
        shown = true;
        root.style.display = '';
      }
      refresh(world, ents);
    },
  };
}
