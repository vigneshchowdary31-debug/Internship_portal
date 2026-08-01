import { describe, it, expect } from 'vitest';
import { GmailApiMailer } from './GmailApiMailer';

/**
 * Regression cover for the scope check.
 *
 * The bug this guards against: verification used `users.getProfile`, which
 * requires a *read* scope. A correct send-only token therefore always failed
 * with "403 insufficient authentication scopes", and the classifier reported
 * that the token lacked gmail.send — the opposite of the truth.
 *
 * `hasSendScope` is the pure part of the replacement check, so it is the part
 * worth pinning down.
 */
describe('GmailApiMailer.hasSendScope', () => {
  const SEND = 'https://www.googleapis.com/auth/gmail.send';
  const FULL = 'https://mail.google.com/';

  it('accepts the send scope', () => {
    expect(GmailApiMailer.hasSendScope([SEND])).toBe(true);
  });

  it('accepts the legacy full-access scope, which is a superset', () => {
    expect(GmailApiMailer.hasSendScope([FULL])).toBe(true);
  });

  it('accepts the send scope alongside unrelated ones', () => {
    expect(
      GmailApiMailer.hasSendScope(['https://www.googleapis.com/auth/calendar.events', SEND])
    ).toBe(true);
  });

  it('rejects read-only Gmail scopes — they cannot send', () => {
    expect(GmailApiMailer.hasSendScope(['https://www.googleapis.com/auth/gmail.readonly'])).toBe(
      false
    );
    expect(GmailApiMailer.hasSendScope(['https://www.googleapis.com/auth/gmail.metadata'])).toBe(
      false
    );
  });

  it('rejects the Calendar scope — this is the exact cross-token mix-up to catch', () => {
    expect(GmailApiMailer.hasSendScope(['https://www.googleapis.com/auth/calendar.events'])).toBe(
      false
    );
  });

  it('rejects an empty or absent scope list', () => {
    expect(GmailApiMailer.hasSendScope([])).toBe(false);
    expect(GmailApiMailer.hasSendScope(undefined)).toBe(false);
  });

  it('does not match on a substring of a different scope', () => {
    expect(GmailApiMailer.hasSendScope(['https://example.com/gmail.send'])).toBe(false);
  });
});

describe('GmailApiMailer configuration', () => {
  it('requires GMAIL_REFRESH_TOKEN, not GOOGLE_REFRESH_TOKEN', () => {
    const saved = { ...process.env };
    try {
      process.env.GOOGLE_CLIENT_ID = 'id';
      process.env.GOOGLE_CLIENT_SECRET = 'secret';
      delete process.env.GMAIL_REFRESH_TOKEN;
      process.env.GOOGLE_REFRESH_TOKEN = 'calendar-token';

      // A Calendar token present must not make the Gmail transport look ready.
      expect(GmailApiMailer.isConfigured()).toBe(false);

      process.env.GMAIL_REFRESH_TOKEN = 'gmail-token';
      expect(GmailApiMailer.isConfigured()).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});
