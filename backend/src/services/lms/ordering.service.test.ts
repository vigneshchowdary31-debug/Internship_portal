import { describe, it, expect } from 'vitest';
import { assertValidReorder, toPositionUpdates, nextPosition } from './ordering.service';

describe('assertValidReorder', () => {
  const existing = ['a', 'b', 'c'];

  it('accepts a complete permutation', () => {
    expect(() => assertValidReorder(['c', 'a', 'b'], existing)).not.toThrow();
  });

  it('rejects an empty list', () => {
    expect(() => assertValidReorder([], existing)).toThrow(/No items/);
  });

  it('rejects duplicates', () => {
    expect(() => assertValidReorder(['a', 'a', 'b'], existing)).toThrow(/more than once/);
  });

  it('rejects an id that does not belong to this list', () => {
    // Guards against reordering across modules, accidentally or otherwise.
    expect(() => assertValidReorder(['a', 'b', 'c', 'z'], existing)).toThrow(/do not belong/);
  });

  it('rejects a partial list — a stale client must not drop items', () => {
    expect(() => assertValidReorder(['a', 'b'], existing)).toThrow(/missing 1 item/);
  });

  it('accepts a single-item list', () => {
    expect(() => assertValidReorder(['a'], ['a'])).not.toThrow();
  });
});

describe('toPositionUpdates', () => {
  it('maps order to dense zero-based positions', () => {
    expect(toPositionUpdates(['c', 'a', 'b'])).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
    ]);
  });

  it('leaves no gaps', () => {
    const positions = toPositionUpdates(['a', 'b', 'c', 'd']).map((u) => u.position);
    expect(positions).toEqual([0, 1, 2, 3]);
  });
});

describe('nextPosition', () => {
  it('starts an empty list at 0', () => {
    expect(nextPosition(null)).toBe(0);
    expect(nextPosition(undefined)).toBe(0);
  });

  it('appends after the current maximum', () => {
    expect(nextPosition(4)).toBe(5);
  });

  it('handles a single-item list at position 0', () => {
    expect(nextPosition(0)).toBe(1);
  });
});
