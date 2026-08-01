import { UserManagementPage } from '../../components/users/UserManagementPage';

export const InstructorsManagement = () => (
  <UserManagementPage
    role="INSTRUCTOR"
    title="Instructors"
    description="Enroll instructors, import them in bulk, and manage their access."
  />
);
