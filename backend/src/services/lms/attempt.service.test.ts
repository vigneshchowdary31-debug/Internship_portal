import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const { AttemptService, markAnswers } = await import('./attempt.service');

const MINUTE = 60 * 1000;

const QUESTIONS = [
  { id: 'q-a', question: 'What is JSX?', options: ['Syntax', 'DB'], correctAnswer: 'Syntax', marks: 2, position: 0 },
  { id: 'q-b', question: 'What is a hook?', options: ['Fn', 'Class'], correctAnswer: 'Fn', marks: 3, position: 1 },
];

const QUIZ = {
  id: 'quiz1',
  title: 'React Fundamentals',
  description: null,
  timeLimit: 30,
  maxAttempts: null,
  moduleId: 'm1',
  questions: QUESTIONS,
};

const asStudent = { batchId: 'b1', includeUnpublished: false };

const openAttempt = (over: Record<string, unknown> = {}) => ({
  id: 'att1',
  quizId: 'quiz1',
  studentId: 's1',
  startedAt: new Date(Date.now() - 5 * MINUTE),
  expiresAt: new Date(Date.now() + 25 * MINUTE),
  submittedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.quiz.findFirst.mockResolvedValue(QUIZ);
  prismaMock.attempt.findFirst.mockResolvedValue(null);
  prismaMock.attempt.findMany.mockResolvedValue([]);
  prismaMock.attempt.create.mockResolvedValue({ id: 'att1' });
  prismaMock.attempt.update.mockResolvedValue({ id: 'att1' });
  prismaMock.attempt.count.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

// --- Auto evaluation --------------------------------------------------------

describe('markAnswers — the arithmetic', () => {
  it('awards each question its own marks, not one point each', () => {
    const result = markAnswers(QUESTIONS, { 'q-a': 'Syntax', 'q-b': 'Fn' });

    expect(result.score).toBe(5);
    expect(result.totalMarks).toBe(5);
    expect(result.correctCount).toBe(2);
  });

  it('scores a partially correct paper', () => {
    const result = markAnswers(QUESTIONS, { 'q-a': 'Syntax', 'q-b': 'Class' });

    expect(result.score).toBe(2);
    expect(result.totalMarks).toBe(5);
    expect(result.correctCount).toBe(1);
  });

  it('scores an empty paper at zero without dividing by anything', () => {
    const result = markAnswers(QUESTIONS, {});
    expect(result).toMatchObject({ score: 0, totalMarks: 5, correctCount: 0 });
  });

  it('marks a MISSING answer wrong', () => {
    const result = markAnswers(QUESTIONS, { 'q-a': 'Syntax' });
    expect(result.score).toBe(2);
  });

  it('marks an answer that is not one of the options wrong', () => {
    const result = markAnswers(QUESTIONS, { 'q-a': 'Something else entirely' });
    expect(result.score).toBe(0);
  });

  it('IGNORES an answer for a question that is not on the paper', () => {
    // A malformed client must not be able to invalidate an otherwise complete
    // submission, and it certainly must not earn marks.
    const result = markAnswers(QUESTIONS, { 'q-a': 'Syntax', 'not-a-question': 'Syntax' });

    expect(result.score).toBe(2);
    expect(result.questionCount).toBe(2);
  });

  it.each([[null], [42], [undefined], [{ nested: true }], [['array']]])(
    'marks a non-string answer (%s) wrong rather than throwing',
    (value) => {
      expect(markAnswers(QUESTIONS, { 'q-a': value }).score).toBe(0);
    }
  );

  it('is case- and whitespace-sensitive, matching the stored option exactly', () => {
    expect(markAnswers(QUESTIONS, { 'q-a': 'syntax' }).score).toBe(0);
    expect(markAnswers(QUESTIONS, { 'q-a': ' Syntax' }).score).toBe(0);
  });

  it('totals marks over an empty question set without NaN', () => {
    expect(markAnswers([], {})).toMatchObject({ score: 0, totalMarks: 0 });
  });
});

// --- Start ------------------------------------------------------------------

describe('start', () => {
  it('pins expiresAt from the quiz time limit', async () => {
    const before = Date.now();
    await AttemptService.start('quiz1', 's1', asStudent);

    const data = prismaMock.attempt.create.mock.calls[0]![0].data;
    const elapsed = data.expiresAt.getTime() - before;
    expect(elapsed).toBeGreaterThanOrEqual(30 * MINUTE - 1000);
    expect(elapsed).toBeLessThanOrEqual(30 * MINUTE + 1000);
  });

  it('never returns the answer key', async () => {
    const result = await AttemptService.start('quiz1', 's1', asStudent);

    // The single thing that must not leak from this endpoint.
    expect(JSON.stringify(result.quiz)).not.toContain('correctAnswer');
    expect(result.quiz.questions[0]).not.toHaveProperty('correctAnswer');
  });

  it('returns the questions in position order', async () => {
    const result = await AttemptService.start('quiz1', 's1', asStudent);
    expect(result.quiz.questions.map((q: any) => q.id)).toEqual(['q-a', 'q-b']);
  });

  it('reports the seconds remaining', async () => {
    const result = await AttemptService.start('quiz1', 's1', asStudent);
    expect(result.secondsRemaining).toBeGreaterThan(29 * 60);
    expect(result.secondsRemaining).toBeLessThanOrEqual(30 * 60);
  });
});

describe('start — visibility and authorization', () => {
  it('404s an unpublished or invisible quiz', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(null);

    // One query covers "unpublished", "hidden module" and "another batch" —
    // three checks that could otherwise disagree.
    await expect(AttemptService.start('quiz1', 's1', asStudent)).rejects.toThrow('Quiz not found');
    expect(prismaMock.attempt.create).not.toHaveBeenCalled();
  });

  it('resolves the quiz through the shared visibility clause', async () => {
    await AttemptService.start('quiz1', 's1', asStudent);

    const where = prismaMock.quiz.findFirst.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ id: 'quiz1' });
    expect(where.AND[1]).toBeTruthy();
  });

  it('refuses a quiz with no questions', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue({ ...QUIZ, questions: [] });

    await expect(AttemptService.start('quiz1', 's1', asStudent)).rejects.toThrow(
      /no questions yet/
    );
  });
});

describe('start — resuming rather than restarting', () => {
  it('returns the running attempt instead of opening a second one', async () => {
    const open = openAttempt();
    prismaMock.attempt.findFirst.mockResolvedValue(open);

    const result = await AttemptService.start('quiz1', 's1', asStudent);

    // A page reload must not burn an attempt.
    expect(result.resumed).toBe(true);
    expect(result.attempt).toBe(open);
    expect(prismaMock.attempt.create).not.toHaveBeenCalled();
  });

  it('does NOT restart the clock on resume', async () => {
    const expiresAt = new Date(Date.now() + 3 * MINUTE);
    prismaMock.attempt.findFirst.mockResolvedValue(openAttempt({ expiresAt }));

    const result = await AttemptService.start('quiz1', 's1', asStudent);

    // A reload buys nothing: three minutes left stays three minutes left.
    expect(result.secondsRemaining).toBeLessThanOrEqual(3 * 60);
    expect(result.secondsRemaining).toBeGreaterThan(2 * 60);
  });

  it('closes an abandoned expired attempt before opening a new one', async () => {
    prismaMock.attempt.findFirst.mockResolvedValue(
      openAttempt({ expiresAt: new Date(Date.now() - MINUTE) })
    );

    const result = await AttemptService.start('quiz1', 's1', asStudent);

    const finalize = prismaMock.attempt.update.mock.calls[0]![0].data;
    expect(finalize.autoSubmitted).toBe(true);
    expect(finalize.score).toBe(0);
    expect(result.resumed).toBe(false);
    expect(prismaMock.attempt.create).toHaveBeenCalled();
  });

  it('stamps the abandoned attempt at its EXPIRY, not at now', async () => {
    const expiresAt = new Date(Date.now() - 3 * 24 * 60 * MINUTE);
    prismaMock.attempt.findFirst.mockResolvedValue(openAttempt({ expiresAt }));

    await AttemptService.start('quiz1', 's1', asStudent);

    // The attempt ended when the clock ran out, not when the server noticed —
    // which here would misreport it by three days.
    expect(prismaMock.attempt.update.mock.calls[0]![0].data.submittedAt).toBe(expiresAt);
  });
});

describe('start — attempt cap', () => {
  it('allows unlimited attempts when maxAttempts is null', async () => {
    prismaMock.attempt.count.mockResolvedValue(99);

    await expect(AttemptService.start('quiz1', 's1', asStudent)).resolves.toBeTruthy();
    expect(prismaMock.attempt.count).not.toHaveBeenCalled();
  });

  it('refuses once the cap is reached', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue({ ...QUIZ, maxAttempts: 2 });
    prismaMock.attempt.count.mockResolvedValue(2);

    await expect(AttemptService.start('quiz1', 's1', asStudent)).rejects.toThrow(
      /used all 2 attempt/
    );
    expect(prismaMock.attempt.create).not.toHaveBeenCalled();
  });

  it('allows the last permitted attempt', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue({ ...QUIZ, maxAttempts: 3 });
    prismaMock.attempt.count.mockResolvedValue(2);

    await expect(AttemptService.start('quiz1', 's1', asStudent)).resolves.toBeTruthy();
  });

  it('counts only CLOSED attempts against the cap', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue({ ...QUIZ, maxAttempts: 2 });

    await AttemptService.start('quiz1', 's1', asStudent);

    expect(prismaMock.attempt.count.mock.calls[0]![0].where).toEqual({
      quizId: 'quiz1',
      studentId: 's1',
      submittedAt: { not: null },
    });
  });
});

// --- Submit -----------------------------------------------------------------

describe('submit', () => {
  beforeEach(() => {
    prismaMock.attempt.findFirst.mockResolvedValue(openAttempt());
  });

  it('marks the answers and closes the attempt', async () => {
    const { result } = await AttemptService.submit(
      'quiz1',
      's1',
      { 'q-a': 'Syntax', 'q-b': 'Fn' },
      asStudent
    );

    expect(result.score).toBe(5);
    const data = prismaMock.attempt.update.mock.calls[0]![0].data;
    expect(data.score).toBe(5);
    expect(data.totalMarks).toBe(5);
    expect(data.submittedAt).toBeInstanceOf(Date);
  });

  it('stores the answers as given, so a mark can be explained', async () => {
    const answers = { 'q-a': 'Syntax', 'q-b': 'Class' };
    await AttemptService.submit('quiz1', 's1', answers, asStudent);

    expect(prismaMock.attempt.update.mock.calls[0]![0].data.answers).toEqual(answers);
  });

  it('rejects submitting without starting', async () => {
    prismaMock.attempt.findFirst.mockResolvedValue(null);

    await expect(AttemptService.submit('quiz1', 's1', {}, asStudent)).rejects.toThrow(
      /no quiz in progress/
    );
    expect(prismaMock.attempt.update).not.toHaveBeenCalled();
  });

  it('rejects a second submission for the same attempt', async () => {
    // Once submitted the attempt is closed, so the open-attempt lookup finds
    // nothing — the same path as never having started.
    prismaMock.attempt.findFirst.mockResolvedValue(null);

    await expect(AttemptService.submit('quiz1', 's1', {}, asStudent)).rejects.toThrow(
      /no quiz in progress/
    );
  });

  it('looks only for an OPEN attempt', async () => {
    await AttemptService.submit('quiz1', 's1', {}, asStudent);

    expect(prismaMock.attempt.findFirst.mock.calls[0]![0].where).toMatchObject({
      quizId: 'quiz1',
      studentId: 's1',
      submittedAt: null,
    });
  });

  it('404s a quiz that stopped being visible mid-attempt', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(null);

    await expect(AttemptService.submit('quiz1', 's1', {}, asStudent)).rejects.toThrow(
      'Quiz not found'
    );
  });
});

describe('submit — the timer', () => {
  it('accepts a submission inside the limit', async () => {
    prismaMock.attempt.findFirst.mockResolvedValue(
      openAttempt({ expiresAt: new Date(Date.now() + MINUTE) })
    );

    await expect(
      AttemptService.submit('quiz1', 's1', { 'q-a': 'Syntax' }, asStudent)
    ).resolves.toBeTruthy();
  });

  it('accepts a submission a few seconds late, inside the grace window', async () => {
    prismaMock.attempt.findFirst.mockResolvedValue(
      openAttempt({ expiresAt: new Date(Date.now() - 5 * 1000) })
    );

    // Network latency and clock skew are the only legitimate reasons a client
    // that fired on time arrives late.
    await expect(
      AttemptService.submit('quiz1', 's1', { 'q-a': 'Syntax' }, asStudent)
    ).resolves.toBeTruthy();
  });

  it('rejects a submission past the grace window', async () => {
    prismaMock.attempt.findFirst.mockResolvedValue(
      openAttempt({ expiresAt: new Date(Date.now() - 5 * MINUTE) })
    );

    await expect(
      AttemptService.submit('quiz1', 's1', { 'q-a': 'Syntax', 'q-b': 'Fn' }, asStudent)
    ).rejects.toThrow(/Time is up/);
  });

  it('closes the expired attempt at zero rather than leaving it open', async () => {
    const expiresAt = new Date(Date.now() - 5 * MINUTE);
    prismaMock.attempt.findFirst.mockResolvedValue(openAttempt({ expiresAt }));

    await expect(
      AttemptService.submit('quiz1', 's1', { 'q-a': 'Syntax', 'q-b': 'Fn' }, asStudent)
    ).rejects.toThrow();

    // Otherwise the student could keep retrying until one happened to land.
    const data = prismaMock.attempt.update.mock.calls[0]![0].data;
    expect(data.score).toBe(0);
    expect(data.autoSubmitted).toBe(true);
    expect(data.submittedAt).toBe(expiresAt);
  });

  it('does not credit the late answers it was sent', async () => {
    prismaMock.attempt.findFirst.mockResolvedValue(
      openAttempt({ expiresAt: new Date(Date.now() - 5 * MINUTE) })
    );

    await expect(
      AttemptService.submit('quiz1', 's1', { 'q-a': 'Syntax', 'q-b': 'Fn' }, asStudent)
    ).rejects.toThrow();

    // A fully correct late paper still scores zero — otherwise the limit is
    // advisory, which is not a limit.
    expect(prismaMock.attempt.update.mock.calls[0]![0].data.answers).toEqual({});
  });
});

// --- Reads ------------------------------------------------------------------

describe('list — scope is applied in SQL', () => {
  const whereOf = () => prismaMock.attempt.findMany.mock.calls[0]![0].where;

  it('puts the viewer scope first, ahead of any filter', async () => {
    await AttemptService.list({ quizId: 'quiz1' }, { studentId: 's1' });

    expect(whereOf().AND[0]).toEqual({ studentId: 's1' });
    expect(whereOf().AND).toContainEqual({ quizId: 'quiz1' });
  });

  it("keeps the scope when a student asks for someone else's attempts", async () => {
    await AttemptService.list({ studentId: 's2' }, { studentId: 's1' });

    // Both clauses AND-ed resolves to nothing, rather than to a classmate's run.
    expect(whereOf().AND).toContainEqual({ studentId: 's1' });
    expect(whereOf().AND).toContainEqual({ studentId: 's2' });
  });

  it('caps pageSize', async () => {
    await AttemptService.list({ pageSize: 5000 }, {});
    expect(prismaMock.attempt.findMany.mock.calls[0]![0].take).toBe(100);
  });
});

describe('getById', () => {
  it('applies the viewer scope rather than checking after fetching', async () => {
    prismaMock.attempt.findFirst.mockResolvedValue(null);

    await expect(AttemptService.getById('att1', { studentId: 's1' })).rejects.toThrow(
      'Attempt not found'
    );

    const where = prismaMock.attempt.findFirst.mock.calls[0]![0].where;
    expect(where.AND).toEqual([{ id: 'att1' }, { studentId: 's1' }]);
  });
});
