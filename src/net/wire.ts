// Wire format: every message is a JSON string. Nothing received is trusted — every parser below
// rebuilds a fresh, fully typed object from scratch or returns null.
import type { NativeNetEvent } from '../core/api';
import type { Command, Difficulty, FactionId, GameOptions, PlayerSetup, QueueCategory, SupportPowerId } from '../core/types';
import { FACTIONS } from '../data';

/** Bump whenever the wire format or lockstep rules change. */
export const PROTOCOL = 1;
/** Incoming strings longer than this are dropped unread. */
export const MAX_TEXT = 256 * 1024;
export const MAX_IDS = 500;
export const MAX_CMDS_PER_MSG = 64;
export const MAX_CMDS_PER_TURN = 600;
export const MAX_NAME = 16;
export const MAX_ROOM_NAME = 24;
export const MAX_CHAT = 200;
export const MAX_SEATS = 8;
export const MAX_TEAM = 8;
export const AD_MAX_BYTES = 200;

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const COORD_MAX = 100_000;
const isCoord = (v: unknown): v is number => isNum(v) && Math.abs(v) <= COORD_MAX;
const isId = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 0x7fffffff;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const CATEGORIES: readonly QueueCategory[] = ['structure', 'defense', 'infantry', 'vehicle', 'aircraft'];
const POWERS: readonly SupportPowerId[] = ['recon_sweep', 'orbital_lance', 'tremor'];

/** Lobby colour palette: every faction colour, in faction order, without duplicates. */
export const PALETTE: readonly string[] = (() => {
  const out: string[] = [];
  for (const f of FACTION_IDS) for (const c of FACTIONS[f].colors) if (!out.includes(c)) out.push(c);
  return out;
})();

export const isFaction = (v: unknown): v is FactionId => oneOf(FACTION_IDS, v);
export const isFactionChoice = (v: unknown): v is FactionId | 'random' => v === 'random' || isFaction(v);
export const isDifficulty = (v: unknown): v is Difficulty => oneOf(DIFFICULTIES, v);

/** Strip control characters, collapse whitespace, trim and cap at `max` code points. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.slice(0, max * 8).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('');
}

function parseIds(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length > MAX_IDS) return null;
  for (const x of v) if (!isId(x)) return null;
  return (v as number[]).slice();
}

/** Rebuild a Command from untrusted data (only known fields, checked types), or null. */
export function sanitizeCommand(raw: unknown): Command | null {
  if (!isObj(raw)) return null;
  const player = raw.player;
  if (!isInt(player) || player < 0 || player >= MAX_SEATS) return null;
  const type = raw.type;
  switch (type) {
    case 'move':
    case 'attackMove': {
      const ids = parseIds(raw.ids);
      if (!ids || !isCoord(raw.x) || !isCoord(raw.y)) return null;
      return raw.queue === true ? { type, player, ids, x: raw.x, y: raw.y, queue: true } : { type, player, ids, x: raw.x, y: raw.y };
    }
    case 'attack': {
      const ids = parseIds(raw.ids);
      if (!ids || !isId(raw.targetId)) return null;
      return raw.queue === true ? { type, player, ids, targetId: raw.targetId, queue: true } : { type, player, ids, targetId: raw.targetId };
    }
    case 'stop':
    case 'guard':
    case 'deploy': {
      const ids = parseIds(raw.ids);
      return ids ? { type, player, ids } : null;
    }
    case 'harvest': {
      const ids = parseIds(raw.ids);
      if (!ids || !isCoord(raw.tx) || !isCoord(raw.ty)) return null;
      return { type, player, ids, tx: raw.tx, ty: raw.ty };
    }
    case 'dock':
    case 'capture': {
      const ids = parseIds(raw.ids);
      if (!ids || !isId(raw.targetId)) return null;
      return { type, player, ids, targetId: raw.targetId };
    }
    case 'produce':
    case 'cancelProduction':
      return isStr(raw.defId, 64) ? { type, player, defId: raw.defId } : null;
    case 'resumeProduction':
      return oneOf(CATEGORIES, raw.category) ? { type, player, category: raw.category } : null;
    case 'placeBuilding':
      if (!isStr(raw.defId, 64) || !isCoord(raw.tx) || !isCoord(raw.ty)) return null;
      return { type, player, defId: raw.defId, tx: raw.tx, ty: raw.ty };
    case 'sell':
    case 'toggleRepair':
    case 'setPrimary':
      return isId(raw.buildingId) ? { type, player, buildingId: raw.buildingId } : null;
    case 'setRally':
      if (!isId(raw.buildingId) || !isCoord(raw.x) || !isCoord(raw.y)) return null;
      return { type, player, buildingId: raw.buildingId, x: raw.x, y: raw.y };
    case 'usePower':
      if (!oneOf(POWERS, raw.power) || !isCoord(raw.x) || !isCoord(raw.y)) return null;
      return { type, player, power: raw.power, x: raw.x, y: raw.y };
    case 'surrender':
      return { type, player };
    default:
      return null;
  }
}

// ───────────────────────────── messages ─────────────────────────────

/** Lobby slot on the wire. Humans are identified by `pid` (peer id; the host is always pid 0), not by seat. */
export type WireSlot =
  | { k: 'open' }
  | { k: 'closed' }
  | { k: 'ai'; faction: FactionId | 'random'; color: string; team: number; difficulty: Difficulty }
  | { k: 'human'; pid: number; name: string; faction: FactionId | 'random'; color: string; team: number; ready: boolean; ping: number };
export type WireOccupied = Extract<WireSlot, { k: 'ai' } | { k: 'human' }>;
export const isOccupied = (s: WireSlot): s is WireOccupied => s.k === 'ai' || s.k === 'human';

export interface WireRoom {
  name: string;
  mapId: string;
  seed: number;
  credits: number;
  options: GameOptions;
  slots: WireSlot[];
}

export interface WirePlayer extends PlayerSetup {
  /** Peer id of the human playing it, -1 for AI. */
  pid: number;
}

export interface WireStart {
  mapId: string;
  seed: number;
  credits: number;
  options: GameOptions;
  players: WirePlayer[];
}

export type RefuseReason = 'build' | 'proto' | 'full' | 'match' | 'bad';
const REFUSE_REASONS: readonly RefuseReason[] = ['build', 'proto', 'full', 'match', 'bad'];

export interface MePatch {
  faction?: FactionId | 'random';
  color?: string;
  team?: number;
  ready?: boolean;
}

export type ClientMsg =
  | { t: 'hello'; v: number; build: string; name: string }
  | { t: 'me'; p: MePatch }
  | { t: 'chat'; text: string }
  | { t: 'pong'; at: number }
  | { t: 'bye' }
  | { t: 'cmd'; c: Command[] }
  /** "I have stepped to tick k"; `h` = world hash at k when k is a check tick. */
  | { t: 'ack'; k: number; h?: number };

export interface WireStat {
  player: number;
  connected: boolean;
  ping: number;
}

export type HostMsg =
  | { t: 'welcome'; pid: number; room: WireRoom }
  | { t: 'refuse'; why: RefuseReason }
  | { t: 'room'; room: WireRoom }
  | { t: 'chat'; from: string; color: string; text: string }
  | { t: 'notice'; text: string }
  | { t: 'kick' }
  | { t: 'ping'; at: number }
  | { t: 'start'; s: WireStart }
  /** The authoritative command list for the step taken at world.tick === k. */
  | { t: 'turn'; k: number; c: Command[] }
  | { t: 'wait'; names: string[] }
  | { t: 'mstat'; p: WireStat[] }
  | { t: 'desync'; k: number }
  | { t: 'bye' };

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseOptions(v: unknown): GameOptions | null {
  if (!isObj(v) || typeof v.fog !== 'boolean' || typeof v.shortGame !== 'boolean' || typeof v.superweapons !== 'boolean') return null;
  return { fog: v.fog, shortGame: v.shortGame, superweapons: v.superweapons };
}

const isTeam = (v: unknown): v is number => isInt(v) && v >= 0 && v <= MAX_TEAM;

function parseSlot(v: unknown): WireSlot | null {
  if (!isObj(v)) return null;
  switch (v.k) {
    case 'open':
      return { k: 'open' };
    case 'closed':
      return { k: 'closed' };
    case 'ai':
      if (!isFactionChoice(v.faction) || !isColor(v.color) || !isTeam(v.team) || !isDifficulty(v.difficulty)) return null;
      return { k: 'ai', faction: v.faction, color: v.color, team: v.team, difficulty: v.difficulty };
    case 'human': {
      if (!isInt(v.pid) || v.pid < 0 || !isFactionChoice(v.faction) || !isColor(v.color) || !isTeam(v.team)) return null;
      if (typeof v.ready !== 'boolean' || !isNum(v.ping) || v.ping < 0) return null;
      const name = cleanText(v.name, MAX_NAME);
      if (!name) return null;
      return { k: 'human', pid: v.pid, name, faction: v.faction, color: v.color, team: v.team, ready: v.ready, ping: Math.round(v.ping) };
    }
    default:
      return null;
  }
}

export function parseRoom(v: unknown): WireRoom | null {
  if (!isObj(v) || !isStr(v.mapId, 64) || !isInt(v.seed) || !isInt(v.credits) || v.credits < 0) return null;
  const options = parseOptions(v.options);
  if (!options || !Array.isArray(v.slots) || v.slots.length < 1 || v.slots.length > MAX_SEATS) return null;
  const slots: WireSlot[] = [];
  for (const s of v.slots) {
    const p = parseSlot(s);
    if (!p) return null;
    slots.push(p);
  }
  return { name: cleanText(v.name, MAX_ROOM_NAME), mapId: v.mapId, seed: v.seed, credits: v.credits, options, slots };
}

function parseStart(v: unknown): WireStart | null {
  if (!isObj(v) || !isStr(v.mapId, 64) || !isInt(v.seed) || !isInt(v.credits) || v.credits < 0) return null;
  const options = parseOptions(v.options);
  if (!options || !Array.isArray(v.players) || v.players.length < 1 || v.players.length > MAX_SEATS) return null;
  const players: WirePlayer[] = [];
  for (const p of v.players) {
    if (!isObj(p) || !isFaction(p.faction) || !isColor(p.color) || !isTeam(p.team) || !isDifficulty(p.difficulty)) return null;
    if ((p.controller !== 'human' && p.controller !== 'ai') || !isInt(p.startIndex) || p.startIndex < 0 || p.startIndex >= MAX_SEATS) return null;
    if (!isInt(p.pid) || p.pid < -1) return null;
    const name = cleanText(p.name, MAX_NAME);
    if (!name) return null;
    players.push({ name, faction: p.faction, color: p.color, team: p.team, controller: p.controller, difficulty: p.difficulty, startIndex: p.startIndex, pid: p.pid });
  }
  return { mapId: v.mapId, seed: v.seed, credits: v.credits, options, players };
}

function parseCommands(v: unknown, max: number): Command[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: Command[] = [];
  for (const c of v) {
    const s = sanitizeCommand(c);
    if (s) out.push(s);
  }
  return out;
}

export function parseClientMsg(text: unknown): ClientMsg | null {
  const m = parseJson(text);
  if (!isObj(m)) return null;
  switch (m.t) {
    case 'hello':
      if (!isInt(m.v) || !isStr(m.build, 256) || typeof m.name !== 'string') return null;
      return { t: 'hello', v: m.v, build: m.build, name: cleanText(m.name, MAX_NAME) };
    case 'me': {
      if (!isObj(m.p)) return null;
      const p: MePatch = {};
      if (isFactionChoice(m.p.faction)) p.faction = m.p.faction;
      if (isColor(m.p.color)) p.color = m.p.color;
      if (isTeam(m.p.team)) p.team = m.p.team;
      if (typeof m.p.ready === 'boolean') p.ready = m.p.ready;
      return { t: 'me', p };
    }
    case 'chat': {
      const text = isStr(m.text, MAX_CHAT * 8) ? cleanText(m.text, MAX_CHAT) : '';
      return text ? { t: 'chat', text } : null;
    }
    case 'pong':
      return isNum(m.at) ? { t: 'pong', at: m.at } : null;
    case 'bye':
      return { t: 'bye' };
    case 'cmd': {
      const c = parseCommands(m.c, MAX_CMDS_PER_MSG);
      return c ? { t: 'cmd', c } : null;
    }
    case 'ack':
      if (!isInt(m.k) || m.k < 0) return null;
      if (m.h === undefined) return { t: 'ack', k: m.k };
      return isNum(m.h) ? { t: 'ack', k: m.k, h: m.h } : null;
    default:
      return null;
  }
}

export function parseHostMsg(text: unknown): HostMsg | null {
  const m = parseJson(text);
  if (!isObj(m)) return null;
  switch (m.t) {
    case 'welcome': {
      const room = parseRoom(m.room);
      return room && isInt(m.pid) && m.pid > 0 ? { t: 'welcome', pid: m.pid, room } : null;
    }
    case 'refuse':
      return { t: 'refuse', why: oneOf(REFUSE_REASONS, m.why) ? m.why : 'bad' };
    case 'room': {
      const room = parseRoom(m.room);
      return room ? { t: 'room', room } : null;
    }
    case 'chat': {
      const from = cleanText(m.from, MAX_NAME);
      const text = isStr(m.text, MAX_CHAT * 8) ? cleanText(m.text, MAX_CHAT) : '';
      return text && isColor(m.color) ? { t: 'chat', from, color: m.color, text } : null;
    }
    case 'notice': {
      const text = isStr(m.text, 400) ? cleanText(m.text, 120) : '';
      return text ? { t: 'notice', text } : null;
    }
    case 'kick':
      return { t: 'kick' };
    case 'ping':
      return isNum(m.at) ? { t: 'ping', at: m.at } : null;
    case 'start': {
      const s = parseStart(m.s);
      return s ? { t: 'start', s } : null;
    }
    case 'turn': {
      if (!isInt(m.k) || m.k < 0) return null;
      const c = parseCommands(m.c, MAX_CMDS_PER_TURN);
      return c ? { t: 'turn', k: m.k, c } : null;
    }
    case 'wait': {
      if (!Array.isArray(m.names) || m.names.length > MAX_SEATS) return null;
      const names = m.names.map((n) => cleanText(n, MAX_NAME)).filter((n) => n.length > 0);
      return { t: 'wait', names };
    }
    case 'mstat': {
      if (!Array.isArray(m.p) || m.p.length > MAX_SEATS) return null;
      const p: WireStat[] = [];
      for (const s of m.p) {
        if (!isObj(s) || !isInt(s.player) || typeof s.connected !== 'boolean' || !isNum(s.ping)) return null;
        p.push({ player: s.player, connected: s.connected, ping: Math.max(0, Math.round(s.ping)) });
      }
      return { t: 'mstat', p };
    }
    case 'desync':
      return isInt(m.k) ? { t: 'desync', k: m.k } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

// ───────────────────────────── room advertisement ─────────────────────────────

/** Short, stable digest of the build id (keeps the ≤ 200-byte advertisement small). */
export function buildHash(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const utf8 = new TextEncoder();
export const utf8Length = (s: string): number => utf8.encode(s).length;

export interface AdFields {
  room: string;
  host: string;
  map: string;
  players: number;
  max: number;
  inMatch: boolean;
  build: string; // buildHash()
}

/** Pack the room advertisement into ≤ AD_MAX_BYTES of UTF-8, shortening the names if needed. */
export function encodeAd(a: AdFields): string {
  const parts = [Array.from(a.room), Array.from(a.host), Array.from(a.map)];
  for (;;) {
    const s = JSON.stringify({ g: 'cf', v: PROTOCOL, b: a.build, r: parts[0].join(''), h: parts[1].join(''), m: parts[2].join(''), p: a.players, x: a.max, i: a.inMatch ? 1 : 0 });
    if (utf8Length(s) <= AD_MAX_BYTES) return s;
    let longest = 0;
    for (let i = 1; i < 3; i++) if (parts[i].length > parts[longest].length) longest = i;
    if (parts[longest].length === 0) return s; // cannot happen with sane inputs
    parts[longest].pop();
  }
}

export interface DecodedAd {
  name: string;
  hostName: string;
  mapName: string;
  players: number;
  maxPlayers: number;
  inMatch: boolean;
  protocol: number;
  build: string;
}

export function decodeAd(info: string): DecodedAd | null {
  const m = parseJson(info);
  if (!isObj(m) || m.g !== 'cf' || !isInt(m.v) || !isStr(m.b, 32)) return null;
  if (!isInt(m.p) || !isInt(m.x) || m.p < 0 || m.x < 0 || m.p > 64 || m.x > 64) return null;
  return {
    name: cleanText(m.r, MAX_ROOM_NAME),
    hostName: cleanText(m.h, MAX_NAME),
    mapName: cleanText(m.m, 32),
    players: m.p,
    maxPlayers: m.x,
    inMatch: m.i === 1,
    protocol: m.v,
    build: m.b,
  };
}

// ───────────────────────────── native bridge events ─────────────────────────────

/** Validate a `cinder:net` CustomEvent detail. */
export function parseNativeEvent(d: unknown): NativeNetEvent | null {
  if (!isObj(d)) return null;
  const optHost = (v: unknown): { hostId?: string } => (typeof v === 'string' ? { hostId: v } : {});
  switch (d.type) {
    case 'hosting':
      return { type: 'hosting', port: isInt(d.port) ? d.port : 0 };
    case 'hostFailed':
      return { type: 'hostFailed', message: typeof d.message === 'string' ? d.message.slice(0, 300) : '' };
    case 'found':
      if (typeof d.id !== 'string' || typeof d.info !== 'string') return null;
      return { type: 'found', id: d.id, name: typeof d.name === 'string' ? d.name : '', info: d.info };
    case 'lost':
      return typeof d.id === 'string' ? { type: 'lost', id: d.id } : null;
    case 'open':
      if (!isInt(d.conn)) return null;
      return { type: 'open', conn: d.conn, incoming: d.incoming === true, ...optHost(d.hostId) };
    case 'message':
      if (!isInt(d.conn) || typeof d.text !== 'string') return null;
      return { type: 'message', conn: d.conn, text: d.text };
    case 'closed':
      if (!isInt(d.conn)) return null;
      return { type: 'closed', conn: d.conn, reason: typeof d.reason === 'string' ? d.reason : '', ...optHost(d.hostId) };
    case 'error':
      return { type: 'error', message: typeof d.message === 'string' ? d.message.slice(0, 300) : '' };
    default:
      return null;
  }
}
