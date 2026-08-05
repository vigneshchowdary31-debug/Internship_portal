import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, X, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  lmsApi,
  CONTENT_TYPE_LABELS,
  type ContentType,
  type ContentStatus,
  type LmsModule,
} from '@/services/lms';

/** Sentinel for "no filter" — Radix Select cannot hold an empty-string value. */
const ANY = '__any__';

interface Props {
  learningPathId: string;
  modules: LmsModule[];
  /** Opens the module containing a hit. */
  onSelectResult?: (moduleId: string, contentId: string) => void;
}

/**
 * Search and filtering across a learning path's content.
 *
 * The query is debounced so typing does not fire a request per keystroke, and
 * `keepPreviousData` holds the previous page on screen while the next loads —
 * without it the list blanks on every filter change and the page jumps.
 */
export function ContentSearch({ learningPathId, modules, onSelectResult }: Props) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [moduleId, setModuleId] = useState<string>(ANY);
  const [type, setType] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  // Any filter change invalidates the current page number — staying on page 4
  // of a result set that now has one page shows an empty list.
  useEffect(() => setPage(1), [debounced, moduleId, type, status]);

  const filters = useMemo(
    () => ({
      q: debounced || undefined,
      learningPathId,
      moduleId: moduleId === ANY ? undefined : moduleId,
      type: type === ANY ? undefined : (type as ContentType),
      status: status === ANY ? undefined : (status as ContentStatus),
      page,
      pageSize: 10,
    }),
    [debounced, learningPathId, moduleId, type, status, page]
  );

  const hasCriteria = Boolean(debounced || moduleId !== ANY || type !== ANY || status !== ANY);

  const { data, isFetching } = useQuery({
    queryKey: ['lms', 'content-search', filters],
    queryFn: () => lmsApi.searchContent(filters),
    enabled: hasCriteria,
    placeholderData: keepPreviousData,
  });

  const moduleNames = useMemo(
    () => new Map(modules.map((m) => [m.id, m.name])),
    [modules]
  );

  const clear = () => {
    setTerm('');
    setModuleId(ANY);
    setType(ANY);
    setStatus(ANY);
  };

  const meta = data?.meta;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search resources by title or description…"
            className="pl-9"
            aria-label="Search resources"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={moduleId} onValueChange={setModuleId}>
            <SelectTrigger className="w-[150px]" aria-label="Filter by module">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All modules</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-[150px]" aria-label="Filter by type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All types</SelectItem>
              {(Object.keys(CONTENT_TYPE_LABELS) as ContentType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {CONTENT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[130px]" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
            </SelectContent>
          </Select>

          {hasCriteria && (
            <Button variant="ghost" size="icon" onClick={clear} aria-label="Clear filters">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {hasCriteria && (
        <div className="mt-4 border-t pt-4">
          {isFetching && !data ? (
            <p className="py-6 text-center text-sm text-gray-500">Searching…</p>
          ) : !data || data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No resources match these filters.
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelectResult?.(item.moduleId, item.id)}
                      className="flex w-full items-start gap-3 px-1 py-2.5 text-left transition hover:bg-gray-50"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {/* Search spans modules, so every hit says where it lives. */}
                          {item.module?.name ?? moduleNames.get(item.moduleId) ?? 'Unknown module'}
                          {' · '}
                          {CONTENT_TYPE_LABELS[item.type]}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {item.scope === 'BATCH' && (
                          <Badge variant="outline" className="text-[10px]">
                            Batch
                          </Badge>
                        )}
                        <Badge
                          variant={item.status === 'PUBLISHED' ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              {meta && meta.total > meta.pageSize && (
                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  <p className="text-xs text-gray-500">
                    {(meta.page - 1) * meta.pageSize + 1}–
                    {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={meta.page <= 1 || isFetching}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={!meta.hasMore || isFetching}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
