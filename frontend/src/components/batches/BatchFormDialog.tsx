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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TechStack } from '../tech-stacks/TechStackTable';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  techStackId: z.string().min(1, 'Please select a tech stack'),
});

export type BatchFormData = z.infer<typeof schema>;

interface BatchFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: BatchFormData) => void;
  initialData?: any;
  title: string;
  isEditing: boolean;
  isLoading: boolean;
  techStacks: TechStack[];
}

export function BatchFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  title,
  isEditing,
  isLoading,
  techStacks,
}: BatchFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<BatchFormData>({
    resolver: zodResolver(schema),
    defaultValues: initialData || { name: '', techStackId: '' },
  });

  useEffect(() => {
    if (open) {
      if (initialData) {
        reset({ name: initialData.name, techStackId: initialData.techStackId });
      } else {
        reset({ name: '', techStackId: '' });
      }
    }
  }, [open, initialData, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the batch details below."
              : "Enter the details for the new batch."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Batch Name</Label>
            <Input id="name" placeholder="e.g. React Summer 2024" {...register('name')} />
            {errors.name && (
              <p className="text-red-500 text-xs">{errors.name.message as string}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="techStackId">Tech Stack</Label>
            <Controller
              control={control}
              name="techStackId"
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value || undefined}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a tech stack" />
                  </SelectTrigger>
                  <SelectContent>
                    {techStacks.map((ts) => (
                      <SelectItem key={ts.id} value={ts.id}>
                        {ts.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.techStackId && (
              <p className="text-red-500 text-xs">{errors.techStackId.message as string}</p>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="mr-2">
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
