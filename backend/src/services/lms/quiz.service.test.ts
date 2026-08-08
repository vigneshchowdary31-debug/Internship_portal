import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

const announce = vi.fn();
vi.mock('./notification.service', () => ({
  NotificationService: { announceQuizPublished: (...a: unknown[]) => announce(...a) },
}));

const { QuizService, QUIZ_SELECT_AUTHOR, QUIZ_SELECT_STUDENT } = await import('./quiz.service');

const MODULE = { id: 'm1', learningPathId: 'lp1' };

const quiz = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  title: 'React Fundamentals',
  isPublished: false,
  publishedAt: null,
  _count: { questions: 3, attempts: 0 },
  ...over,
});

const base = () => ({
  moduleId: 'm1',
  title: 'React Fundamentals',
  timeLimit: 30,
  createdById: 'admin1',
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.module.findUnique.mockResolvedValue(MODULE);
  prismaMock.batch.findUnique.mockResolvedValue({ id: 'b1', name: 'MERN-01', learningPathId: 'lp1' });
  prismaMock.quiz.findUnique.mockResolvedValue(quiz());
  prismaMock.quiz.findUniqueOrThrow.mockResolvedValue(quiz());
  prismaMock.quiz.findFirst.mockResolvedValue(quiz());
  prismaMock.quiz.findMany.mockResolvedValue([]);
  prismaMock.quiz.create.mockResolvedValue({ id: 'q1' });
  prismaMock.quiz.update.mockResolvedValue({ id: 'q1', isPublished: true });
  prismaMock.quiz.count.mockResolvedValue(0);
  prismaMock.question.findFirst.mockResolvedValue(null);
  prismaMock.question.create.mockResolvedValue({ id: 'qq1' });
  prismaMock.question.update.mockResolvedValue({ id: 'qq1' });
  prismaMock.attempt.count.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  announce.mockResolvedValue(null);
});

// --- The answer key must never reach a student ------------------------------

describe('the student select never carries the answer key', () => {
  it('omits correctAnswer from the student question shape', () => {
    const studentFields = Object.keys(QUIZ_SELECT_STUDENT.questions.select);
    expect(studentFields).not.toContain('correctAnswer');
  });

  it('includes it for an author', () => {
    expect(Object.keys(QUIZ_SELECT_AUTHOR.questions.select)).toContain('correctAnswer');
  });

  it('is otherwise the same shape, so the two cannot drift apart', () => {
    const author = Object.keys(QUIZ_SELECT_AUTHOR.questions.select).filter(
      (f) => f !== 'correctAnswer'
    );
    expect(Object.keys(QUIZ_SELECT_STUDENT.questions.select).sort()).toEqual(author.sort());
  });

  it('picks the student select for a student context', async () => {
    await QuizService.getById('q1', { batchId: 'b1', includeUnpublished: false });

    // Driven by the caller's authority, not a parameter a student could pass.
    expect(prismaMock.quiz.findFirst.mock.calls[0]![0].select).toBe(QUIZ_SELECT_STUDENT);
  });

  it('picks the author select for an admin context', async () => {
    await QuizService.getById('q1', { batchId: null, includeUnpublished: true });
    expect(prismaMock.quiz.findFirst.mock.calls[0]![0].select).toBe(QUIZ_SELECT_AUTHOR);
  });
});

// --- Create -----------------------------------------------------------------

describe('create', () => {
  it('denormalises the learning path from the module', async () => {
    await QuizService.create(base());
    expect(prismaMock.quiz.create.mock.calls[0]![0].data.learningPathId).toBe('lp1');
  });

  it('rejects an unknown module before writing anything', async () => {
    prismaMock.module.findUnique.mockResolvedValue(null);

    await expect(QuizService.create(base())).rejects.toThrow('Module not found');
    expect(prismaMock.quiz.create).not.toHaveBeenCalled();
  });

  it('always starts as a draft', async () => {
    await QuizService.create(base());

    // No create-and-publish shortcut: a quiz with no questions cannot be
    // published, so there is nothing useful to shortcut to.
    expect(prismaMock.quiz.create.mock.calls[0]![0].data.isPublished).toBeUndefined();
    expect(announce).not.toHaveBeenCalled();
  });

  it('requires a batch when the scope is BATCH', async () => {
    await expect(QuizService.create({ ...base(), scope: 'BATCH', batchId: null })).rejects.toThrow(
      /batch is required/
    );
  });

  it('refuses a batch running a different curriculum', async () => {
    prismaMock.batch.findUnique.mockResolvedValue({
      id: 'b2',
      name: 'Java-03',
      learningPathId: 'lp-other',
    });

    // Reuses the shared batch-scope check, not a second copy of it.
    await expect(
      QuizService.create({ ...base(), scope: 'BATCH', batchId: 'b2' })
    ).rejects.toThrow(/different learning path/);
  });

  it('defaults to ONE attempt when maxAttempts is not given', async () => {
    await QuizService.create(base());

    // A quiz someone can retake freely measures persistence, not knowledge.
    // Unlimited must be a choice, not what you get by forgetting to decide.
    expect(prismaMock.quiz.create.mock.calls[0]![0].data.maxAttempts).toBe(1);
  });

  it('keeps unlimited available as an EXPLICIT null', async () => {
    await QuizService.create({ ...base(), maxAttempts: null });
    expect(prismaMock.quiz.create.mock.calls[0]![0].data.maxAttempts).toBeNull();
  });

  it('honours an explicit count', async () => {
    await QuizService.create({ ...base(), maxAttempts: 3 });
    expect(prismaMock.quiz.create.mock.calls[0]![0].data.maxAttempts).toBe(3);
  });
});

// --- Publish ----------------------------------------------------------------

describe('setPublished', () => {
  it('refuses to publish a quiz with no questions', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(quiz({ _count: { questions: 0, attempts: 0 } }));

    // A student would open an empty paper and score 0/0, and the notification
    // would have announced nothing.
    await expect(QuizService.setPublished('q1', true, 'admin1')).rejects.toThrow(
      /no questions yet/
    );
    expect(prismaMock.quiz.update).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces on a draft -> published transition', async () => {
    await QuizService.setPublished('q1', true, 'admin1');
    expect(announce).toHaveBeenCalledWith('q1', 'admin1');
  });

  it('does NOT re-announce an already published quiz', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(
      quiz({ isPublished: true, publishedAt: new Date() })
    );

    await QuizService.setPublished('q1', true, 'admin1');
    expect(announce).not.toHaveBeenCalled();
  });

  it('does not announce a withdrawal', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(
      quiz({ isPublished: true, publishedAt: new Date() })
    );

    await QuizService.setPublished('q1', false, 'admin1');
    expect(announce).not.toHaveBeenCalled();
  });

  it('stamps publishedAt on the first publish only', async () => {
    await QuizService.setPublished('q1', true, null);
    expect(prismaMock.quiz.update.mock.calls[0]![0].data.publishedAt).toBeInstanceOf(Date);
  });

  it('keeps the original publishedAt when re-publishing', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(
      quiz({ isPublished: false, publishedAt: new Date('2026-01-01') })
    );

    await QuizService.setPublished('q1', true, null);
    expect(prismaMock.quiz.update.mock.calls[0]![0].data.publishedAt).toBeUndefined();
  });

  it('still publishes when notifying throws', async () => {
    announce.mockRejectedValue(new Error('SMTP down'));

    await expect(QuizService.setPublished('q1', true, null)).resolves.toBeTruthy();
    expect(prismaMock.quiz.update).toHaveBeenCalled();
  });
});

// --- Delete -----------------------------------------------------------------

describe('remove', () => {
  it('refuses to delete a quiz students have sat', async () => {
    prismaMock.quiz.findUnique.mockResolvedValue(quiz({ _count: { questions: 3, attempts: 12 } }));

    // Attempts cascade — deleting would erase twelve results silently.
    await expect(QuizService.remove('q1')).rejects.toThrow(/12 student attempt/);
    expect(prismaMock.quiz.delete).not.toHaveBeenCalled();
  });

  it('deletes an unattempted quiz', async () => {
    await expect(QuizService.remove('q1')).resolves.toBe(true);
  });
});

// --- Questions --------------------------------------------------------------

describe('question shape validation', () => {
  const q = (over: Record<string, unknown> = {}) => ({
    question: 'What is JSX?',
    options: ['A syntax extension', 'A database', 'A CSS framework'],
    correctAnswer: 'A syntax extension',
    ...over,
  });

  it('accepts a well-formed question', async () => {
    await expect(QuizService.addQuestion('q1', q())).resolves.toBeTruthy();
  });

  it('rejects a correctAnswer that is not one of the options', async () => {
    // The check that stops an auto-marked quiz where nobody can ever score.
    await expect(
      QuizService.addQuestion('q1', q({ correctAnswer: 'A templating language' }))
    ).rejects.toThrow(/must be one of the options/);
  });

  it('rejects fewer than two options', async () => {
    await expect(
      QuizService.addQuestion('q1', q({ options: ['Only one'], correctAnswer: 'Only one' }))
    ).rejects.toThrow(/at least two options/);
  });

  it('rejects duplicate options', async () => {
    await expect(
      QuizService.addQuestion('q1', q({ options: ['Same', 'Same'], correctAnswer: 'Same' }))
    ).rejects.toThrow(/distinct/);
  });

  it('rejects a blank option', async () => {
    await expect(
      QuizService.addQuestion('q1', q({ options: ['Good', '   '], correctAnswer: 'Good' }))
    ).rejects.toThrow(/non-empty/);
  });

  it('defaults marks to 1', async () => {
    await QuizService.addQuestion('q1', q());
    expect(prismaMock.question.create.mock.calls[0]![0].data.marks).toBe(1);
  });

  it('appends at the next position', async () => {
    prismaMock.question.findFirst.mockResolvedValue({ position: 4 });

    await QuizService.addQuestion('q1', q());
    expect(prismaMock.question.create.mock.calls[0]![0].data.position).toBe(5);
  });
});

describe('updateQuestion validates the MERGED question', () => {
  beforeEach(() => {
    prismaMock.question.findFirst.mockResolvedValue({
      id: 'qq1',
      options: ['A syntax extension', 'A database'],
      correctAnswer: 'A syntax extension',
    });
  });

  it('rejects a new correctAnswer that is not in the STORED options', async () => {
    // Checking the incoming fields alone would let this through.
    await expect(
      QuizService.updateQuestion('q1', 'qq1', { correctAnswer: 'A CSS framework' })
    ).rejects.toThrow(/must be one of the options/);
  });

  it('rejects new options that no longer contain the STORED answer', async () => {
    await expect(
      QuizService.updateQuestion('q1', 'qq1', { options: ['A database', 'A CSS framework'] })
    ).rejects.toThrow(/must be one of the options/);
  });

  it('accepts options and answer changed together', async () => {
    await expect(
      QuizService.updateQuestion('q1', 'qq1', {
        options: ['Yes', 'No'],
        correctAnswer: 'Yes',
      })
    ).resolves.toBeTruthy();
  });

  it('404s a question that belongs to another quiz', async () => {
    prismaMock.question.findFirst.mockResolvedValue(null);

    await expect(QuizService.updateQuestion('q1', 'other', { marks: 2 })).rejects.toThrow(
      'Question not found'
    );
  });
});

describe('the question set freezes once the quiz has been attempted', () => {
  beforeEach(() => {
    prismaMock.attempt.count.mockResolvedValue(7);
    prismaMock.question.findFirst.mockResolvedValue({
      id: 'qq1',
      options: ['A', 'B'],
      correctAnswer: 'A',
    });
  });

  it('refuses to add a question', async () => {
    await expect(
      QuizService.addQuestion('q1', {
        question: 'New?',
        options: ['A', 'B'],
        correctAnswer: 'A',
      })
    ).rejects.toThrow(/already been attempted 7 time/);
  });

  it('refuses to edit a question', async () => {
    // Editing a correctAnswer would leave stored scores that no longer follow
    // from the quiz — marks that cannot be reproduced or explained.
    await expect(QuizService.updateQuestion('q1', 'qq1', { marks: 5 })).rejects.toThrow(
      /already been attempted/
    );
    expect(prismaMock.question.update).not.toHaveBeenCalled();
  });

  it('refuses to delete a question', async () => {
    await expect(QuizService.removeQuestion('q1', 'qq1')).rejects.toThrow(
      /already been attempted/
    );
    expect(prismaMock.question.delete).not.toHaveBeenCalled();
  });

  it('allows edits while no one has attempted it', async () => {
    prismaMock.attempt.count.mockResolvedValue(0);
    await expect(QuizService.updateQuestion('q1', 'qq1', { marks: 5 })).resolves.toBeTruthy();
  });
});

// --- Visibility on reads ----------------------------------------------------

describe('list — visibility is never optional', () => {
  const asStudent = { batchId: 'b1', includeUnpublished: false };
  const whereOf = () => prismaMock.quiz.findMany.mock.calls[0]![0].where;

  it('AND-s every query with the shared visibility clause', async () => {
    await QuizService.list({ moduleId: 'm1' }, asStudent);

    expect(whereOf().AND[0]).toEqual({
      AND: [
        { isPublished: true, module: { isVisible: true } },
        { OR: [{ scope: 'LEARNING_PATH' }, { scope: 'BATCH', batchId: 'b1' }] },
      ],
    });
  });

  it('keeps it even when the caller asks for drafts', async () => {
    await QuizService.list({ status: 'draft' }, asStudent);

    expect(whereOf().AND[0]).toHaveProperty('AND');
    expect(whereOf().AND).toContainEqual({ isPublished: false });
  });

  it('caps pageSize', async () => {
    await QuizService.list({ pageSize: 5000 }, { batchId: null, includeUnpublished: true });
    expect(prismaMock.quiz.findMany.mock.calls[0]![0].take).toBe(100);
  });
});

describe('getById — an invisible quiz is not found', () => {
  it('resolves through the visibility clause rather than fetching then checking', async () => {
    await QuizService.getById('q1', { batchId: 'b1', includeUnpublished: false });

    const where = prismaMock.quiz.findFirst.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ id: 'q1' });
    expect(where.AND[1]).toBeTruthy();
  });

  it('404s a draft for a student rather than 403ing it', async () => {
    prismaMock.quiz.findFirst.mockResolvedValue(null);

    await expect(
      QuizService.getById('q1', { batchId: 'b1', includeUnpublished: false })
    ).rejects.toThrow('Quiz not found');
  });
});
