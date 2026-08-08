import api from './api';
import type { ProviderUpload } from './lms';

/**
 * Submissions API client (Phase 3, M2).
 *
 * ── NOTE ON THE REQUEST SHAPE ────────────────────────────────────────────────
 * The REQUEST and the RESPONSE use different names for the file fields, and
 * mixing them up produces a 400 that reads like a server bug:
 *
 *   request   providerKey  url        (plus originalFilename, mimeType, sizeBytes)
 *   response  publicId     fileUrl
 *
 * The response flattens the MediaAsset relation into the documented
 * publicId/fileUrl names; the request is validated against
 * `createSubmissionSchema`, which takes Cloudinary's own field names. This
 * client speaks both correctly so no caller has to remember which is which.
 */

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  submittedAt: string;
  isLate: boolean;
  attemptCount: number;
  marks: number | null;
  feedback: string | null;
  gradedAt: string | null;

  // Flattened from the MediaAsset relation by the server.
  assetId: string | null;
  publicId: string | null;
  resourceType: string | null;
  format: string | null;
  fileUrl: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;

  student: { id: string; name: string; email: string; niatId: string | null } | null;
  gradedBy: { id: string; name: string } | null;
  assignment: {
    id: string;
    title: string;
    deadline: string;
    maxMarks: number;
    moduleId: string;
  } | null;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const submissionsApi = {
  /**
   * The caller's own submissions for an assignment.
   *
   * Scoping is the SERVER's job — a student gets only their own rows no matter
   * what this asks for — so there is no studentId filter sent here.
   */
  listForAssignment: (assignmentId: string) =>
    api
      .get('/submissions', { params: { assignmentId, pageSize: 100 } })
      .then((res) => res.data.data as Submission[]),

  /**
   * Registers an upload as the student's submission.
   *
   * Takes the provider response verbatim. The server calls `confirmUpload()`
   * itself, which is what keeps the MediaAsset creation and the submission row
   * in one request — and means a rejected submission never leaves an orphaned
   * asset behind.
   */
  create: (assignmentId: string, upload: ProviderUpload) =>
    api
      .post('/submissions', {
        assignmentId,
        providerKey: upload.providerKey,
        url: upload.url,
        originalFilename: upload.originalFilename,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        resourceType: upload.resourceType,
        ...(upload.format ? { format: upload.format } : {}),
      })
      .then(unwrap<Submission>),

  /** Withdraws an unmarked submission and deletes its file. */
  remove: (id: string) => api.delete(`/submissions/${id}`),
};
