"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const user_controller_1 = require("../controllers/user.controller");
const validate_middleware_1 = require("../middlewares/validate.middleware");
const user_validator_1 = require("../validators/user.validator");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
/**
 * CSV body parser.
 *
 * Scoped to the import routes rather than added globally so the app-wide 10 kB
 * JSON limit still protects every other endpoint. `type: 'text/csv'` is the
 * MIME check: a request sent as anything else leaves `req.body` as an empty
 * object and is rejected before parsing.
 *
 * 2 MB comfortably holds the 500-row cap enforced by CsvImportService.
 */
const csvBody = (0, express_1.text)({ type: 'text/csv', limit: '2mb' });
/**
 * Bulk import is far more expensive than a normal request — it writes up to 500
 * rows and sends up to 500 emails — so it gets its own tight bucket on top of
 * the global limiter.
 */
const bulkImportLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        message: 'Too many bulk imports. Please wait a few minutes before importing again.',
    },
});
/** Dry-run validation is safe and gets used repeatedly in the wizard. */
const csvValidateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: {
        success: false,
        message: 'Too many validation attempts. Please wait a few minutes and try again.',
    },
});
/**
 * Password resets and resends mint or consume credentials, so they get a
 * tighter bucket than ordinary admin CRUD. Generous enough for real remediation
 * work across a cohort, tight enough that a compromised admin session cannot
 * churn every account's password in seconds.
 */
const credentialActionLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: {
        success: false,
        message: 'Too many credential actions. Please wait a few minutes and try again.',
    },
});
router.use(auth_middleware_1.authenticate);
// All authenticated users can update their own profile
router.patch('/profile', (0, validate_middleware_1.validate)(user_validator_1.updateProfileSchema), user_controller_1.updateProfile);
// Admin-only routes
router.use((0, auth_middleware_1.restrictTo)('ADMIN'));
// --- Enrollment --------------------------------------------------------------
router.post('/enroll/student', (0, validate_middleware_1.validate)(user_validator_1.enrollStudentSchema), user_controller_1.enrollStudent);
router.post('/enroll/instructor', (0, validate_middleware_1.validate)(user_validator_1.enrollInstructorSchema), user_controller_1.enrollInstructor);
// --- CSV -------------------------------------------------------------------
// Declared before '/:id' so "import" and "export" are never captured as an id.
router.get('/import/:role/template', (0, validate_middleware_1.validate)(user_validator_1.csvImportRoleSchema), user_controller_1.downloadImportTemplate);
router.post('/import/:role/validate', csvValidateLimiter, csvBody, (0, validate_middleware_1.validate)(user_validator_1.csvImportRoleSchema), user_controller_1.validateImport);
router.post('/import/:role/failed-rows', csvValidateLimiter, csvBody, (0, validate_middleware_1.validate)(user_validator_1.csvImportRoleSchema), user_controller_1.downloadFailedRows);
router.post('/import/:role', bulkImportLimiter, csvBody, (0, validate_middleware_1.validate)(user_validator_1.csvImportRoleSchema), user_controller_1.commitImport);
router.get('/export/:role', (0, validate_middleware_1.validate)(user_validator_1.csvImportRoleSchema), user_controller_1.exportUsers);
// --- Credential management ---------------------------------------------------
// '/credential-status' is a fixed path and MUST precede '/:id', otherwise the
// literal string would be captured as a user id and fail UUID validation.
router.get('/credential-status', user_controller_1.getCredentialStatus);
router.post('/:id/reset-and-send-credentials', credentialActionLimiter, (0, validate_middleware_1.validate)(user_validator_1.userIdParamSchema), user_controller_1.resetAndSendCredentials);
router.post('/:id/reset-password', credentialActionLimiter, (0, validate_middleware_1.validate)(user_validator_1.userIdParamSchema), user_controller_1.resetPassword);
/**
 * Deprecated alias for the old, misleadingly-named endpoint.
 *
 * It used to return 409 and refuse. It now performs the reset it always should
 * have, so any client still pointing here keeps working — and gets the better
 * behaviour rather than a dead end.
 */
router.post('/:id/resend-credentials', credentialActionLimiter, (0, validate_middleware_1.validate)(user_validator_1.userIdParamSchema), user_controller_1.resetAndSendCredentials);
router.get('/:id/enrollment-history', (0, validate_middleware_1.validate)(user_validator_1.userIdParamSchema), user_controller_1.getEnrollmentHistory);
// --- CRUD --------------------------------------------------------------------
router.post('/', (0, validate_middleware_1.validate)(user_validator_1.createUserSchema), user_controller_1.createUser);
router.get('/', user_controller_1.getUsers);
router.get('/:id', user_controller_1.getUserById);
router.patch('/:id', (0, validate_middleware_1.validate)(user_validator_1.updateUserSchema), user_controller_1.updateUser);
exports.default = router;
