import { UserService, type UserFilters } from './user.service';
import { toCsv } from '../utils/csv';

/**
 * CSV export of the admin user lists.
 *
 * Reuses `UserService.getUsers` — and therefore the same filter semantics as
 * the on-screen table — so "Export CSV" always returns exactly the rows the
 * admin is currently looking at, not a differently-filtered set.
 *
 * Password material is structurally impossible to export here: the service
 * selects through `USER_PUBLIC_SELECT`, which has no `password` column, and the
 * column lists below are explicit rather than derived from the record.
 */
export class CsvExportService {
  private static formatDate(value: Date | string | null | undefined): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  static async exportStudents(filters: UserFilters = {}): Promise<string> {
    const students = await UserService.getUsers({ ...filters, role: 'STUDENT' });

    return toCsv(
      ['Name', 'Email', 'NIAT ID', 'University', 'Tech Stack', 'Status', 'Created Date'],
      students.map((s) => [
        s.name,
        s.email,
        s.niatId ?? '',
        s.universityName ?? '',
        s.techStack?.name ?? '',
        s.status ? 'Active' : 'Inactive',
        this.formatDate(s.createdAt),
      ])
    );
  }

  static async exportInstructors(filters: UserFilters = {}): Promise<string> {
    const instructors = await UserService.getUsers({ ...filters, role: 'INSTRUCTOR' });

    return toCsv(
      ['Name', 'Email', 'Employee ID', 'Tech Stack', 'Status', 'Created Date'],
      instructors.map((i) => [
        i.name,
        i.email,
        i.employeeId ?? '',
        i.techStack?.name ?? '',
        i.status ? 'Active' : 'Inactive',
        this.formatDate(i.createdAt),
      ])
    );
  }

  /** `students-2026-07-31.csv` */
  static filename(prefix: string): string {
    return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  }
}
