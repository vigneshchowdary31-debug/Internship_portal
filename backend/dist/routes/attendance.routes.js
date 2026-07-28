"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const attendance_controller_1 = require("../controllers/attendance.controller");
const validate_middleware_1 = require("../middlewares/validate.middleware");
const attendance_validator_1 = require("../validators/attendance.validator");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Everyone can view student attendance (Student can view their own, Admin/Inst can view any)
router.get('/student/:studentId', attendance_controller_1.getStudentAttendance);
// Only Admin and Instructor can mark/update attendance and view session attendance/overviews
router.use((0, auth_middleware_1.restrictTo)('ADMIN', 'INSTRUCTOR'));
router.get('/overview', attendance_controller_1.getOverview);
router.get('/session/:sessionId', attendance_controller_1.getSessionAttendance);
router.post('/', (0, validate_middleware_1.validate)(attendance_validator_1.markAttendanceSchema), attendance_controller_1.markAttendance);
router.patch('/:id', (0, validate_middleware_1.validate)(attendance_validator_1.updateAttendanceSchema), attendance_controller_1.updateAttendance);
exports.default = router;
