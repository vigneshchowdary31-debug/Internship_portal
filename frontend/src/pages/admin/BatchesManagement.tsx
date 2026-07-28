import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { BatchTable } from '../../components/batches/BatchTable';
import type { Batch } from '../../components/batches/BatchTable';

import { BatchFormDialog } from '../../components/batches/BatchFormDialog';
import type { BatchFormData } from '../../components/batches/BatchFormDialog';

import { BatchAssignDialog } from '../../components/batches/BatchAssignDialog';

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

export const BatchesManagement = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [globalError, setGlobalError] = useState<string | null>(null);

  // States for Create/Edit Batch
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);

  // States for Assignment Dialogs
  const [assignType, setAssignType] = useState<'STUDENT' | 'INSTRUCTOR' | null>(null);
  const [targetBatch, setTargetBatch] = useState<Batch | null>(null);

  // State for Delete
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [batchToDelete, setBatchToDelete] = useState<Batch | null>(null);

  // Queries
  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get('/batches')).data.data,
  });

  const { data: techStacks = [] } = useQuery({
    queryKey: ['tech-stacks'],
    queryFn: async () => (await api.get('/techstacks')).data.data,
  });

  const { data: students = [] } = useQuery({
    queryKey: ['users', 'STUDENT'],
    queryFn: async () => (await api.get('/users?role=STUDENT')).data.data,
  });

  const { data: instructors = [] } = useQuery({
    queryKey: ['users', 'INSTRUCTOR'],
    queryFn: async () => (await api.get('/users?role=INSTRUCTOR')).data.data,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: BatchFormData) => api.post('/batches', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setIsFormOpen(false);
      setGlobalError(null);
    },
    onError: (err: any) => setGlobalError(err.response?.data?.message || 'Failed to create batch.')
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: BatchFormData }) => api.patch(`/batches/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setIsFormOpen(false);
      setGlobalError(null);
    },
    onError: (err: any) => setGlobalError(err.response?.data?.message || 'Failed to update batch.')
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/batches/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setIsDeleteAlertOpen(false);
      setGlobalError(null);
    },
    onError: (err: any) => {
      setIsDeleteAlertOpen(false);
      setGlobalError(err.response?.data?.message || 'Failed to delete batch.');
    }
  });

  const assignStudentsMutation = useMutation({
    mutationFn: ({ batchId, studentIds }: { batchId: string; studentIds: string[] }) =>
      api.post(`/batches/${batchId}/students`, { studentIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setAssignType(null);
    },
    onError: (err: any) => setGlobalError(err.response?.data?.message || 'Failed to assign students.')
  });

  const assignInstructorsMutation = useMutation({
    mutationFn: ({ batchId, instructorIds }: { batchId: string; instructorIds: string[] }) =>
      api.post(`/batches/${batchId}/instructors`, { instructorIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setAssignType(null);
    },
    onError: (err: any) => setGlobalError(err.response?.data?.message || 'Failed to assign instructors.')
  });

  // Handlers
  const handleSubmitForm = (data: BatchFormData) => {
    if (editingBatch) updateMutation.mutate({ id: editingBatch.id, data });
    else createMutation.mutate(data);
  };

  const handleAssignSave = (selectedIds: string[]) => {
    if (!targetBatch) return;
    if (assignType === 'STUDENT') {
      assignStudentsMutation.mutate({ batchId: targetBatch.id, studentIds: selectedIds });
    } else {
      assignInstructorsMutation.mutate({ batchId: targetBatch.id, instructorIds: selectedIds });
    }
  };

  // Extract currently assigned IDs for the generic dialog
  const currentAssignedIds = targetBatch
    ? assignType === 'STUDENT'
      ? targetBatch.studentBatches.map(sb => sb.student.id)
      : targetBatch.instructorBatches.map(ib => ib.instructor.id)
    : [];

  const filteredBatches = batches.filter((b: Batch) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batches</h1>
          <p className="text-sm text-gray-500">Manage cohorts, assign tech stacks, and enroll users.</p>
        </div>
        <Button onClick={() => { setEditingBatch(null); setIsFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Create Batch
        </Button>
      </div>

      {globalError && (
        <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-md flex items-center text-sm">
          <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
          {globalError}
        </div>
      )}

      <div className="flex items-center space-x-2 bg-white p-2 rounded-md border max-w-sm">
        <Search className="w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search batches..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 shadow-none focus-visible:ring-0 px-0 h-8"
        />
      </div>

      {loadingBatches ? (
        <div className="py-10 text-center text-gray-500">Loading batches...</div>
      ) : (
        <BatchTable
          batches={filteredBatches}
          onEdit={(batch) => { setEditingBatch(batch); setIsFormOpen(true); }}
          onDelete={(batch) => { setBatchToDelete(batch); setIsDeleteAlertOpen(true); }}
          onAssignStudents={(batch) => { setTargetBatch(batch); setAssignType('STUDENT'); }}
          onAssignInstructors={(batch) => { setTargetBatch(batch); setAssignType('INSTRUCTOR'); }}
        />
      )}

      <BatchFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleSubmitForm}
        initialData={editingBatch}
        title={editingBatch ? "Edit Batch" : "Create New Batch"}
        isEditing={!!editingBatch}
        isLoading={createMutation.isPending || updateMutation.isPending}
        techStacks={techStacks}
      />

      <BatchAssignDialog
        open={!!assignType}
        onOpenChange={(open) => { if (!open) setAssignType(null); }}
        onSubmit={handleAssignSave}
        users={assignType === 'STUDENT' ? students : instructors}
        initialAssignedIds={currentAssignedIds}
        title={assignType === 'STUDENT' ? `Assign Students to ${targetBatch?.name}` : `Assign Instructors to ${targetBatch?.name}`}
        description="Select the users you want to enroll in this batch."
        isLoading={assignStudentsMutation.isPending || assignInstructorsMutation.isPending}
      />

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the batch <span className="font-semibold text-gray-900">{batchToDelete?.name}</span>. 
              Any enrolled students and instructors will be unassigned from this batch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => batchToDelete && deleteMutation.mutate(batchToDelete.id)} 
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
