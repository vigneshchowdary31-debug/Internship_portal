import prisma from './src/config/db';

async function test() {
  const batches = await prisma.batch.findMany({
    include: {
      studentBatches: { include: { student: true } }
    }
  });

  console.log(JSON.stringify(batches, null, 2));
}

test().catch(console.error).finally(() => prisma.$disconnect());
