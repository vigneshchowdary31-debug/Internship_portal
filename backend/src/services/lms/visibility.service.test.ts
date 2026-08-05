import { describe, it, expect } from 'vitest';
import { isVisible, contentVisibilityWhere } from './visibility.service';

/**
 * The visibility rule is the single most security-sensitive piece of Phase 1:
 * getting it wrong leaks another batch's material, or a draft, or an unreleased
 * item. Every branch is pinned here.
 */

const NOW = new Date('2026-08-01T12:00:00Z');
const PAST = new Date('2026-07-01T00:00:00Z');
const FUTURE = new Date('2026-09-01T00:00:00Z');

const global = (over: Partial<Parameters<typeof isVisible>[0]> = {}) => ({
  status: 'PUBLISHED',
  releaseAt: null,
  scope: 'LEARNING_PATH',
  batchId: null,
  overriddenBy: null,
  ...over,
});

const batchItem = (batchId: string, over: Partial<Parameters<typeof isVisible>[0]> = {}) => ({
  status: 'PUBLISHED',
  releaseAt: null,
  scope: 'BATCH',
  batchId,
  overriddenBy: null,
  ...over,
});

const asStudent = (batchId: string) => ({ batchId, includeUnpublished: false, now: NOW });
const asAdmin = { batchId: null, includeUnpublished: true, now: NOW };

describe('isVisible — status gating', () => {
  it('shows a published global item to a student', () => {
    expect(isVisible(global(), asStudent('B1'))).toBe(true);
  });

  it('hides a DRAFT item from a student', () => {
    expect(isVisible(global({ status: 'DRAFT' }), asStudent('B1'))).toBe(false);
  });

  it('hides an ARCHIVED item from a student', () => {
    expect(isVisible(global({ status: 'ARCHIVED' }), asStudent('B1'))).toBe(false);
  });

  it('shows drafts to an admin', () => {
    expect(isVisible(global({ status: 'DRAFT' }), asAdmin)).toBe(true);
  });
});

describe('isVisible — scheduled release (lazy, no scheduler)', () => {
  it('hides an item whose release moment has not arrived', () => {
    expect(isVisible(global({ releaseAt: FUTURE }), asStudent('B1'))).toBe(false);
  });

  it('shows an item whose release moment has passed', () => {
    expect(isVisible(global({ releaseAt: PAST }), asStudent('B1'))).toBe(true);
  });

  it('treats a null releaseAt as immediate', () => {
    expect(isVisible(global({ releaseAt: null }), asStudent('B1'))).toBe(true);
  });

  it('releases exactly at the boundary instant', () => {
    expect(isVisible(global({ releaseAt: NOW }), asStudent('B1'))).toBe(true);
  });

  it('shows unreleased items to an admin', () => {
    expect(isVisible(global({ releaseAt: FUTURE }), asAdmin)).toBe(true);
  });
});

describe('isVisible — batch scoping', () => {
  it("shows a batch's own item to that batch", () => {
    expect(isVisible(batchItem('B1'), asStudent('B1'))).toBe(true);
  });

  it("hides another batch's item", () => {
    expect(isVisible(batchItem('B2'), asStudent('B1'))).toBe(false);
  });

  it('hides a batch item from a student with no batch', () => {
    expect(isVisible(batchItem('B1'), { batchId: null, includeUnpublished: false, now: NOW })).toBe(
      false
    );
  });

  it('shows a global item to every batch', () => {
    expect(isVisible(global(), asStudent('B1'))).toBe(true);
    expect(isVisible(global(), asStudent('B2'))).toBe(true);
  });
});

describe('isVisible — inherit vs override', () => {
  it('hides a global item from the batch that overrode it', () => {
    const overridden = global({ overriddenBy: { batchId: 'B1' } });
    expect(isVisible(overridden, asStudent('B1'))).toBe(false);
  });

  it('still shows that global item to every OTHER batch', () => {
    const overridden = global({ overriddenBy: { batchId: 'B1' } });
    expect(isVisible(overridden, asStudent('B2'))).toBe(true);
  });

  it('inherit-and-add: a batch item with no override leaves the global visible', () => {
    // Both are visible — this is the "add alongside" case.
    expect(isVisible(global(), asStudent('B1'))).toBe(true);
    expect(isVisible(batchItem('B1'), asStudent('B1'))).toBe(true);
  });

  it('shows the overriding batch item itself', () => {
    expect(isVisible(batchItem('B1', { scope: 'BATCH' }), asStudent('B1'))).toBe(true);
  });
});

describe('contentVisibilityWhere', () => {
  it('returns an unrestricted clause for an admin', () => {
    expect(contentVisibilityWhere({ batchId: null, includeUnpublished: true })).toEqual({});
  });

  it('gates on status when unpublished is excluded and no batch is set', () => {
    const where = contentVisibilityWhere({ batchId: null, includeUnpublished: false, now: NOW });
    expect(where.status).toBe('PUBLISHED');
  });

  it('builds the union of non-overridden globals and own-batch items', () => {
    const where = contentVisibilityWhere({ batchId: 'B1', includeUnpublished: true });
    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toMatchObject({
      scope: 'LEARNING_PATH',
      NOT: { overriddenBy: { batchId: 'B1' } },
    });
    expect(where.OR?.[1]).toMatchObject({ scope: 'BATCH', batchId: 'B1' });
  });

  it('combines status and scope for a student', () => {
    const where = contentVisibilityWhere({ batchId: 'B1', includeUnpublished: false, now: NOW });
    expect(where.AND).toHaveLength(2);
  });
});
