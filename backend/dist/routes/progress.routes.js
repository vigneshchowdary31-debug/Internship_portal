"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const progress_controller_1 = require("../controllers/progress.controller");
const validate_middleware_1 = require("../middlewares/validate.middleware");
const progress_validator_1 = require("../validators/progress.validator");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Everyone can view student progress
router.get('/student/:studentId', progress_controller_1.getStudentProgress);
// Only Admin and Instructor can update progress and view overviews
router.use((0, auth_middleware_1.restrictTo)('ADMIN', 'INSTRUCTOR'));
router.get('/overview', progress_controller_1.getOverview);
router.post('/', (0, validate_middleware_1.validate)(progress_validator_1.updateProgressSchema), progress_controller_1.updateProgress);
// we can use POST as an upsert endpoint for simplicity. Or PATCH. 
router.patch('/', (0, validate_middleware_1.validate)(progress_validator_1.updateProgressSchema), progress_controller_1.updateProgress);
exports.default = router;
