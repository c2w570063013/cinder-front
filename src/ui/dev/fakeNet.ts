// Dev-only stand-in for src/net: a scripted LAN so every LAN screen and in-match overlay can be exercised in one tab.
// Rooms appear / disappear while browsing, joining one room fails with an error, fake humans join the lobby, toggle
// ready and chat, and the NetMatch simply echoes the local commands. `dev` lets a page or test flip states by hand.
import type { MapInfo, NetApi, NetEvent, NetMatch, NetMatchStatus, NetRoom, NetRoomAd, NetSlot, NetState } from '../../core/api';
import { makeRng } from '../../core/rng';
import type { Command, FactionId, GameSetup, PlayerSetup } from '../../core/types';
import { ALL_COLORS, FACTION_IDS, freeColor, isOccupied, type SeatHuman } from '../net/util';

export interface FakeNetDev {
  /** Flip the running match's status. */
  setStatus(state: NetMatchStatus['state'], waitingFor?: string[]): void;
  setDisconnected(player: number, off: boolean): void;
  error(text: string): void;
  notice(text: string): void;
  chatFrom(name: string, text: string, color?: string): void;
  /** Lobby: the host removes us / closes the room → phase idle + error. */
  kicked(): void;
  hostClosed(): void;
  /** Stop the scripted fake players (for tests). */
  quiet(): void;
}

export type FakeNet = NetApi & { dev: FakeNetDev };

interface Timer {
  clear(): void;
}

const AD_BASE: NetRoomAd[] = [
  { id: 'r-fri', name: '週五夜戰', hostName: '鐵砧', mapName: '', players: 2, maxPlayers: 4, compatible: true, inMatch: false },
  { id: 'r-new', name: '新手練習', hostName: '小霧', mapName: '', players: 1, maxPlayers: 2, compatible: true, inMatch: false },
  { id: 'r-old', name: '舊版本房間', hostName: '老陳', mapName: '', players: 1, maxPlayers: 4, compatible: false, inMatch: false },
  { id: 'r-war', name: '鏖戰中', hostName: '赤焰', mapName: '', players: 4, maxPlayers: 4, compatible: true, inMatch: true },
  { id: 'r-fail', name: '連線失敗測試', hostName: '幽靈', mapName: '', players: 1, maxPlayers: 4, compatible: true, inMatch: false },
];
const AD_FLICKER: NetRoomAd = { id: 'r-tmp', name: '臨時房間', hostName: '流星', mapName: '', players: 1, maxPlayers: 2, compatible: true, inMatch: false };

const FAKE_LINES = ['大家好!', '這張地圖我很熟', '我先準備好了', 'gl hf', '等我一下,倒杯水', '這次換我用鐵砧陣營'];

export function createFakeNet(opts: { maps: MapInfo[]; transport?: NetApi['transport']; fast?: boolean }): FakeNet {
  const maps = opts.maps;
  const speed = opts.fast ? 0.01 : 1;
  const listeners = new Set<(s: NetState) => void>();
  const eventListeners = new Set<(e: NetEvent) => void>();
  let state: NetState = { phase: 'idle', rooms: [], room: null, match: null };
  let timers: Timer[] = [];
  let browseTimer: Timer | null = null;
  let browseTick = 0;
  let myName = '指揮官';
  let scripted = true;
  let match: FakeMatch | null = null;

  const later = (ms: number, fn: () => void): Timer => {
    const h = setTimeout(fn, ms * speed);
    const t = { clear: () => clearTimeout(h) };
    timers.push(t);
    return t;
  };
  const every = (ms: number, fn: () => void): Timer => {
    const h = setInterval(fn, ms * speed);
    const t = { clear: () => clearInterval(h) };
    timers.push(t);
    return t;
  };
  const clearTimers = () => {
    for (const t of timers) t.clear();
    timers = [];
    browseTimer = null;
  };

  function set(patch: Partial<NetState>): void {
    state = { ...state, ...patch };
    for (const cb of [...listeners]) cb(state);
  }
  function emit(e: NetEvent): void {
    for (const cb of [...eventListeners]) cb(e);
  }
  function setRoomState(room: NetRoom): void {
    set({ room: { ...room, canStart: computeCanStart(room) } });
  }
  function computeCanStart(room: NetRoom): boolean {
    if (!room.isHost) return false;
    const occ = room.slots.filter(isOccupied);
    if (occ.length < 2 || new Set(occ.map((s) => s.team)).size < 2) return false;
    return occ.every((s) => s.kind !== 'human' || s.ready || s.isHost);
  }
  function mapName(id: string): string {
    return maps.find((m) => m.id === id)?.name ?? id;
  }

  function ads(): NetRoomAd[] {
    const name0 = maps[0]?.name ?? '—';
    const name1 = maps[1]?.name ?? name0;
    const list = AD_BASE.map((a, i) => ({ ...a, mapName: i % 2 ? name1 : name0 }));
    // one room comes and goes, another room's head-count changes
    if (browseTick % 4 >= 2) list.splice(2, 0, { ...AD_FLICKER, mapName: name1 });
    list[0] = { ...list[0], players: 2 + (browseTick % 3 === 0 ? 1 : 0) };
    return browseTick === 0 ? list.slice(0, 2) : list;
  }

  // ── fake humans in the lobby ──
  function human(name: string, color: string, team: number, extra: Partial<SeatHuman> = {}): SeatHuman {
    return { kind: 'human', name, faction: 'random', color, team, ready: false, isHost: false, isLocal: false, pingMs: 20 + Math.round(Math.random() * 30), ...extra };
  }
  function patchSlot(i: number, fn: (s: NetSlot) => NetSlot): void {
    const room = state.room;
    if (!room || !room.slots[i]) return;
    const slots = room.slots.slice();
    slots[i] = fn(slots[i]);
    setRoomState({ ...room, slots });
  }
  function startLobbyScript(): void {
    // pings wobble
    every(1500, () => {
      const room = state.room;
      if (!room) return;
      setRoomState({
        ...room,
        slots: room.slots.map((s) => (s.kind === 'human' && !s.isLocal ? { ...s, pingMs: Math.max(4, Math.round(s.pingMs + (Math.random() - 0.5) * 30)) } : s)),
      });
    });
    if (!scripted) return;
    // other humans toggle ready and chat now and then
    every(3800, () => {
      const room = state.room;
      if (!room || !scripted) return;
      const others = room.slots.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'human' && !x.s.isLocal && !x.s.isHost);
      if (!others.length) return;
      const pick = others[Math.floor(Math.random() * others.length)];
      patchSlot(pick.i, (s) => (s.kind === 'human' ? { ...s, ready: !s.ready } : s));
      if (Math.random() < 0.45) {
        const s = pick.s as SeatHuman;
        emit({ type: 'chat', from: s.name, color: s.color, text: FAKE_LINES[Math.floor(Math.random() * FAKE_LINES.length)] });
      }
    });
  }

  function enterLobby(room: NetRoom): void {
    clearTimers();
    set({ phase: 'lobby', rooms: [], match: null });
    setRoomState(room);
    startLobbyScript();
  }

  function hostRoom(roomName: string): void {
    const info = maps[0];
    const n = Math.max(2, Math.min(8, info?.maxPlayers ?? 2));
    const slots: NetSlot[] = Array.from({ length: n }, () => ({ kind: 'open' }) as NetSlot);
    slots[0] = human(myName, ALL_COLORS[0], 1, { isHost: true, isLocal: true, ready: true, pingMs: 0 });
    enterLobby({
      name: roomName,
      isHost: true,
      mapId: info?.id ?? '',
      seed: 12345,
      startingCredits: 10000,
      options: { fog: true, shortGame: false, superweapons: true },
      slots,
      canStart: false,
    });
    if (!scripted) return;
    later(1600, () => {
      if (state.phase !== 'lobby' || !state.room) return;
      const at = state.room.slots.findIndex((s) => s.kind === 'open');
      if (at < 0) return;
      patchSlot(at, () => human('阿岩', freeColor(state.room!.slots, at, 'ferrum'), 2, { faction: 'ferrum' }));
      emit({ type: 'notice', text: '阿岩 加入了房間' });
    });
  }

  function joinRoom(ad: NetRoomAd): void {
    const info = maps.find((m) => m.name === ad.mapName) ?? maps[0];
    const n = Math.max(2, Math.min(8, info?.maxPlayers ?? 2));
    const slots: NetSlot[] = Array.from({ length: n }, () => ({ kind: 'open' }) as NetSlot);
    slots[0] = human(ad.hostName, '#e5484d', 1, { isHost: true, ready: true, faction: 'ferrum' });
    let me = 1;
    if (n > 2) {
      slots[1] = human('小霧', '#35d6c4', 2, { faction: 'helion', ready: true });
      me = 2;
    }
    slots[me] = human(myName, freeColor(slots, me, 'helion'), 2, { isLocal: true, pingMs: 31 });
    if (n > 3) slots[n - 1] = { kind: 'ai', faction: 'random', color: freeColor(slots, n - 1, 'random'), team: 1, difficulty: 'normal' };
    enterLobby({
      name: ad.name,
      isHost: false,
      mapId: info?.id ?? '',
      seed: 777,
      startingCredits: 10000,
      options: { fog: true, shortGame: false, superweapons: true },
      slots,
      canStart: false,
    });
    emit({ type: 'notice', text: `已加入 ${ad.name}` });
    // the fake host starts once everybody (including us) is ready
    every(1000, () => {
      const room = state.room;
      if (!room || state.phase !== 'lobby' || !scripted) return;
      const all = room.slots.every((s) => s.kind !== 'human' || s.ready);
      if (all) {
        emit({ type: 'notice', text: '房主即將開始戰鬥…' });
        clearTimers();
        later(1800, () => {
          if (state.phase === 'lobby' && state.room) beginMatch(state.room);
        });
      }
    });
  }

  function beginMatch(room: NetRoom): void {
    const info = maps.find((m) => m.id === room.mapId) ?? maps[0];
    if (!info) {
      emit({ type: 'error', text: '找不到地圖,無法開始' });
      return;
    }
    const map = info.generate(room.seed);
    const rng = makeRng((room.seed ^ 0x2545f491) | 0);
    const starts = map.starts.map((_, i) => i);
    for (let i = starts.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [starts[i], starts[j]] = [starts[j], starts[i]];
    }
    const players: PlayerSetup[] = [];
    let localPlayer = 0;
    let aiN = 0;
    room.slots.forEach((s) => {
      if (!isOccupied(s)) return;
      const faction: FactionId = s.faction === 'random' ? rng.pick(FACTION_IDS) : s.faction;
      if (s.kind === 'human' && s.isLocal) localPlayer = players.length;
      players.push({
        name: s.kind === 'human' ? s.name : `電腦 ${++aiN}`,
        faction,
        color: s.color,
        team: s.team,
        controller: s.kind === 'ai' ? 'ai' : 'human',
        difficulty: s.kind === 'ai' ? s.difficulty : 'normal',
        startIndex: starts[players.length % starts.length],
      });
    });
    const setup: GameSetup = { map, seed: room.seed, players, startingCredits: room.startingCredits, options: { ...room.options } };
    clearTimers();
    match = new FakeMatch(setup, localPlayer, room.isHost, (st) => set({ match: st }), every);
    set({ phase: 'match', room: null, match: match.status });
    emit({ type: 'matchStart', match });
  }

  const api: FakeNet = {
    transport: opts.transport ?? 'loopback',
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    on(cb) {
      eventListeners.add(cb);
      return () => eventListeners.delete(cb);
    },
    browse() {
      if (api.transport === 'none' || state.phase === 'lobby' || state.phase === 'match') return;
      if (browseTimer) return;
      browseTick = 0;
      set({ phase: 'browsing', rooms: ads() });
      browseTimer = every(2200, () => {
        browseTick++;
        if (state.phase === 'browsing') set({ rooms: ads() });
      });
    },
    stopBrowse() {
      browseTimer?.clear();
      browseTimer = null;
      if (state.phase === 'browsing') set({ phase: 'idle', rooms: [] });
    },
    host(playerName, roomName) {
      myName = playerName || myName;
      clearTimers();
      set({ phase: 'connecting', rooms: [] });
      later(450, () => hostRoom(roomName || `${myName} 的房間`));
    },
    join(roomId, playerName) {
      myName = playerName || myName;
      const ad = state.rooms.find((r) => r.id === roomId);
      clearTimers();
      set({ phase: 'connecting', rooms: [] });
      later(900, () => {
        if (state.phase !== 'connecting') return;
        if (!ad || ad.id === 'r-fail') {
          set({ phase: 'idle', room: null });
          emit({ type: 'error', text: `無法連線到「${ad?.name ?? roomId}」:對方沒有回應` });
        } else if (!ad.compatible) {
          set({ phase: 'idle', room: null });
          emit({ type: 'error', text: '對方使用不同版本的遊戲,無法加入' });
        } else if (ad.inMatch) {
          set({ phase: 'idle', room: null });
          emit({ type: 'error', text: '該房間正在對戰中' });
        } else joinRoom(ad);
      });
    },
    leave() {
      clearTimers();
      if (match) match.end();
      match = null;
      set({ phase: 'idle', rooms: [], room: null, match: null });
    },
    setRoom(patch) {
      const room = state.room;
      if (!room?.isHost) return;
      const next: NetRoom = { ...room, ...patch, options: { ...room.options, ...(patch.options ?? {}) } };
      if (patch.mapId && patch.mapId !== room.mapId) {
        const info = maps.find((m) => m.id === patch.mapId);
        const n = Math.max(2, Math.min(8, info?.maxPlayers ?? room.slots.length));
        const slots = room.slots.slice(0, n);
        while (slots.length < n) slots.push({ kind: 'open' });
        // keep the local host seated even if the map shrank
        if (!slots.some((s) => s.kind === 'human' && s.isLocal)) slots[0] = room.slots.find((s) => s.kind === 'human' && s.isLocal) ?? slots[0];
        next.slots = slots;
      }
      // other humans must re-confirm after a rule change
      next.slots = next.slots.map((s) => (s.kind === 'human' && !s.isHost ? { ...s, ready: false } : s));
      setRoomState(next);
    },
    setSlot(index, slot) {
      const room = state.room;
      if (!room?.isHost || !room.slots[index]) return;
      const cur = room.slots[index];
      if (cur.kind === 'human' && cur.isLocal) return;
      if (cur.kind === 'human') emit({ type: 'notice', text: `${cur.name} 已被移出房間` });
      const slots = room.slots.slice();
      slots[index] = slot.kind === 'ai' ? { ...slot, color: slots.some((s, i) => i !== index && isOccupied(s) && s.color === slot.color) ? freeColor(slots, index, slot.faction) : slot.color } : slot;
      setRoomState({ ...room, slots });
    },
    setMe(patch) {
      const room = state.room;
      if (!room) return;
      const i = room.slots.findIndex((s) => s.kind === 'human' && s.isLocal);
      if (i < 0) return;
      if (patch.color && room.slots.some((s, j) => j !== i && isOccupied(s) && s.color === patch.color)) {
        emit({ type: 'error', text: '這個顏色已被其他玩家使用' });
        return;
      }
      patchSlot(i, (s) => (s.kind === 'human' ? { ...s, ...patch } : s));
    },
    chat(text) {
      const room = state.room;
      const meSeat = room?.slots.find((s): s is SeatHuman => s.kind === 'human' && s.isLocal);
      const color = meSeat?.color ?? match?.setup.players[match.localPlayer]?.color ?? '#ffffff';
      emit({ type: 'chat', from: myName, color, text });
      if (scripted && /[?\uff1f]/.test(text)) later(1200, () => emit({ type: 'chat', from: '阿岩', color: '#ff8a2a', text: '收到!' }));
    },
    startMatch() {
      const room = state.room;
      if (!room?.isHost || !computeCanStart(room)) return;
      beginMatch(room);
    },
    get match() {
      return match;
    },
    destroy() {
      clearTimers();
      listeners.clear();
      eventListeners.clear();
    },
    dev: {
      setStatus(s, waitingFor) {
        match?.setState(s, waitingFor);
      },
      setDisconnected(player, off) {
        match?.setConnected(player, !off);
      },
      error: (text) => emit({ type: 'error', text }),
      notice: (text) => emit({ type: 'notice', text }),
      chatFrom: (name, text, color = '#7bd148') => emit({ type: 'chat', from: name, color, text }),
      kicked() {
        if (state.phase !== 'lobby') return;
        clearTimers();
        set({ phase: 'idle', room: null });
        emit({ type: 'error', text: '你已被房主移出房間' });
      },
      hostClosed() {
        if (state.phase !== 'lobby') return;
        clearTimers();
        set({ phase: 'idle', room: null });
        emit({ type: 'error', text: '房主已關閉房間' });
      },
      quiet() {
        scripted = false;
      },
    },
  };
  return api;
}

/** Echoes the local commands back as the turn; status can be flipped through `setState`. */
class FakeMatch implements NetMatch {
  status: NetMatchStatus;
  private queue: Command[] = [];
  constructor(
    readonly setup: GameSetup,
    readonly localPlayer: number,
    readonly isHost: boolean,
    private publish: (s: NetMatchStatus) => void,
    every: (ms: number, fn: () => void) => Timer,
  ) {
    this.status = {
      state: 'running',
      waitingFor: [],
      players: setup.players.map((p, i) => ({ player: i, name: p.name, controller: p.controller, connected: true, pingMs: p.controller === 'ai' ? 0 : i === localPlayer ? 0 : 24 + i * 9 })),
    };
    every(2000, () => {
      if (this.status.state === 'ended') return;
      this.update({
        players: this.status.players.map((p) => (p.controller === 'human' && p.player !== localPlayer && p.connected ? { ...p, pingMs: Math.max(5, Math.round(p.pingMs + (Math.random() - 0.5) * 24)) } : p)),
      });
    });
  }
  private update(patch: Partial<NetMatchStatus>): void {
    this.status = { ...this.status, ...patch };
    this.publish(this.status);
  }
  setState(state: NetMatchStatus['state'], waitingFor?: string[]): void {
    const others = this.status.players.filter((p) => p.controller === 'human' && p.player !== this.localPlayer).map((p) => p.name);
    this.update({ state, waitingFor: state === 'waiting' ? (waitingFor ?? (others.length ? others.slice(0, 1) : ['阿岩'])) : [] });
  }
  setConnected(player: number, connected: boolean): void {
    this.update({ players: this.status.players.map((p) => (p.player === player ? { ...p, connected } : p)) });
  }
  end(): void {
    this.update({ state: 'ended', waitingFor: [] });
  }
  send(cmd: Command): void {
    this.queue.push(cmd);
  }
  takeTurn(_tick: number): Command[] | null {
    if (this.status.state !== 'running') return null;
    return this.queue.splice(0);
  }
  ready(_tick: number): number {
    return this.status.state === 'running' ? 1 : 0;
  }
  afterStep(_tick: number, _hash: () => number): void {
    /* no peers to compare with */
  }
  leave(): void {
    this.end();
  }
}
