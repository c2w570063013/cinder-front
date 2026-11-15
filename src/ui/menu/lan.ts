// LAN multiplayer screens inside the main menu: room browser (phase idle / browsing / connecting) and the room
// lobby (phase lobby). Driven entirely by net.subscribe / net.on — the menu never starts a match itself: the host's
// 開始戰鬥 calls net.startMatch() and main.ts reacts to 'matchStart'.
import type { AudioApi, MapInfo, NetApi, NetEvent, NetRoom, NetRoomAd, NetSlot, NetState } from '../../core/api';
import type { Difficulty, FactionId, GameMap } from '../../core/types';
import { FACTIONS } from '../../data';
import { button, el, glyph, safeDpr } from '../dom';
import {
  ALL_COLORS,
  cleanName,
  defaultPlayerName,
  FACTION_IDS,
  freeColor,
  freeTeam,
  joinBlocker,
  localSeat,
  MAX_CHAT,
  MAX_NAME,
  MAX_ROOM_NAME,
  pingTone,
  rulesKey,
  seatsKey,
  startBlocker,
  usedColors,
  type SeatHuman,
} from '../net/util';
import { loadJson, saveJson } from '../settings';
import { row, segmented, selectBox, textInput, toggle } from '../widgets';
import { drawMapPreview, renderMapBase } from './thumb';

export interface LanCtx {
  net: NetApi;
  audio: AudioApi;
  maps: MapInfo[];
  mount(name: 'lan' | 'room', node: HTMLElement, dispose?: () => void): void;
  pageHead(title: string, sub: string, onBack: () => void): HTMLElement;
  setAccent(color: string): void;
  showTitle(): void;
}

export interface Lan {
  /** Enter the LAN screens (browser, or the room lobby when already in one). */
  open(): void;
  /** Esc on the browser: back to the title. */
  back(): void;
  /** The menu was hidden (match started) — drop listeners, keep the net session as it is. */
  detach(): void;
  readonly screen: 'lan' | 'room' | null;
}

interface Prefs {
  name: string;
  roomName: string;
}
const PREFS_KEY = 'cinderfront.ui.net.v1';
const DIFF_ZH: Record<Difficulty, string> = { easy: '簡單', normal: '普通', hard: '困難' };
const TEAM_OPTS = [1, 2, 3, 4].map((t) => ({ value: String(t), label: `隊伍 ${t}` }));
const FACTION_OPTS: { value: FactionId | 'random'; label: string }[] = [{ value: 'random', label: '隨機陣營' }, ...FACTION_IDS.map((f) => ({ value: f, label: FACTIONS[f].name }))];
type SeatChoice = 'open' | 'closed' | 'ai-easy' | 'ai-normal' | 'ai-hard';
const SEAT_OPTS: { value: SeatChoice; label: string }[] = [
  { value: 'open', label: '開放席位' },
  { value: 'closed', label: '關閉席位' },
  { value: 'ai-easy', label: '電腦・簡單' },
  { value: 'ai-normal', label: '電腦・普通' },
  { value: 'ai-hard', label: '電腦・困難' },
];
const CHAT_MAX_LINES = 200;

function loadPrefs(): Prefs {
  const p = loadJson<Prefs>(PREFS_KEY);
  const name = cleanName(typeof p?.name === 'string' ? p.name : '') || defaultPlayerName(Math.random);
  const roomName = cleanName(typeof p?.roomName === 'string' ? p.roomName : '', MAX_ROOM_NAME);
  const prefs = { name, roomName };
  saveJson(PREFS_KEY, prefs);
  return prefs;
}

interface ChatLine {
  kind: 'chat' | 'notice' | 'error';
  from?: string;
  color?: string;
  text: string;
}

export function createLan(ctx: LanCtx): Lan {
  const { net, audio, maps } = ctx;
  const click = () => audio.playUi('click');
  const prefs = loadPrefs();
  const savePrefs = () => saveJson(PREFS_KEY, prefs);

  let screen: 'lan' | 'room' | null = null;
  let offState: (() => void) | null = null;
  let offEvents: (() => void) | null = null;
  /** Current screen's reactions. */
  let onState: ((s: NetState) => void) | null = null;
  let onEvent: ((e: NetEvent) => void) | null = null;
  /** An error that arrived while not on the browser (e.g. kicked) — shown when the browser opens. */
  let pendingError = '';
  let chatLog: ChatLine[] = [];

  function attach(): void {
    if (!offState) offState = net.subscribe((s) => route(s));
    if (!offEvents) offEvents = net.on((e) => event(e));
  }
  function detach(): void {
    offState?.();
    offEvents?.();
    offState = offEvents = null;
    onState = onEvent = null;
    if (net.getState().phase === 'browsing') {
      try {
        net.stopBrowse();
      } catch {
        /* ignore */
      }
    }
    screen = null;
  }

  function route(s: NetState): void {
    if (!screen) return;
    if (s.phase === 'lobby' && s.room) {
      if (screen !== 'room') showRoom(s);
      else onState?.(s);
      return;
    }
    if (screen === 'room') {
      // match: main.ts hides the menu; anything else means we are out of the room
      if (s.phase !== 'match') showBrowser();
      return;
    }
    onState?.(s);
  }

  function event(e: NetEvent): void {
    if (!screen) return;
    if (e.type === 'error') {
      audio.playUi('error');
      if (screen === 'room') {
        pushChat({ kind: 'error', text: e.text });
        pendingError = e.text;
      } else pendingError = e.text;
    } else if (e.type === 'chat') pushChat({ kind: 'chat', from: e.from, color: e.color, text: e.text });
    else if (e.type === 'notice') pushChat({ kind: 'notice', text: e.text });
    onEvent?.(e);
  }
  function pushChat(line: ChatLine): void {
    chatLog.push(line);
    if (chatLog.length > CHAT_MAX_LINES) chatLog.splice(0, chatLog.length - CHAT_MAX_LINES);
  }

  // ───────────────────────── room browser ─────────────────────────
  function showBrowser(): void {
    screen = 'lan';
    ctx.setAccent('#ff8a2a');
    const s = el('div', 'cf-screen cf-page');
    const leaveToTitle = () => {
      detach();
      ctx.showTitle();
    };

    const alertBox = el('div', 'cf-alert');
    alertBox.hidden = true;
    const alertText = el('span');
    const alertX = button('cf-icon-btn', glyph('close', 14), () => {
      click();
      pendingError = '';
      alertBox.hidden = true;
    });
    alertX.title = '關閉';
    alertBox.append(el('span', 'cf-alert-ic', ''), alertText, alertX);
    (alertBox.firstElementChild as HTMLElement).innerHTML = glyph('alert', 16);
    function showError(text: string): void {
      alertText.textContent = text;
      alertBox.hidden = !text;
    }

    // ── left: identity + host ──
    const colMe = el('div', 'cf-glass cf-col');
    const meTitle = el('div', 'cf-col-title');
    meTitle.append(el('span', '', '指揮官名稱'), el('small', '', 'Your name'));
    const nameIn = textInput(prefs.name, {
      placeholder: '輸入你的名稱',
      maxLength: MAX_NAME,
      onInput: (v) => {
        const c = cleanName(v);
        if (c) {
          prefs.name = c;
          savePrefs();
        }
        paintButtons();
      },
    });
    nameIn.addEventListener('blur', () => {
      nameIn.value = cleanName(nameIn.value) || prefs.name;
      paintButtons();
    });
    const hostTitle = el('div', 'cf-col-title');
    hostTitle.append(el('span', '', '建立房間'), el('small', '', 'Host a room'));
    const roomIn = textInput(prefs.roomName, {
      placeholder: `${prefs.name} 的房間`,
      maxLength: MAX_ROOM_NAME,
      onInput: (v) => {
        prefs.roomName = cleanName(v, MAX_ROOM_NAME);
        savePrefs();
      },
      onEnter: () => doHost(),
    });
    const hostBtn = button('cf-btn is-primary cf-lan-host', `${glyph('flag', 16)}<span>建立房間</span><small>Host</small>`, () => {
      click();
      doHost();
    });
    const transportNote = el(
      'p',
      'cf-lan-note',
      net.transport === 'loopback'
        ? '本機測試模式:同一瀏覽器的其他分頁會出現在右側清單。'
        : '同一個區域網路(Wi-Fi 或有線網路)上的玩家會自動出現在右側清單。首次使用時 macOS 可能會詢問是否允許存取區域網路。',
    );
    const chip = el('span', 'cf-chip', net.transport === 'loopback' ? '本機回送 Loopback' : '區域網路 Bonjour');
    colMe.append(meTitle, nameIn, hostTitle, roomIn, hostBtn, el('div', 'cf-lan-spacer'), chip, transportNote);

    // ── right: room list ──
    const colRooms = el('div', 'cf-glass cf-col');
    const roomsTitle = el('div', 'cf-col-title');
    const scan = el('span', 'cf-scan', '搜尋中');
    roomsTitle.append(el('span', '', '區域網路上的房間'), el('small', '', 'Rooms'), scan);
    const list = el('div', 'cf-col-scroll cf-room-list');
    colRooms.append(roomsTitle, list);

    const grid = el('div', 'cf-lan');
    grid.append(colMe, colRooms);

    // ── connecting overlay ──
    const conn = el('div', 'cf-overlay cf-lan-conn');
    conn.style.display = 'none';
    const connCard = el('div', 'cf-card cf-glass');
    const connText = el('p', 'cf-card-text', '正在連線…');
    const connActions = el('div', 'cf-card-actions');
    connActions.append(
      button('cf-btn', '取消', () => {
        click();
        net.leave();
      }),
    );
    const connHead = el('div', 'cf-card-head');
    const connTitle = el('div', 'cf-card-title');
    connTitle.append(el('b', '', '連線中'), el('small', '', 'Connecting'));
    connHead.append(el('span', 'cf-spinner'), connTitle);
    connCard.append(connHead, connText, connActions);
    conn.append(connCard);

    s.append(ctx.pageHead('區域網路對戰', 'LAN multiplayer', () => leaveToTitle()), alertBox, grid, conn);

    let listKey = '';
    let connectingTo = '';
    function myName(): string {
      return cleanName(nameIn.value) || prefs.name;
    }
    function paintButtons(): void {
      hostBtn.disabled = !cleanName(nameIn.value);
      roomIn.placeholder = `${myName()} 的房間`;
      for (const b of list.querySelectorAll<HTMLButtonElement>('button[data-room]')) b.disabled = b.dataset.blocked === '1' || !cleanName(nameIn.value);
    }
    function doHost(): void {
      const name = myName();
      if (!cleanName(nameIn.value)) {
        showError('請先輸入你的名稱');
        nameIn.focus();
        return;
      }
      prefs.name = name;
      savePrefs();
      connectingTo = '建立房間';
      pendingError = '';
      showError('');
      net.host(name, prefs.roomName || `${name} 的房間`);
    }
    function doJoin(ad: NetRoomAd): void {
      const name = myName();
      if (!cleanName(nameIn.value)) {
        showError('請先輸入你的名稱');
        nameIn.focus();
        return;
      }
      prefs.name = name;
      savePrefs();
      connectingTo = ad.name;
      pendingError = '';
      showError('');
      net.join(ad.id, name);
    }

    function paintRooms(rooms: NetRoomAd[], phase: NetState['phase']): void {
      const key = JSON.stringify(rooms) + phase;
      if (key === listKey) return;
      listKey = key;
      scan.style.visibility = phase === 'browsing' ? 'visible' : 'hidden';
      list.replaceChildren();
      if (!rooms.length) {
        const empty = el('div', 'cf-grid-empty');
        empty.append(
          el('b', '', phase === 'browsing' ? '正在搜尋區域網路上的房間…' : '目前沒有搜尋房間'),
          el('span', '', phase === 'browsing' ? '找不到房間?你也可以在左側建立一個。' : '回到此畫面時會自動重新搜尋。'),
        );
        list.append(empty);
        return;
      }
      for (const ad of rooms) {
        const blocker = joinBlocker(ad);
        const item = el('div', 'cf-room-item' + (blocker ? ' is-blocked' : ''));
        const main = el('div', 'cf-room-main');
        const nameRow = el('div', 'cf-room-name');
        nameRow.append(el('b', '', ad.name));
        if (!ad.compatible) nameRow.append(el('span', 'cf-badge is-bad', '不相容版本'));
        if (ad.inMatch) nameRow.append(el('span', 'cf-badge is-warn', '對戰中'));
        main.append(nameRow, el('span', 'cf-room-sub', `房主 ${ad.hostName} · ${ad.mapName || '—'}`));
        const count = el('span', 'cf-room-count' + (ad.players >= ad.maxPlayers ? ' is-full' : ''), `${ad.players} / ${ad.maxPlayers}`);
        count.title = '玩家人數';
        const join = button('cf-btn cf-room-join', '<span>加入</span>', () => {
          click();
          doJoin(ad);
        });
        join.dataset.room = ad.id;
        join.dataset.blocked = blocker ? '1' : '0';
        if (blocker) join.title = blocker;
        item.append(main, count, join);
        item.addEventListener('dblclick', () => {
          if (!blocker && cleanName(nameIn.value)) {
            click();
            doJoin(ad);
          }
        });
        list.append(item);
      }
      paintButtons();
    }

    function paint(st: NetState): void {
      paintRooms(st.rooms, st.phase);
      const connecting = st.phase === 'connecting';
      conn.style.display = connecting ? '' : 'none';
      connText.textContent = connectingTo === '建立房間' ? '正在建立房間…' : `正在連線到「${connectingTo || '房間'}」…`;
      if (!connecting && (st.phase === 'idle' || st.phase === 'browsing') && pendingError) {
        showError(pendingError);
      }
      // dropped back to idle (failed join, cancelled): keep looking
      if (st.phase === 'idle') queueMicrotask(() => net.getState().phase === 'idle' && screen === 'lan' && net.browse());
    }

    onState = paint;
    onEvent = (e) => {
      if (e.type === 'error') showError(e.text);
    };
    ctx.mount('lan', s, () => undefined);
    if (pendingError) showError(pendingError);
    attach();
    const st = net.getState();
    if (st.phase === 'idle' || st.phase === 'browsing') net.browse();
    paint(net.getState());
    paintButtons();
  }

  // ───────────────────────── room lobby ─────────────────────────
  function showRoom(initial: NetState): void {
    screen = 'room';
    chatLog = chatLog.filter((l) => l.kind !== 'error').slice(-40);
    pendingError = '';
    const s = el('div', 'cf-screen cf-page');
    const leave = () => {
      click();
      net.leave();
    };
    const head = ctx.pageHead(initial.room!.name, '', leave);
    const headSub = head.querySelector('small')!;
    const headTitle = head.querySelector('h2')!;

    // ── seats ──
    const colSeats = el('div', 'cf-glass cf-col cf-room-seats');
    const seatsTitle = el('div', 'cf-col-title');
    const seatsCount = el('small');
    seatsTitle.append(el('span', '', '玩家席位'), el('small', '', 'Seats'), seatsCount);
    const seatList = el('div', 'cf-col-scroll cf-seat-list');
    colSeats.append(seatsTitle, seatList);

    // ── chat ──
    const colChat = el('div', 'cf-glass cf-col cf-room-chat');
    const chatTitle = el('div', 'cf-col-title');
    chatTitle.append(el('span', '', '聊天'), el('small', '', 'Chat'));
    const logEl = el('div', 'cf-col-scroll cf-chat-log');
    const chatIn = textInput('', {
      placeholder: '輸入訊息,按 Enter 送出',
      maxLength: MAX_CHAT,
      onEnter: (v) => sendChat(v),
    });
    const sendBtn = button('cf-btn cf-chat-send', '<span>送出</span>', () => sendChat(chatIn.value));
    const chatRow = el('div', 'cf-chat-row');
    chatRow.append(chatIn, sendBtn);
    colChat.append(chatTitle, logEl, chatRow);

    // ── map ──
    const colMap = el('div', 'cf-glass cf-col cf-room-map');
    const prevBox = el('div', 'cf-preview');
    const prevCanvas = el('canvas');
    prevCanvas.style.cursor = 'default';
    prevBox.append(prevCanvas);
    const mapInfo = el('div', 'cf-preview-info');
    colMap.append(prevBox, mapInfo);

    // ── rules ──
    const colRules = el('div', 'cf-glass cf-col cf-room-rules');
    const rulesTitle = el('div', 'cf-col-title');
    rulesTitle.append(el('span', '', '規則'), el('small', '', 'Rules'));
    const rulesBody = el('div', 'cf-form');
    colRules.append(rulesTitle, rulesBody);

    const grid = el('div', 'cf-room');
    grid.append(colSeats, colMap, colChat, colRules);

    // ── footer ──
    const note = el('p', 'cf-page-note');
    const leaveBtn = button('cf-btn', '<span>離開房間</span>', leave);
    const mainBtn = button('cf-btn is-primary', '', () => {
      const room = net.getState().room;
      if (!room) return;
      click();
      if (room.isHost) net.startMatch();
      else {
        const meSeat = localSeat(room);
        if (meSeat) net.setMe({ ready: !meSeat.slot.ready });
      }
    });
    const foot = el('div', 'cf-page-foot');
    foot.append(note, leaveBtn, mainBtn);

    // ── colour popover ──
    const pop = el('div', 'cf-colorpop cf-glass');
    pop.hidden = true;
    let popFor = -1;
    function openColors(anchor: HTMLElement, index: number, onPick: (c: string) => void): void {
      const room = net.getState().room;
      if (!room) return;
      if (!pop.hidden && popFor === index) {
        closeColors();
        return;
      }
      popFor = index;
      const used = usedColors(room.slots, index);
      const current = (room.slots[index] as { color?: string }).color;
      pop.replaceChildren();
      for (const c of ALL_COLORS) {
        const b = el('button', 'cf-swatch' + (c === current ? ' is-on' : ''));
        b.type = 'button';
        b.style.setProperty('--c', c);
        b.disabled = used.has(c);
        b.title = used.has(c) ? '已被使用' : c;
        b.addEventListener('click', () => {
          click();
          closeColors();
          onPick(c);
        });
        pop.append(b);
      }
      const r = anchor.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      pop.hidden = false;
      const pw = pop.offsetWidth;
      pop.style.left = `${Math.max(8, Math.min(sr.width - pw - 8, r.right - sr.left - pw))}px`;
      pop.style.top = `${r.bottom - sr.top + 6}px`;
    }
    function closeColors(): void {
      pop.hidden = true;
      popFor = -1;
    }
    s.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!pop.hidden && !pop.contains(t) && !t.closest('.cf-colorbtn')) closeColors();
    });

    s.append(head, grid, foot, pop);

    // ── painting ──
    let seatKeyNow = '';
    let rulesKeyNow = '';
    let mapKeyNow = '';
    let pingEls: (HTMLElement | null)[] = [];
    let map: GameMap | null = null;
    let base: HTMLCanvasElement | null = null;
    let chatShown = 0;

    function sendChat(v: string): void {
      const text = v.trim().slice(0, MAX_CHAT);
      if (!text) return;
      net.chat(text);
      chatIn.value = '';
      audio.playUi('tab');
    }

    function paintChat(): void {
      if (chatShown === chatLog.length && logEl.childElementCount === chatLog.length) return;
      const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 24;
      if (chatShown > chatLog.length || logEl.childElementCount !== chatShown) {
        logEl.replaceChildren();
        chatShown = 0;
      }
      for (const l of chatLog.slice(chatShown)) {
        const line = el('div', 'cf-chat-line is-' + l.kind);
        if (l.kind === 'chat') {
          const who = el('b', '', l.from ?? '');
          who.style.color = l.color ?? '';
          line.append(who, el('span', '', l.text));
        } else line.append(el('span', '', l.text));
        logEl.append(line);
      }
      chatShown = chatLog.length;
      while (logEl.childElementCount > CHAT_MAX_LINES) {
        logEl.firstElementChild?.remove();
        chatShown = Math.min(chatShown, chatLog.length);
      }
      if (atBottom) logEl.scrollTop = logEl.scrollHeight;
    }

    function seatName(room: NetRoom, slot: NetSlot, i: number): HTMLElement {
      const box = el('div', 'cf-seat-name');
      if (slot.kind === 'human') {
        const n = el('b', '', slot.name);
        box.append(n);
        if (slot.isHost) box.append(el('span', 'cf-badge', '房主'));
        if (slot.isLocal) box.append(el('span', 'cf-badge is-me', '你'));
        return box;
      }
      if (room.isHost) {
        const cur: SeatChoice = slot.kind === 'ai' ? (`ai-${slot.difficulty}` as SeatChoice) : slot.kind;
        const sel = selectBox<SeatChoice>(SEAT_OPTS, cur, (v) => {
          if (v === 'open' || v === 'closed') net.setSlot(i, { kind: v });
          else {
            const difficulty = v.slice(3) as Difficulty;
            if (slot.kind === 'ai') net.setSlot(i, { ...slot, difficulty });
            else net.setSlot(i, { kind: 'ai', faction: 'random', difficulty, team: freeTeam(room.slots), color: freeColor(room.slots, i, 'random') });
          }
        }, click);
        sel.title = '席位設定';
        box.append(sel);
        return box;
      }
      if (slot.kind === 'ai') box.append(el('b', '', '電腦'), el('span', 'cf-badge', DIFF_ZH[slot.difficulty]));
      else box.append(el('span', 'cf-dim', slot.kind === 'open' ? '開放席位' : '已關閉'));
      return box;
    }

    function paintSeats(room: NetRoom): void {
      const key = seatsKey(room);
      if (key !== seatKeyNow) {
        seatKeyNow = key;
        // keep an open colour picker open across the rebuild (other players change seats all the time)
        const reopen = popFor;
        closeColors();
        seatList.replaceChildren();
        pingEls = [];
        const colorBtns: HTMLButtonElement[] = [];
        room.slots.forEach((slot, i) => {
          const r = el('div', 'cf-seat is-' + slot.kind + (slot.kind === 'human' && slot.isLocal ? ' is-local' : ''));
          const occupied = slot.kind === 'human' || slot.kind === 'ai';
          const mine = slot.kind === 'human' && slot.isLocal;
          const hostEditsAi = slot.kind === 'ai' && room.isHost;
          const editable = mine || hostEditsAi;
          const idx = el('span', 'cf-seat-n', String(i + 1));
          r.append(idx, seatName(room, slot, i));
          if (occupied) {
            const sl = slot as SeatHuman | Extract<NetSlot, { kind: 'ai' }>;
            const apply = (patch: { faction?: FactionId | 'random'; color?: string; team?: number }) => {
              if (mine) net.setMe(patch);
              else if (slot.kind === 'ai') net.setSlot(i, { ...slot, ...patch });
            };
            // faction
            if (editable) {
              const f = selectBox<FactionId | 'random'>(FACTION_OPTS, sl.faction, (v) => apply({ faction: v }), click);
              f.title = '陣營';
              r.append(f);
            } else r.append(el('span', 'cf-seat-txt', sl.faction === 'random' ? '隨機陣營' : FACTIONS[sl.faction].name));
            // team
            if (editable) {
              const t = selectBox<string>(TEAM_OPTS, String(sl.team), (v) => apply({ team: Number(v) }), click);
              t.title = '隊伍';
              r.append(t);
            } else r.append(el('span', 'cf-seat-txt', `隊伍 ${sl.team}`));
            // colour
            const cb = el('button', 'cf-colorbtn');
            cb.type = 'button';
            cb.style.setProperty('--c', sl.color);
            cb.disabled = !editable;
            cb.title = editable ? '變更代表色' : '代表色';
            if (editable) {
              cb.addEventListener('click', () => openColors(cb, i, (c) => apply({ color: c })));
              colorBtns[i] = cb;
            }
            r.append(cb);
            // status
            const st = el('div', 'cf-seat-st');
            if (slot.kind === 'human') {
              if (slot.isHost) st.append(el('span', 'cf-tag is-host', '房主'));
              else st.append(el('span', 'cf-tag ' + (slot.ready ? 'is-ready' : 'is-wait'), slot.ready ? '就緒' : '未就緒'));
              const p = el('small', 'cf-ms');
              st.append(p);
              pingEls[i] = p;
            } else st.append(el('span', 'cf-tag is-ai', '電腦'));
            r.append(st);
          } else {
            r.append(el('span', 'cf-seat-txt'), el('span', 'cf-seat-txt'), el('span'), el('span'));
          }
          // action
          if (room.isHost && slot.kind === 'human' && !slot.isLocal) {
            const kick = button('cf-icon-btn cf-seat-x', glyph('close', 13), () => {
              click();
              net.setSlot(i, { kind: 'open' });
            });
            kick.title = `將 ${slot.name} 移出房間`;
            r.append(kick);
          } else r.append(el('span'));
          seatList.append(r);
        });
        const occ = room.slots.filter((x) => x.kind === 'human' || x.kind === 'ai').length;
        seatsCount.textContent = `${occ} / ${room.slots.filter((x) => x.kind !== 'closed').length}`;
        const meSeat = localSeat(room);
        if (meSeat) ctx.setAccent(meSeat.slot.color);
        if (reopen >= 0 && colorBtns[reopen]?.isConnected) colorBtns[reopen].click();
      }
      // pings change often — update in place
      room.slots.forEach((slot, i) => {
        const p = pingEls[i];
        if (!p || slot.kind !== 'human') return;
        const txt = slot.isLocal && !room.isHost ? `${slot.pingMs} ms` : slot.isLocal ? '本機' : `${slot.pingMs} ms`;
        if (p.textContent !== txt) p.textContent = txt;
        const tone = slot.isLocal && room.isHost ? 'good' : pingTone(slot.pingMs);
        p.className = 'cf-ms is-' + tone;
      });
    }

    function paintMap(room: NetRoom): void {
      const info = maps.find((m) => m.id === room.mapId) ?? null;
      const key = room.mapId + ':' + room.seed;
      if (key !== mapKeyNow) {
        mapKeyNow = key;
        try {
          map = info ? info.generate(room.seed) : null;
          base = map ? renderMapBase(map) : null;
        } catch (err) {
          console.error('[ui] map preview failed', err);
          map = base = null;
        }
      }
      if (key + '|' + room.isHost !== mapInfo.dataset.key) {
        mapInfo.dataset.key = key + '|' + room.isHost;
        mapInfo.replaceChildren();
        const nameRow = el('div', 'cf-preview-name');
        if (room.isHost && maps.length) {
          const sel = selectBox<string>(
            maps.map((m) => ({ value: m.id, label: `${m.name}(最多 ${m.maxPlayers} 人)` })),
            room.mapId,
            (v) => net.setRoom({ mapId: v, seed: randomSeed() }),
            click,
          );
          sel.className = 'cf-select cf-map-select';
          sel.title = '選擇地圖';
          nameRow.append(sel);
          const reroll = button('cf-icon-btn', glyph('dice', 16), () => {
            click();
            net.setRoom({ seed: randomSeed() });
          });
          reroll.title = '重新生成地形 Reroll';
          nameRow.append(reroll);
        } else nameRow.append(el('b', '', info?.name ?? room.mapId));
        const chips = el('div', 'cf-chips');
        if (info) chips.append(el('span', 'cf-chip', `${info.width} × ${info.height}`), el('span', 'cf-chip', `最多 ${info.maxPlayers} 名玩家`));
        chips.append(el('span', 'cf-chip', `地形種子 ${(room.seed >>> 0).toString(36).toUpperCase()}`));
        if (!info) chips.append(el('span', 'cf-chip is-bad', '本機沒有這張地圖'));
        mapInfo.append(nameRow, el('p', 'cf-preview-desc', info?.desc ?? ''), chips);
      }
      paintPreview();
    }
    function paintPreview(): void {
      if (!map || !base) {
        const c = prevCanvas.getContext('2d');
        c?.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
        return;
      }
      drawMapPreview(
        prevCanvas,
        map,
        base,
        map.starts.map((_, i) => ({ color: null, label: String(i + 1), highlight: false })),
        safeDpr(),
      );
    }

    function paintRules(room: NetRoom): void {
      const key = rulesKey(room);
      if (key === rulesKeyNow) return;
      rulesKeyNow = key;
      const ro = !room.isHost;
      const credits = segmented(
        [
          { value: 5000, label: '5,000' },
          { value: 10000, label: '10,000' },
          { value: 20000, label: '20,000' },
        ],
        room.startingCredits,
        (v) => net.setRoom({ startingCredits: v }),
        click,
      );
      if (ro) credits.setDisabled(() => true);
      const tg = (v: boolean, k: 'fog' | 'shortGame' | 'superweapons') => {
        const b = toggle(v, (nv) => net.setRoom({ options: { ...room.options, [k]: nv } }), click);
        b.disabled = ro;
        return b;
      };
      rulesBody.replaceChildren(
        row('起始資金', 'Credits', credits.el),
        row('戰爭迷霧', 'Fog of war', tg(room.options.fog, 'fog')),
        row('速戰模式', '建築全毀即戰敗', tg(room.options.shortGame, 'shortGame')),
        row('超級武器', 'Superweapons', tg(room.options.superweapons, 'superweapons')),
      );
      if (ro) rulesBody.append(el('p', 'cf-lan-note', '只有房主可以變更地圖與規則。'));
    }

    function paintFoot(room: NetRoom): void {
      const meSeat = localSeat(room);
      if (room.isHost) {
        mainBtn.innerHTML = '<span>開始戰鬥</span><small>Start</small>';
        mainBtn.disabled = !room.canStart;
        mainBtn.classList.remove('is-ready');
        note.textContent = startBlocker(room);
        note.classList.toggle('is-ok', room.canStart);
        if (room.canStart) note.textContent = '所有玩家已就緒';
      } else {
        const ready = !!meSeat?.slot.ready;
        mainBtn.innerHTML = ready ? '<span>取消準備</span><small>Unready</small>' : '<span>準備就緒</span><small>Ready</small>';
        mainBtn.disabled = !meSeat;
        mainBtn.classList.toggle('is-ready', ready);
        note.textContent = ready ? '已就緒,等待房主開始戰鬥' : '準備好後請按「準備就緒」';
        note.classList.toggle('is-ok', ready);
      }
    }

    function paint(st: NetState): void {
      const room = st.room;
      if (!room) return;
      if (headTitle.textContent !== room.name) headTitle.textContent = room.name;
      const sub = room.isHost ? '房主 · Host' : 'Room lobby';
      if (headSub.textContent !== sub) headSub.textContent = sub;
      paintSeats(room);
      paintMap(room);
      paintRules(room);
      paintFoot(room);
      paintChat();
    }

    onState = paint;
    onEvent = () => paintChat();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintPreview()) : null;
    ctx.mount('room', s, () => ro?.disconnect());
    ro?.observe(prevBox);
    attach();
    paint(initial);
    logEl.scrollTop = logEl.scrollHeight;
  }

  return {
    open() {
      const st = net.getState();
      if (st.phase === 'lobby' && st.room) {
        screen = 'room';
        attach();
        showRoom(st);
      } else showBrowser();
    },
    back() {
      if (screen === 'lan') {
        click();
        detach();
        ctx.showTitle();
      }
    },
    detach,
    get screen() {
      return screen;
    },
  };
}

function randomSeed(): number {
  return (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0xffff)) >>> 0 || 1;
}
