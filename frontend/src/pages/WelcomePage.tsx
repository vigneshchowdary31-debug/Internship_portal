import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, homePathFor } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PartyPopper, ShieldCheck, ArrowRight } from 'lucide-react';
import { markWelcomeSeen } from '@/lib/onboarding';

export const WelcomePage = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  // Nothing to welcome them to if they have already set their own password.
  if (!user.mustChangePassword) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  const proceed = () => {
    markWelcomeSeen(user.id);
    navigate('/change-password', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <Card className="w-full max-w-lg border-t-4 border-t-primary shadow-lg">
        <CardHeader className="items-center space-y-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50">
            <PartyPopper className="h-7 w-7 text-primary" aria-hidden="true" />
          </span>
          <CardTitle className="text-2xl font-bold">
            Welcome to Internship Training Portal
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-3 text-center">
            <p className="text-lg font-medium text-gray-900">Hello {user.name}</p>
            <p className="text-sm leading-relaxed text-gray-600">
              Your account has been created successfully.
            </p>
            <p className="text-sm leading-relaxed text-gray-600">
              Before continuing, please change your temporary password.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-md border border-indigo-100 bg-indigo-50 p-3">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed text-indigo-900">
              You are currently signed in with the temporary password that was emailed to you.
              Choosing your own password keeps your account secure.
            </p>
          </div>

          <Button onClick={proceed} className="w-full" size="lg">
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
