
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '../components/AppSidebar';
import { NotificationBell } from '../components/lms/NotificationBell';
import { hasSeenWelcome } from '@/lib/onboarding';

export const DashboardLayout = ({ allowedRoles }: { allowedRoles?: string[] }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Nothing behind the dashboard shell is reachable until the one-time password
  // change is done. Typing a dashboard URL directly lands here and bounces.
  // The server enforces the same rule (403 "Password change required."), so
  // this redirect is convenience, not the security boundary.
  //
  // First-timers see the welcome screen; once acknowledged they go straight to
  // the change-password form, so a refresh mid-flow does not restart onboarding.
  if (user.mustChangePassword) {
    return <Navigate to={hasSeenWelcome(user.id) ? '/change-password' : '/welcome'} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="min-h-screen flex flex-col flex-1 overflow-hidden bg-gray-50">
        <header className="flex h-14 items-center gap-4 border-b bg-white px-4 lg:h-[60px] shadow-sm">
          <SidebarTrigger />
          <div className="flex-1">
            <h1 className="text-lg font-semibold capitalize">{user.role.toLowerCase()} Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="text-sm text-gray-700 font-medium">Hello, {user.name}</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
};
