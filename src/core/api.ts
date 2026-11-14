// FROZEN CONTRACT — owned by the commander session. See CLAUDE.md.
// The public surface each module must export from its index.ts. `src/main.ts` wires them together.
import type {
  Command,
  Difficulty,
  EntityId,
  GameMap,
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
