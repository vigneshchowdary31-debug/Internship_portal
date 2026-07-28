"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_controller_1 = require("../controllers/session.controller");
const validate_middleware_1 = require("../middlewares/validate.middleware");
const session_validator_1 = require("../validators/session.validator");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Instructors and Admins can create sessions
router.post('/', (0, auth_middleware_1.restrictTo)('ADMIN', 'INSTRUCTOR'), (0, validate_middleware_1.validate)(session_validator_1.createSessionSchema), session_controller_1.createSession);
// All roles can view sessions (filtered by query)
router.get('/', session_controller_1.getSessions);
// Update session (Admin or Instructor)
router.patch('/:id', (0, auth_middleware_1.restrictTo)('ADMIN', 'INSTRUCTOR'), session_controller_1.updateSession);
// Cancel session (Admin or Instructor)
router.patch('/:id/cancel', (0, auth_middleware_1.restrictTo)('ADMIN', 'INSTRUCTOR'), session_controller_1.cancelSession);
// Only admins or the instructor who created it should delete it. 
// For MVP, restricting to ADMIN and INSTRUCTOR is sufficient.
router.delete('/:id', (0, auth_middleware_1.restrictTo)('ADMIN', 'INSTRUCTOR'), session_controller_1.deleteSession);
exports.default = router;
