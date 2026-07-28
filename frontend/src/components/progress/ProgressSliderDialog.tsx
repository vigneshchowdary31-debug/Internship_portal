import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export const ProgressSliderDialog = ({ open, onOpenChange, student, techStack }: any) => {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState('BEGINNER');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (techStack?.existingProgress) {
      setProgress(techStack.existingProgress.progress || 0);
      setLevel(techStack.existingProgress.level || 'BEGINNER');
      setNotes(techStack.existingProgress.notes || '');
    } else {
      setProgress(0);
      setLevel('BEGINNER');
      setNotes('');
    }
  }, [techStack]);

  // Auto-update level based on progress slider
  const handleProgressChange = (val: number) => {
    setProgress(val);
    if (val < 40) setLevel('BEGINNER');
    else if (val < 80) setLevel('INTERMEDIATE');
    else setLevel('ADVANCED');
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      return api.post('/progress', payload); // using post as upsert
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-progress'] });
      queryClient.invalidateQueries({ queryKey: ['progress'] });
      onOpenChange(false);
    }
  });

  const handleSave = () => {
    saveMutation.mutate({
      studentId: student.id,
      techStackId: techStack.id,
      progress,
      level,
      notes
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Update Progress</DialogTitle>
          <DialogDescription>
            {student?.name} - {techStack?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="flex justify-between">
              <Label>Progress</Label>
              <span className="font-bold text-primary">{progress}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="100" 
              value={progress}
              onChange={(e) => handleProgressChange(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>

          <div className="space-y-2">
            <Label>Level (Auto-calculated)</Label>
            <div className={`px-3 py-2 rounded-md font-semibold text-sm text-center border ${
              level === 'ADVANCED' ? 'bg-purple-50 text-purple-700 border-purple-200' :
              level === 'INTERMEDIATE' ? 'bg-blue-50 text-blue-700 border-blue-200' :
              'bg-gray-50 text-gray-700 border-gray-200'
            }`}>
              {level}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Instructor Notes</Label>
            <textarea 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-24 border rounded-md p-2 text-sm focus:ring-primary focus:border-primary border-gray-300"
              placeholder="Add observations or feedback..."
            ></textarea>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Progress'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
