// FROZEN CONTRACT — owned by the commander session. See CLAUDE.md.
// The public surface each module must export from its index.ts. `src/main.ts` wires them together.
import type {
  Command,
  Difficulty,
  EntityId,
  FactionId,
  GameMap,
  GameOptions,
  GameSetup,
  MovementType,
  PlayerId,
  QueueCategory,
  SimEvent,
  SupportPowerId,
  World,
} from './types';

// ───────────────────────────── sim  (src/sim/index.ts) ─────────────────────────────

export interface PlacementCheck {
  ok: boolean;
  /** Every footprint tile with its individual verdict, for drawing the green/red ghost. */
  cells: { tx: number; ty: number; ok: boolean }[];
}

export interface BuildOption {
  defId: string;
  category: QueueCategory;
  /** Prerequisites met and a producing building exists → can be queued right now. */
  available: boolean;
}

export interface SimApi {
  createWorld(setup: GameSetup): World;
  /** Advance exactly one tick, applying `commands` first. Deterministic given (world, commands). */
  step(world: World, commands: Command[]): void;
  canPlaceBuilding(world: World, player: PlayerId, defId: string, tx: number, ty: number): PlacementCheck;
  /** Everything in the player's faction tech tree, flagged with availability. Hide unavailable ones in the UI. */
  getBuildOptions(world: World, player: PlayerId): BuildOption[];
  /** Static terrain + building occupancy passability for a movement type. */
  isPassable(world: World, tx: number, ty: number, movement: MovementType): boolean;
  /** True if a and b are on different teams. */
  isEnemy(world: World, a: PlayerId, b: PlayerId): boolean;
  /** Stable hash of the whole world, for determinism tests. */
  hashWorld(world: World): number;
}

// ───────────────────────────── render  (src/render/index.ts) ─────────────────────────────

export interface Camera {
  /** World point (tile units) at the centre of the viewport. */
  x: number;
  y: number;
  /** 1 = TILE_W css px per tile. Clamp to [0.5, 2]. */
  zoom: number;
}

/** UI-owned, per-frame presentation state the renderer draws on top of the world. */
export interface ViewState {
  viewer: PlayerId;
  selection: Set<EntityId>;
  hoverId: EntityId | null;
  /** Building ghost while placing. */
  placement: { defId: string; tx: number; ty: number; check: PlacementCheck } | null;
  /** Drag-select rectangle in css px relative to the canvas. */
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Support power targeting reticle (world coords). */
  powerTarget: { power: SupportPowerId; x: number; y: number } | null;
  /** Show health bars on everything (e.g. while Option/Alt is held). */
  showAllHealth: boolean;
  /** Transient command markers (move/attack click feedback); renderer fades them out by `at`. */
  markers: { x: number; y: number; kind: 'move' | 'attack' | 'rally'; at: number }[];
  /** Wall-clock ms, for animations. */
  time: number;
}

export interface Renderer {
  readonly camera: Camera;
  /** Call when the canvas css size or devicePixelRatio changes. Renderer sets canvas.width/height. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  /** alpha ∈ [0,1): interpolation between the previous and current tick. */
  render(world: World, view: ViewState, alpha: number): void;
  /** Feed sim events every tick so the renderer can spawn effects (explosions, beams, debris…). */
  handleEvents(events: SimEvent[], world: World): void;
  /** css px relative to canvas ↔ world tile coords (ground plane). */
  screenToWorld(sx: number, sy: number): { x: number; y: number };
  worldToScreen(x: number, y: number, z?: number): { x: number; y: number };
  /** Topmost entity under the cursor that `viewer` can currently see, else null. */
  pickEntity(world: World, sx: number, sy: number, viewer: PlayerId): EntityId | null;
  /** Entities whose screen position falls in the rect and that `viewer` can see. */
  entitiesInRect(world: World, x0: number, y0: number, x1: number, y1: number, viewer: PlayerId): EntityId[];
  /** Draw the radar minimap (terrain, fog, units, viewport outline) into any 2D context at (0,0,w,h). */
  drawMinimap(ctx: CanvasRenderingContext2D, world: World, view: ViewState, w: number, h: number): void;
  /** Convert a minimap pixel back to world coords (inverse of drawMinimap's mapping). */
  minimapToWorld(world: World, mx: number, my: number, w: number, h: number): { x: number; y: number };
  /** Procedurally drawn build-menu icon for a unit/building def, tinted with the player colour. Cached. */
  getIcon(defId: string, color: string, size: number): HTMLCanvasElement;
  /** Keep the camera inside the map. */
  clampCamera(world: World): void;
  destroy(): void;
}

export type CreateRenderer = (canvas: HTMLCanvasElement) => Renderer;

// ───────────────────────────── audio  (src/audio/index.ts) ─────────────────────────────

export type UiSound = 'click' | 'select' | 'move' | 'attack' | 'place' | 'error' | 'tab' | 'queue' | 'cancel';
export type MusicMood = 'menu' | 'calm' | 'battle' | 'victory' | 'defeat' | 'off';

export interface AudioApi {
  /** Must be called from a user gesture once (browser autoplay policy). */
  unlock(): void;
  /** Positional SFX + announcer lines derived from sim events. Sounds outside the camera view are attenuated. */
  handleEvents(events: SimEvent[], world: World, viewer: PlayerId, camera: Camera): void;
  playUi(sound: UiSound): void;
  /** Unit acknowledgement blip when the player selects / orders an entity of this def. */
  playAck(defId: string, kind: 'select' | 'move' | 'attack'): void;
  setMusic(mood: MusicMood): void;
  /** 0..1 each. */
  setVolume(v: { master?: number; sfx?: number; music?: number; voice?: number }): void;
  getVolume(): { master: number; sfx: number; music: number; voice: number };
}

export type CreateAudio = () => AudioApi;

// ───────────────────────────── ui  (src/ui/index.ts) ─────────────────────────────

export interface UiDeps {
  /** Container the UI may fill with DOM (HUD overlays). The game canvas is `canvas`, already inside root. */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  sim: SimApi;
  audio: AudioApi;
  viewer: PlayerId;
  /** Queue a command for the next sim tick. */
  send(cmd: Command): void;
  /** Pause/resume, speed and leaving the match are owned by main.ts. */
  setPaused(paused: boolean): void;
  setSpeed(multiplier: number): void;
  quitToMenu(): void;
  /**
   * Present only in a LAN match. Then: the pause menu must NOT stop the game (main.ts ignores setPaused/setSpeed),
   * and the HUD shows the net overlays (waiting for players, desync, host lost, defeated → spectating) and chat.
   */
  net?: NetMatch;
  /** Present with `net`: subscribe to chat / notices while in the match. */
  netApi?: NetApi;
}

export interface GameUi {
  /** The renderer reads this every frame. */
  readonly view: ViewState;
  /** Called once per rendered frame, before renderer.render. Handles edge-scroll, HUD refresh, etc. */
  update(world: World, dtMs: number): void;
  /** Called once per sim tick with that tick's events (announcements, alerts, minimap pings). */
  handleEvents(events: SimEvent[], world: World): void;
  destroy(): void;
}

export type CreateGameUi = (deps: UiDeps) => GameUi;

export interface MenuDeps {
  root: HTMLElement;
  audio: AudioApi;
  maps: MapInfo[];
  /** Start a skirmish with this setup. */
  start(setup: GameSetup): void;
  /**
   * LAN multiplayer. When present the title screen offers 區域網路對戰 (room browser → room lobby).
   * The menu never starts a LAN match itself: it calls net.startMatch() and main.ts reacts to the
   * 'matchStart' event (and hides the menu).
   */
  net?: NetApi;
}

export interface MenuUi {
  show(): void;
  hide(): void;
  /** Show the end-of-match screen (victory/defeat + stats), with a button back to the menu. */
  showResult(world: World, viewer: PlayerId): void;
  destroy(): void;
}

export type CreateMenu = (deps: MenuDeps) => MenuUi;

// ───────────────────────────── ai  (src/ai/index.ts) ─────────────────────────────

export interface AiController {
  readonly player: PlayerId;
  /** Called every tick; returns commands for that tick (usually empty — the AI throttles itself). Read-only on world. */
  think(world: World): Command[];
}

export type CreateAi = (player: PlayerId, difficulty: Difficulty, seed: number, sim: SimApi) => AiController;

// ───────────────────────────── maps  (src/maps/index.ts) ─────────────────────────────

export interface MapInfo {
  id: string;
  name: string;
  desc: string;
  maxPlayers: number;
  width: number;
  height: number;
  /** Deterministic for a given seed. */
  generate(seed: number): GameMap;
}

// ───────────────────────────── net  (src/net/index.ts) ─────────────────────────────
// LAN multiplayer = deterministic lockstep: peers exchange Commands only, every peer runs the same sim.
// Star topology: one host, clients talk only to the host. AI players are run by the host and their
// commands travel through the same stream. A LAN match always runs at 1× and cannot be paused.

/**
 * Raw LAN bridge the macOS app injects as `window.cinderNative.net` (mac/ implements it, src/net consumes it).
 * Bonjour discovery + TCP, messages are whole UTF-8 strings (the native side does the framing).
 * Everything is asynchronous: results arrive as `CustomEvent<NativeNetEvent>` named 'cinder:net' on window.
 */
export interface NativeNetBridge {
  /** Listen on a free TCP port and advertise it on the local network. `info` (≤ 200 bytes) is shown to browsers as-is. */
  host(name: string, info: string): void;
  /** Change the advertised info while hosting. */
  updateInfo(info: string): void;
  /** Stop advertising and listening. Existing connections stay open. */
  stopHost(): void;
  /** Start / stop looking for hosts. 'found' / 'lost' events follow. */
  browse(): void;
  stopBrowse(): void;
  /** Connect to a host previously reported by 'found'. Answers with 'open' or 'closed'. */
  connect(hostId: string): void;
  send(conn: number, text: string): void;
  close(conn: number): void;
  /** Close every connection, stop hosting and browsing. */
  reset(): void;
}

export type NativeNetEvent =
  | { type: 'hosting'; port: number }
  | { type: 'hostFailed'; message: string }
  | { type: 'found'; id: string; name: string; info: string }
  | { type: 'lost'; id: string }
  /** A connection is ready. `incoming` = a client connected to our listener; otherwise our connect(hostId) succeeded. */
  | { type: 'open'; conn: number; incoming: boolean; hostId?: string }
  | { type: 'message'; conn: number; text: string }
  /** Also the answer to a failed connect() (conn = -1, hostId set). */
  | { type: 'closed'; conn: number; hostId?: string; reason: string }
  /** Anything else, e.g. local-network permission denied. `message` is user-presentable zh-Hant. */
  | { type: 'error'; message: string };

/** A room found on the local network. */
export interface NetRoomAd {
  id: string;
  name: string;
  hostName: string;
  mapName: string;
  players: number;
  maxPlayers: number;
  /** False when the room runs a different game build; joining is refused. */
  compatible: boolean;
  inMatch: boolean;
}

export type NetSlot =
  | { kind: 'open' }
  | { kind: 'closed' }
  | { kind: 'ai'; faction: FactionId | 'random'; color: string; team: number; difficulty: Difficulty }
  | {
      kind: 'human';
      name: string;
      faction: FactionId | 'random';
      color: string;
      team: number;
      ready: boolean;
      isHost: boolean;
      /** This is the player on this machine. */
      isLocal: boolean;
      pingMs: number;
    };

/** Room lobby state, identical on every peer (except isHost / isLocal). Slot index = seat, not start position. */
export interface NetRoom {
  name: string;
  isHost: boolean;
  mapId: string;
  seed: number;
  startingCredits: number;
  options: GameOptions;
  /** One per map start (length = map.maxPlayers). Colours are unique across occupied slots. */
  slots: NetSlot[];
  /** Host only: every human is ready and at least two teams are present. */
  canStart: boolean;
}

export interface NetMatchStatus {
  /**
   * running  – stepping normally
   * waiting  – stalled until `waitingFor` catch up / reconnect (show an overlay with the names)
   * desync   – world hashes differ between peers; the match cannot continue (terminal)
   * hostLost – the host went away; the match cannot continue (terminal)
   * ended    – leave() was called (terminal)
   */
  state: 'running' | 'waiting' | 'desync' | 'hostLost' | 'ended';
  waitingFor: string[];
  players: { player: PlayerId; name: string; controller: 'human' | 'ai'; connected: boolean; pingMs: number }[];
}

/** One running LAN match, as seen by main.ts (lockstep driver) and the HUD (status). */
export interface NetMatch {
  /** Identical on every peer: same map (generated from id + seed), same PlayerSetup order. */
  readonly setup: GameSetup;
  /** The PlayerId played on this machine. */
  readonly localPlayer: PlayerId;
  readonly isHost: boolean;
  /** Queue a command issued on this machine (UI, or an AI the host runs). It executes on every peer at the same later tick. */
  send(cmd: Command): void;
  /**
   * The commands every peer applies in the step taken while `world.tick === tick`, or null when they are
   * not known yet (stall — do not step). Ask for ticks in order; after a non-null answer the caller must step.
   */
  takeTurn(tick: number): Command[] | null;
  /** How many consecutive turns starting at `tick` are already available — > 2 means this peer is behind and should catch up. */
  ready(tick: number): number;
  /** Call after every step with the new `world.tick`. `hash` is invoked only on the ticks the protocol checks. */
  afterStep(tick: number, hash: () => number): void;
  readonly status: NetMatchStatus;
  /** Leave the match. A human who leaves surrenders (the host injects the command for them). */
  leave(): void;
}

export interface NetState {
  phase: 'idle' | 'browsing' | 'connecting' | 'lobby' | 'match';
  /** Rooms currently visible on the network (maintained while browsing). */
  rooms: NetRoomAd[];
  room: NetRoom | null;
  match: NetMatchStatus | null;
}

export type NetEvent =
  /** The host started the game. main.ts builds the world from `match.setup` and drives it through `match`. */
  | { type: 'matchStart'; match: NetMatch }
  | { type: 'chat'; from: string; color: string; text: string }
  /** Informational, zh-Hant: "某某 加入了房間", "某某 已離線"… */
  | { type: 'notice'; text: string }
  /** Something failed and the user should be told (connect failed, kicked, version mismatch, room closed…). zh-Hant. */
  | { type: 'error'; text: string };

export interface NetApi {
  /** 'none' = no way to reach other machines here (plain browser); the UI disables LAN play and says why. */
  readonly transport: 'native' | 'loopback' | 'none';
  /** Immutable snapshot — a new object after every change. */
  getState(): NetState;
  subscribe(cb: (state: NetState) => void): () => void;
  on(cb: (event: NetEvent) => void): () => void;

  browse(): void;
  stopBrowse(): void;
  /** Create a room and enter its lobby as host. */
  host(playerName: string, roomName: string): void;
  join(roomId: string, playerName: string): void;
  /** Leave the room or the match and go back to 'idle'. Safe to call in any phase. */
  leave(): void;

  // Room lobby. Host-only calls are ignored on clients.
  setRoom(patch: Partial<Pick<NetRoom, 'mapId' | 'seed' | 'startingCredits' | 'options'>>): void;
  /** Host: open / close a seat or put an AI in it. Kicks a human sitting there. */
  setSlot(index: number, slot: Exclude<NetSlot, { kind: 'human' }>): void;
  /** Change my own seat's settings. */
  setMe(patch: { faction?: FactionId | 'random'; color?: string; team?: number; ready?: boolean }): void;
  chat(text: string): void;
  /** Host: start when `room.canStart`. */
  startMatch(): void;

  readonly match: NetMatch | null;
  destroy(): void;
}

export interface NetDeps {
  maps: MapInfo[];
  /** Identifies the game build; peers with a different value cannot play together. */
  buildId: string;
}

export type CreateNet = (deps: NetDeps) => NetApi;
