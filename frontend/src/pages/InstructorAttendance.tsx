import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ClipboardCheck, Users } from 'lucide-react';
import { AttendanceFormDialog } from '../components/attendance/AttendanceFormDialog';

export const InstructorAttendance = () => {
  const [selectedSession, setSelectedSession] = useState<any | null>(null);

  // Fetch only sessions for this instructor
  const { data: sessionsData, isLoading: isLoadingSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get('/sessions').then(res => res.data.data)
  });

  const sessions = (sessionsData || []).filter((s: any) => s.status !== 'CANCELLED');

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Mark Attendance</h2>
        <p className="text-gray-500">Select a session to mark or update student attendance.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <ClipboardCheck className="w-5 h-5 mr-2 text-primary" />
            My Active Sessions
          </CardTitle>
          <CardDescription>Only active or completed sessions are eligible for attendance.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingSessions ? (
            <p className="text-gray-500 py-4">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No active sessions found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sessions.map((s: any) => (
                <div key={s.id} className="p-4 border rounded-md shadow-sm bg-white hover:border-primary transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold text-gray-900">{s.title}</h4>
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    <span className="font-medium text-primary">{s.batch.name}</span>
                  </div>
                  <div className="text-sm text-gray-500 mb-4">
                    {format(new Date(s.startTime), 'MMM d, yyyy h:mm a')}
                  </div>
                  <Button 
                    className="w-full" 
                    variant="outline" 
                    onClick={() => setSelectedSession(s)}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Manage Attendance
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSession && (
        <AttendanceFormDialog
          open={!!selectedSession}
          onOpenChange={(open: boolean) => !open && setSelectedSession(null)}
          session={selectedSession}
        />
      )}
    </div>
  );
};
