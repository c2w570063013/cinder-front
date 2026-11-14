// FROZEN CONTRACT — owned by the commander session. See CLAUDE.md.
import { TILE_H, TILE_W } from './constants';

/**
 * World space: tile units. Tile (tx,ty) covers [tx,tx+1) x [ty,ty+1); its centre is (tx+0.5, ty+0.5).
 * +x runs toward screen bottom-right, +y toward screen bottom-left.
 * Iso space: unzoomed pixels, before camera transform. World (0,0) maps to iso (0,0).
 */
export function worldToIso(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

export function isoToWorld(ix: number, iy: number): { x: number; y: number } {
  const a = ix / (TILE_W / 2);
  const b = iy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/**
 * Facing angles are radians in WORLD space: atan2(dy, dx). 0 = +x.
 * This converts a world-space facing to the on-screen angle (atan2 of the projected direction).
 */
export function worldAngleToScreen(a: number): number {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  return Math.atan2((dx + dy) * (TILE_H / 2), (dx - dy) * (TILE_W / 2));
}
