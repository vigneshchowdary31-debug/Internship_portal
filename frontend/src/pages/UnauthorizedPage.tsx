import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';

export const UnauthorizedPage = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-900">
      <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
      <h1 className="text-4xl font-bold mb-4">403</h1>
      <h2 className="text-2xl font-semibold mb-6">Unauthorized Access</h2>
      <p className="text-gray-500 mb-8 max-w-md text-center">
        You do not have permission to view this page. Please log in with the appropriate account.
      </p>
      <Button onClick={() => navigate('/login')}>Return to Login</Button>
    </div>
  );
};
