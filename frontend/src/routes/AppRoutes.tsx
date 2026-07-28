import { Routes, Route, Navigate } from 'react-router-dom';
import { Login } from '../pages/Login';
import { DashboardLayout } from '../layouts/DashboardLayout';
import { AdminDashboard } from '../pages/AdminDashboard';
import { InstructorDashboard } from '../pages/InstructorDashboard';
import { StudentDashboard } from '../pages/StudentDashboard';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { StudentsManagement } from '../pages/admin/StudentsManagement';
import { InstructorsManagement } from '../pages/admin/InstructorsManagement';
import { TechStacksManagement } from '../pages/admin/TechStacksManagement';
import { BatchesManagement } from '../pages/admin/BatchesManagement';
import { SessionsManagement } from '../pages/admin/SessionsManagement';
import { AdminAttendance } from '../pages/admin/AdminAttendance';
import { AdminProgress } from '../pages/admin/AdminProgress';
import { InstructorAttendance } from '../pages/InstructorAttendance';
import { InstructorProgress } from '../pages/InstructorProgress';
import { ProfilePage } from '../pages/ProfilePage';

export const AppRoutes = () => {
  return (
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
        <Route path="/student/profile" element={<ProfilePage />} />
      </Route>

      {/* Shared Routes inside DashboardLayout for other roles too, if we want them to have /profile */}
      {/* Wait, instead of defining it per role, we can define a wildcard or inject it. Let's just add it to Admin and Instructor as well, or just define one without role restriction but inside DashboardLayout. */}
      {/* But DashboardLayout requires allowedRoles. I'll add to all 3. */}
      <Route element={<DashboardLayout allowedRoles={['ADMIN', 'INSTRUCTOR', 'STUDENT']} />}>
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="/unauthorized" element={<div className="p-10 text-center text-red-500 font-bold">Unauthorized Access</div>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
