import { Request, Response } from 'express';
import { UserService, type UserFilters } from '../services/user.service';
import { CsvImportService, type ImportRole } from '../services/csv-import.service';
import { CsvExportService } from '../services/csv-export.service';
import { CredentialService } from '../services/credential.service';
import { EnrollmentHistoryService } from '../services/enrollment-history.service';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';

/** Pulls the shared list/export filters off the query string. */
function readFilters(req: Request): UserFilters {
  return {
    role: req.query.role as string | undefined,
    techStackId: req.query.techStackId as string | undefined,
    universityName: req.query.universityName as string | undefined,
    status: req.query.status as string | undefined,
    credentialStatus: req.query.credentialStatus as string | undefined,
    search: req.query.search as string | undefined,
  };
}

/** `/students` | `/instructors` in the URL → the Role enum value. */
function roleFromParam(param: string): ImportRole {
  if (param === 'students') return 'STUDENT';
  if (param === 'instructors') return 'INSTRUCTOR';
  throw new AppError('Role must be either students or instructors', 400);
}

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * Reads the raw CSV body.
 *
 * The route mounts `express.text({ type: 'text/csv' })`, so a request with any
 * other Content-Type never populates a string body — that check IS the MIME
 * validation, enforced before a single byte is parsed.
 */
function readCsvBody(req: Request): string {
  if (typeof req.body !== 'string' || req.body.trim() === '') {
    throw new AppError(
      'Expected a CSV file body with Content-Type: text/csv. Please re-upload the file.',
      400
    );
  }
  return req.body;
}

// --- Single enrollment -------------------------------------------------------

/**
 * Generic creation, kept for backward compatibility.
 * Sends the enrollment email whenever the password was auto-generated.
 */
export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { user, temporaryPassword, generated } = await UserService.enrollUser({
    ...req.body,
    actorId: req.user!.id,
  });

  if (generated && (user.role === 'STUDENT' || user.role === 'INSTRUCTOR')) {
    // Fire and forget: enrollment has already succeeded and must never be
    // rolled back because a mail server was unreachable.
    void CredentialService.deliverAndRecord(user, temporaryPassword, { actorId: req.user!.id });
  }

  res.status(201).json({ success: true, data: user });
});

/** Builds the enroll handler for a role. Both roles differ only in their payload. */
const makeEnrollHandler = (role: 'STUDENT' | 'INSTRUCTOR') =>
  asyncHandler(async (req: Request, res: Response) => {
    const { user, temporaryPassword } = await UserService.enrollUser({
      ...req.body,
      role,
      actorId: req.user!.id,
    });

    // Awaited, unlike the legacy path, so the response can tell the admin
    // whether the credential email actually landed. A failure here is reported,
    // never thrown — the account already exists either way.
    const outcome = await CredentialService.deliverAndRecord(user, temporaryPassword, {
      actorId: req.user!.id,
    });

    const noun = role === 'STUDENT' ? 'Student' : 'Instructor';

    res.status(201).json({
      success: true,
      data: {
        user: { ...user, credentialStatus: outcome.delivered ? 'SENT' : 'FAILED' },
        /**
         * The ONLY time the plaintext password ever leaves the server.
         *
         * It is shown once in the enrollment confirmation dialog so the admin
         * can hand it over directly when email delivery fails. It is not stored
         * in plaintext anywhere and no other endpoint can retrieve it — once
         * this response is discarded the value is unrecoverable.
         */
        temporaryPassword,
        credentialDelivered: outcome.delivered,
        credentialFailureReason: outcome.reason ?? null,
      },
      message: outcome.delivered
        ? `${noun} enrolled successfully. Login credentials have been emailed to ${user.email}.`
        : `${noun} enrolled successfully. However, the credential email could not be delivered.`,
    });
  });

export const enrollStudent = makeEnrollHandler('STUDENT');
export const enrollInstructor = makeEnrollHandler('INSTRUCTOR');

// --- Reads -------------------------------------------------------------------

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await UserService.getUsers(readFilters(req));
  res.status(200).json({ success: true, data: users });
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserService.getUserById(req.params.id);
  res.status(200).json({ success: true, data: user });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { status, statusReason, ...profileFields } = req.body ?? {};

  // A status change is an access decision, so it goes through CredentialService
  // to pick up the confirmation rules and the audit event. Everything else is
  // an ordinary profile edit. Both may arrive in one request.
  let user = null;
  if (Object.keys(profileFields).length > 0) {
    user = await UserService.updateUser(req.params.id, profileFields);
  }
  if (typeof status === 'boolean') {
    user = await CredentialService.setStatus(req.params.id, status, req.user!.id, statusReason);
  }
  if (!user) {
    user = await UserService.getUserById(req.params.id);
  }

  res.status(200).json({ success: true, data: user });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await UserService.updateProfile(req.user!.id, req.body);
  res.status(200).json({
    success: true,
    data: user,
    message: 'Profile updated successfully',
  });
});

// --- CSV ---------------------------------------------------------------------

export const downloadImportTemplate = asyncHandler(async (req: Request, res: Response) => {
  const role = roleFromParam(req.params.role);
  const prefix = role === 'STUDENT' ? 'students' : 'instructors';
  sendCsv(res, `${prefix}-import-template.csv`, CsvImportService.template(role));
});

/** Dry run. Writes nothing — powers the wizard's validation and preview steps. */
export const validateImport = asyncHandler(async (req: Request, res: Response) => {
  const role = roleFromParam(req.params.role);
  const report = await CsvImportService.validate(readCsvBody(req), role);
  res.status(200).json({ success: true, data: report });
});

export const commitImport = asyncHandler(async (req: Request, res: Response) => {
  const role = roleFromParam(req.params.role);
  const report = await CsvImportService.import(readCsvBody(req), role, req.user!.id);
  res.status(200).json({
    success: true,
    data: report,
    message: `${report.imported} of ${report.totalRows} row(s) imported.`,
  });
});

/** Returns only the failing rows, annotated with their errors, for re-upload. */
export const downloadFailedRows = asyncHandler(async (req: Request, res: Response) => {
  const role = roleFromParam(req.params.role);
  const report = await CsvImportService.validate(readCsvBody(req), role);
  const prefix = role === 'STUDENT' ? 'students' : 'instructors';
  sendCsv(res, `${prefix}-failed-rows.csv`, CsvImportService.failedRowsCsv(report));
});

export const exportUsers = asyncHandler(async (req: Request, res: Response) => {
  const role = roleFromParam(req.params.role);
  const filters = readFilters(req);

  if (role === 'STUDENT') {
    sendCsv(res, CsvExportService.filename('students'), await CsvExportService.exportStudents(filters));
  } else {
    sendCsv(
      res,
      CsvExportService.filename('instructors'),
      await CsvExportService.exportInstructors(filters)
    );
  }
});


// --- Credential management ---------------------------------------------------

/**
 * Aggregate credential-delivery metrics for the admin dashboard.
 * Declared on a fixed path, so it must be routed before `/:id`.
 */
export const getCredentialStatus = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await CredentialService.getCredentialStats();
  res.status(200).json({ success: true, data: stats });
});

/**
 * Reset & Send New Credentials.
 *
 * Replaces the previous two-step "resend → 409 → reset" dance. Because the
 * plaintext password is never stored, a resend could never actually resend
 * anything; this action does the honest equivalent in one step — mint a new
 * credential, email it, and disclose it once.
 */
export const resetAndSendCredentials = asyncHandler(async (req: Request, res: Response) => {
  const result = await CredentialService.resetCredentials(req.params.id, req.user!.id, {
    sendEmail: true,
  });

  res.status(200).json({
    success: true,
    data: {
      user: result.user,
      // One-time disclosure. Same contract as enrollment.
      temporaryPassword: result.temporaryPassword,
      emailed: true,
      credentialDelivered: result.delivered,
      credentialFailureReason: result.failureReason ?? null,
    },
    message: result.delivered
      ? 'New credentials generated and emailed.'
      : 'New credentials generated. However, the email could not be delivered.',
  });
});

/**
 * Reset Password — generates a new credential but sends no email.
 *
 * For the case where the admin will hand the password over in person or through
 * another channel, and an automated email would be noise or a leak.
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await CredentialService.resetCredentials(req.params.id, req.user!.id, {
    sendEmail: false,
  });

  res.status(200).json({
    success: true,
    data: {
      user: result.user,
      temporaryPassword: result.temporaryPassword,
      emailed: false,
      credentialDelivered: false,
      credentialFailureReason: null,
    },
    message: 'New password generated. No email was sent — share the credentials manually.',
  });
});

export const getEnrollmentHistory = asyncHandler(async (req: Request, res: Response) => {
  const events = await EnrollmentHistoryService.listForUser(req.params.id);
  res.status(200).json({ success: true, data: events });
});
