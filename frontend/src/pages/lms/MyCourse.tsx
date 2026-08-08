import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Presentation,
  FileType,
  FolderGit2,
  Video,
  Link as LinkIcon,
  Film,
  Loader2,
  ExternalLink,
  Download,
  Eye,
  ClipboardList,
  CalendarClock,
  ListChecks,
} from 'lucide-react';
import {
  lmsApi,
  ASSET_CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  type ContentType,
  type LmsContent,
  type LmsModule,
} from '@/services/lms';
import { assignmentsApi, type Assignment } from '@/services/assignments';
import { quizzesApi } from '@/services/quizzes';
import { opensInBrowser, viewerPath } from '@/lib/contentUrl';
import { StudentQuizRow } from '@/components/lms/StudentQuizRow';

const TYPE_ICONS: Record<ContentType, typeof FileText> = {
  PDF: FileText,
  PPT: Presentation,
  DOCX: FileType,
  VIDEO: Film,
  GITHUB_REPO: FolderGit2,
  RECORDING: Video,
  LINK: LinkIcon,
  REFERENCE: BookOpen,
};

const DIFFICULTY_STYLES: Record<string, string> = {
  BEGINNER: 'border-green-200 bg-green-50 text-green-700',
  INTERMEDIATE: 'border-blue-200 bg-blue-50 text-blue-700',
  ADVANCED: 'border-purple-200 bg-purple-50 text-purple-700',
};

function formatDuration(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * One content item as a student sees it.
 *
 * Opening records the interaction so analytics and the future Continue Learning
 * widget have data. The recording is fire-and-forget: a tracking failure must
 * never stop someone opening their notes.
 */
function StudentContentRow({ content }: { content: LmsContent }) {
  const Icon = TYPE_ICONS[content.type];
  const isFile = ASSET_CONTENT_TYPES.includes(content.type);
  const href = content.asset?.url ?? content.externalUrl ?? undefined;

  const track = useMutation({
    mutationFn: () => (isFile ? lmsApi.recordDownload(content.id) : lmsApi.recordOpen(content.id)),
  });

  // Office documents cannot be rendered by any browser. Routing them through
  // the viewer would show a blank frame or silently download anyway, so they
  // keep the honest download link — the one case where leaving is correct.
  const canView = href && opensInBrowser(content.type);

  const shared = (
    <>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50">
        <Icon className="h-4 w-4 text-indigo-600" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{content.title}</p>
        {content.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{content.description}</p>
        )}
        <p className="mt-0.5 text-xs text-gray-400">{CONTENT_TYPE_LABELS[content.type]}</p>
      </div>
      {canView ? (
        <Eye className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
      ) : isFile ? (
        <Download className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
      ) : (
        <ExternalLink className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
      )}
    </>
  );

  const className =
    'flex items-center gap-3 rounded-md border bg-white p-3 transition-colors hover:border-primary/40 hover:bg-gray-50';

  // A Link, not window.location: the viewer opens inside the app and the back
  // button returns to this module with its state intact.
  if (canView) {
    return (
      <Link
        to={viewerPath({
          url: href!,
          type: content.type,
          title: content.title,
          moduleId: content.moduleId,
          contentId: content.id,
        })}
        className={className}
      >
        {shared}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track.mutate()}
      className={className}
    >
      {shared}
    </a>
  );
}

/**
 * One assignment as a student sees it.
 *
 * Assignments are NOT content — they come from `/api/assignments`, carry a
 * deadline and a mark, and are fetched separately. Merging them into the
 * content list would mean the server could not tell "material to read" from
 * "work to hand in", which is the distinction the whole submission flow rests
 * on.
 *
 * The server has already applied the visibility resolver, so an unpublished
 * assignment, one in a hidden module, and another batch's work never reach
 * here. Nothing below re-checks any of that.
 */
function StudentAssignmentRow({ assignment }: { assignment: Assignment }) {
  const due = new Date(assignment.deadline);
  const closed = due.getTime() < Date.now();
  const dueSoon = !closed && due.getTime() - Date.now() < 48 * 60 * 60 * 1000;

  return (
    <Link
      to={`/student/assignments/${assignment.id}`}
      className="flex items-center gap-3 rounded-md border bg-white p-3 transition-colors hover:border-amber-300 hover:bg-amber-50/40"
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-amber-50">
        <ClipboardList className="h-4 w-4 text-amber-600" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{assignment.title}</p>
        {assignment.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{assignment.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
          <span
            className={
              closed
                ? 'flex items-center gap-1 font-medium text-red-600'
                : dueSoon
                  ? 'flex items-center gap-1 font-medium text-amber-700'
                  : 'flex items-center gap-1 text-gray-500'
            }
          >
            <CalendarClock className="h-3 w-3" />
            {closed ? 'Closed' : 'Due'} {due.toLocaleString()}
          </span>
          <span className="text-gray-400">{assignment.maxMarks} marks</span>
        </div>
      </div>

      <Badge
        variant="outline"
        className={
          closed
            ? 'flex-shrink-0 border-red-200 bg-red-50 text-[10px] text-red-700'
            : 'flex-shrink-0 border-amber-200 bg-amber-50 text-[10px] text-amber-700'
        }
      >
        {closed ? 'Closed' : 'Assignment'}
      </Badge>
    </Link>
  );
}

type ModuleTab = 'content' | 'assignments' | 'quizzes';

/** A tab button. No Tabs primitive exists in this project, and one button group
 *  is less code than adding a dependency for three toggles. */
function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'flex items-center gap-1.5 border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary'
          : 'flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm text-gray-500 hover:text-gray-800'
      }
    >
      {children}
      <span className="rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-600">{count}</span>
    </button>
  );
}

function StudentModuleCard({ module, defaultOpen }: { module: LmsModule; defaultOpen: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [tab, setTab] = useState<ModuleTab | null>(null);

  const { data: contents = [], isLoading } = useQuery({
    queryKey: ['lms', 'contents', module.id],
    queryFn: () => lmsApi.listContents(module.id),
    enabled: expanded,
  });

  // A SECOND query, not a widened first one. Both are enabled on the same
  // condition so react-query fires them concurrently — the parallel fetch,
  // with independent caching and error states that one Promise.all would fuse
  // together (a failing assignments call would blank the content list too).
  const { data: assignments = [], isLoading: loadingAssignments } = useQuery({
    queryKey: ['lms', 'assignments', module.id],
    queryFn: () => assignmentsApi.listForModule(module.id),
    enabled: expanded,
  });

  // Quizzes are their own entity and their own endpoint — a third query rather
  // than a widened one, for the same reason assignments were: independent
  // caching, and a failure in one list does not blank the others.
  const { data: quizzes = [], isLoading: loadingQuizzes } = useQuery({
    queryKey: ['quizzes', module.id],
    queryFn: () => quizzesApi.list({ moduleId: module.id }),
    enabled: expanded,
  });

  const duration = formatDuration(module.estimatedDurationMinutes);
  const loading = isLoading || loadingAssignments || loadingQuizzes;
  const isEmpty = contents.length === 0 && assignments.length === 0 && quizzes.length === 0;

  // Never land on an empty tab: the default follows the data, and an explicit
  // choice wins once the student has made one.
  const firstPopulated: ModuleTab =
    contents.length > 0 ? 'content' : assignments.length > 0 ? 'assignments' : 'quizzes';
  const activeTab = tab ?? firstPopulated;

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="mt-0.5 text-gray-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        {module.thumbnail && (
          <img
            src={module.thumbnail.url}
            alt=""
            className="hidden h-12 w-16 shrink-0 rounded border object-cover sm:block"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">{module.name}</span>
            {module.difficulty && (
              <Badge variant="outline" className={DIFFICULTY_STYLES[module.difficulty]}>
                {module.difficulty.charAt(0) + module.difficulty.slice(1).toLowerCase()}
              </Badge>
            )}
          </div>
          {module.progress && module.progress.total > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${module.progress.percent}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">
                {module.progress.completed}/{module.progress.total}
              </span>
            </div>
          )}
          {module.description && (
            <p className="mt-0.5 text-sm text-gray-500">{module.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {module._count.contents} resource{module._count.contents === 1 ? '' : 's'}
            </span>
            {/* Only once expanded: the count comes from the assignments query,
                which does not run until then. */}
            {expanded && assignments.length > 0 && (
              <span className="flex items-center gap-1 font-medium text-amber-700">
                <ClipboardList className="h-3 w-3" />
                {assignments.length} assignment{assignments.length === 1 ? '' : 's'}
              </span>
            )}
            {expanded && quizzes.length > 0 && (
              <span className="flex items-center gap-1 font-medium text-violet-700">
                <ListChecks className="h-3 w-3" />
                {quizzes.length} quiz{quizzes.length === 1 ? '' : 'zes'}
              </span>
            )}
            {duration && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {duration}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-gray-50/60 p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : isEmpty ? (
            // The empty state now depends on BOTH lists. Keying it off content
            // alone was what hid a module that had only assignments in it.
            <p className="py-4 text-center text-sm text-gray-500">
              Nothing has been shared in this module yet.
            </p>
          ) : (
            <>
              {/* Tabs rather than stacked sections: a module with content,
                  assignments and quizzes is otherwise a long scroll, and a
                  student usually arrives wanting one of the three. The default
                  falls to whichever tab actually has something in it, so an
                  empty tab is never what greets them. */}
              <div className="flex flex-wrap items-center gap-1 border-b" role="tablist">
                {contents.length > 0 && (
                  <TabButton
                    active={activeTab === 'content'}
                    count={contents.length}
                    onClick={() => setTab('content')}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Content
                  </TabButton>
                )}
                {assignments.length > 0 && (
                  <TabButton
                    active={activeTab === 'assignments'}
                    count={assignments.length}
                    onClick={() => setTab('assignments')}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    Assignments
                  </TabButton>
                )}
                {quizzes.length > 0 && (
                  <TabButton
                    active={activeTab === 'quizzes'}
                    count={quizzes.length}
                    onClick={() => setTab('quizzes')}
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    Quizzes
                  </TabButton>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {activeTab === 'content' &&
                  contents.map((c) => <StudentContentRow key={c.id} content={c} />)}
                {activeTab === 'assignments' &&
                  assignments.map((a) => <StudentAssignmentRow key={a.id} assignment={a} />)}
                {activeTab === 'quizzes' &&
                  quizzes.map((quiz) => <StudentQuizRow key={quiz.id} quiz={quiz} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The student's course.
 *
 * Every module is open from day one — no sequential unlocking, by design. The
 * server has already filtered to published, released, own-batch content, so
 * nothing here re-checks visibility.
 */
export const MyCourse = () => {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['lms', 'my-curriculum'],
    queryFn: () => lmsApi.myCurriculum(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading your course…
      </div>
    );
  }

  if (!data?.learningPath) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <BookOpen className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">Your course is not ready yet</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            {data?.batch
              ? 'Your batch has no curriculum assigned yet. Your administrator will set this up.'
              : 'You have not been assigned to a batch yet. Please contact your administrator.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Course</h1>
        <p className="text-sm text-gray-500">
          Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}. Everything your instructors
          have shared is here.
        </p>
      </div>

      <Card className="border-t-4 border-t-primary">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">{data.learningPath.name}</CardTitle>
            <Badge variant="outline">{data.learningPath.version}</Badge>
          </div>
          <CardDescription>
            {data.batch?.techStack?.name && <>{data.batch.techStack.name} · </>}
            Batch {data.batch?.name} · {data.modules.length} module
            {data.modules.length === 1 ? '' : 's'}
          </CardDescription>
        </CardHeader>

        {/* Weighted across every visible item, so it only reads 100% when the
            whole course is genuinely finished. */}
        {data.progress && data.progress.total > 0 && (
          <CardContent className="pt-0">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">Your progress</span>
              <span className="text-gray-500">
                {data.progress.completed} of {data.progress.total} completed
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${data.progress.percent}%` }}
                role="progressbar"
                aria-valuenow={data.progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Overall course progress"
              />
            </div>
            <p className="mt-1 text-right text-xs font-semibold text-primary">
              {data.progress.percent}%
            </p>
          </CardContent>
        )}

        {/* Assignment progress is reported separately from content progress,
            exactly as the server returns it. Folding them into one bar would
            change the number every existing screen already shows. */}
        {data.assignmentProgress && data.assignmentProgress.total > 0 && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-amber-50/50 px-3 py-2 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-gray-700">
                <ClipboardList className="h-4 w-4 text-amber-600" />
                Assignments
              </span>
              <span className="text-gray-600">
                {data.assignmentProgress.submitted} of {data.assignmentProgress.total} submitted
              </span>
              {data.assignmentProgress.late > 0 && (
                <span className="text-amber-700">{data.assignmentProgress.late} late</span>
              )}
              {data.assignmentProgress.averageScorePercent !== null && (
                <span className="text-gray-600">
                  Average {data.assignmentProgress.averageScorePercent}%
                </span>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {data.modules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-gray-500">
              No modules have been published yet. Check back soon.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.modules.map((module, index) => (
            // First module opens by default so the page is never a wall of
            // collapsed rows on first visit.
            <StudentModuleCard key={module.id} module={module} defaultOpen={index === 0} />
          ))}
        </div>
      )}
    </div>
  );
};
