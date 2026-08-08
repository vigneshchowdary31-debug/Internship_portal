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

    // --- LMS (Phase 2). Added alongside the originals rather than replacing
    // them, so every pre-existing test keeps its exact behaviour.
    content: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    },
    module: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    learningPath: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    batch: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    studentBatch: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    /** Backs `instructorBatchIds`, the basis of every instructor-scoped query. */
    instructorBatch: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    notification: {
      create: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    notificationRecipient: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    contentProgress: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },

    // --- LMS (Phase 3). Appended, same as Phase 2 was: no existing entry is
    // touched, so every pre-existing test keeps its exact behaviour.
    assignment: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    submission: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn(),
    },
    mediaAsset: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
    },
    quiz: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    question: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    attempt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },

    $transaction: vi.fn(),
    /** Used by the health probe's `SELECT 1` and by catalog inspections. */
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;
