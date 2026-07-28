import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Users, BookOpen, Video } from 'lucide-react';

import { SessionFormDialog } from '../components/sessions/SessionFormDialog';
import type { SessionFormData } from '../components/sessions/SessionFormDialog';

export const InstructorDashboard = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  
  // By omitting query params, the backend will auto-filter based on the INSTRUCTOR role
  const { data: sessionsData } = useQuery({
    queryKey: ['sessions', user?.id],
    queryFn: () => api.get(`/sessions`).then(res => res.data.data)
  });

  const { data: batchesData } = useQuery({
    queryKey: ['batches', user?.id],
    queryFn: () => api.get('/batches').then(res => res.data.data)
  });

  const createMutation = useMutation({
    mutationFn: (data: SessionFormData) => api.post('/sessions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsFormOpen(false);
      setGlobalError(null);
    },
    onError: (err: any) => setGlobalError(err.response?.data?.message || 'Failed to schedule session.')
  });

  const sessions = sessionsData || [];
  const batches = batchesData || [];

  // Extract all unique students from the instructor's batches
  const allStudentsMap = new Map();
  batches.forEach((b: any) => {
    b.studentBatches?.forEach((sb: any) => {
      const student = sb.student;
      if (!allStudentsMap.has(student.id)) {
        allStudentsMap.set(student.id, { ...student, batchNames: [b.name] });
      } else {
        allStudentsMap.get(student.id).batchNames.push(b.name);
      }
    });
  });
  const uniqueStudents = Array.from(allStudentsMap.values());

  const handleSubmitForm = (data: SessionFormData) => {
    createMutation.mutate(data);
  };

  // The instructor array just contains the current user so they can only select themselves
  const instructorOptions = user ? [{ id: user.id, name: user.name }] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Welcome, {user?.name}</h2>
          <p className="text-gray-500">Manage your batches and schedule upcoming classes.</p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="mt-4 sm:mt-0">
          <Plus className="w-4 h-4 mr-2" />
          Schedule Session
        </Button>
      </div>

      {globalError && (
        <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-200">
          {globalError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Sessions */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b mb-4">
              <CardTitle className="text-lg flex items-center">
                <Video className="w-5 h-5 mr-2 text-primary" />
                My Upcoming Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Video className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                  <p>No sessions scheduled.</p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {sessions.map((s: any) => (
                    <li key={s.id} className="p-4 border rounded-md bg-gray-50/50 hover:bg-gray-50 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-semibold text-gray-900 text-lg">{s.title}</h4>
                          <p className="text-sm text-primary font-medium">{s.batch.name}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          s.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {s.status === 'CANCELLED' ? 'Cancelled' : new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 mb-4 flex items-center">
                        <span className="font-medium mr-2">{new Date(s.startTime).toLocaleDateString()}</span>
                        {s.status !== 'CANCELLED' && <span>({Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000)}m)</span>}
                      </div>
                      {s.status !== 'CANCELLED' && s.googleMeetLink && (
                        <a 
                          href={s.googleMeetLink} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-indigo-600 text-white hover:bg-indigo-700 h-9 px-4 py-2 w-full sm:w-auto"
                        >
                          <Video className="w-4 h-4 mr-2" />
                          Start Meeting
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Batches & Students */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b mb-4">
              <CardTitle className="text-lg flex items-center">
                <BookOpen className="w-5 h-5 mr-2 text-primary" />
                My Assigned Batches
              </CardTitle>
            </CardHeader>
            <CardContent>
              {batches.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No batches assigned.</p>
              ) : (
                <ul className="space-y-3">
                  {batches.map((b: any) => (
                    <li key={b.id} className="p-3 bg-white rounded border flex flex-col">
                      <span className="font-bold text-gray-800">{b.name}</span>
                      <span className="text-xs text-gray-500 mt-1">{b.techStack.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b mb-4">
              <CardTitle className="text-lg flex items-center">
                <Users className="w-5 h-5 mr-2 text-primary" />
                My Students
              </CardTitle>
              <CardDescription>All students across your cohorts</CardDescription>
            </CardHeader>
            <CardContent>
              {uniqueStudents.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No students enrolled yet.</p>
              ) : (
                <ul className="space-y-3">
                  {uniqueStudents.map((student: any) => (
                    <li key={student.id} className="p-3 bg-white rounded border flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="font-medium text-sm text-gray-900">{student.name}</span>
                        <span className="text-xs text-gray-500">{student.email}</span>
                      </div>
                      <div className="flex gap-1">
                        {student.batchNames.map((name: string, i: number) => (
                          <span key={i} className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 border">
                            {name}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <SessionFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleSubmitForm}
        title="Schedule New Session"
        isEditing={false}
        isLoading={createMutation.isPending}
        batches={batches}
        instructors={instructorOptions}
        initialData={{
          title: '',
          description: '',
          batchId: '',
          instructorId: user?.id || '',
          startTime: '',
          durationMinutes: 60
        }}
      />
    </div>
  );
};
