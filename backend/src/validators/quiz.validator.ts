import { z } from 'zod';

/**
 * Quiz request validation (Phase 3, M3).
 *
 * Shape only. The rule that `correctAnswer` must be ONE OF `options` lives in
 * QuizService, not here — on the update path it has to be checked against the
 * MERGED question (new options against the stored answer, or vice versa), which
 * a body-only schema cannot see.
 */

const id = z.string().uuid('Invalid id format');
const title = z.string().trim().min(2, 'Must be at least 2 characters').max(200);

/**
 * Minutes. Capped at 24 hours: a longer limit is always a typo (someone meaning
 * seconds), and an attempt whose clock never realistically expires is one that
 * can sit open forever.
 */
const timeLimit = z
  .number()
  .int('Time limit must be a whole number of minutes')
  .min(1, 'A quiz needs at least one minute')
  .max(1440, 'Time limit must be 24 hours or less');

/** NULL means unlimited attempts, which is why nullable is distinct from absent. */
const maxAttempts = z
  .number()
  .int()
  .min(1, 'A quiz must allow at least one attempt')
  .max(100)
  .nullable()
  .optional();

const questionText = z.string().trim().min(1, 'A question needs text').max(2000);

/**
 * Bounds only. Distinctness and the correct-answer membership check are in the
 * service, so they hold for partial updates too.
 */
const options = z
  .array(z.string().trim().min(1, 'Options cannot be blank').max(500))
  .min(2, 'A question needs at least two options')
  .max(10, 'A question can have at most ten options');

const marks = z.number().int().min(1, 'A question must be worth at least 1 mark').max(100);

const pageNumber = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();

// --- Quizzes ----------------------------------------------------------------

export const createQuizSchema = z.object({
  body: z.object({
    moduleId: id,
    title,
    description: z.string().trim().max(8000).nullable().optional(),
    timeLimit,
    maxAttempts,
    scope: z.enum(['LEARNING_PATH', 'BATCH']).optional(),
    batchId: id.nullable().optional(),
  }),
});

export const updateQuizSchema = z.object({
  params: z.object({ id }),
  body: z
    .object({
      title: title.optional(),
      description: z.string().trim().max(8000).nullable().optional(),
      timeLimit: timeLimit.optional(),
      maxAttempts,
      isPublished: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

export const listQuizzesSchema = z.object({
  query: z.object({
    moduleId: id.optional(),
    learningPathId: id.optional(),
    batchId: id.optional(),
    q: z.string().trim().max(200).optional(),
    status: z.enum(['draft', 'published', 'all']).optional(),
    page: pageNumber,
    pageSize,
  }),
});

export const quizIdSchema = z.object({ params: z.object({ id }) });

// --- Questions ---------------------------------------------------------------

export const createQuestionSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    question: questionText,
    options,
    correctAnswer: z.string().trim().min(1, 'A correct answer is required').max(500),
    marks: marks.optional(),
  }),
});

export const updateQuestionSchema = z.object({
  params: z.object({ id, questionId: id }),
  body: z
    .object({
      question: questionText.optional(),
      options: options.optional(),
      correctAnswer: z.string().trim().min(1).max(500).optional(),
      marks: marks.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

export const questionIdSchema = z.object({ params: z.object({ id, questionId: id }) });

// --- Attempts ----------------------------------------------------------------

export const startAttemptSchema = z.object({ params: z.object({ id }) });

/**
 * `answers` is `{ questionId: selectedOption }`.
 *
 * Values are accepted as `unknown` rather than constrained to strings: a client
 * that sends a number or null for an unanswered question should have that
 * marked wrong, not have the whole submission rejected at the door with the
 * clock still running. `markAnswers` treats any non-matching value as wrong.
 */
export const submitAttemptSchema = z.object({
  params: z.object({ id }),
  body: z.object({
    answers: z.record(z.string().uuid('Answer keys must be question ids'), z.unknown()),
  }),
});

export const listAttemptsSchema = z.object({
  params: z.object({ id }),
  query: z.object({
    studentId: id.optional(),
    page: pageNumber,
    pageSize,
  }),
});

export const attemptIdSchema = z.object({ params: z.object({ id }) });
