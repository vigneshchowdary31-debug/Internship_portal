const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN'
];

// Email is optional: without SMTP credentials the app runs normally and email
// notifications are skipped. Missing credentials must not stop the server.
const optionalEnvVars = ['SMTP_USER', 'SMTP_PASS'];

export function validateEnv() {
  const missingOptional = optionalEnvVars.filter((envVar) => !process.env[envVar]);
  if (missingOptional.length > 0) {
    console.warn(`⚠️  Email disabled — missing: ${missingOptional.join(', ')}`);
    console.warn('   Sessions, Google Meet and Google Calendar are unaffected.');
  }

  const missingVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missingVars.length > 0) {
    console.error('❌ FATAL ERROR: Missing required environment variables:');
    missingVars.forEach((envVar) => {
      console.error(`   - ${envVar}`);
    });
    console.error('\nPlease ensure these variables are defined in your .env file or deployment environment.');
    process.exit(1);
  }
}

// Execute on import
validateEnv();
