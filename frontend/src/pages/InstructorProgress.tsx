import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart, Edit } from 'lucide-react';
import { ProgressSliderDialog } from '../components/progress/ProgressSliderDialog';
import { useAuth } from '../contexts/AuthContext';

export const InstructorProgress = () => {
  const { user } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [selectedTechStack, setSelectedTechStack] = useState<any | null>(null);

  // Instructor needs their batches to know their students and tech stacks
  const { data: batchesData, isLoading: isLoadingBatches } = useQuery({
    queryKey: ['batches', user?.id],
    queryFn: () => api.get('/batches').then(res => res.data.data)
  });

  const batches = batchesData || [];
  
  // Extract all unique students from the instructor's batches with their associated tech stacks
  const studentsMap = new Map();
  batches.forEach((b: any) => {
    b.studentBatches?.forEach((sb: any) => {
      const student = sb.student;
      if (!studentsMap.has(student.id)) {
        studentsMap.set(student.id, { ...student, techStacks: [b.techStack] });
      } else {
        const existing = studentsMap.get(student.id);
        if (!existing.techStacks.find((ts: any) => ts.id === b.techStack.id)) {
          existing.techStacks.push(b.techStack);
        }
      }
    });
  });
  const students = Array.from(studentsMap.values());

  // Also fetch existing progress to show current numbers
  const { data: progressData } = useQuery({
    queryKey: ['admin-progress'], // We can use the overview endpoint to get all progress
    queryFn: () => api.get('/progress/overview').then(res => res.data.data)
  });
  const allProgress = progressData || [];

  const handleUpdateClick = (student: any, techStack: any) => {
    const existingProgress = allProgress.find((p: any) => p.studentId === student.id && p.techStackId === techStack.id);
    setSelectedStudent(student);
    setSelectedTechStack({ ...techStack, existingProgress });
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Update Student Progress</h2>
        <p className="text-gray-500">Track and update the learning progress of your assigned students.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart className="w-5 h-5 mr-2 text-primary" />
            My Students' Progress
          </CardTitle>
          <CardDescription>Select a student to update their current level and progress percentage.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingBatches ? (
            <p className="text-gray-500 py-4">Loading students...</p>
          ) : students.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No students found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {students.map((student: any) => (
                <div key={student.id} className="p-4 border rounded-md shadow-sm bg-white flex flex-col justify-between">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">{student.name}</h4>
                    <p className="text-xs text-gray-500 mb-3">{student.email}</p>
                    <div className="space-y-3 mb-4">
                      {student.techStacks.map((ts: any) => {
                        const prog = allProgress.find((p: any) => p.studentId === student.id && p.techStackId === ts.id);
                        return (
                          <div key={ts.id} className="flex flex-col gap-1 border-t pt-2 mt-2 first:border-0 first:pt-0 first:mt-0">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-medium text-gray-700">{ts.name}</span>
                              <span className="text-gray-500">{prog ? `${prog.progress}%` : '0%'}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div className="bg-primary h-1.5 rounded-full" style={{ width: `${prog?.progress || 0}%` }}></div>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-6 px-2 mt-1 text-xs justify-start text-blue-600 hover:text-blue-800"
                              onClick={() => handleUpdateClick(student, ts)}
                            >
                              <Edit className="w-3 h-3 mr-1" /> Update {ts.name}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedStudent && selectedTechStack && (
        <ProgressSliderDialog
          open={!!selectedStudent}
          onOpenChange={(open: boolean) => !open && setSelectedStudent(null)}
          student={selectedStudent}
          techStack={selectedTechStack}
        />
      )}
    </div>
  );
};
