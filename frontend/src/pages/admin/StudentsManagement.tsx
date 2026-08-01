import { UserManagementPage } from '../../components/users/UserManagementPage';

export const StudentsManagement = () => (
  <UserManagementPage
    role="STUDENT"
    title="Students"
    description="Enroll students, import them in bulk, and manage their access."
  />
);
