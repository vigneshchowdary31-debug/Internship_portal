import prisma from '../config/db';
import bcrypt from 'bcrypt';
import { AppError } from '../utils/AppError';
import { generateToken } from '../utils/jwt';
import { PasswordGeneratorService } from './password.service';
import { EnrollmentHistoryService } from './enrollment-history.service';

const BCRYPT_ROUNDS = 10;

export class AuthService {
  static async login(email: string, passwordString: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user || !user.status) {
      throw new AppError('Invalid email or password', 401);
    }

    const isMatch = await bcrypt.compare(passwordString, user.password);

    if (!isMatch) {
      throw new AppError('Invalid email or password', 401);
    }

    const token = generateToken({ id: user.id, role: user.role });

    // Stamp the very first successful login exactly once. Guarded on the
    // column rather than on the event table so this costs one UPDATE on login
    // number one and nothing at all on every login after it.
    if (!user.firstLoginAt) {
      await prisma.user
        .update({ where: { id: user.id }, data: { firstLoginAt: new Date() } })
        .catch((error) =>
          console.error('[auth] Could not stamp firstLoginAt:', error?.message || error)
        );
      await EnrollmentHistoryService.record({ userId: user.id, type: 'FIRST_LOGIN' });
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        // Drives the client-side redirect to /change-password. The server
        // enforces the same rule independently (requirePasswordChanged), so a
        // client that ignores this flag still cannot reach anything.
        mustChangePassword: user.mustChangePassword,
      },
      token,
    };
  }

  /**
   * One-time / self-service password change.
   *
   * Requires the current password even when `mustChangePassword` is set: the
   * temporary credential arrived by email, and proving possession of it is what
   * stops anyone who merely holds a session from silently taking the account
   * over.
   */
  static async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new AppError('Your current password is incorrect', 400);
    }

    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      throw new AppError('Your new password must be different from your current password', 400);
    }

    const { valid, errors } = PasswordGeneratorService.validate(newPassword);
    if (!valid) {
      throw new AppError(errors.join('. '), 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mustChangePassword: true,
        passwordChangedAt: true,
      },
    });

    await EnrollmentHistoryService.record({
      userId,
      type: 'PASSWORD_CHANGED',
      detail: 'Temporary password replaced by the user',
      actorId: null, // self-service
    });

    return updated;
  }
}
