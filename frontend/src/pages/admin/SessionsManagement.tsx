import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { SessionTable } from '../../components/sessions/SessionTable';
import type { Session } from '../../components/sessions/SessionTable';

import { SessionFormDialog } from '../../components/sessions/SessionFormDialog';
import type { SessionFormData } from '../../components/sessions/SessionFormDialog';
import { SessionViewDialog } from '../../components/sessions/SessionViewDialog';

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

export const SessionsManagement = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [globalError, setGlobalError] = useState<string | null>(null);

  // States for Create/Edit Dialog
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);

  // States for Cancel/View Alerts
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isCancelAlertOpen, setIsCancelAlertOpen] = useState(false);
  const [targetSession, setTargetSession] = useState<Session | null>(null);

  // Queries
  const { data: sessions = [], isLoading: loadingSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await api.get('/sessions')).data.data,
  });

  const { data: batches = [] } = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await api.get('/batches')).data.data,
  });

  const { data: instructors = [] } = useQuery({
    queryKey: ['users', 'INSTRUCTOR'],
    queryFn: async () => (await api.get('/users?role=INSTRUCTOR')).data.data,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: SessionFormData) => api.post('/sessions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsFormOpen(false);
      setGlobalError(null);
    },
    onError: (err: any) => setGlobalError(err.response?.data?.message || 'Failed to create session.')
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: SessionFormData }) => api.patch(`/sessions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsFormOpen(false);
      setGlobalError(null);
    },
    onError: (err: any) => setGlobalError(err.response?.data?.message || 'Failed to update session.')
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/sessions/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsCancelAlertOpen(false);
      setGlobalError(null);
    },
    onError: (err: any) => {
      setIsCancelAlertOpen(false);
      setGlobalError(err.response?.data?.message || 'Failed to cancel session.');
    }
  });

  // Handlers
  const handleSubmitForm = (data: SessionFormData) => {
    if (editingSession) updateMutation.mutate({ id: editingSession.id, data });
    else createMutation.mutate(data);
  };

  const filteredSessions = sessions.filter((s: Session) =>
    s.title.toLowerCase().includes(search.toLowerCase()) || 
    s.batch.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
          <p className="text-sm text-gray-500">Schedule classes, manage Google Meet links, and track status.</p>
        </div>
        <Button onClick={() => { setEditingSession(null); setIsFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Schedule Session
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
          placeholder="Search by title or batch..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 shadow-none focus-visible:ring-0 px-0 h-8"
        />
      </div>

      {loadingSessions ? (
        <div className="py-10 text-center text-gray-500">Loading sessions...</div>
      ) : (
        <SessionTable
          sessions={filteredSessions}
          onView={(session) => { setTargetSession(session); setIsViewOpen(true); }}
          onEdit={(session) => { setEditingSession(session); setIsFormOpen(true); }}
          onCancel={(session) => { setTargetSession(session); setIsCancelAlertOpen(true); }}
        />
      )}

      <SessionFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleSubmitForm}
        initialData={editingSession}
        title={editingSession ? "Edit Session" : "Schedule New Session"}
        isEditing={!!editingSession}
        isLoading={createMutation.isPending || updateMutation.isPending}
        batches={batches}
        instructors={instructors}
      />

      <AlertDialog open={isCancelAlertOpen} onOpenChange={setIsCancelAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the session, notify all enrolled students and instructors, and remove/update the Google Calendar event.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => targetSession && cancelMutation.mutate(targetSession.id)} 
              className="bg-orange-500 hover:bg-orange-600"
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SessionViewDialog 
        open={isViewOpen} 
        onOpenChange={setIsViewOpen} 
        session={targetSession} 
      />
    </div>
  );
}
