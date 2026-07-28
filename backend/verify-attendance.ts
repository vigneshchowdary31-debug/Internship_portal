import prisma from './src/config/db';
import { AttendanceService } from './src/services/attendance.service';
import { v4 as uuid } from 'uuid';

async function verify() {
  console.log('--- Verification Started ---');
  try {
    // 1. Database Check
    const batch = await prisma.batch.findFirst({
      include: {
        studentBatches: true,
        instructorBatches: true,
      }
    });
    
    if (!batch || batch.studentBatches.length === 0) {
       console.log('No batch with students found. Verification blocked.');
       return;
    }
    
    const instructorId = batch.instructorBatches[0]?.instructorId;
    const studentId = batch.studentBatches[0]?.studentId;
    
    console.log(`✅ Found Batch: ${batch.name}`);
    console.log(`✅ Found Student: ${studentId}`);
    
    if (!instructorId) {
      console.log('No instructor assigned. Creating a mock instructor for test.');
    }
    const adminOrInstructorId = instructorId || 'mock-id';

    // 2. Create Session
    const session = await prisma.session.create({
      data: {
        title: 'Test E2E Session',
        batchId: batch.id,
        instructorId: adminOrInstructorId,
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        status: 'SCHEDULED'
      }
    });
    console.log(`✅ Created Session: ${session.id}`);

    // 3. Mark Attendance (Present)
    const record1 = await AttendanceService.markAttendance({
      sessionId: session.id,
      studentId: studentId,
      status: 'PRESENT',
      markedBy: adminOrInstructorId
    });
    console.log(`✅ Marked Attendance PRESENT: ${record1.id}`);

    // 4. Update Attendance (Late) to test upsert duplicate prevention
    const record2 = await AttendanceService.markAttendance({
      sessionId: session.id,
      studentId: studentId,
      status: 'LATE',
      remarks: 'Traffic',
      markedBy: adminOrInstructorId
    });
    console.log(`✅ Updated Attendance LATE (Upsert): ${record2.id}`);
    
    // Check if duplicate was created
    const count = await prisma.attendance.count({
      where: { sessionId: session.id, studentId: studentId }
    });
    if (count === 1) {
      console.log(`✅ Upsert prevented duplicates correctly. Count: 1`);
    } else {
      console.log(`❌ Duplicate found! Count: ${count}`);
    }

    // 5. Get Session Attendance (Instructor reload)
    const sessionRoster = await AttendanceService.getSessionAttendance(session.id);
    console.log(`✅ Reloaded Session Attendance. Length: ${sessionRoster.length}`);
    
    // 6. Get Student Dashboard Attendance (Student Login)
    const studentDash = await AttendanceService.getStudentAttendance(studentId);
    console.log(`✅ Reloaded Student Dashboard Attendance. Found ${studentDash.length} records.`);

    // 7. Get Overview (Admin dashboard)
    const overview = await AttendanceService.getOverview();
    console.log(`✅ Reloaded Admin Overview. Found ${overview.length} total records.`);

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
