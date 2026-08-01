import { vi } from 'vitest';

/**
 * In-memory Prisma double.
 *
 * The services under test are thin orchestration over Prisma, so the interesting
 * behaviour — status transitions, audit events, guard rails, what is and is not
 * returned — is all observable without a real database. This double exists so
 * those paths can be asserted in milliseconds rather than requiring Postgres in
 * CI.
 *
 * It is deliberately shallow: `where` clauses are not evaluated. Each test sets
 * the return value it needs. Anything that genuinely depends on query semantics
 * (the `buildWhere` filters) is tested by asserting the clause that gets built,
 * not by executing it.
 */
export function createPrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    techStack: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    enrollmentEvent: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
  };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;
