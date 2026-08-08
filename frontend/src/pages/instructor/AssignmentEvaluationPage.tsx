import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Loader2,
  FileQuestion,
  ClipboardList,
  Clock,
  Award,
  Users,
  Search,
  Inbox,
} from 'lucide-react';
import { SubmissionTable } from '@/components/lms/SubmissionTable';
import { GradeModal } from '@/components/lms/GradeModal';
import { BulkGradePanel } from '@/components/lms/BulkGradePanel';
import { instructorApi } from '@/services/instructor';
import { assignmentsApi } from '@/services/assignments';
import type { Submission } from '@/services/submissions';

/**
 * Instructor evaluation dashboard for one assignment.
 *
 * Reads three server-owned facts and derives nothing it could get wrong:
 *   ['assignment', id]           the assignment, for its title and maxMarks
 *   ['assignment-progress', id]  the counts, already scoped to this instructor
 *   ['submissions', id]          the rows, already scoped to this instructor
 *
 * Filtering and sorting happen HERE rather than in the table, so what is on
 * screen has one source and a filter can never disagree with a count.
 */

type StatusFilter = 'all' | 'graded' | 'ungraded';

function StatCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof ClipboardList;
  label: string;
  value: string | number;
  tone?: 'default' | 'amber' | 'red' | 'indigo';
}) {
  const tones = {
    default: 'bg-gray-100 text-gray-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  };

  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={`flex h-9 w-9 items-center justify-center rounded-md ${tones[tone]}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export const AssignmentEvaluationPage = () => {
  const { id = '' } = useParams<{ id: string }>();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [lateOnly, setLateOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [failedIds, setFailedIds] = useState<Map<string, string>>(new Map());
  const [openSubmission, setOpenSubmission] = useState<Submission | null>(null);

  const assignment = useQuery({
    queryKey: ['assignment', id],
    queryFn: () => assignmentsApi.get(id),
    enabled: !!id,
    retry: false,
  });

  const progress = useQuery({
    queryKey: ['assignment-progress', id],
    queryFn: () => instructorApi.progress(id),
    enabled: !!id,
    retry: false,
  });

  const submissions = useQuery({
    queryKey: ['submissions', id],
    queryFn: () => instructorApi.listSubmissions(id),
    enabled: !!id,
    retry: false,
  });

  const rows = useMemo(() => submissions.data ?? [], [submissions.data]);
  const maxMarks = assignment.data?.maxMarks ?? 0;

  /**
   * Average as a percentage of maxMarks, over MARKED work only.
   *
   * Computed from the rows already loaded rather than fetched from
   * /analytics/assignment/:id, because that endpoint is not narrowed to the
   * instructor's own batches — it would report a figure including cohorts this
   * page does not show.
   */
  const averageScore = useMemo(() => {
    const graded = rows.filter((r) => r.marks !== null);
    if (graded.length === 0 || maxMarks === 0) return null;
    const total = graded.reduce((sum, r) => sum + (r.marks! / maxMarks) * 100, 0);
    return Math.round(total / graded.length);
  }, [rows, maxMarks]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === 'graded' && r.marks === null) return false;
      if (statusFilter === 'ungraded' && r.marks !== null) return false;
      if (lateOnly && !r.isLate) return false;
      if (term) {
        const haystack = `${r.student?.name ?? ''} ${r.student?.email ?? ''} ${r.student?.niatId ?? ''}`;
        if (!haystack.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, lateOnly, search]);

  const selectedSubmissions = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds]
  );

  const toggleSelect = (submissionId: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(submissionId)) next.delete(submissionId);
      else next.add(submissionId);
      return next;
    });

  // Operates on the FILTERED ids the caller passes, so "select all" means what
  // is visible — never a hidden row the instructor has not looked at.
  const toggleAll = (ids: string[]) =>
    setSelectedIds((current) => {
      const allSelected = ids.length > 0 && ids.every((i) => current.has(i));
      const next = new Set(current);
      for (const i of ids) {
        if (allSelected) next.delete(i);
        else next.add(i);
      }
      return next;
    });

  if (assignment.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading assignment…
      </div>
    );
  }

  // The API answers 404 for an assignment outside this instructor's curriculum
  // — the same answer as one that does not exist, which is deliberate. Both
  // render as "not available" rather than hinting that it is someone else's.
  if (assignment.isError || !assignment.data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <FileQuestion className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">This assignment is not available</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            It may have been withdrawn, or it is not part of a curriculum you teach.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/instructor/curriculum">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to curriculum
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const stats = progress.data;
  const gradedPercent =
    stats && stats.totalSubmissions > 0
      ? Math.round((stats.gradedCount / stats.totalSubmissions) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/instructor/curriculum">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to curriculum
          </Link>
        </Button>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{assignment.data.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              {assignment.data.module?.name && <span>{assignment.data.module.name}</span>}
              <Badge variant="outline">{maxMarks} marks</Badge>
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                Due {new Date(assignment.data.deadline).toLocaleString()}
              </Badge>
            </p>
          </div>
        </div>
      </div>

      {/* --- Stats --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Submissions" value={stats?.totalSubmissions ?? '—'} />
        <StatCard
          icon={ClipboardList}
          label="Graded / Pending"
          value={stats ? `${stats.gradedCount} / ${stats.pendingCount}` : '—'}
          tone="indigo"
        />
        <StatCard
          icon={Award}
          label="Average score"
          value={averageScore === null ? '—' : `${averageScore}%`}
          tone="amber"
        />
        <StatCard icon={Clock} label="Late" value={stats?.lateCount ?? '—'} tone="red" />
      </div>

      {stats && stats.totalSubmissions > 0 && (
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Grading progress</span>
            <span className="text-gray-500">
              {stats.gradedCount} of {stats.totalSubmissions} marked
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${gradedPercent}%` }}
              role="progressbar"
              aria-valuenow={gradedPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Grading progress"
            />
          </div>
        </div>
      )}

      {/* --- Filters --- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or NIAT ID"
            className="pl-8"
            aria-label="Search students"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[150px]" aria-label="Grading status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="ungraded">Ungraded</SelectItem>
            <SelectItem value="graded">Graded</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={lateOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setLateOnly((v) => !v)}
        >
          <Clock className="mr-2 h-4 w-4" />
          Late only
        </Button>

        {selectedIds.size > 0 && (
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            <Users className="mr-2 h-4 w-4" />
            Bulk grade ({selectedIds.size})
          </Button>
        )}
      </div>

      {bulkOpen && selectedSubmissions.length > 0 && (
        <BulkGradePanel
          submissions={selectedSubmissions}
          maxMarks={maxMarks}
          assignmentId={id}
          onClose={() => {
            setBulkOpen(false);
            setSelectedIds(new Set());
          }}
          onResults={(failures) => {
            setFailedIds(failures);
            // Keep only the rows that still need attention selected.
            setSelectedIds(new Set(failures.keys()));
          }}
        />
      )}

      {/* --- Table --- */}
      {submissions.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading submissions…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Inbox className="mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-gray-700">No submissions yet</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Nobody in your batches has handed this in. They will appear here as they submit.
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-gray-500">
              No submissions match these filters.{' '}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => {
                  setStatusFilter('all');
                  setLateOnly(false);
                  setSearch('');
                }}
              >
                Clear filters
              </button>
            </p>
          </CardContent>
        </Card>
      ) : (
        <SubmissionTable
          submissions={filtered}
          maxMarks={maxMarks}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleAll={toggleAll}
          onOpen={setOpenSubmission}
          failedIds={failedIds}
        />
      )}

      {rows.length >= 100 && (
        <p className="text-center text-xs text-amber-700">
          Showing the first 100 submissions — the server's page limit. Use the filters to narrow
          the list.
        </p>
      )}

      <GradeModal
        submission={openSubmission}
        maxMarks={maxMarks}
        assignmentId={id}
        open={!!openSubmission}
        onOpenChange={(open) => !open && setOpenSubmission(null)}
      />
    </div>
  );
};
