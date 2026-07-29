import 'dotenv/config';
import prisma from './src/config/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-for-mvp';

async function run() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) {
    console.log('No admin found');
    return;
  }
  
  const token = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '1d' });

  try {
    const res = await fetch('http://localhost:5001/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Test Student',
        email: 'test.student.' + Date.now() + '@example.com',
        password: 'password123',
        role: 'STUDENT'
      })
    });
    const data = await res.json();
    console.log('Response:', data);
  } catch (err: any) {
    console.error('Fetch error:', err.message);
  }
}

run();
