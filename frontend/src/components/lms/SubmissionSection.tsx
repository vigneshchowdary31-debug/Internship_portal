import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  Loader2,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
  Award,
  MessageSquare,
  Download,
  Lock,
  Send,
} from 'lucide-react';
import { FileUpload } from './FileUpload';
import { submissionsApi, type Submission } from '@/services/submissions';
import type { ProviderUpload } from '@/services/lms';
import type { Assignment } from '@/services/assignments';
import { cn } from '@/lib/utils';

/**
 * The student's submission panel for one assignment.
 *
 * Upload and submit are two steps held in one component, because the failure
 * modes differ and the recovery does too:
 *
 *   upload fails  → nothing was registered; pick the file again
 *   submit fails  → the file IS uploaded; retry the API call, do not re-upload
 *
 * `pendingUpload` is what makes the second case cheap. Collapsing the two into
 * one "submit" action would mean a transient 500 costs the student another
 * 25 MB transfer, on a deadline.
 */

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The state of an existing submission, rendered as a status card. */
function SubmissionStatus({ submission }: { submission: Submission }) {
  const graded = submission.marks !== null;
  const submittedAt = new Date(submission.submittedAt);

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'rounded-md border p-3',
          submission.isLate ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {submission.isLate ? (
            <>
              <Clock className="h-4 w-4 text-red-600" />
              <span className="text-sm font-semibold text-red-900">Submitted late</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-semibold text-green-900">Submitted</span>
            </>
          )}

          {submission.attemptCount > 1 && (
            <Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-[10px] text-blue-700">
              <RefreshCw className="h-2.5 w-2.5" />
              Resubmitted · attempt {submission.attemptCount}
            </Badge>
          )}
        </div>

        <p className={cn('mt-1 text-xs', submission.isLate ? 'text-red-700' : 'text-green-700')}>
          {submittedAt.toLocaleString()}
        </p>

        {submission.fileUrl && (
          <a
            href={submission.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
          >
            <Download className="h-3 w-3" />
            {submission.originalFilename ?? 'Your file'}
            {submission.sizeBytes ? ` (${formatSize(submission.sizeBytes)})` : ''}
          </a>
        )}
      </div>

      {graded ? (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-900">
              {submission.marks} / {submission.assignment?.maxMarks ?? '?'} marks
            </span>
          </div>
          {submission.feedback && (
            <div className="mt-2 flex items-start gap-2 border-t border-indigo-200 pt-2">
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-600" />
              <p className="whitespace-pre-wrap text-xs text-indigo-900">{submission.feedback}</p>
            </div>
          )}
          {submission.gradedBy && (
            <p className="mt-2 text-[11px] text-indigo-700">Marked by {submission.gradedBy.name}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500">Not marked yet.</p>
      )}
    </div>
  );
}

export function SubmissionSection({ assignment }: { assignment: Assignment }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [pendingUpload, setPendingUpload] = useState<ProviderUpload | null>(null);

  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['submissions', assignment.id],
    queryFn: () => submissionsApi.listForAssignment(assignment.id),
  });

  // One row per (assignment, student) server-side, so this is "the" submission.
  const submission = submissions[0] ?? null;
  const graded = submission?.marks !== null && submission?.marks !== undefined;

  const submit = useMutation({
    mutationFn: (upload: ProviderUpload) => submissionsApi.create(assignment.id, upload),
    onSuccess: (created) => {
      setPendingUpload(null);
      queryClient.invalidateQueries({ queryKey: ['submissions', assignment.id] });
      // Refreshes the derived assignment progress on the course page.
      queryClient.invalidateQueries({ queryKey: ['lms', 'my-curriculum'] });
      toast.success(
        created.isLate ? 'Submitted (late)' : 'Submitted',
        created.isLate
          ? 'Your work was recorded and flagged as late.'
          : 'Your work has been recorded.'
      );
    },
    // Deliberately does NOT clear pendingUpload — the file is already in
    // storage, so the retry button below can reuse it.
    onError: (err) => toast.error('Could not submit', errorMessage(err)),
  });

  const deadline = new Date(assignment.deadline);
  const pastDeadline = deadline.getTime() < Date.now();

  // Why the student cannot submit right now, or null if they can.
  const blockedReason: string | null = graded
    ? 'This has been marked, so it can no longer be replaced.'
    : submission && !assignment.allowResubmission
      ? 'You have already submitted, and this assignment does not allow resubmission.'
      : !assignment.isPublished
        ? 'This assignment is not open for submissions.'
        : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading your submission…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {submission && <SubmissionStatus submission={submission} />}

      {blockedReason ? (
        <p className="flex items-start gap-2 rounded-md border bg-gray-50 p-3 text-sm text-gray-600">
          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          {blockedReason}
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {submission ? 'Replace your submission' : 'Submit your work'}
            </h3>
            {submission && (
              <p className="mt-0.5 text-xs text-gray-500">
                Uploading a new file replaces the one above. Your previous file is deleted.
              </p>
            )}
          </div>

          {/* A late submission is accepted and flagged, never refused — a
              student with nothing recorded is worse off than one marked late. */}
          {pastDeadline && (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              The deadline passed on {deadline.toLocaleString()}. You can still submit, and your
              work will be recorded as late.
            </p>
          )}

          <FileUpload
            onUploaded={(upload) => {
              setPendingUpload(upload);
              // Submit immediately: an uploaded file that is never submitted is
              // a blob in storage with no database row, invisible to the admin
              // orphan report. The two steps stay separable for RETRY only.
              submit.mutate(upload);
            }}
            onCleared={() => setPendingUpload(null)}
            uploadedFilename={pendingUpload?.originalFilename ?? null}
            disabled={submit.isPending}
          />

          {/* Retry path: the file is already in storage, so this re-sends the
              API call rather than the bytes. */}
          {pendingUpload && submit.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="flex items-start gap-2 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Your file uploaded, but recording the submission failed. Your file is safe — retry
                without uploading again.
              </p>
              <Button
                size="sm"
                className="mt-2"
                disabled={submit.isPending}
                onClick={() => submit.mutate(pendingUpload)}
              >
                {submit.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Retry submission
              </Button>
            </div>
          )}

          {submit.isPending && (
            <p className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Recording your submission…
            </p>
          )}

          {!pendingUpload && !submit.isPending && (
            <p className="flex items-center gap-1.5 text-xs text-gray-400">
              <Send className="h-3 w-3" />
              Your file is submitted as soon as it finishes uploading.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
