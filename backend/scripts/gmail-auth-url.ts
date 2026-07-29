import 'dotenv/config';
import { google } from 'googleapis';
import { GmailApiMailer } from '../src/services/email/GmailApiMailer';

/**
 * Prints the Google consent URL that mints a GMAIL_REFRESH_TOKEN.
 *
 * Run with:  npm run gmail:auth
 *
 * This asks ONLY for the gmail.send scope and issues a SEPARATE refresh token,
 * so the existing GOOGLE_REFRESH_TOKEN used for Calendar / Meet is never
 * touched, re-scoped, or invalidated.
 *
 * The redirect lands on the app's existing /api/google/oauth/callback route,
 * which exchanges the code and prints the tokens as JSON. No route, no scope
 * and no Google Cloud Console change is required.
 */

const RULE = '──────────────────────────────────────────────';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
  console.error('❌ Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REDIRECT_URI in .env');
  process.exit(1);
}

const url = new google.auth.OAuth2(clientId, clientSecret, redirectUri).generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces a fresh refresh_token every time
  scope: [GmailApiMailer.SCOPE],
});

const isLocal = redirectUri.includes('localhost') || redirectUri.includes('127.0.0.1');

console.log(`\n${RULE}`);
console.log('📧 Gmail API — refresh token setup');
console.log(RULE);
console.log(`Scope requested : ${GmailApiMailer.SCOPE}  (send only — no read access)`);
console.log(`Redirect URI    : ${redirectUri}`);
console.log(`Sender account  : ${GmailApiMailer.senderAddress() || '(set GMAIL_SENDER or SMTP_USER)'}`);
console.log(RULE);
console.log('\nSteps:\n');
if (isLocal) {
  console.log('  1. Start the backend locally first:  npm run dev');
  console.log('     (the redirect URI points at localhost, so the app must be running)');
} else {
  console.log('  1. Make sure the deployed backend is live — the redirect points at it.');
}
console.log('  2. Open this URL in a browser and approve the "Send email" permission:\n');
console.log(`     ${url}\n`);
console.log('  3. The callback responds with JSON. Copy the value of "refresh_token".');
console.log('  4. Set it as GMAIL_REFRESH_TOKEN — locally in .env, and in the Render dashboard.');
console.log('  5. Restart the service. The startup banner should print:');
console.log('     "Gmail API Verify   : ✅ Reachable — authenticated as <your address>"\n');
console.log('Note: GOOGLE_REFRESH_TOKEN (Calendar / Meet) stays exactly as it is.');
console.log(`${RULE}\n`);
