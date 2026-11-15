// Pure helpers for the LAN screens (no DOM — unit-tested in node).
import type { NetRoom, NetRoomAd, NetSlot } from '../../core/api';
import type { FactionId } from '../../core/types';
import { FACTIONS } from '../../data';

export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
/** Every player colour offered anywhere in the UI (union of the factions' palettes). */
export const ALL_COLORS: string[] = [...new Set(FACTION_IDS.flatMap((f) => FACTIONS[f].colors))];
export const MAX_NAME = 16;
export const MAX_ROOM_NAME = 24;
export const MAX_CHAT = 120;

/** Trim, collapse whitespace, strip control characters, cap length. Empty → ''. */
export function cleanName(raw: string, max = MAX_NAME): string {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('');
}

export function defaultPlayerName(rand: () => number): string {
  return `指揮官-${String(Math.floor(rand() * 9000) + 1000)}`;
}

export type SeatHuman = Extract<NetSlot, { kind: 'human' }>;
export type SeatAi = Extract<NetSlot, { kind: 'ai' }>;

export function isOccupied(s: NetSlot): s is SeatHuman | SeatAi {
  return s.kind === 'human' || s.kind === 'ai';
}

export function usedColors(slots: NetSlot[], exceptIndex = -1): Set<string> {
  const used = new Set<string>();
  slots.forEach((s, i) => {
    if (i !== exceptIndex && isOccupied(s)) used.add(s.color);
  });
  return used;
}

/** First colour not used by another occupied seat, preferring the faction's own palette. */
export function freeColor(slots: NetSlot[], exceptIndex: number, faction: FactionId | 'random'): string {
  const used = usedColors(slots, exceptIndex);
  const pref = faction === 'random' ? [] : FACTIONS[faction].colors;
  return [...pref, ...ALL_COLORS].find((c) => !used.has(c)) ?? '#9aa3ab';
}

/** Team for a newly added AI: the lowest team number nobody else is on (2..4), else 2. */
export function freeTeam(slots: NetSlot[]): number {
  const used = new Set(slots.filter(isOccupied).map((s) => s.team));
  return [2, 3, 4, 1].find((t) => !used.has(t)) ?? 2;
}

export function localSeat(room: NetRoom): { index: number; slot: SeatHuman } | null {
  const index = room.slots.findIndex((s) => s.kind === 'human' && s.isLocal);
  return index < 0 ? null : { index, slot: room.slots[index] as SeatHuman };
}

/** Why a room in the browser cannot be joined, or null when it can. */
export function joinBlocker(ad: NetRoomAd): string | null {
  if (!ad.compatible) return '不相容版本';
  if (ad.inMatch) return '對戰中';
  if (ad.players >= ad.maxPlayers) return '已滿';
  return null;
}

/** Explanation under the host's start button when it is disabled. */
export function startBlocker(room: NetRoom): string {
  if (room.canStart) return '';
  const occ = room.slots.filter(isOccupied);
  if (occ.length < 2) return '至少需要兩名玩家';
  if (new Set(occ.map((s) => s.team)).size < 2) return '至少需要兩個不同的隊伍';
  const waiting = occ.filter((s): s is SeatHuman => s.kind === 'human' && !s.ready && !s.isHost);
  if (waiting.length) return `等待 ${waiting.map((s) => s.name).join('、')} 準備就緒`;
  return '尚無法開始';
}

export function pingTone(ms: number): 'good' | 'warn' | 'bad' {
  return ms < 60 ? 'good' : ms < 150 ? 'warn' : 'bad';
}

/** Structural key of the seats, excluding fast-changing ping values (so selects are not rebuilt every ping). */
export function seatsKey(room: NetRoom): string {
  return JSON.stringify(room.slots.map((s) => (s.kind === 'human' ? { ...s, pingMs: 0 } : s))) + '|' + room.isHost + '|' + room.canStart;
}

export function rulesKey(room: NetRoom): string {
  return JSON.stringify([room.mapId, room.seed, room.startingCredits, room.options, room.isHost]);
}
