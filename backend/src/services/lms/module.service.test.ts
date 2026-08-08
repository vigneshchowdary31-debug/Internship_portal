import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const { ModuleService } = await import('./module.service');

/**
 * Module deletion is the SECOND route to the assignment/submission cascade.
 *
 * Everything under a module cascades: module → assignment → submission. A guard
 * that only lives in AssignmentService.remove is bypassed completely by
 * deleting the module instead, so the same rule has to hold here.
 */

const moduleWith = (counts: { contents?: number; assignments?: number; quizzes?: number }) => ({
  id: 'm1',
  name: 'React',
  _count: {
    contents: counts.contents ?? 0,
    assignments: counts.assignments ?? 0,
    quizzes: counts.quizzes ?? 0,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.module.findUnique.mockResolvedValue(moduleWith({}));
  prismaMock.module.delete.mockResolvedValue({});
});

describe('remove', () => {
  it('deletes an empty module', async () => {
    await expect(ModuleService.remove('m1')).resolves.toBe(true);
    expect(prismaMock.module.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('404s an unknown module', async () => {
    prismaMock.module.findUnique.mockResolvedValue(null);

    await expect(ModuleService.remove('nope')).rejects.toThrow('Module not found');
    expect(prismaMock.module.delete).not.toHaveBeenCalled();
  });

  it('still refuses a module holding content', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleWith({ contents: 4 }));

    await expect(ModuleService.remove('m1')).rejects.toThrow(/4 content item\(s\)/);
    expect(prismaMock.module.delete).not.toHaveBeenCalled();
  });
});

describe('remove — the module → assignment → submission cascade', () => {
  it('refuses a module holding an assignment, even with no content', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleWith({ assignments: 1 }));

    // The dangerous shape: nothing in the old guard's count, but deleting it
    // would cascade to the assignment and then to every submission on it.
    await expect(ModuleService.remove('m1')).rejects.toThrow(/1 assignment\(s\)/);
    expect(prismaMock.module.delete).not.toHaveBeenCalled();
  });

  it('refuses a module holding a quiz, even with no content', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleWith({ quizzes: 2 }));

    await expect(ModuleService.remove('m1')).rejects.toThrow(/2 quiz\(zes\)/);
    expect(prismaMock.module.delete).not.toHaveBeenCalled();
  });

  it('names everything that is blocking, not just the first thing', async () => {
    prismaMock.module.findUnique.mockResolvedValue(
      moduleWith({ contents: 3, assignments: 1, quizzes: 2 })
    );

    // An admin clearing a module should learn the whole job in one message
    // rather than discovering it one refusal at a time.
    const error = await ModuleService.remove('m1').catch((e) => e);
    expect(error.message).toContain('3 content item(s)');
    expect(error.message).toContain('1 assignment(s)');
    expect(error.message).toContain('2 quiz(zes)');
  });

  it('omits the categories that are empty', async () => {
    prismaMock.module.findUnique.mockResolvedValue(moduleWith({ assignments: 1 }));

    const error = await ModuleService.remove('m1').catch((e) => e);
    expect(error.message).not.toContain('content item');
    expect(error.message).not.toContain('quiz');
  });
});
