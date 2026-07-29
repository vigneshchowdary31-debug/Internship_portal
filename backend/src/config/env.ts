const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SMTP_USER',
  'SMTP_PASS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN'
];

export function validateEnv() {
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
