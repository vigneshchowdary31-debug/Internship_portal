import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BookOpen, Loader2, Eye } from 'lucide-react';
import { ModuleCard } from '@/components/lms/ModuleCard';
import { lmsApi } from '@/services/lms';

interface InstructorBatch {
  id: string;
  name: string;
  learningPathId: string | null;
  techStack?: { id: string; name: string } | null;
}

/**
 * Instructor view of a batch's curriculum — strictly read-only.
 *
 * `canEdit={false}` removes every authoring affordance, and the API rejects the
 * writes regardless: content authoring is admin-only. The batch selector only
 * ever lists batches this instructor is assigned to, because `GET /batches`
 * already scopes by instructor.
 */
export const BatchCurriculum = () => {
  const [batchId, setBatchId] = useState<string>('');

  const { data: batches = [], isLoading: loadingBatches } = useQuery<InstructorBatch[]>({
    queryKey: ['batches'],
    queryFn: async () => (await api.get('/batches')).data.data,
  });

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === batchId) ?? batches[0],
    [batches, batchId]
  );

  const { data: modules = [], isLoading: loadingModules } = useQuery({
    queryKey: ['lms', 'modules', selectedBatch?.learningPathId],
    queryFn: () => lmsApi.listModules(selectedBatch!.learningPathId!),
    enabled: !!selectedBatch?.learningPathId,
  });

  if (loadingBatches) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading your batches…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batch Curriculum</h1>
          <p className="text-sm text-gray-500">
            What your students see. Content is authored by administrators.
          </p>
        </div>

        {batches.length > 0 && (
          <Select value={selectedBatch?.id ?? ''} onValueChange={setBatchId}>
            <SelectTrigger className="w-[220px]" aria-label="Batch">
              <SelectValue placeholder="Select batch" />
            </SelectTrigger>
            <SelectContent>
              {batches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-start gap-2.5 rounded-md border border-blue-100 bg-blue-50 p-3">
        <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-blue-900">
          <span className="font-medium">Read-only view.</span> You can see drafts and scheduled items
          so you know what is coming, including material students cannot see yet.
        </p>
      </div>

      {batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <BookOpen className="mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-gray-700">No batches assigned</p>
            <p className="mt-1 text-sm text-gray-500">
              You will see curriculum here once you are assigned to a batch.
            </p>
          </CardContent>
        </Card>
      ) : !selectedBatch?.learningPathId ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-gray-500">
              “{selectedBatch?.name}” has no curriculum assigned yet.
            </p>
          </CardContent>
        </Card>
      ) : loadingModules ? (
        <div className="flex items-center justify-center gap-2 py-10 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading curriculum…
        </div>
      ) : modules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-gray-500">No modules have been created yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Modules</h2>
            <Badge variant="outline">{modules.length}</Badge>
          </div>
          <div className="space-y-3">
            {modules.map((module) => (
              <ModuleCard
                key={module.id}
                module={module}
                canEdit={false}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
