import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TechStackTable } from '../../components/tech-stacks/TechStackTable';
import type { TechStack } from '../../components/tech-stacks/TechStackTable';
import { TechStackFormDialog } from '../../components/tech-stacks/TechStackFormDialog';
import type { TechStackFormData } from '../../components/tech-stacks/TechStackFormDialog';
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

export const TechStacksManagement = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [globalError, setGlobalError] = useState<string | null>(null);
  
  // Dialog States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [editingTechStack, setEditingTechStack] = useState<TechStack | null>(null);
  const [techStackToDelete, setTechStackToDelete] = useState<TechStack | null>(null);

  // Fetch Tech Stacks
  const { data: techStacks = [], isLoading } = useQuery({
    queryKey: ['tech-stacks'],
    queryFn: async () => {
      const res = await api.get('/techstacks');
      return res.data.data;
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: TechStackFormData) => api.post('/techstacks', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tech-stacks'] });
      setIsFormOpen(false);
      setGlobalError(null);
    },
    onError: (error: any) => {
      setIsFormOpen(false);
      setGlobalError(error.response?.data?.message || 'Failed to create tech stack.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TechStackFormData }) =>
      api.patch(`/techstacks/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tech-stacks'] });
      setIsFormOpen(false);
      setGlobalError(null);
    },
    onError: (error: any) => {
      setIsFormOpen(false);
      setGlobalError(error.response?.data?.message || 'Failed to update tech stack.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/techstacks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tech-stacks'] });
      setIsDeleteAlertOpen(false);
      setGlobalError(null);
    },
    onError: (error: any) => {
      setIsDeleteAlertOpen(false);
      setGlobalError(error.response?.data?.message || 'Failed to delete tech stack.');
    }
  });

  // Handlers
  const handleOpenCreate = () => {
    setEditingTechStack(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (techStack: TechStack) => {
    setEditingTechStack(techStack);
    setIsFormOpen(true);
  };

  const handleOpenDelete = (techStack: TechStack) => {
    setTechStackToDelete(techStack);
    setIsDeleteAlertOpen(true);
  };

  const handleSubmit = (data: TechStackFormData) => {
    if (editingTechStack) {
      updateMutation.mutate({ id: editingTechStack.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const confirmDelete = () => {
    if (techStackToDelete) {
      deleteMutation.mutate(techStackToDelete.id);
    }
  };

  // Filtering
  const filteredTechStacks = techStacks.filter((t: TechStack) => 
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tech Stacks</h1>
          <p className="text-sm text-gray-500">Manage all technologies used to categorize batches.</p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Add Tech Stack
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
          placeholder="Search tech stacks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 shadow-none focus-visible:ring-0 px-0 h-8"
        />
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-gray-500">Loading tech stacks...</div>
      ) : (
        <TechStackTable 
          techStacks={filteredTechStacks} 
          onEdit={handleOpenEdit} 
          onDelete={handleOpenDelete} 
        />
      )}

      <TechStackFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleSubmit}
        initialData={editingTechStack}
        title={editingTechStack ? "Edit Tech Stack" : "Add New Tech Stack"}
        isEditing={!!editingTechStack}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the 
              <span className="font-semibold text-gray-900"> {techStackToDelete?.name} </span> 
              tech stack.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete} 
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
};
