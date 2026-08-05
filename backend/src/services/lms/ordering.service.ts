import { AppError } from '../../utils/AppError';

/**
 * Drag-and-drop reordering.
 *
 * Positions are dense integers (0, 1, 2, …) rewritten as a set rather than
 * patched individually. Fractional indexing would avoid rewriting siblings, but
 * these lists are 5–30 items and rewriting them all in one transaction is
 * simpler, has no precision drift, and cannot leave gaps that later confuse
 * an ORDER BY.
 */

/**
 * Validates a reorder request against the ids that actually exist.
 *
 * The check is strict on purpose: a client that sends a stale list (an item
 * deleted in another tab, or an id from a different module) must be told, not
 * silently allowed to reshuffle a partial list and drop items to position 0.
 */
export function assertValidReorder(orderedIds: string[], existingIds: string[]): void {
  if (orderedIds.length === 0) {
    throw new AppError('No items were supplied to reorder.', 400);
  }

  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) {
      throw new AppError('The same item appears more than once in the new order.', 400);
    }
    seen.add(id);
  }

  const existing = new Set(existingIds);

  const unknown = orderedIds.filter((id) => !existing.has(id));
  if (unknown.length > 0) {
    throw new AppError(
      `${unknown.length} item(s) in the new order do not belong here. Refresh and try again.`,
      400
    );
  }

  const missing = existingIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new AppError(
      `The new order is missing ${missing.length} item(s). Refresh and try again.`,
      400
    );
  }
}

/** Maps an ordered id list to dense positions. */
export function toPositionUpdates(orderedIds: string[]): { id: string; position: number }[] {
  return orderedIds.map((id, index) => ({ id, position: index }));
}

/**
 * Next position for a newly created item — appended to the end.
 * `max` is the current highest position, or null for an empty list.
 */
export function nextPosition(max: number | null | undefined): number {
  return max === null || max === undefined ? 0 : max + 1;
}
