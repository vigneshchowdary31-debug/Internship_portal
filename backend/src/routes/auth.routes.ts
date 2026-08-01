import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, getMe, changePassword } from '../controllers/auth.controller';
import { validate } from '../middlewares/validate.middleware';
import { loginSchema, changePasswordSchema } from '../validators/auth.validator';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

/**
 * Credential endpoints get a tighter bucket than the global 100/15min limiter.
 * `skipSuccessfulRequests` means a legitimate user logging in repeatedly is
 * never throttled — only repeated *failures* consume the budget.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many failed attempts. Please wait a few minutes and try again.',
  },
});

router.post('/login', credentialLimiter, validate(loginSchema), login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.post(
  '/change-password',
  authenticate,
  credentialLimiter,
  validate(changePasswordSchema),
  changePassword
);

export default router;
