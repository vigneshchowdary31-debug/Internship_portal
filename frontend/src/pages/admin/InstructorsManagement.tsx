import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserTable } from '../../components/users/UserTable';
import type { User } from '../../components/users/UserTable';
import { UserFormDialog } from '../../components/users/UserFormDialog';
import type { UserFormData, UpdateUserFormData } from '../../components/users/UserFormDialog';

export const InstructorsManagement = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  
  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Fetch Instructors
  const { data: instructors = [], isLoading } = useQuery({
    queryKey: ['users', 'INSTRUCTOR'],
    queryFn: async () => {
      const res = await api.get('/users?role=INSTRUCTOR');
      return res.data.data;
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: UserFormData) => api.post('/users', { ...data, role: 'INSTRUCTOR' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', 'INSTRUCTOR'] });
      setIsDialogOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserFormData }) =>
      api.patch(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', 'INSTRUCTOR'] });
      setIsDialogOpen(false);
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: boolean }) =>
      api.patch(`/users/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', 'INSTRUCTOR'] });
    },
  });

  // Handlers
  const handleOpenCreate = () => {
    setEditingUser(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setIsDialogOpen(true);
  };

  const handleToggleStatus = (user: User) => {
    toggleStatusMutation.mutate({ id: user.id, status: !user.status });
  };

  const handleSubmit = (data: UserFormData | UpdateUserFormData) => {
    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, data });
    } else {
      createMutation.mutate(data as UserFormData);
    }
  };

  // Filtering
  const filteredInstructors = instructors.filter((s: User) => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instructors Management</h1>
          <p className="text-sm text-gray-500">Manage all registered instructors in the portal.</p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Add Instructor
        </Button>
      </div>

      <div className="flex items-center space-x-2 bg-white p-2 rounded-md border max-w-sm">
        <Search className="w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search instructors..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 shadow-none focus-visible:ring-0 px-0 h-8"
        />
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-gray-500">Loading instructors...</div>
      ) : (
        <UserTable 
          users={filteredInstructors} 
          onEdit={handleOpenEdit} 
          onToggleStatus={handleToggleStatus} 
        />
      )}

      <UserFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleSubmit}
        initialData={editingUser}
        title={editingUser ? "Edit Instructor" : "Add New Instructor"}
        isEditing={!!editingUser}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
};
