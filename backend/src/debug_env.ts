import 'dotenv/config';
import fs from 'fs';
import path from 'path';

console.log('--- ENV DEBUG SCRIPT ---');
console.log('CWD:', process.cwd());
console.log('.env absolute path:', path.resolve(process.cwd(), '.env'));

console.log('Has SMTP_USER?', !!process.env.SMTP_USER);
console.log('Has SMTP_PASS?', !!process.env.SMTP_PASS);

const fileContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
console.log('File contains SMTP_USER:', fileContent.includes('SMTP_USER'));
console.log('File contains SMTP_PASS:', fileContent.includes('SMTP_PASS'));

console.log('--- END ENV DEBUG SCRIPT ---');
