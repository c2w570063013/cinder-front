// In-match LAN overlays: player chips with ping / disconnect markers (in the top bar), the "waiting for players"
// card, the terminal desync / host-lost dialogs, the defeated → spectating banner, and the chat bar (Enter).
import type { NetMatchStatus, UiDeps } from '../../core/api';
import type { World } from '../../core/types';
import { button, el, glyph } from '../dom';
import { MAX_CHAT, pingTone } from '../net/util';
import { textInput } from '../widgets';
import type { Feed } from './feed';

export interface NetHud {
  /** Goes into the top bar. */
  chips: HTMLElement;
  /** Overlay elements, appended to the HUD root by the caller. */
  els: HTMLElement[];
  update(world: World, now: number): void;
  /** A terminal state (desync / host lost) is on screen — the game UI must ignore input. */
  readonly blocking: boolean;
  readonly chatOpen: boolean;
  openChat(): void;
  closeChat(): void;
  destroy(): void;
}

export interface NetHudHooks {
  deps: UiDeps;
  hud: HTMLElement;
  feed: Feed;
  /** Ask "leave = surrender?" (the pause menu's confirm page). */
  confirmLeave(): void;
  /** Called when a modal net state appears, so the game UI can drop drags / close menus. */
  onBlock(): void;
}

const WAIT_DELAY_MS = 600;

export function createNetHud(h: NetHudHooks): NetHud {
  const { deps, hud, feed } = h;
  const match = deps.net!;
  const me = deps.viewer;
  const click = () => deps.audio.playUi('click');
  const offs: (() => void)[] = [];

  // ── top-bar chips ──
  const chips = el('div', 'cf-net-chips');
  chips.title = '區網玩家 · 延遲';
  let chipsKey = '';
  let chipPings: { player: number; el: HTMLElement }[] = [];
  let pingAt = 0;

  // ── waiting card (non-modal: the player can still look around or open the menu) ──
  const wait = el('div', 'cf-netwait cf-glass');
  wait.style.display = 'none';
  const waitHead = el('div', 'cf-netwait-head');
  const waitTitle = el('div', 'cf-card-title');
  waitTitle.append(el('b', '', '等待玩家'), el('small', '', 'Waiting'));
  waitHead.append(el('span', 'cf-spinner'), waitTitle);
  const waitText = el('p', 'cf-lan-note', '對戰暫時停止,等待以下玩家的連線恢復:');
  const waitNames = el('div', 'cf-netwait-names');
  const waitActions = el('div', 'cf-card-actions');
  waitActions.append(
    button('cf-btn', '<span>離開對戰</span>', () => {
      click();
      h.confirmLeave();
    }),
  );
  wait.append(waitHead, waitText, waitNames, waitActions);
  let waitSince = -1;
  let waitKey = '';

  // ── terminal dialog ──
  const block = el('div', 'cf-overlay cf-netblock');
  block.style.display = 'none';
  block.addEventListener('contextmenu', (e) => e.preventDefault());
  const blockCard = el('div', 'cf-card cf-glass');
  block.append(blockCard);
  let blockState: NetMatchStatus['state'] | '' = '';

  // ── spectating banner ──
  const spec = el('div', 'cf-spectate cf-glass');
  spec.style.display = 'none';
  spec.append(
    el('b', '', '已戰敗 — 觀戰中'),
    el('small', '', 'Defeated · spectating'),
    button('cf-btn', '<span>離開</span>', () => {
      click();
      deps.quitToMenu();
    }),
  );
  let specShown = false;

  // ── chat bar ──
  const chatBar = el('div', 'cf-chatbar cf-glass');
  chatBar.style.display = 'none';
  let chatOpen = false;
  const chatIn = textInput('', { placeholder: '對所有玩家說…', maxLength: MAX_CHAT });
  chatIn.addEventListener('keydown', (e) => {
    // keep every key away from the game's hotkeys while typing
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = chatIn.value.trim();
      if (text && deps.netApi) {
        deps.netApi.chat(text);
        deps.audio.playUi('tab');
      }
      api.closeChat();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.closeChat();
    }
  });
  chatIn.addEventListener('keyup', (e) => e.stopPropagation());
  // clicking back into the battlefield closes an empty chat; a half-typed message stays (Enter refocuses it)
  chatIn.addEventListener('blur', () => {
    if (chatOpen && !chatIn.value.trim() && document.hasFocus()) api.closeChat();
  });
  const chatIc = el('span', 'cf-toast-ic');
  chatIc.innerHTML = glyph('chat', 15);
  chatBar.append(chatIc, chatIn, el('small', '', 'Enter 送出 · Esc 取消'));

  // ── chat / notices → feed ──
  let chatN = 0;
  if (deps.netApi) {
    offs.push(
      deps.netApi.on((e) => {
        if (e.type === 'chat') feed.push(e.text, 'chat', { key: 'chat' + chatN++, from: { name: e.from, color: e.color } });
        else if (e.type === 'notice') feed.push(e.text, 'info', { key: 'notice' + chatN++ });
        else if (e.type === 'error') feed.push(e.text, 'bad', { key: 'neterr' + chatN++ });
      }),
    );
  }

  function paintChips(st: NetMatchStatus, world: World, now: number): void {
    const others = st.players.filter((p) => p.controller === 'human' && p.player !== me);
    const key = others.map((p) => `${p.player}:${p.name}:${p.connected}:${world.players[p.player]?.color ?? ''}:${world.players[p.player]?.defeated ? 1 : 0}`).join('|');
    if (key !== chipsKey) {
      chipsKey = key;
      chips.replaceChildren();
      chipPings = [];
      for (const p of others) {
        const c = el('div', 'cf-net-chip' + (p.connected ? '' : ' is-off'));
        const dot = el('i');
        dot.style.setProperty('--c', world.players[p.player]?.color ?? '#9aa3ab');
        const ms = el('small', 'cf-ms');
        c.append(dot, el('span', '', p.name), ms);
        c.title = `${p.name}${p.connected ? '' : '(已離線)'}${world.players[p.player]?.defeated ? '・已戰敗' : ''}`;
        chips.append(c);
        chipPings.push({ player: p.player, el: ms });
      }
      pingAt = 0;
    }
    if (now - pingAt < 500) return;
    pingAt = now;
    for (const cp of chipPings) {
      const p = st.players.find((x) => x.player === cp.player);
      if (!p) continue;
      const txt = p.connected ? `${Math.round(p.pingMs)}` : '離線';
      if (cp.el.textContent !== txt) cp.el.textContent = txt;
      const cls = 'cf-ms is-' + (p.connected ? pingTone(p.pingMs) : 'bad');
      if (cp.el.className !== cls) cp.el.className = cls;
    }
  }

  function showBlock(state: 'desync' | 'hostLost'): void {
    blockState = state;
    blockCard.replaceChildren();
    const head = el('div', 'cf-card-head');
    const t = el('div', 'cf-card-title');
    if (state === 'desync') t.append(el('b', '', '戰局不同步'), el('small', '', 'Desync'));
    else t.append(el('b', '', '主機已離線'), el('small', '', 'Host lost'));
    const ic = el('span', 'cf-alert-ic');
    ic.innerHTML = glyph('alert', 20);
    head.append(ic, t);
    const text = el(
      'p',
      'cf-card-text',
      state === 'desync' ? '戰局不同步,對戰無法繼續。各玩家電腦上的戰況已不一致,這通常是版本或連線問題造成的。' : '主機已離線,對戰無法繼續。',
    );
    const actions = el('div', 'cf-card-actions');
    actions.append(
      button('cf-btn is-primary', '<span>離開</span><small>Leave</small>', () => {
        click();
        deps.quitToMenu();
      }),
    );
    blockCard.append(head, text, actions);
    block.style.display = '';
    deps.audio.playUi('error');
  }

  const api: NetHud = {
    chips,
    els: [spec, wait, chatBar, block],
    get blocking() {
      return blockState !== '';
    },
    get chatOpen() {
      return chatOpen;
    },
    update(world, now) {
      let st: NetMatchStatus;
      try {
        st = match.status;
      } catch {
        return;
      }
      paintChips(st, world, now);

      // terminal states
      if ((st.state === 'desync' || st.state === 'hostLost') && blockState !== st.state) {
        api.closeChat();
        h.onBlock();
        showBlock(st.state);
      }

      // waiting for players (after a short grace so one late packet does not flash the card)
      if (st.state === 'waiting') {
        if (waitSince < 0) waitSince = now;
        if (now - waitSince >= WAIT_DELAY_MS) {
          const key = st.waitingFor.join('\u0000');
          if (key !== waitKey) {
            waitKey = key;
            waitNames.replaceChildren(...(st.waitingFor.length ? st.waitingFor : ['…']).map((n) => el('span', 'cf-chip', n)));
          }
          if (wait.style.display === 'none') wait.style.display = '';
        }
      } else {
        waitSince = -1;
        if (wait.style.display !== 'none') wait.style.display = 'none';
      }

      // defeated but the match goes on → spectate
      const p = world.players[me];
      const showSpec = !!p?.defeated && world.winnerTeam === null && !blockState && st.state !== 'ended';
      if (showSpec !== specShown) {
        specShown = showSpec;
        spec.style.display = showSpec ? '' : 'none';
      }
    },
    openChat() {
      if (blockState || !deps.netApi) return;
      if (chatOpen) {
        chatIn.focus();
        return;
      }
      chatOpen = true;
      chatBar.style.display = '';
      hud.classList.add('is-chatting');
      chatIn.value = '';
      chatIn.focus();
    },
    closeChat() {
      if (!chatOpen) return;
      chatOpen = false;
      chatBar.style.display = 'none';
      hud.classList.remove('is-chatting');
      chatIn.blur();
    },
    destroy() {
      for (const off of offs) off();
      offs.length = 0;
    },
  };
  return api;
}
