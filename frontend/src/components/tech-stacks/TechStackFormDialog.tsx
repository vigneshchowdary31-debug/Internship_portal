import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
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

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long'),
});

export type TechStackFormData = z.infer<typeof schema>;

interface TechStackFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: TechStackFormData) => void;
  initialData?: any;
  title: string;
  isEditing: boolean;
  isLoading: boolean;
}

export function TechStackFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  title,
  isEditing,
  isLoading,
}: TechStackFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TechStackFormData>({
    resolver: zodResolver(schema),
    defaultValues: initialData || { name: '' },
  });

  useEffect(() => {
    if (open) {
      if (initialData) {
        reset({ name: initialData.name });
      } else {
        reset({ name: '' });
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
              ? "Update the tech stack name below."
              : "Enter the name of the new tech stack."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Tech Stack Name</Label>
            <Input id="name" placeholder="e.g. React" {...register('name')} />
            {errors.name && (
              <p className="text-red-500 text-xs">{errors.name.message as string}</p>
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
