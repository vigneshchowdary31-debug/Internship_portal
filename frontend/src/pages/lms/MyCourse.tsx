import { useState } from 'react';
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
} from 'lucide-react';
import {
  lmsApi,
  ASSET_CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  type ContentType,
  type LmsContent,
  type LmsModule,
} from '@/services/lms';

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

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track.mutate()}
      className="flex items-center gap-3 rounded-md border bg-white p-3 transition-colors hover:border-primary/40 hover:bg-gray-50"
    >
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
      {isFile ? (
        <Download className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
      ) : (
        <ExternalLink className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
      )}
    </a>
  );
}

function StudentModuleCard({ module, defaultOpen }: { module: LmsModule; defaultOpen: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen);

  const { data: contents = [], isLoading } = useQuery({
    queryKey: ['lms', 'contents', module.id],
    queryFn: () => lmsApi.listContents(module.id),
    enabled: expanded,
  });

  const duration = formatDuration(module.estimatedDurationMinutes);

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
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : contents.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">
              Nothing has been shared in this module yet.
            </p>
          ) : (
            <div className="space-y-2">
              {contents.map((c) => (
                <StudentContentRow key={c.id} content={c} />
              ))}
            </div>
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
