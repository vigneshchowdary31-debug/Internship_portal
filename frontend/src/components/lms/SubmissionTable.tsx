import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Clock, RefreshCw, Download, AlertTriangle, Award } from 'lucide-react';
import type { Submission } from '@/services/submissions';
import { cn } from '@/lib/utils';

/**
 * The instructor's grading list.
 *
 * Presentational: it renders what it is given and reports clicks upward. It
 * does no filtering of its own — the page owns that, so "what is on screen" has
 * exactly one source and a filter can never disagree with the count in the
 * header.
 */
export function SubmissionTable({
  submissions,
  maxMarks,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onOpen,
  failedIds,
}: {
  submissions: Submission[];
  maxMarks: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  onOpen: (submission: Submission) => void;
  /** Submission ids the last bulk save could not mark, with the reason. */
  failedIds: Map<string, string>;
}) {
  const allSelected = submissions.length > 0 && submissions.every((s) => selectedIds.has(s.id));

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => onToggleAll(submissions.map((s) => s.id))}
                aria-label="Select all submissions"
              />
            </TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Marks</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {submissions.map((submission) => {
            const graded = submission.marks !== null;
            const failure = failedIds.get(submission.id);

            return (
              <TableRow
                key={submission.id}
                className={cn(
                  failure && 'bg-red-50/70 hover:bg-red-50',
                  selectedIds.has(submission.id) && !failure && 'bg-primary/5'
                )}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(submission.id)}
                    onCheckedChange={() => onToggleSelect(submission.id)}
                    aria-label={`Select ${submission.student?.name ?? 'submission'}`}
                  />
                </TableCell>

                <TableCell>
                  <div className="font-medium text-gray-900">
                    {submission.student?.name ?? 'Unknown student'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {submission.student?.niatId ?? submission.student?.email}
                  </div>
                  {failure && (
                    <div className="mt-1 flex items-start gap-1 text-xs font-medium text-red-700">
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      {failure}
                    </div>
                  )}
                </TableCell>

                <TableCell className="whitespace-nowrap text-sm text-gray-600">
                  {new Date(submission.submittedAt).toLocaleString()}
                </TableCell>

                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {submission.isLate ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-red-200 bg-red-50 text-[10px] text-red-700"
                      >
                        <Clock className="h-2.5 w-2.5" />
                        Late
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-green-200 bg-green-50 text-[10px] text-green-700"
                      >
                        On time
                      </Badge>
                    )}

                    {graded ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700"
                      >
                        <Award className="h-2.5 w-2.5" />
                        Graded
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-gray-500">
                        Pending
                      </Badge>
                    )}

                    {submission.attemptCount > 1 && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-blue-200 bg-blue-50 text-[10px] text-blue-700"
                      >
                        <RefreshCw className="h-2.5 w-2.5" />
                        {submission.attemptCount}
                      </Badge>
                    )}
                  </div>
                </TableCell>

                <TableCell className="text-right font-medium">
                  {graded ? (
                    <span className="text-gray-900">
                      {submission.marks}
                      <span className="text-xs font-normal text-gray-400">/{maxMarks}</span>
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {submission.fileUrl && (
                      <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0">
                        <a
                          href={submission.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Download ${submission.student?.name ?? 'submission'}`}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => onOpen(submission)}>
                      {graded ? 'Review' : 'Grade'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
