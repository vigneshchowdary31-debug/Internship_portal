import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import prisma from '../src/config/db';

async function main() {
  const adminEmail = 'admin@example.com';
  
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        password: hashedPassword,
        role: Role.ADMIN,
        // The bootstrap admin is not "enrolled" — no enrollment email is sent,
        // so there is no temporary credential to rotate. Matches how the
        // migration backfills every pre-existing account.
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    console.log('✅ Admin user created: admin@example.com / admin123');
  } else {
    console.log('Admin user already exists.');
  }

  // Create some initial Tech Stacks
  const stacks = ['React', 'Node.js', 'Python', 'Java', 'DevOps'];
  for (const name of stacks) {
    await prisma.techStack.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log('✅ Tech Stacks seeded');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
