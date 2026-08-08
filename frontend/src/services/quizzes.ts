import api from './api';

/**
 * Quiz API client.
 *
 * Separate from `lmsApi` because the backend mounts quizzes at /api/quizzes,
 * not under /lms — keeping the client split the same way the server is means
 * there is never a question about which endpoint a call lands on.
 */

export interface QuizQuestion {
  id: string;
  quizId: string;
  question: string;
  options: string[];
  /** Present only for authors. The student select omits it entirely. */
  correctAnswer?: string;
  marks: number;
  position: number;
}

export interface Quiz {
  id: string;
  moduleId: string;
  learningPathId: string;
  title: string;
  description: string | null;
  /** Minutes. */
  timeLimit: number;
  isPublished: boolean;
  publishedAt: string | null;
  scope: 'LEARNING_PATH' | 'BATCH';
  batchId: string | null;
  /** NULL means unlimited. Omitting it at creation yields 1. */
  maxAttempts: number | null;
  createdAt: string;
  updatedAt: string;
  module: { id: string; name: string; isVisible: boolean } | null;
  batch: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  _count: { questions: number; attempts: number };
  /** Only on the single-quiz read, never on the list. */
  questions?: QuizQuestion[];
}

export interface QuizPayload {
  title: string;
  description?: string | null;
  timeLimit: number;
  /**
   * Omit for the server's default of ONE attempt. Explicit null means
   * unlimited — a deliberate choice, not what you get by leaving it blank.
   */
  maxAttempts?: number | null;
}

export interface QuestionPayload {
  question: string;
  options: string[];
  correctAnswer: string;
  marks?: number;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const quizzesApi = {
  list: (params: { moduleId?: string; learningPathId?: string; q?: string; status?: string } = {}) =>
    api
      .get('/quizzes', {
        params: {
          ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
          pageSize: 100,
        },
      })
      .then((res) => res.data.data as Quiz[]),

  /** Includes questions WITH their correct answers, for an admin or instructor. */
  get: (id: string) => api.get(`/quizzes/${id}`).then(unwrap<Quiz>),

  /** `moduleId` is required by the server — a quiz always belongs to a module. */
  create: (moduleId: string, body: QuizPayload) =>
    api.post('/quizzes', { moduleId, ...body }).then(unwrap<Quiz>),

  update: (id: string, body: Partial<QuizPayload>) =>
    api.patch(`/quizzes/${id}`, body).then(unwrap<Quiz>),

  /**
   * Publishing notifies every student on the curriculum, and the server refuses
   * it while the quiz has no questions — hence its own method rather than a raw
   * `update` call that reads like an edit.
   */
  setPublished: (id: string, isPublished: boolean) =>
    api.patch(`/quizzes/${id}`, { isPublished }).then(unwrap<Quiz>),

  remove: (id: string) => api.delete(`/quizzes/${id}`),

  addQuestion: (quizId: string, body: QuestionPayload) =>
    api.post(`/quizzes/${quizId}/questions`, body).then(unwrap<QuizQuestion>),

  updateQuestion: (quizId: string, questionId: string, body: Partial<QuestionPayload>) =>
    api.patch(`/quizzes/${quizId}/questions/${questionId}`, body).then(unwrap<QuizQuestion>),

  removeQuestion: (quizId: string, questionId: string) =>
    api.delete(`/quizzes/${quizId}/questions/${questionId}`),

  /**
   * Bulk question import.
   *
   * Sent as raw `text/csv`, not multipart or JSON: the server parses the body
   * with a route-scoped text parser, and wrapping the file in JSON would double
   * its size for no gain.
   *
   * Answers 200 even when rows were rejected — the ones that passed WERE
   * imported. Callers must read `imported`/`failed`, never the status code.
   */
  uploadCsv: (quizId: string, csv: string) =>
    api
      .post(`/quizzes/${quizId}/upload-csv`, csv, {
        headers: { 'Content-Type': 'text/csv' },
      })
      .then(unwrap<QuestionImportResult>),

  /** The template, as text — fetched through the client so auth applies. */
  questionTemplate: () =>
    api.get('/quizzes/questions/template', { responseType: 'text' }).then((res) => res.data as string),
};

// --- Student attempt flow ----------------------------------------------------

/** A question as a STUDENT receives it. Note the absence of `correctAnswer`. */
export interface StudentQuestion {
  id: string;
  question: string;
  options: string[];
  marks: number;
  position: number;
}

export interface Attempt {
  id: string;
  quizId: string;
  studentId: string;
  /** `{ questionId: selectedOption }`, as submitted. Null while in progress. */
  answers: Record<string, string> | null;
  score: number | null;
  totalMarks: number | null;
  startedAt: string;
  /** Null while open — this is what makes "in progress" detectable. */
  submittedAt: string | null;
  expiresAt: string;
  /** True when the server closed an abandoned attempt at its expiry. */
  autoSubmitted: boolean;
  quiz: { id: string; title: string; timeLimit: number; moduleId: string } | null;
}

export interface StartedAttempt {
  attempt: Attempt;
  quiz: {
    id: string;
    title: string;
    description: string | null;
    timeLimit: number;
    maxAttempts: number | null;
    moduleId: string;
    questions: StudentQuestion[];
  };
  /** True when an already-running attempt was returned rather than a new one. */
  resumed: boolean;
  secondsRemaining: number;
}

export interface AttemptResult {
  score: number;
  totalMarks: number;
  correctCount: number;
  questionCount: number;
}

export const attemptsApi = {
  /**
   * Opens an attempt, or RESUMES the one already running.
   *
   * Safe to call repeatedly: the server returns the open attempt with its
   * original `expiresAt` rather than starting a new one, so a page reload
   * neither burns an attempt nor buys more time. That is why the attempt page
   * calls this to rehydrate instead of needing a separate questions endpoint.
   */
  start: (quizId: string) =>
    api.post(`/quizzes/${quizId}/start`).then(unwrap<StartedAttempt>),

  submit: (quizId: string, answers: Record<string, string>) =>
    api
      .post(`/quizzes/${quizId}/submit`, { answers })
      .then((res) => res.data.data as { attempt: Attempt; result: AttemptResult }),

  get: (attemptId: string) => api.get(`/attempts/${attemptId}`).then(unwrap<Attempt>),

  /**
   * This student's attempts at one quiz.
   *
   * Scoped by the SERVER — a student receives only their own rows whatever they
   * ask for. Used for "attempts used", which cannot come from the quiz list's
   * `_count.attempts`: that counts every student's attempts, not this one's.
   */
  listForQuiz: (quizId: string) =>
    api
      .get(`/quizzes/${quizId}/attempts`, { params: { pageSize: 100 } })
      .then((res) => res.data.data as Attempt[]),
};

export interface QuestionImportResult {
  totalRows: number;
  imported: number;
  failed: number;
  rejected: { row: number; question: string; reason: string }[];
}
