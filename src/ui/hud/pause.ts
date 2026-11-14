// Pause menu overlay: resume, settings, controls reference, surrender, quit to menu.
import type { UiDeps } from '../../core/api';
import { button, el, glyph } from '../dom';
import { buildHowTo, buildSettingsPanel } from '../panels';

export interface PauseMenu {
  el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Esc inside the menu: back one level, or close. */
  back(): void;
  /** Open straight on the controls reference. */
  openHelp(): void;
}

export function createPauseMenu(deps: UiDeps, hooks: { onOpen(): void; onClose(): void; surrender(): void; canSurrender(): boolean }): PauseMenu {
  const root = el('div', 'cf-overlay');
  root.style.display = 'none';
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  const card = el('div', 'cf-card cf-glass');
  root.append(card);
  let open = false;
  let page: 'main' | 'settings' | 'howto' | 'confirm' = 'main';
  const click = () => deps.audio.playUi('click');

  function header(title: string, sub: string, withBack: boolean): HTMLElement {
    const head = el('div', 'cf-card-head');
    if (withBack) {
      const b = button('cf-icon-btn', glyph('back', 18), () => {
        click();
        show('main');
      });
      b.title = '返回';
      head.append(b);
    }
    const t = el('div', 'cf-card-title');
    t.append(el('b', '', title), el('small', '', sub));
    head.append(t);
    return head;
  }

  function confirmPage(title: string, text: string, yes: string, action: () => void): void {
    page = 'confirm';
    card.className = 'cf-card cf-glass';
    card.replaceChildren(header(title, '', true));
    card.append(el('p', 'cf-card-text', text));
    const rowEl = el('div', 'cf-card-actions');
    rowEl.append(
      button('cf-btn', '取消', () => {
        click();
        show('main');
      }),
      button('cf-btn is-danger', yes, () => {
        click();
        action();
      }),
    );
    card.append(rowEl);
  }

  function show(p: 'main' | 'settings' | 'howto'): void {
    page = p;
    card.replaceChildren();
    card.className = 'cf-card cf-glass' + (p === 'howto' ? ' is-wide' : p === 'settings' ? ' is-mid' : '');
    if (p === 'main') {
      card.append(header('戰術暫停', 'Paused', false));
      const list = el('div', 'cf-menu-list');
      list.append(
        button('cf-btn is-primary', '<span>繼續作戰</span><small>Resume</small>', () => {
          click();
          api.close();
        }),
        button('cf-btn', '<span>設定</span><small>Settings</small>', () => {
          click();
          show('settings');
        }),
        button('cf-btn', '<span>操作說明</span><small>Controls</small>', () => {
          click();
          show('howto');
        }),
      );
      const sur = button('cf-btn', '<span>投降</span><small>Surrender</small>', () => {
        click();
        confirmPage('確定投降?', '你的部隊將放下武器,本場戰鬥判定為戰敗。', '確認投降', () => {
          api.close();
          hooks.surrender();
        });
      });
      sur.disabled = !hooks.canSurrender();
      list.append(
        sur,
        button('cf-btn', '<span>返回主選單</span><small>Quit to menu</small>', () => {
          click();
          confirmPage('離開戰鬥?', '目前的戰鬥進度不會保存。', '返回主選單', () => {
            open = false;
            root.style.display = 'none';
            deps.quitToMenu();
          });
        }),
      );
      card.append(list);
    } else if (p === 'settings') {
      card.append(header('設定', 'Settings', true));
      const scroll = el('div', 'cf-card-scroll');
      scroll.append(buildSettingsPanel(deps.audio, { setSpeed: deps.setSpeed }));
      card.append(scroll);
    } else {
      card.append(header('操作說明', 'Controls', true));
      const scroll = el('div', 'cf-card-scroll');
      scroll.append(buildHowTo());
      card.append(scroll);
    }
  }

  const api: PauseMenu = {
    el: root,
    get isOpen() {
      return open;
    },
    open() {
      if (open) return;
      open = true;
      show('main');
      root.style.display = '';
      hooks.onOpen();
    },
    close() {
      if (!open) return;
      open = false;
      root.style.display = 'none';
      hooks.onClose();
    },
    openHelp() {
      api.open();
      show('howto');
    },
    back() {
      if (page === 'main') api.close();
      else {
        click();
        show('main');
      }
    },
  };
  return api;
}
