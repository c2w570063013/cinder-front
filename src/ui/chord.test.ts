import { describe, expect, it } from 'vitest';
import { orderChord } from './chord';

const m = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('order chords', () => {
  it('maps the classic modifiers', () => {
    expect(orderChord(m(), false, false)).toBeNull();
    expect(orderChord(m({ shiftKey: true }), false, false)).toBeNull();
    expect(orderChord(m({ ctrlKey: true }), false, false)).toBe('force');
    expect(orderChord(m({ metaKey: true }), false, false)).toBe('force');
    expect(orderChord(m({ ctrlKey: true, shiftKey: true }), false, false)).toBe('attackMove');
    expect(orderChord(m({ altKey: true }), false, false)).toBe('forceMove');
    expect(orderChord(m(), true, false)).toBe('waypoint');
    expect(orderChord(m({ altKey: true }), true, false)).toBe('forceMove');
  });
  it('leaves ⌃ alone when it is the right-click substitute', () => {
    expect(orderChord(m({ ctrlKey: true }), false, true)).toBeNull();
    expect(orderChord(m({ metaKey: true }), false, true)).toBe('force');
    expect(orderChord(m({ metaKey: true, shiftKey: true }), false, true)).toBe('attackMove');
  });
});
