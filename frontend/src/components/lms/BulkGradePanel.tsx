import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast, errorMessage } from '@/components/ui/toast';
import { Loader2, X, Users, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { instructorApi, type BulkGradeItem } from '@/services/instructor';
import type { Submission } from '@/services/submissions';
import { cn } from '@/lib/utils';

/**
 * Marks several submissions in one request.
 *
 * ── PARTIAL SUCCESS IS THE NORMAL CASE ───────────────────────────────────────
 * The API answers 200 even when some rows failed, because some marks really
 * were recorded. So this reads `results`, never the status code: successful
 * rows are dropped from the panel and the failures stay behind with their
 * reason, which leaves the instructor looking at exactly the work still to do
 * rather than re-entering thirty marks that already saved.
 *
 * Rows with no mark typed are simply not sent — selecting a student and leaving
 * them blank means "not this one", not "zero".
 */
export function BulkGradePanel({
  submissions,
  maxMarks,
  assignmentId,
  onClose,
  onResults,
}: {
  submissions: Submission[];
  maxMarks: number;
  assignmentId: string;
  onClose: () => void;
  /** Reports failures upward so the table can highlight the same rows. */
  onResults: (failures: Map<string, string>) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [marksById, setMarksById] = useState<Record<string, string>>({});
  const [sharedFeedback, setSharedFeedback] = useState('');
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());

  // Pre-fills an existing mark so a re-grade edits rather than blanks it.
  useEffect(() => {
    setMarksById((current) => {
      const next = { ...current };
      for (const s of submissions) {
        if (next[s.id] === undefined) next[s.id] = s.marks !== null ? String(s.marks) : '';
      }
      return next;
    });
  }, [submissions]);

  const bulk = useMutation({
    mutationFn: (items: BulkGradeItem[]) => instructorApi.bulkGrade(items),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['submissions', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['assignment-progress', assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });

      const failures = new Map<string, string>();
      for (const row of result.results) {
        if (row.status === 'failed') failures.set(row.submissionId, row.reason ?? 'Could not be marked.');
      }
      onResults(failures);

      if (result.failed === 0) {
        toast.success(
          `Marked ${result.graded} submission(s)`,
          'Those students have been notified.'
        );
        onClose();
        return;
      }

      // Keep the panel open on the rows that still need attention.
      setMarksById((current) => {
        const next: Record<string, string> = {};
        for (const id of failures.keys()) next[id] = current[id] ?? '';
        return next;
      });
      toast.error(
        `Marked ${result.graded} of ${result.requested}`,
        `${result.failed} could not be marked — see the highlighted rows.`
      );
    },
    onError: (err) => toast.error('Bulk grading failed', errorMessage(err)),
  });

  const handleSubmit = () => {
    const items: BulkGradeItem[] = [];
    const invalid = new Set<string>();

    for (const submission of submissions) {
      const raw = marksById[submission.id];
      // Blank means "skip this one", not zero.
      if (raw === undefined || raw.trim() === '') continue;

      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > maxMarks) {
        invalid.add(submission.id);
        continue;
      }

      items.push({
        submissionId: submission.id,
        marks: value,
        feedback: sharedFeedback.trim() || null,
      });
    }

    setInvalidIds(invalid);

    if (invalid.size > 0) {
      return toast.error(
        'Some marks are out of range',
        `Every mark must be a whole number between 0 and ${maxMarks}.`
      );
    }
    if (items.length === 0) {
      return toast.error('Nothing to save', 'Enter a mark for at least one student.');
    }

    bulk.mutate(items);
  };

  const pendingCount = submissions.filter(
    (s) => (marksById[s.id] ?? '').trim() !== ''
  ).length;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <Users className="h-4 w-4 text-primary" />
          Bulk grading — {submissions.length} selected
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={bulk.isPending}>
          <X className="mr-1 h-3.5 w-3.5" />
          Close
        </Button>
      </div>

      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
        {submissions.map((submission) => {
          const invalid = invalidIds.has(submission.id);
          return (
            <div
              key={submission.id}
              className={cn(
                'flex items-center gap-3 rounded-md border bg-white p-2.5',
                invalid && 'border-red-300 bg-red-50'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {submission.student?.name ?? 'Unknown student'}
                </p>
                <p className="text-xs text-gray-500">
                  {submission.isLate ? 'Late · ' : ''}
                  {submission.marks !== null ? `currently ${submission.marks}/${maxMarks}` : 'not marked'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={maxMarks}
                  value={marksById[submission.id] ?? ''}
                  onChange={(e) =>
                    setMarksById((current) => ({ ...current, [submission.id]: e.target.value }))
                  }
                  placeholder="—"
                  className={cn('h-8 w-20', invalid && 'border-red-400')}
                  aria-label={`Marks for ${submission.student?.name ?? 'student'}`}
                />
                <span className="text-xs text-gray-400">/{maxMarks}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-2">
        <Label htmlFor="bulk-feedback">
          Shared feedback <span className="font-normal text-gray-500">(applied to all, optional)</span>
        </Label>
        <Textarea
          id="bulk-feedback"
          value={sharedFeedback}
          onChange={(e) => setSharedFeedback(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Anything the whole group should read. Leave blank for no feedback."
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-gray-600">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          {pendingCount} of {submissions.length} have a mark entered. Blank rows are skipped.
        </p>
        <Button onClick={handleSubmit} disabled={bulk.isPending || pendingCount === 0}>
          {bulk.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save {pendingCount} mark{pendingCount === 1 ? '' : 's'}
        </Button>
      </div>

      {bulk.isPending && submissions.length > 10 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          Each student is notified by email as their mark saves, so a large batch takes a
          moment. Do not close this tab.
        </p>
      )}
    </div>
  );
}
