import prisma from './src/config/db';
import { SessionService } from './src/services/session.service';

async function verify() {
  console.log('--- Verification Started ---');
  try {
    const batch = await prisma.batch.findFirst({
      include: {
        studentBatches: { include: { student: true } },
        instructorBatches: true,
      }
    });

    if (!batch) {
       console.log('No batch found. Verification blocked.');
       return;
    }
    
    const instructorId = batch.instructorBatches[0]?.instructorId;
    if (!instructorId) {
      console.log('No instructor assigned.');
      return;
    }

    console.log(`✅ Found Batch: ${batch.name}`);

    // 1. Create Session
    const session = await SessionService.createSession({
      title: 'Original Title',
      description: 'Original Description',
      batchId: batch.id,
      instructorId: instructorId,
      startTime: new Date().toISOString(),
      durationMinutes: 60
    });
    console.log(`✅ Created Session: ${session.id}`);

    // 2. Edit Session
    const updated = await SessionService.updateSession(session.id, {
      title: 'Updated Title',
      durationMinutes: 90
    });
    console.log(`✅ Edited Session: ${updated.id}. New Title: ${updated.title}`);

    // 3. Cancel Session
    const cancelled = await SessionService.cancelSession(session.id);
    console.log(`✅ Cancelled Session: ${cancelled.id}. Status: ${cancelled.status}`);

    // Clean up
    await prisma.session.delete({ where: { id: session.id } });
    console.log(`✅ Verification complete. Cleaned up test session.`);
  } catch (error) {
    console.error('❌ Verification failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
