import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const { SearchService } = await import('./search.service');
const { contentVisibilityWhere } = await import('./visibility.service');

// `now` is pinned: contentVisibilityWhere defaults it to new Date(), so a
// service call and a test-side recomputation would otherwise differ by a
// millisecond and compare unequal — passing or failing on timing alone.
const NOW = new Date('2026-06-01T00:00:00.000Z');
const STUDENT = { batchId: 'b1', includeUnpublished: false, now: NOW };
const ADMIN = { batchId: null, includeUnpublished: true, now: NOW };

/** The `where` handed to findMany by the last searchContent call. */
function lastWhere() {
  return prismaMock.content.findMany.mock.calls[0]![0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.content.findMany.mockResolvedValue([]);
  prismaMock.content.count.mockResolvedValue(0);
  // $transaction([a, b]) — resolve the array the service destructures.
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe('search is always confined to the caller\'s visibility', () => {
  it('AND-s the visibility clause into every query', async () => {
    await SearchService.searchContent({ q: 'react' }, STUDENT);

    const where = lastWhere();
    // The clause must be present verbatim — a search that filters only by term
    // happily returns another batch's material and looks correct in any test
    // that checks the term alone.
    expect(where.AND).toContainEqual(contentVisibilityWhere(STUDENT));
  });

  it('keeps the visibility clause even with no search term and no filters', async () => {
    await SearchService.searchContent({}, STUDENT);
    expect(lastWhere().AND).toContainEqual(contentVisibilityWhere(STUDENT));
  });

  it('cannot be widened by a user-supplied batchId', async () => {
    // A student passing someone else's batch gets their own visibility clause
    // AND-ed on top, so the two conflict and match nothing.
    await SearchService.searchContent({ batchId: 'b-someone-else' }, STUDENT);

    const where = lastWhere();
    expect(where.AND).toContainEqual(contentVisibilityWhere(STUDENT));
    expect(where.AND).toContainEqual({ batchId: 'b-someone-else' });
  });

  it('gives an admin the unrestricted clause', async () => {
    await SearchService.searchContent({ q: 'x' }, ADMIN);
    expect(lastWhere().AND).toContainEqual(contentVisibilityWhere(ADMIN));
  });
});

describe('filters', () => {
  it('searches title and description case-insensitively', async () => {
    await SearchService.searchContent({ q: '  Hooks  ' }, ADMIN);

    expect(lastWhere().AND).toContainEqual({
      OR: [
        { title: { contains: 'Hooks', mode: 'insensitive' } },
        { description: { contains: 'Hooks', mode: 'insensitive' } },
      ],
    });
  });

  it('omits the text clause entirely for a blank term', async () => {
    await SearchService.searchContent({ q: '   ' }, ADMIN);

    const clauses = lastWhere().AND;
    expect(clauses.some((c: Record<string, unknown>) => 'OR' in c && Array.isArray(c.OR) && 'title' in (c.OR as Record<string, unknown>[])[0]!)).toBe(false);
  });

  it.each([
    ['moduleId', { moduleId: 'm1' }],
    ['type', { type: 'PDF' }],
    ['status', { status: 'DRAFT' }],
    ['scope', { scope: 'BATCH' as const }],
    ['learningPathId', { learningPathId: 'lp1' }],
  ])('applies the %s filter', async (_label, filter) => {
    await SearchService.searchContent(filter, ADMIN);
    expect(lastWhere().AND).toContainEqual(filter);
  });
});

describe('pagination', () => {
  it('defaults to page 1 at the default size', async () => {
    await SearchService.searchContent({}, ADMIN);

    const call = prismaMock.content.findMany.mock.calls[0]![0];
    expect(call.skip).toBe(0);
    expect(call.take).toBe(25);
  });

  it('computes skip from page and size', async () => {
    await SearchService.searchContent({ page: 3, pageSize: 10 }, ADMIN);

    const call = prismaMock.content.findMany.mock.calls[0]![0];
    expect(call.skip).toBe(20);
    expect(call.take).toBe(10);
  });

  it('caps pageSize so a client cannot request the whole table', async () => {
    await SearchService.searchContent({ pageSize: 100000 }, ADMIN);
    expect(prismaMock.content.findMany.mock.calls[0]![0].take).toBe(100);
  });

  it('clamps nonsensical paging rather than producing a negative skip', async () => {
    await SearchService.searchContent({ page: -5, pageSize: 0 }, ADMIN);

    const call = prismaMock.content.findMany.mock.calls[0]![0];
    expect(call.skip).toBe(0);
    expect(call.take).toBeGreaterThan(0);
  });

  it('reports totals and hasMore from the count', async () => {
    prismaMock.content.count.mockResolvedValue(57);
    prismaMock.content.findMany.mockResolvedValue([]);

    const result = await SearchService.searchContent({ page: 1, pageSize: 25 }, ADMIN);

    expect(result.total).toBe(57);
    expect(result.totalPages).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore false on the last page', async () => {
    prismaMock.content.count.mockResolvedValue(20);
    const result = await SearchService.searchContent({ page: 1, pageSize: 25 }, ADMIN);
    expect(result.hasMore).toBe(false);
  });
});

describe('N+1 avoidance', () => {
  it('selects the module and path inline rather than fetching per hit', async () => {
    await SearchService.searchContent({ q: 'x' }, ADMIN);

    const select = prismaMock.content.findMany.mock.calls[0]![0].select;
    expect(select.module).toBeDefined();
    expect(select.learningPath).toBeDefined();
  });
});

describe('facets', () => {
  it('counts by type and status inside the visibility clause', async () => {
    prismaMock.content.groupBy
      .mockResolvedValueOnce([{ type: 'PDF', _count: { _all: 4 } }])
      .mockResolvedValueOnce([{ status: 'PUBLISHED', _count: { _all: 4 } }]);

    const facets = await SearchService.facets({}, STUDENT);

    expect(facets.types).toEqual([{ value: 'PDF', count: 4 }]);
    expect(facets.statuses).toEqual([{ value: 'PUBLISHED', count: 4 }]);

    for (const call of prismaMock.content.groupBy.mock.calls) {
      expect(call[0].where.AND).toContainEqual(contentVisibilityWhere(STUDENT));
    }
  });

  it('uses two grouped queries, not one per filter option', async () => {
    await SearchService.facets({}, ADMIN);
    expect(prismaMock.content.groupBy).toHaveBeenCalledTimes(2);
  });
});
