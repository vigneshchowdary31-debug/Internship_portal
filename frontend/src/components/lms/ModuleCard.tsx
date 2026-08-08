import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast, errorMessage } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
  EyeOff,
  Clock,
  FileText,
  ClipboardList,
  Loader2,
} from 'lucide-react';
import { SortableList, SortableItem } from './SortableList';
import { ContentRow } from './ContentRow';
import { ContentFormDialog, type ContentFormValues } from './ContentFormDialog';
import { AssignmentRow } from './AssignmentRow';
import { AssignmentFormDialog } from './AssignmentFormDialog';
import { lmsApi, type LmsContent, type LmsModule } from '@/services/lms';
import { assignmentsApi, type Assignment, type AssignmentPayload } from '@/services/assignments';
import { cn } from '@/lib/utils';

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
 * One collapsible module with its content list.
 *
 * Content is fetched lazily on first expand — a 12-module curriculum should not
 * issue 12 content requests on page load.
 */
export function ModuleCard({
  module,
  canEdit,
  onEdit,
  onDelete,
  focused = false,
}: {
  module: LmsModule;
  canEdit: boolean;
  onEdit: (module: LmsModule) => void;
  onDelete: (module: LmsModule) => void;
  /**
   * Set when a search result points at this module: the card expands and
   * scrolls into view. Opt-in and defaulted, so the existing callers that do
   * not pass it keep their previous behaviour exactly.
   */
  focused?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused) return;
    setExpanded(true);
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focused]);
  const [isContentFormOpen, setIsContentFormOpen] = useState(false);
  const [editingContent, setEditingContent] = useState<LmsContent | null>(null);
  const [isAssignmentFormOpen, setIsAssignmentFormOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);

  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: contents = [], isLoading } = useQuery({
    queryKey: ['lms', 'contents', module.id],
    queryFn: () => lmsApi.listContents(module.id),
    enabled: expanded,
  });

  // Assignments live on their own endpoint, so they are their own query. Both
  // are lazy on first expand for the same reason: a 12-module curriculum should
  // not issue 24 requests on page load.
  const { data: assignments = [], isLoading: loadingAssignments } = useQuery({
    queryKey: ['lms', 'assignments', module.id],
    queryFn: () => assignmentsApi.listForModule(module.id),
    enabled: expanded,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lms', 'contents', module.id] });
    queryClient.invalidateQueries({ queryKey: ['lms', 'modules'] });
  };

  const invalidateAssignments = () =>
    queryClient.invalidateQueries({ queryKey: ['lms', 'assignments', module.id] });

  const openAssignmentForm = (assignment: Assignment | null) => {
    setEditingAssignment(assignment);
    setExpanded(true);
    setIsAssignmentFormOpen(true);
  };

  const createAssignment = useMutation({
    mutationFn: (values: AssignmentPayload) => assignmentsApi.create(module.id, values),
    onSuccess: () => {
      invalidateAssignments();
      setIsAssignmentFormOpen(false);
      toast.success('Assignment created', 'It is a draft until you publish it.');
    },
    onError: (err) => toast.error('Could not add assignment', errorMessage(err)),
  });

  const updateAssignment = useMutation({
    mutationFn: ({ id, values }: { id: string; values: AssignmentPayload }) =>
      assignmentsApi.update(id, values),
    onSuccess: () => {
      invalidateAssignments();
      setIsAssignmentFormOpen(false);
      setEditingAssignment(null);
      toast.success('Assignment updated');
    },
    onError: (err) => toast.error('Could not save changes', errorMessage(err)),
  });

  const createContent = useMutation({
    mutationFn: (values: ContentFormValues) => lmsApi.createContent(module.id, values),
    onSuccess: () => {
      invalidate();
      setIsContentFormOpen(false);
      toast.success('Content added');
    },
    onError: (err) => toast.error('Could not add content', errorMessage(err)),
  });

  const updateContent = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ContentFormValues }) =>
      lmsApi.updateContent(id, values),
    onSuccess: () => {
      invalidate();
      setIsContentFormOpen(false);
      setEditingContent(null);
      toast.success('Content updated');
    },
    onError: (err) => toast.error('Could not save changes', errorMessage(err)),
  });

  const reorderContents = useMutation({
    mutationFn: (orderedIds: string[]) => lmsApi.reorderContents(module.id, orderedIds),
    // Optimistic: reordering must feel instant, and it is trivially reversible.
    onMutate: async (orderedIds) => {
      const key = ['lms', 'contents', module.id];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LmsContent[]>(key);
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        queryClient.setQueryData(
          key,
          orderedIds.map((id) => byId.get(id)).filter(Boolean) as LmsContent[]
        );
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['lms', 'contents', module.id], context.previous);
      }
      toast.error('Could not reorder', errorMessage(err));
    },
    onSettled: invalidate,
  });

  const duration = formatDuration(module.estimatedDurationMinutes);

  return (
    <div
      ref={cardRef}
      className={`rounded-lg border bg-white transition-shadow ${
        focused ? 'ring-2 ring-primary ring-offset-2' : ''
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        {module.thumbnail && (
          <img
            src={module.thumbnail.url}
            alt=""
            className="hidden h-12 w-16 shrink-0 rounded border object-cover sm:block"
          />
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-0.5 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('font-semibold text-gray-900', !module.isVisible && 'text-gray-400')}>
              {module.name}
            </span>
            {!module.isVisible && (
              <Badge variant="outline" className="gap-1 text-gray-500">
                <EyeOff className="h-3 w-3" />
                Hidden
              </Badge>
            )}
            {module.difficulty && (
              <Badge variant="outline" className={DIFFICULTY_STYLES[module.difficulty]}>
                {module.difficulty.charAt(0) + module.difficulty.slice(1).toLowerCase()}
              </Badge>
            )}
          </div>

          {module.description && (
            <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">{module.description}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {module._count.contents} item{module._count.contents === 1 ? '' : 's'}
            </span>
            {/* Only once expanded — the count comes from the assignments query,
                which does not run until then. */}
            {expanded && assignments.length > 0 && (
              <span className="flex items-center gap-1">
                <ClipboardList className="h-3 w-3" />
                {assignments.length} assignment{assignments.length === 1 ? '' : 's'}
              </span>
            )}
            {duration && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {duration}
              </span>
            )}
            {module.prerequisites.length > 0 && (
              <span className="text-gray-400">
                Requires: {module.prerequisites.map((p) => p.prerequisite.name).join(', ')}
              </span>
            )}
          </div>
        </button>

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 flex-shrink-0 p-0">
                <span className="sr-only">Actions for {module.name}</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditingContent(null);
                  setExpanded(true);
                  setIsContentFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Content
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAssignmentForm(null)}>
                <ClipboardList className="mr-2 h-4 w-4" />
                Add Assignment
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(module)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Module
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDelete(module)} className="text-red-600">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Module
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {expanded && (
        <div className="border-t bg-gray-50/60 px-4 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading content…
            </div>
          ) : contents.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-500">No content in this module yet.</p>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setEditingContent(null);
                    setIsContentFormOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add the first item
                </Button>
              )}
            </div>
          ) : (
            <>
              <SortableList
                items={contents}
                getId={(c) => c.id}
                onReorder={(ids) => reorderContents.mutate(ids)}
                disabled={!canEdit}
                className="space-y-2"
              >
                {(content) => (
                  <SortableItem key={content.id} id={content.id} disabled={!canEdit}>
                    <ContentRow
                      content={content}
                      canEdit={canEdit}
                      onEdit={(c) => {
                        setEditingContent(c);
                        setIsContentFormOpen(true);
                      }}
                      onChanged={invalidate}
                    />
                  </SortableItem>
                )}
              </SortableList>

              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full justify-start text-gray-500"
                  onClick={() => {
                    setEditingContent(null);
                    setIsContentFormOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add content
                </Button>
              )}
            </>
          )}

          {/* Assignments — a separate backend entity, shown in the same module
              so an admin reads one curriculum rather than two systems. */}
          <div className="mt-4 border-t pt-3">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <ClipboardList className="h-3.5 w-3.5" />
              Assignments
            </h4>

            {loadingAssignments ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading assignments…
              </div>
            ) : assignments.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-gray-500">No assignments in this module yet.</p>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => openAssignmentForm(null)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add an assignment
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="mt-2 space-y-2">
                  {assignments.map((assignment) => (
                    <AssignmentRow
                      key={assignment.id}
                      assignment={assignment}
                      canEdit={canEdit}
                      onEdit={openAssignmentForm}
                      onChanged={invalidateAssignments}
                    />
                  ))}
                </div>

                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full justify-start text-gray-500"
                    onClick={() => openAssignmentForm(null)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add assignment
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <ContentFormDialog
        open={isContentFormOpen}
        onOpenChange={(open) => {
          setIsContentFormOpen(open);
          if (!open) setEditingContent(null);
        }}
        initialData={editingContent}
        isLoading={createContent.isPending || updateContent.isPending}
        onSubmit={(values) => {
          if (editingContent) updateContent.mutate({ id: editingContent.id, values });
          else createContent.mutate(values);
        }}
      />

      <AssignmentFormDialog
        open={isAssignmentFormOpen}
        onOpenChange={(open) => {
          setIsAssignmentFormOpen(open);
          if (!open) setEditingAssignment(null);
        }}
        initialData={editingAssignment}
        isLoading={createAssignment.isPending || updateAssignment.isPending}
        onSubmit={(values) => {
          if (editingAssignment) updateAssignment.mutate({ id: editingAssignment.id, values });
          else createAssignment.mutate(values);
        }}
      />
    </div>
  );
}
