import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast, errorMessage } from '@/components/ui/toast';
import { Plus, Copy, Send, Loader2, BookOpen, Layers, GitBranch } from 'lucide-react';
import { SortableList, SortableItem } from '@/components/lms/SortableList';
import { ContentSearch } from '@/components/lms/ContentSearch';
import { ModuleCard } from '@/components/lms/ModuleCard';
import { ModuleFormDialog } from '@/components/lms/ModuleFormDialog';
import { LearningPathDialog } from '@/components/lms/LearningPathDialog';
import { lmsApi, type LearningPath, type LmsModule } from '@/services/lms';

interface TechStack {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'border-gray-200 bg-gray-50 text-gray-600',
  PUBLISHED: 'border-green-200 bg-green-50 text-green-700',
  ARCHIVED: 'border-amber-200 bg-amber-50 text-amber-700',
};

/**
 * Admin curriculum authoring.
 *
 * Structure: pick a tech stack → pick a learning path version → build its
 * modules and content. Versioning is front and centre because it is the thing
 * that lets a syllabus change without disturbing a running cohort.
 */
export const CurriculumBuilder = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [techStackId, setTechStackId] = useState<string>('');
  const [pathId, setPathId] = useState<string>('');

  const [isPathDialogOpen, setIsPathDialogOpen] = useState(false);
  const [pathDialogMode, setPathDialogMode] = useState<'create' | 'clone'>('create');
  const [isModuleDialogOpen, setIsModuleDialogOpen] = useState(false);
  // Set from a search hit so the owning module expands and scrolls into view.
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<LmsModule | null>(null);
  const [moduleToDelete, setModuleToDelete] = useState<LmsModule | null>(null);

  const { data: techStacks = [] } = useQuery<TechStack[]>({
    queryKey: ['tech-stacks'],
    queryFn: async () => (await api.get('/techstacks')).data.data,
  });

  const effectiveStackId = techStackId || techStacks[0]?.id || '';

  const { data: paths = [], isLoading: loadingPaths } = useQuery({
    queryKey: ['lms', 'paths', effectiveStackId],
    queryFn: () => lmsApi.listPaths(effectiveStackId),
    enabled: !!effectiveStackId,
  });

  const selectedPath: LearningPath | undefined = useMemo(
    () => paths.find((p) => p.id === pathId) ?? paths[0],
    [paths, pathId]
  );

  const { data: modules = [], isLoading: loadingModules } = useQuery({
    queryKey: ['lms', 'modules', selectedPath?.id],
    queryFn: () => lmsApi.listModules(selectedPath!.id),
    enabled: !!selectedPath,
  });

  const invalidatePaths = () =>
    queryClient.invalidateQueries({ queryKey: ['lms', 'paths', effectiveStackId] });
  const invalidateModules = () =>
    queryClient.invalidateQueries({ queryKey: ['lms', 'modules', selectedPath?.id] });

  const createModule = useMutation({
    mutationFn: (values: Parameters<typeof lmsApi.createModule>[1]) =>
      lmsApi.createModule(selectedPath!.id, values),
    onSuccess: () => {
      invalidateModules();
      invalidatePaths();
      setIsModuleDialogOpen(false);
      toast.success('Module added');
    },
    onError: (err) => toast.error('Could not add module', errorMessage(err)),
  });

  const updateModule = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      lmsApi.updateModule(id, values),
    onSuccess: () => {
      invalidateModules();
      setIsModuleDialogOpen(false);
      setEditingModule(null);
      toast.success('Module updated');
    },
    onError: (err) => toast.error('Could not save changes', errorMessage(err)),
  });

  const deleteModule = useMutation({
    mutationFn: (id: string) => lmsApi.deleteModule(id),
    onSuccess: () => {
      invalidateModules();
      invalidatePaths();
      setModuleToDelete(null);
      toast.success('Module deleted');
    },
    onError: (err) => {
      setModuleToDelete(null);
      toast.error('Could not delete module', errorMessage(err));
    },
  });

  const reorderModules = useMutation({
    mutationFn: (orderedIds: string[]) => lmsApi.reorderModules(selectedPath!.id, orderedIds),
    onMutate: async (orderedIds) => {
      const key = ['lms', 'modules', selectedPath?.id];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LmsModule[]>(key);
      if (previous) {
        const byId = new Map(previous.map((m) => [m.id, m]));
        queryClient.setQueryData(
          key,
          orderedIds.map((id) => byId.get(id)).filter(Boolean) as LmsModule[]
        );
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['lms', 'modules', selectedPath?.id], context.previous);
      }
      toast.error('Could not reorder modules', errorMessage(err));
    },
    onSettled: invalidateModules,
  });

  const publishPath = useMutation({
    mutationFn: () => lmsApi.setPathStatus(selectedPath!.id, 'PUBLISHED'),
    onSuccess: () => {
      invalidatePaths();
      toast.success('Curriculum published', 'Batches on this version now see it.');
    },
    onError: (err) => toast.error('Could not publish', errorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Curriculum</h1>
          <p className="text-sm text-gray-500">
            Build versioned learning paths. Batches stay on the version they were assigned.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={effectiveStackId}
            onValueChange={(v) => {
              setTechStackId(v);
              setPathId('');
            }}
          >
            <SelectTrigger className="w-[180px]" aria-label="Tech stack">
              <SelectValue placeholder="Tech stack" />
            </SelectTrigger>
            <SelectContent>
              {techStacks.map((ts) => (
                <SelectItem key={ts.id} value={ts.id}>
                  {ts.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {paths.length > 0 && (
            <Select value={selectedPath?.id ?? ''} onValueChange={setPathId}>
              <SelectTrigger className="w-[220px]" aria-label="Curriculum version">
                <SelectValue placeholder="Version" />
              </SelectTrigger>
              <SelectContent>
                {paths.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            onClick={() => {
              setPathDialogMode('create');
              setIsPathDialogOpen(true);
            }}
            disabled={!effectiveStackId}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Version
          </Button>
        </div>
      </div>

      {loadingPaths ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading curricula…
        </div>
      ) : !selectedPath ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-gray-50 py-16 text-center">
          <BookOpen className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-gray-700">No curriculum yet</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Create the first learning path for this tech stack. You can clone it later to make a new
            version without touching running batches.
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setPathDialogMode('create');
              setIsPathDialogOpen(true);
            }}
            disabled={!effectiveStackId}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Learning Path
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-gray-900">{selectedPath.name}</h2>
                <Badge variant="outline">{selectedPath.version}</Badge>
                <Badge variant="outline" className={STATUS_STYLES[selectedPath.status]}>
                  {selectedPath.status.charAt(0) + selectedPath.status.slice(1).toLowerCase()}
                </Badge>
                {selectedPath.isDefault && (
                  <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                    Default
                  </Badge>
                )}
                {selectedPath.clonedFromId && (
                  <Badge variant="outline" className="gap-1 text-gray-500">
                    <GitBranch className="h-3 w-3" />
                    Cloned
                  </Badge>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {selectedPath._count.modules} module
                  {selectedPath._count.modules === 1 ? '' : 's'}
                </span>
                <span>
                  {selectedPath._count.batches} batch
                  {selectedPath._count.batches === 1 ? '' : 'es'} running this version
                </span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPathDialogMode('clone');
                  setIsPathDialogOpen(true);
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Clone Version
              </Button>
              {selectedPath.status !== 'PUBLISHED' && (
                <Button size="sm" onClick={() => publishPath.mutate()} disabled={publishPath.isPending}>
                  {publishPath.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Publish
                </Button>
              )}
            </div>
          </div>

          {/* Search sits above the module list so an admin can find a resource
              without expanding every module to look for it. */}
          {modules.length > 0 && (
            <ContentSearch
              learningPathId={selectedPath.id}
              modules={modules}
              onSelectResult={setFocusedModuleId}
            />
          )}

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Modules</h3>
            <Button
              size="sm"
              onClick={() => {
                setEditingModule(null);
                setIsModuleDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Module
            </Button>
          </div>

          {loadingModules ? (
            <div className="flex items-center justify-center gap-2 py-10 text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading modules…
            </div>
          ) : modules.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-gray-50 py-12 text-center">
              <p className="text-sm text-gray-500">
                No modules yet. Add the first one — for example “HTML”.
              </p>
            </div>
          ) : (
            <SortableList
              items={modules}
              getId={(m) => m.id}
              onReorder={(ids) => reorderModules.mutate(ids)}
              className="space-y-3"
            >
              {(module) => (
                <SortableItem key={module.id} id={module.id}>
                  <ModuleCard
                    focused={focusedModuleId === module.id}
                    module={module}
                    canEdit
                    onEdit={(m) => {
                      setEditingModule(m);
                      setIsModuleDialogOpen(true);
                    }}
                    onDelete={setModuleToDelete}
                  />
                </SortableItem>
              )}
            </SortableList>
          )}
        </>
      )}

      <LearningPathDialog
        open={isPathDialogOpen}
        onOpenChange={setIsPathDialogOpen}
        mode={pathDialogMode}
        techStackId={effectiveStackId}
        sourcePath={pathDialogMode === 'clone' ? selectedPath ?? null : null}
        onCreated={(path) => {
          invalidatePaths();
          setPathId(path.id);
          setIsPathDialogOpen(false);
        }}
      />

      <ModuleFormDialog
        open={isModuleDialogOpen}
        onOpenChange={(open) => {
          setIsModuleDialogOpen(open);
          if (!open) setEditingModule(null);
        }}
        initialData={editingModule}
        isLoading={createModule.isPending || updateModule.isPending}
        onSubmit={(values) => {
          if (editingModule) updateModule.mutate({ id: editingModule.id, values });
          else createModule.mutate(values);
        }}
      />

      <AlertDialog open={!!moduleToDelete} onOpenChange={(o) => !o && setModuleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{moduleToDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {moduleToDelete && moduleToDelete._count.contents > 0
                ? `This module still contains ${moduleToDelete._count.contents} item(s). Delete or move them first.`
                : 'This cannot be undone. Other curriculum versions are unaffected.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteModule.isPending || (moduleToDelete?._count.contents ?? 0) > 0}
              onClick={() => moduleToDelete && deleteModule.mutate(moduleToDelete.id)}
            >
              {deleteModule.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
