import api from './api';
import type { Submission } from './submissions';

/**
 * Instructor grading API client (Phase 5 UI).
 *
 * Thin by design. Every rule that matters — who may see which submissions, what
 * counts as a valid mark, whether a partial batch succeeded — is decided by the
 * server. Nothing here re-checks any of it, because a second opinion in the
 * browser is one that can disagree.
 */

export interface GradingProgress {
  totalSubmissions: number;
  gradedCount: number;
  pendingCount: number;
  lateCount: number;
}

export interface BulkGradeItem {
  submissionId: string;
  marks: number;
  feedback?: string | null;
}

export interface BulkGradeResult {
  requested: number;
  graded: number;
  failed: number;
  results: {
    submissionId: string;
    status: 'graded' | 'failed';
    marks?: number;
    reason?: string;
  }[];
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const instructorApi = {
  /**
   * Counts for one assignment, scoped to the caller's own batches.
   *
   * Deliberately this endpoint rather than `/analytics/assignment/:id`: the
   * grading progress route applies the viewer's batch scope, so "9 of 12
   * marked" never counts a parallel cohort's submissions the instructor cannot
   * open, let alone mark.
   */
  progress: (assignmentId: string) =>
    api.get(`/instructor/assignment/${assignmentId}/progress`).then(unwrap<GradingProgress>),

  /**
   * Submissions for one assignment, already reduced to what this instructor may
   * see. `pageSize` is the server's maximum — a cohort larger than that needs
   * paging, which the table does not yet do (see the page's note).
   */
  listSubmissions: (assignmentId: string) =>
    api
      .get('/instructor/submissions', { params: { assignmentId, pageSize: 100 } })
      .then((res) => res.data.data as Submission[]),

  gradeOne: (submissionId: string, body: { marks: number; feedback?: string | null }) =>
    api.patch(`/submissions/${submissionId}/grade`, body).then(unwrap<Submission>),

  /**
   * Marks many at once.
   *
   * The body is a bare array, matching the server contract. Partial success is
   * normal and is reported per item — the caller must read `results`, not just
   * the HTTP status, which is 200 even when some rows failed.
   */
  bulkGrade: (items: BulkGradeItem[]) =>
    api.patch('/submissions/bulk-grade', items).then(unwrap<BulkGradeResult>),
};
