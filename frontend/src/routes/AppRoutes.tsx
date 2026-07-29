import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from '../layouts/DashboardLayout';

const Login = React.lazy(() => import('../pages/Login').then(m => ({ default: m.Login })));
const AdminDashboard = React.lazy(() => import('../pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const InstructorDashboard = React.lazy(() => import('../pages/InstructorDashboard').then(m => ({ default: m.InstructorDashboard })));
const StudentDashboard = React.lazy(() => import('../pages/StudentDashboard').then(m => ({ default: m.StudentDashboard })));
const PlaceholderPage = React.lazy(() => import('../pages/PlaceholderPage').then(m => ({ default: m.PlaceholderPage })));
const StudentsManagement = React.lazy(() => import('../pages/admin/StudentsManagement').then(m => ({ default: m.StudentsManagement })));
const InstructorsManagement = React.lazy(() => import('../pages/admin/InstructorsManagement').then(m => ({ default: m.InstructorsManagement })));
const TechStacksManagement = React.lazy(() => import('../pages/admin/TechStacksManagement').then(m => ({ default: m.TechStacksManagement })));
const BatchesManagement = React.lazy(() => import('../pages/admin/BatchesManagement').then(m => ({ default: m.BatchesManagement })));
const SessionsManagement = React.lazy(() => import('../pages/admin/SessionsManagement').then(m => ({ default: m.SessionsManagement })));
const AdminAttendance = React.lazy(() => import('../pages/admin/AdminAttendance').then(m => ({ default: m.AdminAttendance })));
const AdminProgress = React.lazy(() => import('../pages/admin/AdminProgress').then(m => ({ default: m.AdminProgress })));
const InstructorAttendance = React.lazy(() => import('../pages/InstructorAttendance').then(m => ({ default: m.InstructorAttendance })));
const InstructorProgress = React.lazy(() => import('../pages/InstructorProgress').then(m => ({ default: m.InstructorProgress })));
const ProfilePage = React.lazy(() => import('../pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const NotFoundPage = React.lazy(() => import('../pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const UnauthorizedPage = React.lazy(() => import('../pages/UnauthorizedPage').then(m => ({ default: m.UnauthorizedPage })));

const SuspenseFallback = () => (
  <div className="flex h-screen items-center justify-center text-gray-500">
    Loading...
  </div>
);

export const AppRoutes = () => {
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        
        {/* Admin Routes */}
        <Route element={<DashboardLayout allowedRoles={['ADMIN']} />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/students" element={<StudentsManagement />} />
          <Route path="/admin/instructors" element={<InstructorsManagement />} />
          <Route path="/admin/tech-stacks" element={<TechStacksManagement />} />
          <Route path="/admin/batches" element={<BatchesManagement />} />
          <Route path="/admin/sessions" element={<SessionsManagement />} />
          <Route path="/admin/attendance" element={<AdminAttendance />} />
          <Route path="/admin/progress" element={<AdminProgress />} />
          <Route path="/admin/calendar" element={<PlaceholderPage title="Calendar" />} />
          <Route path="/admin/settings" element={<PlaceholderPage title="Settings" />} />
        </Route>

        {/* Instructor Routes */}
        <Route element={<DashboardLayout allowedRoles={['INSTRUCTOR']} />}>
          <Route path="/instructor" element={<InstructorDashboard />} />
          <Route path="/instructor/attendance" element={<InstructorAttendance />} />
          <Route path="/instructor/progress" element={<InstructorProgress />} />
        </Route>

        {/* Student Routes */}
        <Route element={<DashboardLayout allowedRoles={['STUDENT']} />}>
          <Route path="/student" element={<StudentDashboard />} />
        </Route>

        {/* Shared Routes */}
        <Route element={<DashboardLayout allowedRoles={['ADMIN', 'INSTRUCTOR', 'STUDENT']} />}>
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
};
