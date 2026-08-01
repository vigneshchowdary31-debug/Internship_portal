import { describe, it, expect } from 'vitest';
import { PasswordGeneratorService } from './password.service';

describe('PasswordGeneratorService.generate', () => {
  const samples = Array.from({ length: 300 }, () => PasswordGeneratorService.generate());

  it('always produces a 12-16 character password', () => {
    for (const password of samples) {
      expect(password.length).toBeGreaterThanOrEqual(12);
      expect(password.length).toBeLessThanOrEqual(16);
    }
  });

  it('always includes every required character class', () => {
    for (const password of samples) {
      expect(password, `failed on "${password}"`).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('always satisfies its own validation policy', () => {
    for (const password of samples) {
      expect(PasswordGeneratorService.validate(password).valid).toBe(true);
    }
  });

  it('excludes visually ambiguous characters', () => {
    for (const password of samples) {
      expect(password).not.toMatch(/[O0Il1]/);
    }
  });

  it('does not place the seeded classes in a fixed order', () => {
    // Without the shuffle every password would start upper-lower-digit-special.
    const firstChars = new Set(samples.map((p) => p[0]));
    expect(firstChars.size).toBeGreaterThan(4);
  });

  it('produces distinct values', () => {
    expect(new Set(samples).size).toBe(samples.length);
  });
});

describe('PasswordGeneratorService.validate', () => {
  it('accepts a compliant password', () => {
    expect(PasswordGeneratorService.validate('Str0ng!Pass').valid).toBe(true);
  });

  it('reports every violation at once rather than only the first', () => {
    const { valid, errors } = PasswordGeneratorService.validate('abc');
    expect(valid).toBe(false);
    expect(errors).toHaveLength(4); // length, uppercase, number, special
  });

  it.each([
    ['Sh0rt!', false, 'under 8 characters'],
    ['Exact8A!', true, 'exactly 8 characters is allowed'],
    ['nouppercase1!', false, 'missing uppercase'],
    ['NOLOWERCASE1!', false, 'missing lowercase'],
    ['NoNumbers!!', false, 'missing number'],
    ['NoSpecial123', false, 'missing special'],
    ['Valid1Pass!', true, 'compliant'],
  ])('validate(%s) -> %s (%s)', (password, expected) => {
    expect(PasswordGeneratorService.validate(password).valid).toBe(expected);
  });

  it('rejects a password beyond the maximum length', () => {
    expect(PasswordGeneratorService.validate(`Aa1!${'x'.repeat(200)}`).valid).toBe(false);
  });
});
