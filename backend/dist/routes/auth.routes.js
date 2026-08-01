"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_controller_1 = require("../controllers/auth.controller");
const validate_middleware_1 = require("../middlewares/validate.middleware");
const auth_validator_1 = require("../validators/auth.validator");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
/**
 * Credential endpoints get a tighter bucket than the global 100/15min limiter.
 * `skipSuccessfulRequests` means a legitimate user logging in repeatedly is
 * never throttled — only repeated *failures* consume the budget.
 */
const credentialLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    message: {
        success: false,
        message: 'Too many failed attempts. Please wait a few minutes and try again.',
    },
});
router.post('/login', credentialLimiter, (0, validate_middleware_1.validate)(auth_validator_1.loginSchema), auth_controller_1.login);
router.post('/logout', auth_middleware_1.authenticate, auth_controller_1.logout);
router.get('/me', auth_middleware_1.authenticate, auth_controller_1.getMe);
router.post('/change-password', auth_middleware_1.authenticate, credentialLimiter, (0, validate_middleware_1.validate)(auth_validator_1.changePasswordSchema), auth_controller_1.changePassword);
exports.default = router;
