import { describe, it, expect } from 'vitest';
import { deriveQuizStatus, latestCompletedAttempt } from './QuizCard';
import type { Attempt } from '@/services/quizzes';

/**
 * The status derivation decides which button a student sees, so every attempt
 * shape is pinned here. It is a pure function precisely so this can be done
 * without rendering anything.
 */

const attempt = (over: Partial<Attempt> = {}): Attempt =>
  ({
    id: 'a1',
    quizId: 'quiz1',
    studentId: 's1',
    answers: null,
    score: null,
    totalMarks: null,
    startedAt: '2026-08-01T10:00:00Z',
    submittedAt: '2026-08-01T10:20:00Z',
    expiresAt: '2026-08-01T10:30:00Z',
    autoSubmitted: false,
    quiz: null,
    ...over,
  }) as Attempt;

const open = () => attempt({ id: 'open', submittedAt: null });

describe('deriveQuizStatus', () => {
  it('is NOT_STARTED with no attempts', () => {
    expect(deriveQuizStatus([], 3)).toMatchObject({
      status: 'NOT_STARTED',
      attemptsUsed: 0,
      attemptsLeft: 3,
    });
  });

  it('is IN_PROGRESS while an attempt is open', () => {
    expect(deriveQuizStatus([open()], 3).status).toBe('IN_PROGRESS');
  });

  it('prefers IN_PROGRESS over a completed attempt', () => {
    // A student who finished once and started again must be sent back to the
    // running attempt, not offered a third.
    const result = deriveQuizStatus([attempt(), open()], 3);
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.openAttempt?.id).toBe('open');
  });

  it('is COMPLETED while attempts remain', () => {
    expect(deriveQuizStatus([attempt()], 3)).toMatchObject({
      status: 'COMPLETED',
      attemptsUsed: 1,
      attemptsLeft: 2,
    });
  });

  it('is COMPLETED_FINAL once the cap is reached', () => {
    const attempts = [attempt({ id: '1' }), attempt({ id: '2' })];
    expect(deriveQuizStatus(attempts, 2)).toMatchObject({
      status: 'COMPLETED_FINAL',
      attemptsLeft: 0,
    });
  });

  it('does not count an OPEN attempt as used', () => {
    // Otherwise resuming the only attempt would show "0 left" and the student
    // would think they had already spent it.
    expect(deriveQuizStatus([open()], 1)).toMatchObject({
      attemptsUsed: 0,
      attemptsLeft: 1,
      status: 'IN_PROGRESS',
    });
  });
});

describe('unlimited attempts (maxAttempts null)', () => {
  it('never reaches COMPLETED_FINAL', () => {
    const many = Array.from({ length: 50 }, (_, i) => attempt({ id: String(i) }));
    expect(deriveQuizStatus(many, null).status).toBe('COMPLETED');
  });

  it('reports attemptsLeft as null, not NaN', () => {
    // `maxAttempts - attemptsUsed` on a null cap yields NaN, which renders as
    // "NaN attempts left" and compares falsely in every direction.
    const result = deriveQuizStatus([attempt()], null);
    expect(result.attemptsLeft).toBeNull();
    expect(Number.isNaN(result.attemptsLeft as unknown as number)).toBe(false);
  });

  it('still starts at NOT_STARTED', () => {
    expect(deriveQuizStatus([], null).status).toBe('NOT_STARTED');
  });
});

describe('never reports a negative allowance', () => {
  it('floors attemptsLeft at zero if the cap was lowered after the fact', () => {
    const attempts = [attempt({ id: '1' }), attempt({ id: '2' }), attempt({ id: '3' })];
    expect(deriveQuizStatus(attempts, 2)).toMatchObject({
      attemptsLeft: 0,
      status: 'COMPLETED_FINAL',
    });
  });
});

describe('latestCompletedAttempt', () => {
  it('returns the most recently submitted one', () => {
    const older = attempt({ id: 'older', submittedAt: '2026-08-01T10:00:00Z' });
    const newer = attempt({ id: 'newer', submittedAt: '2026-08-02T10:00:00Z' });

    // Order in the array is not order in time — the server sorts by startedAt.
    expect(latestCompletedAttempt([older, newer])?.id).toBe('newer');
    expect(latestCompletedAttempt([newer, older])?.id).toBe('newer');
  });

  it('ignores an open attempt', () => {
    expect(latestCompletedAttempt([open()])).toBeNull();
  });

  it('returns null when nothing is finished', () => {
    expect(latestCompletedAttempt([])).toBeNull();
  });
});
