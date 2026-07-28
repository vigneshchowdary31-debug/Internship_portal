"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("../controllers/user.controller");
const validate_middleware_1 = require("../middlewares/validate.middleware");
const user_validator_1 = require("../validators/user.validator");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// All authenticated users can update their own profile
router.patch('/profile', (0, validate_middleware_1.validate)(user_validator_1.updateProfileSchema), user_controller_1.updateProfile);
// Admin-only routes
router.use((0, auth_middleware_1.restrictTo)('ADMIN'));
router.post('/', (0, validate_middleware_1.validate)(user_validator_1.createUserSchema), user_controller_1.createUser);
router.get('/', user_controller_1.getUsers);
router.get('/:id', user_controller_1.getUserById);
router.patch('/:id', (0, validate_middleware_1.validate)(user_validator_1.updateUserSchema), user_controller_1.updateUser);
exports.default = router;
