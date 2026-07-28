import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const schema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  description: z.string().optional(),
  batchId: z.string().min(1, 'Batch is required'),
  instructorId: z.string().min(1, 'Instructor is required'),
  startTime: z.string().min(1, 'Start time is required'),
  durationMinutes: z.coerce.number().min(15, 'Duration must be at least 15 minutes').max(480, 'Duration cannot exceed 8 hours'),
});

export type SessionFormData = z.infer<typeof schema>;

interface SessionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: SessionFormData) => void;
  initialData?: any;
  title: string;
  isEditing: boolean;
  isLoading: boolean;
  batches: { id: string; name: string }[];
  instructors: { id: string; name: string }[];
}

export function SessionFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  title,
  isEditing,
  isLoading,
  batches,
  instructors,
}: SessionFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<SessionFormData>({
    resolver: zodResolver(schema),
    defaultValues: initialData || { 
      title: '', 
      description: '', 
      batchId: '', 
      instructorId: '',
      startTime: '',
      durationMinutes: 60
    },
  });

  useEffect(() => {
    if (open) {
      if (initialData) {
        // format datetime string for datetime-local input (YYYY-MM-DDThh:mm)
        const dateObj = new Date(initialData.startTime);
        const tzOffset = dateObj.getTimezoneOffset() * 60000;
        const localISOTime = new Date(dateObj.getTime() - tzOffset).toISOString().slice(0, 16);

        // calculate duration from start/end times if editing
        const endObj = new Date(initialData.endTime);
        const durationMinutes = Math.round((endObj.getTime() - dateObj.getTime()) / 60000);

        reset({ 
          title: initialData.title, 
          description: initialData.description || '', 
          batchId: initialData.batchId, 
          instructorId: initialData.instructorId,
          startTime: localISOTime,
          durationMinutes
        });
      } else {
        reset({ title: '', description: '', batchId: '', instructorId: '', startTime: '', durationMinutes: 60 });
      }
    }
  }, [open, initialData, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the session details. Changing the time will automatically update the Google Meet event."
              : "Schedule a new class and automatically generate a Google Meet link."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          
          <div className="space-y-2">
            <Label htmlFor="title">Session Title</Label>
            <Input id="title" placeholder="e.g. Intro to React hooks" {...register('title')} />
            {errors.title && <p className="text-red-500 text-xs">{errors.title.message as string}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea id="description" placeholder="Topics covered..." {...register('description')} />
            {errors.description && <p className="text-red-500 text-xs">{errors.description.message as string}</p>}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="batchId">Batch</Label>
              <Controller
                control={control}
                name="batchId"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || undefined} disabled={isEditing}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {batches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.batchId && <p className="text-red-500 text-xs">{errors.batchId.message as string}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instructorId">Instructor</Label>
              <Controller
                control={control}
                name="instructorId"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || undefined} disabled={isEditing}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select instructor" />
                    </SelectTrigger>
                    <SelectContent>
                      {instructors.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.instructorId && <p className="text-red-500 text-xs">{errors.instructorId.message as string}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Date & Time</Label>
              <Input id="startTime" type="datetime-local" {...register('startTime')} />
              {errors.startTime && <p className="text-red-500 text-xs">{errors.startTime.message as string}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="durationMinutes">Duration (Minutes)</Label>
              <Input id="durationMinutes" type="number" min="15" step="15" {...register('durationMinutes')} />
              {errors.durationMinutes && <p className="text-red-500 text-xs">{errors.durationMinutes.message as string}</p>}
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="mr-2">
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Schedule Session')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
