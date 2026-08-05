import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast, errorMessage } from '@/components/ui/toast';
import { Loader2, ArrowRight, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { lmsApi, type TransferPreview } from '@/services/lms';

interface Batch {
  id: string;
  name: string;
  learningPathId: string | null;
  techStack?: { id: string; name: string } | null;
}

/**
 * Move a student to a batch.
 *
 * Under the one-batch-per-student rule this is a MOVE, not an add — so the
 * dialog previews the consequences before committing. The important case it
 * surfaces: moving to a batch on a different curriculum version, where the
 * student's completion percentage will change because the requirements did.
 * Nothing is deleted either way; that is stated explicitly.
 */
export function MoveStudentDialog({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: { id: string; name: string } | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [targetBatchId, setTargetBatchId] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ['batches'],
    queryFn: async () => (await api.get('/batches')).data.data,
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setTargetBatchId('');
      setPreview(null);
    }
  }, [open]);

  const previewMutation = useMutation({
    mutationFn: (batchId: string) => lmsApi.previewAssignment(batchId, student!.id),
    onSuccess: setPreview,
    onError: (err) => toast.error('Could not preview the move', errorMessage(err)),
  });

  const assign = useMutation({
    mutationFn: () => lmsApi.assignStudent(targetBatchId, student!.id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['enrollment-history', student?.id] });
      toast.success('Batch updated', res.data.message);
      onOpenChange(false);
    },
    onError: (err) => toast.error('Could not move the student', errorMessage(err)),
  });

  const handleSelect = (batchId: string) => {
    setTargetBatchId(batchId);
    setPreview(null);
    previewMutation.mutate(batchId);
  };

  if (!student) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Move {student.name} to a Batch</DialogTitle>
          <DialogDescription>
            A student belongs to exactly one batch, so this moves them rather than adding a second.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="target-batch">Destination batch</Label>
            <Select value={targetBatchId} onValueChange={handleSelect}>
              <SelectTrigger id="target-batch">
                <SelectValue placeholder="Select a batch" />
              </SelectTrigger>
              <SelectContent>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    {b.techStack ? ` · ${b.techStack.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {previewMutation.isPending && (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking what this would change…
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-3 rounded-md border bg-gray-50 p-3 text-sm">
                <span className="font-medium text-gray-700">
                  {preview.currentBatch?.name ?? 'No batch'}
                </span>
                <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="font-medium text-gray-900">{preview.targetBatch.name}</span>
              </div>

              {preview.crossesLearningPath ? (
                <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <div className="text-xs leading-relaxed text-amber-900">
                    <p className="font-semibold">This batch runs a different curriculum version.</p>
                    <ul className="mt-1.5 space-y-1">
                      <li>
                        <span className="font-medium">{preview.retainedModuleCount}</span> module
                        {preview.retainedModuleCount === 1 ? '' : 's'} exist in both — completed work
                        there still counts.
                      </li>
                      <li>
                        <span className="font-medium">{preview.newModuleCount}</span> module
                        {preview.newModuleCount === 1 ? ' is' : 's are'} new and will start
                        incomplete, so their completion percentage may drop.
                      </li>
                    </ul>
                  </div>
                </div>
              ) : (
                preview.isMove && (
                  <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 p-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
                    <p className="text-xs leading-relaxed text-green-900">
                      Both batches run the same curriculum, so their progress carries over exactly.
                    </p>
                  </div>
                )
              )}

              <div className="flex items-start gap-2.5 rounded-md border p-3">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                <p className="text-xs leading-relaxed text-gray-600">
                  <span className="font-medium">Nothing is deleted.</span> Attendance, submissions,
                  instructor ratings and enrollment history are all preserved. Only future sessions
                  and batch-specific content follow the new batch.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => assign.mutate()}
              disabled={!targetBatchId || assign.isPending || previewMutation.isPending}
            >
              {assign.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {preview?.isMove ? 'Move Student' : 'Assign to Batch'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
