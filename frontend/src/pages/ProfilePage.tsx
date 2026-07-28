import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, ShieldCheck, AlertCircle } from 'lucide-react';

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export const ProfilePage = () => {
  const { user } = useAuth();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name || '',
      password: '',
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileFormData) => {
      const payload: any = { name: data.name };
      if (data.password) payload.password = data.password;
      return api.patch('/users/profile', payload);
    },
    onSuccess: (res) => {
      setSuccessMessage('Profile updated successfully!');
      setErrorMessage(null);
      // Ensure the auth context updates the user's name
      // Usually, updating the token is required, but if the app reads name from localStorage,
      // we might need to manually update it or force a re-login.
      // For MVP, if they changed their name, we update the local object (though token might still have old name).
      if (user) {
        localStorage.setItem('user', JSON.stringify({ ...user, name: res.data.data.name }));
      }
      reset({ name: res.data.data.name, password: '' });
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: any) => {
      setErrorMessage(err.response?.data?.message || 'Failed to update profile.');
      setSuccessMessage(null);
    }
  });

  const onSubmit = (data: ProfileFormData) => {
    updateProfileMutation.mutate(data);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Profile Settings</h2>
        <p className="text-gray-500">Manage your account details and security.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-lg">
            <User className="w-5 h-5 mr-2" />
            Personal Information
          </CardTitle>
          <CardDescription>
            Update your display name or change your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {successMessage && (
            <div className="mb-4 bg-green-50 border border-green-200 text-green-700 p-3 rounded-md flex items-center text-sm">
              <ShieldCheck className="w-4 h-4 mr-2" />
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-md flex items-center text-sm">
              <AlertCircle className="w-4 h-4 mr-2" />
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Input value={user?.role || ''} disabled className="bg-gray-50 text-gray-500 font-semibold" />
            </div>

            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input value={user?.email || ''} disabled className="bg-gray-50 text-gray-500" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" {...register('name')} placeholder="Your Name" />
              {errors.name && <p className="text-red-500 text-xs">{errors.name.message as string}</p>}
            </div>

            <div className="space-y-2 pt-2">
              <Label htmlFor="password">New Password</Label>
              <Input 
                id="password" 
                type="password" 
                {...register('password')} 
                placeholder="Leave blank to keep current password" 
              />
              {errors.password && <p className="text-red-500 text-xs">{errors.password.message as string}</p>}
            </div>

            <div className="pt-4 flex justify-end">
              <Button type="submit" disabled={updateProfileMutation.isPending}>
                {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
