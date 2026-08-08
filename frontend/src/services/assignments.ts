import api from './api';

/**
 * Assignments API client (Phase 3, M1).
 *
 * A separate module from `lms.ts` rather than more methods on `lmsApi`, because
 * assignments are a separate backend entity mounted at `/api/assignments` — not
 * a `ContentType`. Keeping the client split the same way the server is means
 * there is never a question about which endpoint a call lands on.
 */

export interface Assignment {
  id: string;
  moduleId: string;
  learningPathId: string;
  title: string;
  description: string;
  maxMarks: number;
  /** ISO datetime. */
  deadline: string;
  isPublished: boolean;
  publishedAt: string | null;
  scope: 'LEARNING_PATH' | 'BATCH';
  batchId: string | null;
  allowResubmission: boolean;
  createdAt: string;
  updatedAt: string;
  module: { id: string; name: string; isVisible: boolean } | null;
  batch: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
}

export interface AssignmentPayload {
  title: string;
  description: string;
  maxMarks: number;
  /** ISO datetime. The server rejects anything not in the future. */
  deadline: string;
  allowResubmission?: boolean;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const assignmentsApi = {
  /**
   * Every assignment in a module, drafts included for an admin.
   *
   * Draft visibility is decided by the SERVER from the caller's role — there is
   * no `status` filter sent here. A student hitting the same endpoint gets only
   * published work, so the UI never has to be trusted to hide anything.
   */
  listForModule: (moduleId: string) =>
    api
      .get('/assignments', { params: { moduleId, pageSize: 100 } })
      .then((res) => res.data.data as Assignment[]),

  /**
   * One assignment.
   *
   * Resolved server-side through the visibility resolver, so a draft, one in a
   * hidden module, and another batch's work all come back as 404 — the caller
   * never has to decide whether it is allowed to render this.
   */
  get: (id: string) => api.get(`/assignments/${id}`).then(unwrap<Assignment>),

  create: (moduleId: string, body: AssignmentPayload) =>
    api.post('/assignments', { moduleId, ...body }).then(unwrap<Assignment>),

  update: (id: string, body: Partial<AssignmentPayload>) =>
    api.patch(`/assignments/${id}`, body).then(unwrap<Assignment>),

  /**
   * Publishing is the same PATCH, and it is what notifies every student on the
   * learning path — hence its own named method rather than a raw `update` call
   * that reads like an edit.
   */
  setPublished: (id: string, isPublished: boolean) =>
    api.patch(`/assignments/${id}`, { isPublished }).then(unwrap<Assignment>),

  remove: (id: string) => api.delete(`/assignments/${id}`),
};
