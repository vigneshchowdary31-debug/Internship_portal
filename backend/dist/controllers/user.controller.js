"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEnrollmentHistory = exports.resetPassword = exports.resetAndSendCredentials = exports.getCredentialStatus = exports.exportUsers = exports.downloadFailedRows = exports.commitImport = exports.validateImport = exports.downloadImportTemplate = exports.updateProfile = exports.updateUser = exports.getUserById = exports.getUsers = exports.enrollInstructor = exports.enrollStudent = exports.createUser = void 0;
const user_service_1 = require("../services/user.service");
const csv_import_service_1 = require("../services/csv-import.service");
const csv_export_service_1 = require("../services/csv-export.service");
const credential_service_1 = require("../services/credential.service");
const enrollment_history_service_1 = require("../services/enrollment-history.service");
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
/** Pulls the shared list/export filters off the query string. */
function readFilters(req) {
    return {
        role: req.query.role,
        techStackId: req.query.techStackId,
        universityName: req.query.universityName,
        status: req.query.status,
        credentialStatus: req.query.credentialStatus,
        search: req.query.search,
    };
}
/** `/students` | `/instructors` in the URL → the Role enum value. */
function roleFromParam(param) {
    if (param === 'students')
        return 'STUDENT';
    if (param === 'instructors')
        return 'INSTRUCTOR';
    throw new AppError_1.AppError('Role must be either students or instructors', 400);
}
function sendCsv(res, filename, csv) {
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
function readCsvBody(req) {
    if (typeof req.body !== 'string' || req.body.trim() === '') {
        throw new AppError_1.AppError('Expected a CSV file body with Content-Type: text/csv. Please re-upload the file.', 400);
    }
    return req.body;
}
// --- Single enrollment -------------------------------------------------------
/**
 * Generic creation, kept for backward compatibility.
 * Sends the enrollment email whenever the password was auto-generated.
 */
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { user, temporaryPassword, generated } = await user_service_1.UserService.enrollUser({
        ...req.body,
        actorId: req.user.id,
    });
    if (generated && (user.role === 'STUDENT' || user.role === 'INSTRUCTOR')) {
        // Fire and forget: enrollment has already succeeded and must never be
        // rolled back because a mail server was unreachable.
        void credential_service_1.CredentialService.deliverAndRecord(user, temporaryPassword, { actorId: req.user.id });
    }
    res.status(201).json({ success: true, data: user });
});
/** Builds the enroll handler for a role. Both roles differ only in their payload. */
const makeEnrollHandler = (role) => (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { user, temporaryPassword } = await user_service_1.UserService.enrollUser({
        ...req.body,
        role,
        actorId: req.user.id,
    });
    // Awaited, unlike the legacy path, so the response can tell the admin
    // whether the credential email actually landed. A failure here is reported,
    // never thrown — the account already exists either way.
    const outcome = await credential_service_1.CredentialService.deliverAndRecord(user, temporaryPassword, {
        actorId: req.user.id,
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
exports.enrollStudent = makeEnrollHandler('STUDENT');
exports.enrollInstructor = makeEnrollHandler('INSTRUCTOR');
// --- Reads -------------------------------------------------------------------
exports.getUsers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const users = await user_service_1.UserService.getUsers(readFilters(req));
    res.status(200).json({ success: true, data: users });
});
exports.getUserById = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await user_service_1.UserService.getUserById(req.params.id);
    res.status(200).json({ success: true, data: user });
});
exports.updateUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { status, statusReason, ...profileFields } = req.body ?? {};
    // A status change is an access decision, so it goes through CredentialService
    // to pick up the confirmation rules and the audit event. Everything else is
    // an ordinary profile edit. Both may arrive in one request.
    let user = null;
    if (Object.keys(profileFields).length > 0) {
        user = await user_service_1.UserService.updateUser(req.params.id, profileFields);
    }
    if (typeof status === 'boolean') {
        user = await credential_service_1.CredentialService.setStatus(req.params.id, status, req.user.id, statusReason);
    }
    if (!user) {
        user = await user_service_1.UserService.getUserById(req.params.id);
    }
    res.status(200).json({ success: true, data: user });
});
exports.updateProfile = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await user_service_1.UserService.updateProfile(req.user.id, req.body);
    res.status(200).json({
        success: true,
        data: user,
        message: 'Profile updated successfully',
    });
});
// --- CSV ---------------------------------------------------------------------
exports.downloadImportTemplate = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const role = roleFromParam(req.params.role);
    const prefix = role === 'STUDENT' ? 'students' : 'instructors';
    sendCsv(res, `${prefix}-import-template.csv`, csv_import_service_1.CsvImportService.template(role));
});
/** Dry run. Writes nothing — powers the wizard's validation and preview steps. */
exports.validateImport = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const role = roleFromParam(req.params.role);
    const report = await csv_import_service_1.CsvImportService.validate(readCsvBody(req), role);
    res.status(200).json({ success: true, data: report });
});
exports.commitImport = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const role = roleFromParam(req.params.role);
    const report = await csv_import_service_1.CsvImportService.import(readCsvBody(req), role, req.user.id);
    res.status(200).json({
        success: true,
        data: report,
        message: `${report.imported} of ${report.totalRows} row(s) imported.`,
    });
});
/** Returns only the failing rows, annotated with their errors, for re-upload. */
exports.downloadFailedRows = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const role = roleFromParam(req.params.role);
    const report = await csv_import_service_1.CsvImportService.validate(readCsvBody(req), role);
    const prefix = role === 'STUDENT' ? 'students' : 'instructors';
    sendCsv(res, `${prefix}-failed-rows.csv`, csv_import_service_1.CsvImportService.failedRowsCsv(report));
});
exports.exportUsers = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const role = roleFromParam(req.params.role);
    const filters = readFilters(req);
    if (role === 'STUDENT') {
        sendCsv(res, csv_export_service_1.CsvExportService.filename('students'), await csv_export_service_1.CsvExportService.exportStudents(filters));
    }
    else {
        sendCsv(res, csv_export_service_1.CsvExportService.filename('instructors'), await csv_export_service_1.CsvExportService.exportInstructors(filters));
    }
});
// --- Credential management ---------------------------------------------------
/**
 * Aggregate credential-delivery metrics for the admin dashboard.
 * Declared on a fixed path, so it must be routed before `/:id`.
 */
exports.getCredentialStatus = (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const stats = await credential_service_1.CredentialService.getCredentialStats();
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
exports.resetAndSendCredentials = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await credential_service_1.CredentialService.resetCredentials(req.params.id, req.user.id, {
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
exports.resetPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await credential_service_1.CredentialService.resetCredentials(req.params.id, req.user.id, {
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
exports.getEnrollmentHistory = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const events = await enrollment_history_service_1.EnrollmentHistoryService.listForUser(req.params.id);
    res.status(200).json({ success: true, data: events });
});
