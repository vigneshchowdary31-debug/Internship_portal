import prisma from '../config/db';
import { AppError } from '../utils/AppError';
import { UserService } from './user.service';
import { CredentialService } from './credential.service';
import { CsvParseError, normaliseHeader, parseCsvTable, toCsv } from '../utils/csv';

/**
 * Bulk enrollment from CSV.
 *
 * Split into two phases that share one validation routine:
 *
 *   validate() — pure, writes nothing. Powers the wizard's preview step.
 *   import()   — re-validates, then creates only the rows that pass.
 *
 * import() deliberately re-runs validation rather than trusting a token from
 * the preview: the two calls are separate HTTP requests, and the database can
 * change between them (another admin enrolling the same email, a tech stack
 * being deleted). Validating twice is cheap; importing against stale
 * validation is not.
 */

export type ImportRole = 'STUDENT' | 'INSTRUCTOR';

export const STUDENT_CSV_HEADERS = ['Name', 'Email', 'NIAT ID', 'University Name', 'Tech Stack'];
export const INSTRUCTOR_CSV_HEADERS = ['Name', 'Email', 'Employee ID', 'Tech Stack'];

/** Row cap. Bounds request size, transaction time, and outbound email volume. */
export const MAX_IMPORT_ROWS = 500;

export interface ValidatedRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  name: string;
  email: string;
  niatId?: string;
  universityName?: string;
  employeeId?: string;
  techStackName: string;
  techStackId: string | null;
}

export interface ValidationReport {
  role: ImportRole;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: ValidatedRow[];
}

export interface ImportReport {
  role: ImportRole;
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  emailsSent: number;
  emailsFailed: number;
  errors: { rowNumber: number; email: string; message: string }[];
}

// Deliberately permissive: matches the frontend and the Zod validators used
// elsewhere. Strict RFC 5322 rejects addresses that real mail servers accept.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CsvImportService {
  static headersFor(role: ImportRole): string[] {
    return role === 'INSTRUCTOR' ? INSTRUCTOR_CSV_HEADERS : STUDENT_CSV_HEADERS;
  }

  /** Downloadable template: header row plus one illustrative example row. */
  static template(role: ImportRole): string {
    const headers = this.headersFor(role);
    const example =
      role === 'INSTRUCTOR'
        ? ['Asha Rao', 'asha.rao@example.com', 'EMP1001', 'React']
        : ['Ravi Kumar', 'ravi.kumar@example.com', 'NIAT2024001', 'Anna University', 'React'];
    return toCsv(headers, [example]);
  }

  /**
   * Validates CSV text without writing anything.
   *
   * Checks, per row: required fields present, email well-formed, tech stack
   * resolvable by name, no duplicate within the file, no collision with an
   * existing database row.
   */
  static async validate(csvText: string, role: ImportRole): Promise<ValidationReport> {
    const headers = this.headersFor(role);

    let table;
    try {
      table = parseCsvTable(csvText, headers);
    } catch (error: any) {
      if (error instanceof CsvParseError) throw new AppError(error.message, 400);
      throw error;
    }

    if (table.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        `This file has ${table.rows.length} rows. A single import is limited to ${MAX_IMPORT_ROWS} rows — please split the file.`,
        400
      );
    }

    const key = {
      name: normaliseHeader('Name'),
      email: normaliseHeader('Email'),
      niatId: normaliseHeader('NIAT ID'),
      university: normaliseHeader('University Name'),
      employeeId: normaliseHeader('Employee ID'),
      techStack: normaliseHeader('Tech Stack'),
    };

    // One lookup for the whole file rather than one per row.
    const techStacks = await prisma.techStack.findMany({ select: { id: true, name: true } });
    const techStackByName = new Map(techStacks.map((ts) => [ts.name.trim().toLowerCase(), ts]));

    const emails = table.rows.map((r) => (r[key.email] || '').toLowerCase()).filter(Boolean);
    const niatIds = table.rows.map((r) => (r[key.niatId] || '')).filter(Boolean);
    const employeeIds = table.rows.map((r) => (r[key.employeeId] || '')).filter(Boolean);

    const existing = await prisma.user.findMany({
      where: {
        OR: [
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...(niatIds.length ? [{ niatId: { in: niatIds } }] : []),
          ...(employeeIds.length ? [{ employeeId: { in: employeeIds } }] : []),
        ],
      },
      select: { email: true, niatId: true, employeeId: true },
    });

    const existingEmails = new Set(existing.map((u) => u.email.toLowerCase()));
    const existingNiatIds = new Set(
      existing.map((u) => u.niatId?.toLowerCase()).filter(Boolean) as string[]
    );
    const existingEmployeeIds = new Set(
      existing.map((u) => u.employeeId?.toLowerCase()).filter(Boolean) as string[]
    );

    // Track values seen earlier in this same file so intra-file duplicates are
    // caught too — the database check alone would let a file containing the
    // same address twice through.
    const seenEmails = new Set<string>();
    const seenNiatIds = new Set<string>();
    const seenEmployeeIds = new Set<string>();

    const rows: ValidatedRow[] = table.rows.map((record, index) => {
      const errors: string[] = [];

      const name = (record[key.name] || '').trim();
      const email = (record[key.email] || '').trim().toLowerCase();
      const niatId = (record[key.niatId] || '').trim();
      const universityName = (record[key.university] || '').trim();
      const employeeId = (record[key.employeeId] || '').trim();
      const techStackName = (record[key.techStack] || '').trim();

      if (!name) errors.push('Name is required');
      else if (name.length < 2) errors.push('Name must be at least 2 characters');

      if (!email) {
        errors.push('Email is required');
      } else if (!EMAIL_RE.test(email)) {
        errors.push('Email is not a valid address');
      } else if (seenEmails.has(email)) {
        errors.push('Duplicate email within this file');
      } else if (existingEmails.has(email)) {
        errors.push('A user with this email already exists');
      }
      if (email) seenEmails.add(email);

      if (role === 'STUDENT') {
        if (!niatId) {
          errors.push('NIAT ID is required');
        } else if (seenNiatIds.has(niatId.toLowerCase())) {
          errors.push('Duplicate NIAT ID within this file');
        } else if (existingNiatIds.has(niatId.toLowerCase())) {
          errors.push('A user with this NIAT ID already exists');
        }
        if (niatId) seenNiatIds.add(niatId.toLowerCase());

        if (!universityName) errors.push('University Name is required');
      } else {
        if (!employeeId) {
          errors.push('Employee ID is required');
        } else if (seenEmployeeIds.has(employeeId.toLowerCase())) {
          errors.push('Duplicate Employee ID within this file');
        } else if (existingEmployeeIds.has(employeeId.toLowerCase())) {
          errors.push('A user with this Employee ID already exists');
        }
        if (employeeId) seenEmployeeIds.add(employeeId.toLowerCase());
      }

      let techStackId: string | null = null;
      if (!techStackName) {
        errors.push('Tech Stack is required');
      } else {
        const match = techStackByName.get(techStackName.toLowerCase());
        if (!match) {
          errors.push(`Tech Stack "${techStackName}" does not exist in the portal`);
        } else {
          techStackId = match.id;
        }
      }

      return {
        rowNumber: table.rowNumbers[index],
        valid: errors.length === 0,
        errors,
        name,
        email,
        ...(role === 'STUDENT' ? { niatId, universityName } : { employeeId }),
        techStackName,
        techStackId,
      };
    });

    const validRows = rows.filter((r) => r.valid).length;

    return {
      role,
      totalRows: rows.length,
      validRows,
      invalidRows: rows.length - validRows,
      rows,
    };
  }

  /**
   * Validates then imports.
   *
   * Rows are created one at a time rather than in a single transaction: a
   * 200-row import where row 173 collides should still enroll the other 199.
   * Partial success is the desired behaviour here and is reported explicitly.
   *
   * Enrollment emails are sent per user and never affect the outcome — the
   * account exists whether or not the mail leaves the building.
   */
  static async import(csvText: string, role: ImportRole, actorId?: string): Promise<ImportReport> {
    const validation = await this.validate(csvText, role);

    const report: ImportReport = {
      role,
      totalRows: validation.totalRows,
      imported: 0,
      skipped: validation.invalidRows,
      failed: 0,
      emailsSent: 0,
      emailsFailed: 0,
      errors: validation.rows
        .filter((r) => !r.valid)
        .map((r) => ({ rowNumber: r.rowNumber, email: r.email, message: r.errors.join('; ') })),
    };

    for (const row of validation.rows) {
      if (!row.valid) continue;

      try {
        const { user, temporaryPassword } = await UserService.enrollUser({
          name: row.name,
          email: row.email,
          role,
          niatId: row.niatId || null,
          universityName: row.universityName || null,
          employeeId: row.employeeId || null,
          techStackId: row.techStackId,
          actorId: actorId ?? null,
        });

        report.imported++;

        // Delivery outcome is recorded against the user so a failed credential
        // email surfaces in the dashboard and the audit trail, not just here.
        const outcome = await CredentialService.deliverAndRecord(user, temporaryPassword, {
          actorId: actorId ?? null,
        });
        if (outcome.delivered) report.emailsSent++;
        else report.emailsFailed++;
      } catch (error: any) {
        // Reaching here means the row passed validation but the write still
        // failed — almost always a unique-constraint race with a concurrent
        // enrollment. Recorded as failed, not skipped.
        report.failed++;
        report.errors.push({
          rowNumber: row.rowNumber,
          email: row.email,
          message: error?.message || 'Failed to create this user',
        });
      }
    }

    return report;
  }

  /** CSV of only the rows that failed, so an admin can fix and re-upload. */
  static failedRowsCsv(report: ValidationReport): string {
    const headers = [...this.headersFor(report.role), 'Errors'];
    const rows = report.rows
      .filter((r) => !r.valid)
      .map((r) =>
        report.role === 'INSTRUCTOR'
          ? [r.name, r.email, r.employeeId ?? '', r.techStackName, r.errors.join('; ')]
          : [
              r.name,
              r.email,
              r.niatId ?? '',
              r.universityName ?? '',
              r.techStackName,
              r.errors.join('; '),
            ]
      );
    return toCsv(headers, rows);
  }
}
