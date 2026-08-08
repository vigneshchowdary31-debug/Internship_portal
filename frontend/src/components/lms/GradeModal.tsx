import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  Loader2,
  Download,
  Clock,
  RefreshCw,
  Award,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { instructorApi } from '@/services/instructor';
import type { Submission } from '@/services/submissions';
import { cn } from '@/lib/utils';

/**
 * Submission detail and grading, in one overlay.
 *
 * Detail and grading are deliberately not two separate surfaces: an instructor
 * decides a mark BY reading the submission, so making them open the file in one
 * place and enter the number in another adds a step to every single paper.
 *
 * Validation is the server's. The upper bound is shown and the field is capped
 * to stop the obvious typo early, but nothing here decides whether a mark is
 * acceptable — the API answers that, and its message is what the toast shows.
 */

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GradeModal({
  submission,
  maxMarks,
  assignmentId,
  open,
  onOpenChange,
}: {
  submission: Submission | null;
  maxMarks: number;
  assignmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [marks, setMarks] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);

  const alreadyGraded = submission?.marks !== null && submission?.marks !== undefined;

  useEffect(() => {
    if (!open || !submission) return;
    // Pre-filled when re-marking, so a correction is an edit rather than a
    // retype from memory.
    setMarks(submission.marks !== null ? String(submission.marks) : '');
    setFeedback(submission.feedback ?? '');
    setError(null);
  }, [open, submission]);

  const grade = useMutation({
    mutationFn: (body: { marks: number; feedback?: string | null }) =>
      instructorApi.gradeOne(submission!.id, body),
    onSuccess: (updated) => {
      // Three caches move together: the row, the header counts, and anything
      // analytics has already computed from this assignment.
      queryClient.invalidateQueries({ queryKey: ['submissions', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['assignment-progress', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      toast.success(
        'Marked',
        `${updated.student?.name ?? 'The student'} scored ${updated.marks}/${maxMarks} and has been notified.`
      );
      onOpenChange(false);
    },
    onError: (err) => toast.error('Could not save the mark', errorMessage(err)),
  });

  if (!submission) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const value = Number(marks);
    if (marks.trim() === '' || !Number.isInteger(value)) {
      return setError('Enter a whole number of marks.');
    }
    if (value < 0 || value > maxMarks) {
      return setError(`Marks must be between 0 and ${maxMarks}.`);
    }

    grade.mutate({ marks: value, feedback: feedback.trim() || null });
  };

  const submittedAt = new Date(submission.submittedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{submission.student?.name ?? 'Submission'}</DialogTitle>
          <DialogDescription>
            {submission.student?.niatId ? `${submission.student.niatId} · ` : ''}
            {submission.student?.email}
          </DialogDescription>
        </DialogHeader>

        {/* --- Detail --- */}
        <div className="space-y-3 rounded-md border bg-gray-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {submission.isLate ? (
              <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-700">
                <Clock className="h-3 w-3" />
                Late
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-green-200 bg-green-50 text-green-700">
                <CheckCircle2 className="h-3 w-3" />
                On time
              </Badge>
            )}
            {submission.attemptCount > 1 && (
              <Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
                <RefreshCw className="h-3 w-3" />
                Attempt {submission.attemptCount}
              </Badge>
            )}
            {alreadyGraded && (
              <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700">
                <Award className="h-3 w-3" />
                Already marked {submission.marks}/{maxMarks}
              </Badge>
            )}
          </div>

          <p className="text-xs text-gray-500">Submitted {submittedAt.toLocaleString()}</p>

          {submission.fileUrl ? (
            <a
              href={submission.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-2"
            >
              <Download className="h-3.5 w-3.5" />
              {submission.originalFilename ?? 'Download submission'}
              {submission.sizeBytes ? ` (${formatSize(submission.sizeBytes)})` : ''}
            </a>
          ) : (
            <p className="text-sm text-gray-500">No file attached.</p>
          )}
        </div>

        {/* --- Grading --- */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {alreadyGraded && (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              This submission is already marked. Saving replaces the existing mark and feedback,
              and notifies the student again.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="grade-marks">
              Marks <span className="font-normal text-gray-500">out of {maxMarks}</span>
            </Label>
            <Input
              id="grade-marks"
              type="number"
              min={0}
              max={maxMarks}
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
              className={cn('w-32', error && 'border-red-400')}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="grade-feedback">Feedback</Label>
            <Textarea
              id="grade-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What did they do well, and what should they change?"
              rows={5}
              maxLength={4000}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={grade.isPending}>
              {grade.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {alreadyGraded ? 'Update mark' : 'Save mark'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
