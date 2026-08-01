import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Calendar, BookOpen, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CredentialDashboardCards } from '../components/users/CredentialDashboardCards';

export const AdminDashboard = () => {
  const [isSessionDialogOpen, setIsSessionDialogOpen] = useState(false);

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(res => res.data.data)
  });

  const { data: batchesData } = useQuery({
    queryKey: ['batches'],
    queryFn: () => api.get('/batches').then(res => res.data.data)
  });

  const { data: sessionsData, refetch: refetchSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get('/sessions').then(res => res.data.data)
  });

  const students = usersData?.filter((u: any) => u.role === 'STUDENT') || [];
  const instructors = usersData?.filter((u: any) => u.role === 'INSTRUCTOR') || [];
  const batches = batchesData || [];
  const sessions = sessionsData || [];

  const handleCreateSession = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload = {
      title: formData.get('title'),
      batchId: formData.get('batchId'),
      instructorId: formData.get('instructorId'),
      startTime: new Date(`${formData.get('date')}T${formData.get('time')}`).toISOString(),
      durationMinutes: Number(formData.get('duration'))
    };

    try {
      await api.post('/sessions', payload);
      alert('Session scheduled successfully with Google Meet!');
      setIsSessionDialogOpen(false);
      refetchSessions();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to create session');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Students</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{students.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Instructors</CardTitle>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{instructors.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Batches</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{batches.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessions.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Credential delivery overview — Enrollment & Credential Management */}
      <div className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">Enrollment &amp; Credentials</h2>
        <CredentialDashboardCards />
      </div>

      <div className="flex justify-between items-center mt-8 mb-4">
        <h2 className="text-xl font-semibold">Upcoming Sessions</h2>
        <Dialog open={isSessionDialogOpen} onOpenChange={setIsSessionDialogOpen}>
          <DialogTrigger asChild>
            <Button>Schedule Session</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Schedule Google Meet Session</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateSession} className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input name="title" required placeholder="e.g. React Basics" />
              </div>
              <div>
                <Label>Batch</Label>
                <select name="batchId" required className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <option value="">Select Batch...</option>
                  {batches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Instructor</Label>
                <select name="instructorId" required className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <option value="">Select Instructor...</option>
                  {instructors.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Date</Label>
                  <Input type="date" name="date" required />
                </div>
                <div>
                  <Label>Time</Label>
                  <Input type="time" name="time" required />
                </div>
              </div>
              <div>
                <Label>Duration (Minutes)</Label>
                <Input type="number" name="duration" defaultValue={60} min={15} max={480} required />
              </div>
              <Button type="submit" className="w-full">Create & Generate Meet Link</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500">Title</th>
                <th className="px-6 py-3 font-medium text-gray-500">Batch</th>
                <th className="px-6 py-3 font-medium text-gray-500">Instructor</th>
                <th className="px-6 py-3 font-medium text-gray-500">Date/Time</th>
                <th className="px-6 py-3 font-medium text-gray-500">Meet Link</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s: any) => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{s.title}</td>
                  <td className="px-6 py-4">{s.batch.name}</td>
                  <td className="px-6 py-4">{s.instructor.name}</td>
                  <td className="px-6 py-4">{new Date(s.startTime).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    {s.googleMeetLink ? (
                      <a href={s.googleMeetLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        Join Meet
                      </a>
                    ) : 'N/A'}
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No sessions scheduled</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};
