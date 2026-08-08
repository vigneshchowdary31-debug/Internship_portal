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
const ChangePasswordPage = React.lazy(() => import('../pages/ChangePasswordPage').then(m => ({ default: m.ChangePasswordPage })));
const WelcomePage = React.lazy(() => import('../pages/WelcomePage').then(m => ({ default: m.WelcomePage })));
const CurriculumBuilder = React.lazy(() => import('../pages/lms/CurriculumBuilder').then(m => ({ default: m.CurriculumBuilder })));
const MyCourse = React.lazy(() => import('../pages/lms/MyCourse').then(m => ({ default: m.MyCourse })));
const AssignmentDetailPage = React.lazy(() => import('../pages/lms/AssignmentDetailPage').then(m => ({ default: m.AssignmentDetailPage })));
const QuizzesManagement = React.lazy(() => import('../pages/admin/QuizzesManagement').then(m => ({ default: m.QuizzesManagement })));
const QuizQuestionBuilder = React.lazy(() => import('../pages/admin/QuizQuestionBuilder').then(m => ({ default: m.QuizQuestionBuilder })));
const QuizAttemptPage = React.lazy(() => import('../pages/lms/QuizAttemptPage').then(m => ({ default: m.QuizAttemptPage })));
const ContentViewerPage = React.lazy(() => import('../pages/lms/ContentViewerPage').then(m => ({ default: m.ContentViewerPage })));
const QuizResultPage = React.lazy(() => import('../pages/lms/QuizResultPage').then(m => ({ default: m.QuizResultPage })));
const AssignmentEvaluationPage = React.lazy(() => import('../pages/instructor/AssignmentEvaluationPage').then(m => ({ default: m.AssignmentEvaluationPage })));
const BatchCurriculum = React.lazy(() => import('../pages/lms/BatchCurriculum').then(m => ({ default: m.BatchCurriculum })));

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

        {/* Both deliberately OUTSIDE DashboardLayout: that layout redirects
            anyone with mustChangePassword here, so nesting them would loop. */}
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        
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
          <Route path="/admin/curriculum" element={<CurriculumBuilder />} />
          <Route path="/admin/quizzes" element={<QuizzesManagement />} />
          <Route path="/admin/quizzes/:id/questions" element={<QuizQuestionBuilder />} />
          <Route path="/admin/calendar" element={<PlaceholderPage title="Calendar" />} />
          <Route path="/admin/settings" element={<PlaceholderPage title="Settings" />} />
        </Route>

        {/* Instructor Routes */}
        <Route element={<DashboardLayout allowedRoles={['INSTRUCTOR']} />}>
          <Route path="/instructor" element={<InstructorDashboard />} />
          <Route path="/instructor/attendance" element={<InstructorAttendance />} />
          <Route path="/instructor/progress" element={<InstructorProgress />} />
          <Route path="/instructor/curriculum" element={<BatchCurriculum />} />
        </Route>

        {/* Student Routes */}
        <Route element={<DashboardLayout allowedRoles={['STUDENT']} />}>
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/student/course" element={<MyCourse />} />
          <Route path="/student/assignments/:id" element={<AssignmentDetailPage />} />
          <Route path="/quiz/result/:attemptId" element={<QuizResultPage />} />
          <Route path="/quiz/:attemptId" element={<QuizAttemptPage />} />
        </Route>

        {/* Grading. Under /instructor by contract, but admins evaluate too —
            the API authorises both via assertCanEvaluate. */}
        <Route element={<DashboardLayout allowedRoles={['ADMIN', 'INSTRUCTOR']} />}>
          <Route path="/instructor/assignments/:id" element={<AssignmentEvaluationPage />} />
        </Route>

        {/* Shared Routes */}
        <Route element={<DashboardLayout allowedRoles={['ADMIN', 'INSTRUCTOR', 'STUDENT']} />}>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/learn/content" element={<ContentViewerPage />} />
        </Route>

        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
};
