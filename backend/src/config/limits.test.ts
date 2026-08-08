import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Config is read at import time, so each case re-imports with a fresh module
 * registry rather than trying to mutate a frozen object.
 */
async function loadLimits(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '');
    else vi.stubEnv(key, value);
  }
  return (await import('./limits')).limits;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('defaults preserve pre-Phase-7 behaviour', () => {
  it('uses the original values when nothing is set', async () => {
    const limits = await loadLimits({});

    // An environment that sets nothing must behave exactly as it did before
    // this file existed — otherwise "extract the constants" is a behaviour
    // change wearing a refactor's clothes.
    expect(limits.email.queueMaxLength).toBe(5000);
    expect(limits.email.maxAttempts).toBe(3);
    expect(limits.grading.bulkMaxItems).toBe(100);
    expect(limits.grading.bulkRateMax).toBe(20);
  });
});

describe('environment overrides', () => {
  it('takes a valid override', async () => {
    const limits = await loadLimits({ BULK_GRADE_MAX_ITEMS: '250' });
    expect(limits.grading.bulkMaxItems).toBe(250);
  });

  it('reads several independently', async () => {
    const limits = await loadLimits({
      EMAIL_QUEUE_MAX_LENGTH: '100',
      EMAIL_MAX_ATTEMPTS: '5',
    });

    expect(limits.email.queueMaxLength).toBe(100);
    expect(limits.email.maxAttempts).toBe(5);
    expect(limits.grading.bulkMaxItems).toBe(100); // untouched
  });
});

describe('bad input falls back rather than disabling the guard', () => {
  it.each([
    ['not-a-number', 'a typo'],
    ['0', 'zero, which would block every request'],
    ['-5', 'a negative'],
    ['1.5', 'a fraction'],
  ])('ignores %s (%s) and warns', async (value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const limits = await loadLimits({ BULK_GRADE_MAX_ITEMS: value });

    // A limit that silently became NaN would disable the guard it exists to
    // enforce — the failure mode this fallback is for.
    expect(limits.grading.bulkMaxItems).toBe(100);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('treats an empty string as unset, without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const limits = await loadLimits({ BULK_GRADE_MAX_ITEMS: '' });

    // An unset variable in a deployment template is normal, not a mistake.
    expect(limits.grading.bulkMaxItems).toBe(100);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
