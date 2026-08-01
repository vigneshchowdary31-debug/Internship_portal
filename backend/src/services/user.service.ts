import prisma from '../config/db';
import { AppError } from '../utils/AppError';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PasswordGeneratorService } from './password.service';
import { EnrollmentHistoryService } from './enrollment-history.service';

const BCRYPT_ROUNDS = 10;

/** Columns safe to return from any user-facing endpoint. Never includes `password`. */
export const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  niatId: true,
  universityName: true,
  employeeId: true,
  techStackId: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  firstLoginAt: true,
  credentialStatus: true,
  credentialSentAt: true,
  credentialFailureReason: true,
  credentialRetryCount: true,
  credentialLastRetryAt: true,
  techStack: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export interface EnrollUserInput {
  name: string;
  email: string;
  role: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT';
  niatId?: string | null;
  universityName?: string | null;
  employeeId?: string | null;
  techStackId?: string | null;
  /**
   * Optional explicit password. Present only for backward compatibility with
   * callers that predate auto-generation; the enrollment UI never sends one.
   */
  password?: string;
  /** Admin performing the enrollment, recorded as "Created By" in the audit trail. */
  actorId?: string | null;
}

/** A user row as returned by every read path — password columns excluded by construction. */
export type PublicUser = Prisma.UserGetPayload<{ select: typeof USER_PUBLIC_SELECT }>;

export interface EnrollUserResult {
  user: PublicUser;
  /**
   * Plaintext one-time password. Returned ONLY to the immediate caller so it
   * can be handed to the enrollment email. It is never persisted in plaintext,
   * never logged, and never returned by any read endpoint.
   */
  temporaryPassword: string;
  /** True when the password was generated rather than supplied by the caller. */
  generated: boolean;
}

export interface UserFilters {
  role?: string;
  techStackId?: string;
  universityName?: string;
  /** 'active' | 'inactive'; anything else means no status filter. */
  status?: string;
  /** 'PENDING' | 'SENT' | 'FAILED'. */
  credentialStatus?: string;
  /** Case-insensitive match across name, email, NIAT ID and employee ID. */
  search?: string;
}

export class UserService {
  /**
   * Builds the Prisma `where` clause for the admin list views.
   * Shared by the list endpoint and the CSV export so the two can never
   * disagree about what "the current filter" means.
   */
  static buildWhere(filters: UserFilters = {}): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (filters.role) where.role = filters.role as any;
    if (filters.techStackId) where.techStackId = filters.techStackId;
    if (filters.universityName) {
      where.universityName = { equals: filters.universityName, mode: 'insensitive' };
    }
    if (filters.status === 'active') where.status = true;
    if (filters.status === 'inactive') where.status = false;
    if (filters.credentialStatus) where.credentialStatus = filters.credentialStatus as any;

    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { niatId: { contains: search, mode: 'insensitive' } },
        { employeeId: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /**
   * Checks every uniqueness constraint in ONE query and reports all conflicts
   * at once, so an admin fixing a form is not told about `email` and then, on
   * resubmit, about `niatId`.
   *
   * This is a pre-check for good error messages, not the enforcement mechanism:
   * the database unique indexes remain the actual guarantee, and a concurrent
   * insert between this check and the write still surfaces as P2002.
   */
  static async findConflicts(input: {
    email?: string | null;
    niatId?: string | null;
    employeeId?: string | null;
    excludeUserId?: string;
  }): Promise<string[]> {
    const or: Prisma.UserWhereInput[] = [];
    if (input.email) or.push({ email: { equals: input.email, mode: 'insensitive' } });
    if (input.niatId) or.push({ niatId: { equals: input.niatId, mode: 'insensitive' } });
    if (input.employeeId) or.push({ employeeId: { equals: input.employeeId, mode: 'insensitive' } });
    if (or.length === 0) return [];

    const matches = await prisma.user.findMany({
      where: {
        OR: or,
        ...(input.excludeUserId ? { NOT: { id: input.excludeUserId } } : {}),
      },
      select: { id: true, email: true, niatId: true, employeeId: true },
    });

    const conflicts: string[] = [];
    const eq = (a?: string | null, b?: string | null) =>
      !!a && !!b && a.toLowerCase() === b.toLowerCase();

    for (const match of matches) {
      if (eq(match.email, input.email)) conflicts.push('A user with this email already exists');
      if (eq(match.niatId, input.niatId)) conflicts.push('A user with this NIAT ID already exists');
      if (eq(match.employeeId, input.employeeId)) {
        conflicts.push('A user with this Employee ID already exists');
      }
    }

    return [...new Set(conflicts)];
  }

  /**
   * Creates a user and returns the plaintext password alongside it.
   *
   * When `password` is omitted (the enrollment path) a cryptographically secure
   * one is generated. It is hashed before the row is written; the plaintext
   * exists only in this function's return value, for exactly one purpose —
   * handing to the enrollment email.
   */
  static async enrollUser(data: EnrollUserInput): Promise<EnrollUserResult> {
    const email = data.email.trim().toLowerCase();
    const niatId = data.niatId?.trim() || null;
    const employeeId = data.employeeId?.trim() || null;

    const conflicts = await this.findConflicts({ email, niatId, employeeId });
    if (conflicts.length > 0) {
      throw new AppError(conflicts.join('. '), 400);
    }

    if (data.techStackId) {
      const techStack = await prisma.techStack.findUnique({ where: { id: data.techStackId } });
      if (!techStack) throw new AppError('The selected tech stack does not exist', 400);
    }

    const generated = !data.password;
    const temporaryPassword = data.password || PasswordGeneratorService.generate();
    const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        name: data.name.trim(),
        email,
        password: hashedPassword,
        role: data.role,
        niatId,
        universityName: data.universityName?.trim() || null,
        employeeId,
        techStackId: data.techStackId || null,
        // Enrolled accounts always start locked behind the one-time change.
        mustChangePassword: true,
        passwordChangedAt: null,
        // Delivery has not been attempted yet; the email path updates this.
        credentialStatus: 'PENDING',
      },
      select: USER_PUBLIC_SELECT,
    });

    // Two events, not one: "the account exists" and "a credential was minted"
    // are separate facts, and a later reset produces CREDENTIAL_GENERATED again
    // without a second ENROLLED. The timeline reads correctly either way.
    await EnrollmentHistoryService.recordMany([
      {
        userId: user.id,
        type: 'ENROLLED',
        detail: `Enrolled as ${data.role}`,
        actorId: data.actorId ?? null,
      },
      {
        userId: user.id,
        type: 'CREDENTIAL_GENERATED',
        detail: generated
          ? 'A temporary password was generated automatically'
          : 'An explicit password was supplied by the caller',
        actorId: data.actorId ?? null,
      },
    ]);

    return { user, temporaryPassword, generated };
  }

  /**
   * Backward-compatible creation entry point.
   *
   * Pre-existing callers (and any integration posting to `POST /api/users`
   * with a password) keep working unchanged; the plaintext password is simply
   * discarded rather than returned.
   */
  static async createUser(data: EnrollUserInput) {
    const { user } = await this.enrollUser(data);
    return user;
  }

  static async getUsers(filtersOrRole?: string | UserFilters) {
    // Legacy signature: getUsers('STUDENT'). Kept so existing callers and the
    // `GET /api/users?role=X` contract continue to behave identically.
    const filters: UserFilters =
      typeof filtersOrRole === 'string' ? { role: filtersOrRole } : filtersOrRole || {};

    return prisma.user.findMany({
      where: this.buildWhere(filters),
      select: USER_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getUserById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_PUBLIC_SELECT,
        studentBatches: { include: { batch: true } },
        instructorBatches: { include: { batch: true } },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return user;
  }

  /**
   * Admin update.
   *
   * Fields are picked explicitly rather than spread from the request body.
   * Forwarding the raw body would let any `Prisma.UserUpdateInput` key through —
   * including `password`, which would be written unhashed and permanently lock
   * the account out of login.
   */
  static async updateUser(
    id: string,
    data: {
      name?: string;
      email?: string;
      status?: boolean;
      role?: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT';
      niatId?: string | null;
      universityName?: string | null;
      employeeId?: string | null;
      techStackId?: string | null;
    }
  ) {
    const userExists = await prisma.user.findUnique({ where: { id } });
    if (!userExists) {
      throw new AppError('User not found', 404);
    }

    const email = data.email?.trim().toLowerCase();
    const niatId = data.niatId === null ? null : data.niatId?.trim();
    const employeeId = data.employeeId === null ? null : data.employeeId?.trim();

    const conflicts = await this.findConflicts({ email, niatId, employeeId, excludeUserId: id });
    if (conflicts.length > 0) {
      throw new AppError(conflicts.join('. '), 400);
    }

    if (data.techStackId) {
      const techStack = await prisma.techStack.findUnique({ where: { id: data.techStackId } });
      if (!techStack) throw new AppError('The selected tech stack does not exist', 400);
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (email !== undefined) updateData.email = email;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.niatId !== undefined) updateData.niatId = niatId || null;
    if (data.universityName !== undefined) {
      updateData.universityName = data.universityName?.trim() || null;
    }
    if (data.employeeId !== undefined) updateData.employeeId = employeeId || null;
    if (data.techStackId !== undefined) {
      updateData.techStack = data.techStackId
        ? { connect: { id: data.techStackId } }
        : { disconnect: true };
    }

    return prisma.user.update({
      where: { id },
      data: updateData,
      select: USER_PUBLIC_SELECT,
    });
  }

  /**
   * Self-service profile update.
   *
   * A password set here is one the user chose, so it clears the forced-change
   * flag and stamps `passwordChangedAt` — otherwise someone could satisfy the
   * requirement here and still be bounced back to the change-password screen.
   */
  static async updateProfile(id: string, data: { name?: string; password?: string }) {
    const userExists = await prisma.user.findUnique({ where: { id } });
    if (!userExists) {
      throw new AppError('User not found', 404);
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (data.name) updateData.name = data.name.trim();

    if (data.password) {
      const { valid, errors } = PasswordGeneratorService.validate(data.password);
      if (!valid) throw new AppError(errors.join('. '), 400);

      updateData.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
      updateData.mustChangePassword = false;
      updateData.passwordChangedAt = new Date();
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: USER_PUBLIC_SELECT,
    });

    await EnrollmentHistoryService.record({
      userId: id,
      type: data.password ? 'PASSWORD_CHANGED' : 'PROFILE_UPDATED',
      detail: data.password ? 'Password changed from the profile screen' : null,
      actorId: null, // self-service
    });

    return updated;
  }
}
