import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock, type PrismaMock } from '../../test/prismaMock';

const prismaMock: PrismaMock = createPrismaMock();
vi.mock('../../config/db', () => ({ default: prismaMock }));

/**
 * StorageService is mocked, not stubbed out: these tests assert that the
 * submission path CALLS it with the provider's own values. The provider
 * behaviour itself (never /auto/destroy, throw on "not found", CDN invalidate)
 * is pinned in cloudinary.provider.test.ts and is deliberately not re-tested
 * here — that would be a second copy of the rule, which is the exact thing the
 * storage abstraction exists to prevent.
 */
const confirmUpload = vi.fn();
const deleteAsset = vi.fn();
vi.mock('../storage/storage.service', () => ({
  StorageService: {
    confirmUpload: (...a: unknown[]) => confirmUpload(...a),
    deleteAsset: (...a: unknown[]) => deleteAsset(...a),
  },
}));

const announceEvaluated = vi.fn();
const announceEvaluatedBulk = vi.fn();
vi.mock('./notification.service', () => ({
  NotificationService: {
    announceSubmissionEvaluated: (...a: unknown[]) => announceEvaluated(...a),
    // Phase 6: bulk grading notifies once for the whole batch, so the digest
    // can group by student. The single path still uses the singular method.
    announceSubmissionsEvaluated: (...a: unknown[]) => announceEvaluatedBulk(...a),
  },
}));

const { SubmissionService } = await import('./submission.service');

const HOUR = 60 * 60 * 1000;
const future = () => new Date(Date.now() + 7 * 24 * HOUR);
const past = () => new Date(Date.now() - 24 * HOUR);

const ASSIGNMENT = {
  id: 'a1',
  title: 'Build a REST API',
  deadline: future(),
  maxMarks: 100,
  allowResubmission: true,
  isPublished: true,
};

/** A real Cloudinary upload response for a raw .zip — extension included. */
const UPLOAD = {
  providerKey: 'lms/submissions/report-5def.zip',
  url: 'https://res.cloudinary.com/c/raw/upload/lms/submissions/report-5def.zip',
  originalFilename: 'report.zip',
  mimeType: 'application/zip',
  sizeBytes: 2048,
  resourceType: 'raw' as const,
  format: undefined,
};

const asStudent = { batchId: 'b1', includeUnpublished: false };

const submitInput = (over: Record<string, unknown> = {}) => ({
  assignmentId: 'a1',
  studentId: 's1',
  ...UPLOAD,
  context: asStudent,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignment.findFirst.mockResolvedValue(ASSIGNMENT);
  prismaMock.submission.findUnique.mockResolvedValue(null);
  prismaMock.submission.findFirst.mockResolvedValue(null);
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.submission.upsert.mockResolvedValue({ id: 'sub1', isLate: false, asset: null });
  prismaMock.submission.update.mockResolvedValue({ id: 'sub1', asset: null });
  prismaMock.submission.count.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  confirmUpload.mockResolvedValue({ id: 'asset1' });
  deleteAsset.mockResolvedValue(undefined);
  announceEvaluated.mockResolvedValue(null);
});

// --- Upload -----------------------------------------------------------------

describe('submit — goes through the existing storage layer', () => {
  it('registers the file with confirmUpload rather than writing storage columns itself', async () => {
    await SubmissionService.submit(submitInput());

    expect(confirmUpload).toHaveBeenCalledTimes(1);
    expect(prismaMock.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("passes Cloudinary's RETURNED public_id, extension and all", async () => {
    await SubmissionService.submit(submitInput());

    // Trimming the extension off a raw key is what made every delete a silent
    // no-op; the key is forwarded byte-for-byte.
    expect(confirmUpload.mock.calls[0]![0].providerKey).toBe(
      'lms/submissions/report-5def.zip'
    );
  });

  it('forwards resourceType and format so the file can be deleted later', async () => {
    await SubmissionService.submit(submitInput({ ...UPLOAD, format: 'pdf', resourceType: 'image' }));

    const call = confirmUpload.mock.calls[0]![0];
    expect(call.resourceType).toBe('image');
    expect(call.format).toBe('pdf');
  });

  it('registers under the submission purpose, not content', async () => {
    await SubmissionService.submit(submitInput());

    // Drives both the folder and the 25 MB limit.
    expect(confirmUpload.mock.calls[0]![0].purpose).toBe('submission');
    expect(confirmUpload.mock.calls[0]![0].uploadedById).toBe('s1');
  });

  it('links the submission to the asset confirmUpload returned', async () => {
    confirmUpload.mockResolvedValue({ id: 'asset-xyz' });

    await SubmissionService.submit(submitInput());

    expect(prismaMock.submission.upsert.mock.calls[0]![0].create.assetId).toBe('asset-xyz');
  });
});

describe('submit — visibility', () => {
  it('resolves the assignment through the shared visibility clause', async () => {
    await SubmissionService.submit(submitInput());

    const where = prismaMock.assignment.findFirst.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ id: 'a1' });
    expect(where.AND[1]).toBeTruthy();
  });

  it('404s an assignment the student cannot see, before registering anything', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    // A draft, a hidden module and another batch's work all land here — the
    // same answer, carrying no information about which.
    await expect(SubmissionService.submit(submitInput())).rejects.toThrow('Assignment not found');
    expect(confirmUpload).not.toHaveBeenCalled();
  });
});

// --- Late submission --------------------------------------------------------

describe('submit — isLate', () => {
  it('flags a submission made after the deadline', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...ASSIGNMENT, deadline: past() });

    await SubmissionService.submit(submitInput());

    expect(prismaMock.submission.upsert.mock.calls[0]![0].create.isLate).toBe(true);
  });

  it('does not flag a submission made before the deadline', async () => {
    await SubmissionService.submit(submitInput());
    expect(prismaMock.submission.upsert.mock.calls[0]![0].create.isLate).toBe(false);
  });

  it('still accepts late work rather than refusing it', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...ASSIGNMENT, deadline: past() });

    // A deadline flags work; it does not bar it. Refusing would leave a student
    // with nothing recorded at all.
    await expect(SubmissionService.submit(submitInput())).resolves.toBeTruthy();
  });

  it('flags lateness on a resubmission too, not just the first attempt', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...ASSIGNMENT, deadline: past() });
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 'sub1',
      assetId: 'old-asset',
      attemptCount: 1,
      marks: null,
    });

    await SubmissionService.submit(submitInput());

    expect(prismaMock.submission.upsert.mock.calls[0]![0].update.isLate).toBe(true);
  });
});

// --- Resubmission -----------------------------------------------------------

describe('submit — resubmission', () => {
  const existing = { id: 'sub1', assetId: 'old-asset', attemptCount: 1, marks: null };

  it('replaces the artifact and counts the attempt', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(existing);
    confirmUpload.mockResolvedValue({ id: 'new-asset' });

    await SubmissionService.submit(submitInput());

    const update = prismaMock.submission.upsert.mock.calls[0]![0].update;
    expect(update.assetId).toBe('new-asset');
    expect(update.attemptCount).toEqual({ increment: 1 });
  });

  it('clears marks and feedback, which described the replaced file', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(existing);

    await SubmissionService.submit(submitInput());

    const update = prismaMock.submission.upsert.mock.calls[0]![0].update;
    expect(update.marks).toBeNull();
    expect(update.feedback).toBeNull();
    expect(update.gradedAt).toBeNull();
  });

  it('deletes the superseded artifact through the storage layer', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(existing);
    confirmUpload.mockResolvedValue({ id: 'new-asset' });

    await SubmissionService.submit(submitInput());

    // deleteAsset is what performs the provider call with the stored
    // resourceType — this path never talks to Cloudinary itself.
    expect(deleteAsset).toHaveBeenCalledWith('old-asset');
  });

  it('does not delete the artifact when the same file is re-confirmed', async () => {
    prismaMock.submission.findUnique.mockResolvedValue({ ...existing, assetId: 'asset1' });
    confirmUpload.mockResolvedValue({ id: 'asset1' }); // idempotent confirm

    await SubmissionService.submit(submitInput());

    // Deleting here would remove the file the submission now points at.
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it('still succeeds when removing the old artifact fails', async () => {
    prismaMock.submission.findUnique.mockResolvedValue(existing);
    deleteAsset.mockRejectedValue(new Error('Cloudinary unreachable'));

    // The submission is recorded. A storage outage at a deadline must not read
    // as a failed hand-in; the leftover file surfaces in the orphan report.
    await expect(SubmissionService.submit(submitInput())).resolves.toBeTruthy();
  });

  it('refuses a second attempt when the assignment forbids it', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...ASSIGNMENT, allowResubmission: false });
    prismaMock.submission.findUnique.mockResolvedValue(existing);

    await expect(SubmissionService.submit(submitInput())).rejects.toThrow(
      /resubmissions are not allowed/
    );
    // Rejected before the file is registered, so no orphan is left behind.
    expect(confirmUpload).not.toHaveBeenCalled();
  });

  it('allows a FIRST submission when the assignment forbids resubmission', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...ASSIGNMENT, allowResubmission: false });
    prismaMock.submission.findUnique.mockResolvedValue(null);

    await expect(SubmissionService.submit(submitInput())).resolves.toBeTruthy();
  });

  it('refuses to replace work that has already been marked', async () => {
    prismaMock.submission.findUnique.mockResolvedValue({ ...existing, marks: 80 });

    await expect(SubmissionService.submit(submitInput())).rejects.toThrow(/already been marked/);
    expect(confirmUpload).not.toHaveBeenCalled();
  });
});

// --- Delete -----------------------------------------------------------------

describe('remove', () => {
  it('deletes the row first, then the artifact', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub1',
      assetId: 'asset1',
      marks: null,
    });
    const order: string[] = [];
    prismaMock.submission.delete.mockImplementation(async () => {
      order.push('row');
      return {};
    });
    deleteAsset.mockImplementation(async () => {
      order.push('asset');
    });

    await SubmissionService.remove('sub1', {});

    // Forced by the Restrict foreign key, and the safe direction anyway: a
    // surplus file is recoverable, a submission with no evidence is not.
    expect(order).toEqual(['row', 'asset']);
  });

  it('removes the file through the storage layer, never Cloudinary directly', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub1',
      assetId: 'asset1',
      marks: null,
    });

    await SubmissionService.remove('sub1', {});

    expect(deleteAsset).toHaveBeenCalledWith('asset1');
  });

  it('refuses to withdraw marked work', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub1',
      assetId: 'asset1',
      marks: 75,
    });

    await expect(SubmissionService.remove('sub1', {})).rejects.toThrow(/already been marked/);
    expect(prismaMock.submission.delete).not.toHaveBeenCalled();
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it('applies the viewer scope, so one student cannot withdraw another\'s work', async () => {
    prismaMock.submission.findFirst.mockResolvedValue(null);

    await expect(SubmissionService.remove('sub1', { studentId: 's1' })).rejects.toThrow(
      'Submission not found'
    );

    const where = prismaMock.submission.findFirst.mock.calls[0]![0].where;
    expect(where.AND).toContainEqual({ studentId: 's1' });
  });

  it('reports success when the row is gone but the file could not be removed', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub1',
      assetId: 'asset1',
      marks: null,
    });
    deleteAsset.mockRejectedValue(new Error('Cloudinary unreachable'));

    // The withdrawal happened. The leftover file is surplus storage the admin
    // orphan report surfaces, not a failed operation to retry.
    await expect(SubmissionService.remove('sub1', {})).resolves.toBe(true);
  });
});

// --- Reads ------------------------------------------------------------------

describe('list — scope is applied in SQL, not after fetching', () => {
  const whereOf = () => prismaMock.submission.findMany.mock.calls[0]![0].where;

  it('puts the viewer scope first, ahead of any filter', async () => {
    await SubmissionService.list({ assignmentId: 'a1' }, { studentId: 's1' });

    expect(whereOf().AND[0]).toEqual({ studentId: 's1' });
    expect(whereOf().AND).toContainEqual({ assignmentId: 'a1' });
  });

  it('keeps the scope even when the caller filters by another student', async () => {
    // A student passing ?studentId=someone-else gets both clauses AND-ed, which
    // resolves to nothing rather than to their classmate's work.
    await SubmissionService.list({ studentId: 's2' }, { studentId: 's1' });

    expect(whereOf().AND).toContainEqual({ studentId: 's1' });
    expect(whereOf().AND).toContainEqual({ studentId: 's2' });
  });

  it('filters late and graded submissions', async () => {
    await SubmissionService.list({ isLate: true, graded: false }, {});

    expect(whereOf().AND).toContainEqual({ isLate: true });
    expect(whereOf().AND).toContainEqual({ marks: null });
  });

  it('treats graded=true as "has marks"', async () => {
    await SubmissionService.list({ graded: true }, {});
    expect(whereOf().AND).toContainEqual({ marks: { not: null } });
  });

  it('caps pageSize and computes skip', async () => {
    await SubmissionService.list({ page: 2, pageSize: 5000 }, {});

    const call = prismaMock.submission.findMany.mock.calls[0]![0];
    expect(call.take).toBe(100);
    expect(call.skip).toBe(100);
  });

  it('flattens the asset into the documented response fields', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'sub1',
        isLate: false,
        asset: {
          id: 'asset1',
          providerKey: 'lms/submissions/report-5def.zip',
          url: 'https://res.cloudinary.com/c/raw/upload/lms/submissions/report-5def.zip',
          resourceType: 'raw',
          format: null,
          originalFilename: 'report.zip',
          mimeType: 'application/zip',
          sizeBytes: 2048,
        },
      },
    ]);

    const result = await SubmissionService.list({}, {});

    // The Phase 3 contract's field names, read through the relation rather than
    // duplicated as columns.
    expect(result.items[0]).toMatchObject({
      publicId: 'lms/submissions/report-5def.zip',
      resourceType: 'raw',
      format: null,
      fileUrl: 'https://res.cloudinary.com/c/raw/upload/lms/submissions/report-5def.zip',
    });
  });
});

// --- Grading ----------------------------------------------------------------

describe('grade', () => {
  beforeEach(() => {
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub1',
      assignment: { maxMarks: 100 },
    });
  });

  it('records the mark, the grader and the time', async () => {
    await SubmissionService.grade('sub1', { marks: 85, feedback: '  Good work  ' }, 'inst1', {});

    const data = prismaMock.submission.update.mock.calls[0]![0].data;
    expect(data.marks).toBe(85);
    expect(data.feedback).toBe('Good work');
    expect(data.gradedById).toBe('inst1');
    expect(data.gradedAt).toBeInstanceOf(Date);
  });

  it('refuses a mark above the assignment maximum', async () => {
    // The typo that quietly corrupts every average Module 4 will compute.
    await expect(SubmissionService.grade('sub1', { marks: 120 }, 'inst1', {})).rejects.toThrow(
      /out of 100/
    );
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('refuses a negative mark', async () => {
    await expect(SubmissionService.grade('sub1', { marks: -1 }, 'inst1', {})).rejects.toThrow(
      /cannot be negative/
    );
  });

  it('accepts a mark of exactly the maximum, and of zero', async () => {
    await expect(SubmissionService.grade('sub1', { marks: 100 }, 'inst1', {})).resolves.toBeTruthy();
    await expect(SubmissionService.grade('sub1', { marks: 0 }, 'inst1', {})).resolves.toBeTruthy();
  });

  it('notifies the student', async () => {
    await SubmissionService.grade('sub1', { marks: 85 }, 'inst1', {});
    expect(announceEvaluated).toHaveBeenCalledWith('sub1', 'inst1');
  });

  it('still records the mark when notifying fails', async () => {
    announceEvaluated.mockRejectedValue(new Error('SMTP down'));

    await expect(SubmissionService.grade('sub1', { marks: 85 }, 'inst1', {})).resolves.toBeTruthy();
    expect(prismaMock.submission.update).toHaveBeenCalled();
  });

  it('applies the viewer scope', async () => {
    prismaMock.submission.findFirst.mockResolvedValue(null);

    await expect(SubmissionService.grade('sub1', { marks: 1 }, 'inst1', { studentId: 'x' })).rejects.toThrow(
      'Submission not found'
    );
  });
});


// --- Bulk grading (Phase 6 rewrite) -----------------------------------------

describe('bulkGrade', () => {
  /** What the single resolving query returns for a gradable submission. */
  const resolved = (id: string, maxMarks = 100) => ({ id, assignment: { maxMarks } });

  beforeEach(() => {
    announceEvaluatedBulk.mockResolvedValue({ notified: 0, students: 0 });
    prismaMock.submission.findMany.mockResolvedValue([resolved('s1'), resolved('s2')]);
  });

  it('marks every item and reports the totals', async () => {
    const result = await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 65, feedback: 'Solid' },
      ],
      'inst1',
      {}
    );

    expect(result).toMatchObject({ requested: 2, graded: 2, failed: 0 });
  });

  it('resolves the WHOLE batch in one query, not one per item', async () => {
    await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 65 },
      ],
      'inst1',
      {}
    );

    // The Phase 5 version issued findFirst + update per item. Forty papers was
    // eighty round trips; this is one read plus one transaction.
    expect(prismaMock.submission.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.submission.findMany.mock.calls[0]![0].where.AND[0]).toEqual({
      id: { in: ['s1', 's2'] },
    });
  });

  it('writes the survivors in ONE transaction', async () => {
    await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 65 },
      ],
      'inst1',
      {}
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0]![0]).toHaveLength(2);
  });

  it('enforces the mark bounds with the same rule the single path uses', async () => {
    prismaMock.submission.findMany.mockResolvedValue([resolved('s1', 50)]);

    const result = await SubmissionService.bulkGrade(
      [{ submissionId: 's1', marks: 120 }],
      'inst1',
      {}
    );

    // assertMarksInRange is shared, so the message is identical to grade()'s.
    expect(result.failed).toBe(1);
    expect(result.results[0].reason).toMatch(/out of 50/);
  });

  it('keeps the good items when one fails validation', async () => {
    // s2 is absent from the resolve — withdrawn, or outside this scope.
    prismaMock.submission.findMany.mockResolvedValue([resolved('s1'), resolved('s3')]);

    const result = await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 70 },
        { submissionId: 's3', marks: 60 },
      ],
      'inst1',
      {}
    );

    // Partial success survives the transaction because everything that CAN
    // fail per item has already failed before the transaction opens.
    expect(result).toMatchObject({ requested: 3, graded: 2, failed: 1 });
    expect(prismaMock.$transaction.mock.calls[0]![0]).toHaveLength(2);
  });

  it('does not open a transaction when every item fails', async () => {
    prismaMock.submission.findMany.mockResolvedValue([]);

    const result = await SubmissionService.bulkGrade(
      [{ submissionId: 's1', marks: 80 }],
      'inst1',
      {}
    );

    expect(result.failed).toBe(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('reports results in REQUEST order, not failures-first', async () => {
    prismaMock.submission.findMany.mockResolvedValue([resolved('s2')]);

    const result = await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 70 },
      ],
      'inst1',
      {}
    );

    // The array is read alongside the rows the instructor typed.
    expect(result.results.map((r) => [r.submissionId, r.status])).toEqual([
      ['s1', 'failed'],
      ['s2', 'graded'],
    ]);
  });

  it('gives a scope miss and a genuine 404 the same answer', async () => {
    prismaMock.submission.findMany.mockResolvedValue([]);

    const scope = { student: { studentBatches: { some: { batchId: { in: ['b1'] } } } } };
    const result = await SubmissionService.bulkGrade(
      [{ submissionId: 's1', marks: 10 }],
      'inst1',
      scope
    );

    // An instructor must not learn that a submission exists in a batch they do
    // not teach, so the scope is applied in the query and the miss reads as
    // "not found".
    expect(prismaMock.submission.findMany.mock.calls[0]![0].where.AND).toContainEqual(scope);
    expect(result.results[0].reason).toBe('Submission not found');
  });

  it('stamps the grader and one timestamp across the batch', async () => {
    await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 65 },
      ],
      'inst1',
      {}
    );

    const [first, second] = prismaMock.submission.update.mock.calls;
    expect(first![0].data.gradedById).toBe('inst1');
    // One `gradedAt` for the whole sitting: they were marked together.
    expect(first![0].data.gradedAt).toEqual(second![0].data.gradedAt);
  });

  it('notifies ONCE for the whole batch, so the digest can group by student', async () => {
    await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 65 },
      ],
      'inst1',
      {}
    );

    // The Phase 5 version called the singular announcement per item, which is
    // what produced one email per submission.
    expect(announceEvaluatedBulk).toHaveBeenCalledTimes(1);
    expect(announceEvaluatedBulk).toHaveBeenCalledWith(['s1', 's2'], 'inst1');
    expect(announceEvaluated).not.toHaveBeenCalled();
  });

  it('notifies only about the items that were actually marked', async () => {
    prismaMock.submission.findMany.mockResolvedValue([resolved('s1')]);

    await SubmissionService.bulkGrade(
      [
        { submissionId: 's1', marks: 80 },
        { submissionId: 's2', marks: 70 },
      ],
      'inst1',
      {}
    );

    expect(announceEvaluatedBulk).toHaveBeenCalledWith(['s1'], 'inst1');
  });

  it('does not notify when nothing was marked', async () => {
    prismaMock.submission.findMany.mockResolvedValue([]);

    await SubmissionService.bulkGrade([{ submissionId: 's1', marks: 80 }], 'inst1', {});
    expect(announceEvaluatedBulk).not.toHaveBeenCalled();
  });

  it('still reports success when notifying throws', async () => {
    announceEvaluatedBulk.mockRejectedValue(new Error('SMTP down'));

    // The marks are committed by then. Same isolation as the single path.
    const result = await SubmissionService.bulkGrade(
      [{ submissionId: 's1', marks: 80 }],
      'inst1',
      {}
    );

    expect(result.graded).toBe(1);
  });

  it('handles an empty batch without touching the database', async () => {
    const result = await SubmissionService.bulkGrade([], 'inst1', {});

    expect(result).toMatchObject({ requested: 0, graded: 0, failed: 0 });
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
