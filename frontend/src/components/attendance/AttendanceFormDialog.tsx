import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle } from 'lucide-react';

export const AttendanceFormDialog = ({ open, onOpenChange, session }: any) => {
  const queryClient = useQueryClient();
  const [localAttendance, setLocalAttendance] = useState<Record<string, { status: string, remarks: string }>>({});

  // 1. Fetch all students in this session's batch
  const { data: batchData, isLoading: isLoadingBatch } = useQuery({
    queryKey: ['batch', session?.batchId],
    queryFn: () => api.get(`/batches/${session?.batchId}`).then(res => res.data.data),
    enabled: !!session?.batchId
  });

  // 2. Fetch existing attendance for this session
  const { data: existingAttendance, isLoading: isLoadingAttendance } = useQuery({
    queryKey: ['attendance', session?.id],
    queryFn: () => api.get(`/attendance/session/${session?.id}`).then(res => res.data.data),
    enabled: !!session?.id
  });

  // 3. Initialize local state when data loads
  useEffect(() => {
    if (batchData && existingAttendance) {
      const initial: any = {};
      batchData.studentBatches.forEach((sb: any) => {
        const studentId = sb.student.id;
        const existingRecord = existingAttendance.find((a: any) => a.studentId === studentId);
        if (existingRecord) {
          initial[studentId] = { status: existingRecord.status, remarks: existingRecord.remarks || '' };
        } else {
          initial[studentId] = { status: 'PRESENT', remarks: '' }; // Default
        }
      });
      setLocalAttendance(initial);
    }
  }, [batchData, existingAttendance]);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      // payload is an array of requests
      const promises = payload.map((p: any) => api.post('/attendance', p));
      return Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['admin-attendance'] });
      onOpenChange(false);
    }
  });

  const handleStatusChange = (studentId: string, status: string) => {
    setLocalAttendance(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], status }
    }));
  };

  const handleBulkMark = (status: string) => {
    const updated: any = {};
    Object.keys(localAttendance).forEach(id => {
      updated[id] = { ...localAttendance[id], status };
    });
    setLocalAttendance(updated);
  };

  const handleSave = () => {
    const payload = Object.keys(localAttendance).map(studentId => ({
      sessionId: session.id,
      studentId,
      status: localAttendance[studentId].status,
      remarks: localAttendance[studentId].remarks
    }));
    saveMutation.mutate(payload);
  };

  const students = batchData?.studentBatches.map((sb: any) => sb.student) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mark Attendance: {session?.title}</DialogTitle>
          <DialogDescription>
            {session?.batch.name} • {new Date(session?.startTime).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        {(isLoadingBatch || isLoadingAttendance) ? (
          <div className="py-8 text-center text-gray-500">Loading roster...</div>
        ) : students.length === 0 ? (
          <div className="py-8 text-center text-gray-500">No students found in this batch.</div>
        ) : (
          <div className="space-y-4 mt-4">
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => handleBulkMark('PRESENT')} className="text-green-600 border-green-200 bg-green-50 hover:bg-green-100">
                <CheckCircle className="w-4 h-4 mr-2" /> Mark All Present
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkMark('ABSENT')} className="text-red-600 border-red-200 bg-red-50 hover:bg-red-100">
                <XCircle className="w-4 h-4 mr-2" /> Mark All Absent
              </Button>
            </div>

            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 font-medium border-b">
                  <tr>
                    <th className="px-4 py-3">Student Name</th>
                    <th className="px-4 py-3 text-center">Present</th>
                    <th className="px-4 py-3 text-center">Late</th>
                    <th className="px-4 py-3 text-center">Absent</th>
                    <th className="px-4 py-3 text-center">Excused</th>
                    <th className="px-4 py-3">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {students.map((student: any) => (
                    <tr key={student.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{student.name}</td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="radio" 
                          name={`status-${student.id}`} 
                          checked={localAttendance[student.id]?.status === 'PRESENT'}
                          onChange={() => handleStatusChange(student.id, 'PRESENT')}
                          className="w-4 h-4 text-green-600"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="radio" 
                          name={`status-${student.id}`} 
                          checked={localAttendance[student.id]?.status === 'LATE'}
                          onChange={() => handleStatusChange(student.id, 'LATE')}
                          className="w-4 h-4 text-yellow-600"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="radio" 
                          name={`status-${student.id}`} 
                          checked={localAttendance[student.id]?.status === 'ABSENT'}
                          onChange={() => handleStatusChange(student.id, 'ABSENT')}
                          className="w-4 h-4 text-red-600"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="radio" 
                          name={`status-${student.id}`} 
                          checked={localAttendance[student.id]?.status === 'EXCUSED'}
                          onChange={() => handleStatusChange(student.id, 'EXCUSED')}
                          className="w-4 h-4 text-blue-600"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="text"
                          value={localAttendance[student.id]?.remarks || ''}
                          onChange={(e) => setLocalAttendance(prev => ({
                            ...prev,
                            [student.id]: { ...prev[student.id], remarks: e.target.value }
                          }))}
                          placeholder="Optional"
                          className="w-full border-gray-300 rounded-md shadow-sm sm:text-sm px-2 py-1 border focus:ring-primary focus:border-primary"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : 'Save Attendance'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
