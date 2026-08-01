import { Router, text } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createUser,
  enrollStudent,
  enrollInstructor,
  getUsers,
  getUserById,
  updateUser,
  updateProfile,
  downloadImportTemplate,
  validateImport,
  commitImport,
  downloadFailedRows,
  exportUsers,
  getCredentialStatus,
  resetAndSendCredentials,
  resetPassword,
  getEnrollmentHistory,
} from '../controllers/user.controller';
import { validate } from '../middlewares/validate.middleware';
import {
  createUserSchema,
  updateUserSchema,
  updateProfileSchema,
  enrollStudentSchema,
  enrollInstructorSchema,
  csvImportRoleSchema,
  userIdParamSchema,
} from '../validators/user.validator';

import { authenticate, restrictTo } from '../middlewares/auth.middleware';

const router = Router();

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
const csvBody = text({ type: 'text/csv', limit: '2mb' });

/**
 * Bulk import is far more expensive than a normal request — it writes up to 500
 * rows and sends up to 500 emails — so it gets its own tight bucket on top of
 * the global limiter.
 */
const bulkImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many bulk imports. Please wait a few minutes before importing again.',
  },
});

/** Dry-run validation is safe and gets used repeatedly in the wizard. */
const csvValidateLimiter = rateLimit({
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
const credentialActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: 'Too many credential actions. Please wait a few minutes and try again.',
  },
});

router.use(authenticate);

// All authenticated users can update their own profile
router.patch('/profile', validate(updateProfileSchema), updateProfile);

// Admin-only routes
router.use(restrictTo('ADMIN'));

// --- Enrollment --------------------------------------------------------------
router.post('/enroll/student', validate(enrollStudentSchema), enrollStudent);
router.post('/enroll/instructor', validate(enrollInstructorSchema), enrollInstructor);

// --- CSV -------------------------------------------------------------------
// Declared before '/:id' so "import" and "export" are never captured as an id.
router.get('/import/:role/template', validate(csvImportRoleSchema), downloadImportTemplate);
router.post(
  '/import/:role/validate',
  csvValidateLimiter,
  csvBody,
  validate(csvImportRoleSchema),
  validateImport
);
router.post(
  '/import/:role/failed-rows',
  csvValidateLimiter,
  csvBody,
  validate(csvImportRoleSchema),
  downloadFailedRows
);
router.post(
  '/import/:role',
  bulkImportLimiter,
  csvBody,
  validate(csvImportRoleSchema),
  commitImport
);
router.get('/export/:role', validate(csvImportRoleSchema), exportUsers);

// --- Credential management ---------------------------------------------------
// '/credential-status' is a fixed path and MUST precede '/:id', otherwise the
// literal string would be captured as a user id and fail UUID validation.
router.get('/credential-status', getCredentialStatus);
router.post(
  '/:id/reset-and-send-credentials',
  credentialActionLimiter,
  validate(userIdParamSchema),
  resetAndSendCredentials
);
router.post(
  '/:id/reset-password',
  credentialActionLimiter,
  validate(userIdParamSchema),
  resetPassword
);
/**
 * Deprecated alias for the old, misleadingly-named endpoint.
 *
 * It used to return 409 and refuse. It now performs the reset it always should
 * have, so any client still pointing here keeps working — and gets the better
 * behaviour rather than a dead end.
 */
router.post(
  '/:id/resend-credentials',
  credentialActionLimiter,
  validate(userIdParamSchema),
  resetAndSendCredentials
);
router.get('/:id/enrollment-history', validate(userIdParamSchema), getEnrollmentHistory);

// --- CRUD --------------------------------------------------------------------
router.post('/', validate(createUserSchema), createUser);
router.get('/', getUsers);
router.get('/:id', getUserById);
router.patch('/:id', validate(updateUserSchema), updateUser);

export default router;
