import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Video, ClipboardCheck, BarChart } from 'lucide-react';

export const StudentDashboard = () => {
  const { user } = useAuth();
  
  const { data: sessionsData } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get(`/sessions`);
      return res.data.data;
    }
  });

  const { data: attendanceData } = useQuery({
    queryKey: ['student-attendance', user?.id],
    queryFn: async () => {
      const res = await api.get(`/attendance/student/${user?.id}`);
      return res.data.data;
    },
    enabled: !!user?.id
  });

  const { data: progressData } = useQuery({
    queryKey: ['student-progress', user?.id],
    queryFn: async () => {
      const res = await api.get(`/progress/student/${user?.id}`);
      return res.data.data;
    },
    enabled: !!user?.id
  });

  const sessions = sessionsData || [];
  const attendances = attendanceData || [];
  const progressRecords = progressData || [];

  // Attendance stats
  const totalAtt = attendances.length;
  const present = attendances.filter((a: any) => a.status === 'PRESENT').length;
  const absent = attendances.filter((a: any) => a.status === 'ABSENT').length;
  const attPercentage = totalAtt > 0 ? Math.round((present / totalAtt) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Welcome, {user?.name}</h2>
        <p className="text-gray-500">View your classes, attendance, and learning progress.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card className="bg-gradient-to-br from-indigo-50 to-white border-indigo-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center text-indigo-700">
              <ClipboardCheck className="w-4 h-4 mr-2" />
              My Attendance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-900">{attPercentage}%</div>
            <p className="text-xs text-indigo-600 mt-1">{present} Attended • {absent} Missed</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Sessions */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b mb-4">
              <CardTitle className="text-lg flex items-center">
                <Video className="w-5 h-5 mr-2 text-primary" />
                My Upcoming Classes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Video className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                  <p>No upcoming classes.</p>
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
                          Join Meeting
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Progress */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b mb-4">
              <CardTitle className="text-lg flex items-center">
                <BarChart className="w-5 h-5 mr-2 text-primary" />
                Learning Progress
              </CardTitle>
              <CardDescription>Track your academic level across tech stacks.</CardDescription>
            </CardHeader>
            <CardContent>
              {progressRecords.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No progress records found yet.</p>
              ) : (
                <ul className="space-y-4">
                  {progressRecords.map((p: any) => (
                    <li key={p.id} className="p-3 bg-white rounded border flex flex-col">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-gray-800">{p.techStack.name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          p.level === 'ADVANCED' ? 'bg-purple-100 text-purple-800' :
                          p.level === 'INTERMEDIATE' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {p.level}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="text-gray-500">Mastery</span>
                        <span className="font-semibold">{p.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                        <div className={`h-1.5 rounded-full ${p.progress < 50 ? 'bg-red-500' : p.progress < 80 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${p.progress}%` }}></div>
                      </div>
                      {p.notes && <p className="text-xs text-gray-500 italic">Note: {p.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
