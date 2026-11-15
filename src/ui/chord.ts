// Classic modifier-click order chords (pure; unit-tested).
export type OrderChord = 'attackMove' | 'force' | 'forceMove' | 'waypoint';

export interface Mods {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * ⌃/⌘ = force fire, ⌃⇧ / ⌘⇧ = attack-move, ⌥ = force move, Z held = waypoint, plain / ⇧ = null (smart order).
 * `ctrlIsRightClick`: the Mac single-button setting, where ⌃ is consumed as a right click and only ⌘ forces fire.
 */
export function orderChord(m: Mods, zDown: boolean, ctrlIsRightClick: boolean): OrderChord | null {
  const force = m.metaKey || (m.ctrlKey && !ctrlIsRightClick);
  if (force && m.shiftKey) return 'attackMove';
  if (force) return 'force';
  if (m.altKey) return 'forceMove';
  if (zDown) return 'waypoint';
  return null;
}
