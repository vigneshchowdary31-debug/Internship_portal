import crypto from 'crypto';

/**
 * Password generation and policy enforcement.
 *
 * Two separate concerns live here on purpose:
 *   - generate()  — mints the one-time password an enrolled user receives.
 *   - validate()  — enforces the policy a user's *chosen* password must meet.
 *
 * A generated password is the only plaintext credential this system ever
 * produces. It exists in memory exactly long enough to be hashed and handed to
 * the enrollment email, and is never logged, persisted, returned by any read
 * endpoint, or included in any export.
 */

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz'; // no l
const NUMBERS = '23456789'; // no 0 or 1
const SPECIALS = '!@#$%^&*-_=+?';
const ALL = UPPERCASE + LOWERCASE + NUMBERS + SPECIALS;

/** Policy for passwords a user chooses themselves (Part 6). */
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  description:
    'At least 8 characters, including an uppercase letter, a lowercase letter, a number and a special character.',
} as const;

export class PasswordGeneratorService {
  /**
   * Cryptographically secure random integer in [0, max).
   *
   * `crypto.randomInt` is rejection-sampled by Node, so unlike
   * `randomBytes()[0] % max` it carries no modulo bias.
   */
  private static randomInt(max: number): number {
    return crypto.randomInt(0, max);
  }

  /** Fisher–Yates using a CSPRNG for every swap. */
  private static shuffle(chars: string[]): string[] {
    for (let i = chars.length - 1; i > 0; i--) {
      const j = this.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars;
  }

  private static pick(pool: string): string {
    return pool[this.randomInt(pool.length)];
  }

  /**
   * Generates a 12–16 character password guaranteed to contain at least one
   * character from each required class.
   *
   * Ambiguous glyphs (0/O, 1/l/I) are excluded from the alphabet: these
   * passwords get transcribed by hand from an email into a login form, and a
   * password that cannot be read reliably generates support tickets instead of
   * logins. The remaining alphabet is 69 characters, so a 12-character password
   * still carries ~73 bits of entropy — far beyond what a one-time credential
   * with a forced rotation on first use requires.
   */
  static generate(): string {
    const length = 12 + this.randomInt(5); // 12..16 inclusive

    // Seed one of each required class so the result can never fail its own policy.
    const chars: string[] = [
      this.pick(UPPERCASE),
      this.pick(LOWERCASE),
      this.pick(NUMBERS),
      this.pick(SPECIALS),
    ];

    while (chars.length < length) chars.push(this.pick(ALL));

    // Without this the first four positions would always be U-l-n-s.
    return this.shuffle(chars).join('');
  }

  /**
   * Validates a user-chosen password against the policy.
   * Returns every failure at once rather than the first, so the UI can show a
   * complete checklist instead of making the user guess one rule at a time.
   */
  static validate(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < PASSWORD_POLICY.minLength) {
      errors.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters long`);
    }
    if (password.length > PASSWORD_POLICY.maxLength) {
      errors.push(`Password must be at most ${PASSWORD_POLICY.maxLength} characters long`);
    }
    if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
    if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must contain a special character');

    return { valid: errors.length === 0, errors };
  }
}
