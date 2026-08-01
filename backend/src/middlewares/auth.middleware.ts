import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';
import prisma from '../config/db';

/** The authenticated principal attached to every request by `authenticate`. */
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT';
  status: boolean;
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Endpoints reachable while a user still owes a password change.
 *
 * Deliberately tiny: enough to load the shell, change the password, and leave.
 * Matched against the path with the query string stripped.
 */
const PASSWORD_CHANGE_ALLOWLIST: { method: string; path: string }[] = [
  { method: 'POST', path: '/api/auth/change-password' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'GET', path: '/api/auth/me' },
  { method: 'PATCH', path: '/api/users/profile' },
];

export function isAllowedDuringPasswordChange(method: string, originalUrl: string): boolean {
  const path = originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
  return PASSWORD_CHANGE_ALLOWLIST.some(
    (entry) => entry.method === method.toUpperCase() && entry.path === path
  );
}

/**
 * Verifies the bearer token and loads the current user.
 *
 * The user row is re-read on every request rather than trusted from the token,
 * so deactivation and a completed password change both take effect immediately
 * instead of at the next token expiry.
 *
 * The forced-password-change gate lives here, not in a separately-mounted
 * middleware, because `authenticate` is the one place `req.user` is populated —
 * enforcing it here means a newly added protected route is covered by default
 * rather than by remembering to chain another guard onto it.
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }

  let currentUser: AuthenticatedUser | null;
  try {
    const decoded = verifyToken(token);

    currentUser = (await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        mustChangePassword: true,
      },
    })) as AuthenticatedUser | null;
  } catch (error) {
    return next(new AppError('Invalid token or token has expired', 401));
  }

  if (!currentUser) {
    return next(new AppError('The user belonging to this token does no longer exist.', 401));
  }

  if (!currentUser.status) {
    return next(new AppError('This account has been deactivated.', 403));
  }

  req.user = currentUser;

  if (currentUser.mustChangePassword && !isAllowedDuringPasswordChange(req.method, req.originalUrl)) {
    return next(new AppError('Password change required.', 403));
  }

  next();
};

export const restrictTo = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};
