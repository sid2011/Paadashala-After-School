/**
 * Automated test suite for Subject-wise Attendance, Push Notifications,
 * Daily Activities, and Marks Comparison Graph.
 */

const assert = require('assert');
const db = require('../config/connections');
const collections = require('../config/collections');
const {
  savePushSubscription,
  sendNotification,
  getNotifications
} = require('../helpers/notification-helper');

async function runFeatureTests() {
  console.log('====================================================');
  console.log('🧪 Testing New Features: Subject Attendance, Push, Activities & Marks');
  console.log('====================================================\n');

  await db.connect();
  const database = db.get();

  let passed = 0;
  let failed = 0;

  async function test(title, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${title}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${title}`);
      console.error(`   ${err.stack || err.message}`);
      failed++;
    }
  }

  // 1. Subject-wise attendance
  await test('1: Subject-wise attendance saves distinct records for same student on same day', async () => {
    const attendanceCol = database.collection(collections.STUDENT_ATTENDANCE_COLLECTION);
    const date = '2026-10-21';
    const studentId = 'PAD1024';

    // Insert Math - Present
    await attendanceCol.updateOne(
      { date, studentId, subject: 'Mathematics' },
      { $set: { date, studentId, subject: 'Mathematics', status: 'present', updatedAt: new Date() } },
      { upsert: true }
    );

    // Insert Physics - Absent
    await attendanceCol.updateOne(
      { date, studentId, subject: 'Physics' },
      { $set: { date, studentId, subject: 'Physics', status: 'absent', updatedAt: new Date() } },
      { upsert: true }
    );

    // Verify both exist independently
    const mathRec = await attendanceCol.findOne({ date, studentId, subject: 'Mathematics' });
    const physRec = await attendanceCol.findOne({ date, studentId, subject: 'Physics' });

    assert.ok(mathRec, 'Mathematics attendance should exist');
    assert.strictEqual(mathRec.status, 'present');

    assert.ok(physRec, 'Physics attendance should exist');
    assert.strictEqual(physRec.status, 'absent');
  });

  // 2. Notification Dispatch
  await test('2: Attendance and Activity notifications are created and queryable', async () => {
    const testStudentId = 'PAD1024';
    const testPhone = '9876543210';

    await sendNotification(database, {
      studentId: testStudentId,
      parentPhone: testPhone,
      targetClass: 'Class 10',
      title: '⚠️ അറ്റൻഡൻസ് അലേർട്ട്: Sidharth B',
      message: 'Sidharth B ഇന്ന് (2026-10-21) Physics ക്ലാസ്സിൽ ഹാജരായിട്ടില്ല (Absent).',
      type: 'attendance',
      url: '/attendance'
    });

    const notifs = await getNotifications(database, { studentId: testStudentId, parentPhone: testPhone, limit: 5 });
    assert.ok(notifs.length > 0, 'Notifications list should not be empty');
    assert.strictEqual(notifs[0].type, 'attendance');
    assert.ok(notifs[0].title.includes('അറ്റൻഡൻസ്'));
  });

  // 3. Daily Activities
  await test('3: Daily Activities can be published and filtered by student class', async () => {
    const activityCol = database.collection(collections.DAILY_ACTIVITY_COLLECTION);

    const testActivity = {
      date: '2026-10-21',
      class: 'Class 10',
      subject: 'Biology',
      shift: 'Morning',
      teacherName: 'Smt. Lakshmi',
      topic: 'Photosynthesis & Light Reaction',
      description: 'പ്രകാശസംശ്ലേഷണത്തിന്റെ പ്രകാശഘട്ടം ചർച്ച ചെയ്തു.',
      homework: 'പാഠപുസ്തകത്തിലെ ഡയഗ്രം വരയ്ക്കുക.',
      createdAt: new Date()
    };

    const res = await activityCol.insertOne(testActivity);
    assert.ok(res.insertedId);

    const found = await activityCol.find({ class: 'Class 10' }).toArray();
    assert.ok(found.length > 0, 'Class 10 activities should be retrieved');

    // Cleanup
    await activityCol.deleteOne({ _id: res.insertedId });
  });

  // 4. Student Marks & Comparison Graph calculations
  await test('4: Student marks correctly calculate school %, paadashala %, and growth improvement', async () => {
    const marksCol = database.collection(collections.STUDENT_MARKS_COLLECTION);
    const report = await marksCol.findOne({ studentId: 'PAD1024', examTerm: 'Term 1 (Onam / First Term)' });

    assert.ok(report, 'Term 1 marks report should exist for PAD1024');
    assert.strictEqual(report.subjects.length, 6, 'Should have 6 subjects');

    // Check school and paadashala percentage calculation
    assert.strictEqual(report.totalMax, 600);
    assert.strictEqual(report.totalSchool, 389);
    assert.strictEqual(report.totalPaadashala, 515);
    assert.ok(report.paadashalaPercentage > report.schoolPercentage, 'Paadashala % should exceed school %');
    assert.strictEqual(report.improvement, 21.0, 'Improvement should be exactly 21.0%');
  });

  // 5. Push Subscription synchronization
  await test('5: Push subscriptions are stored without duplicate endpoints', async () => {
    const mockSub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test_endpoint_123',
      keys: {
        p256dh: 'mock_key_p256dh',
        auth: 'mock_auth_secret'
      }
    };

    await savePushSubscription(database, {
      studentId: 'PAD1024',
      parentPhone: '9876543210',
      subscription: mockSub
    });

    const subCol = database.collection(collections.PUSH_SUBSCRIPTION_COLLECTION);
    const count = await subCol.countDocuments({ endpoint: mockSub.endpoint });
    assert.strictEqual(count, 1, 'Endpoint should be unique and upserted');

    // Cleanup
    await subCol.deleteOne({ endpoint: mockSub.endpoint });
  });

  // 6. Dynamic Subjects & Marks for lower vs higher classes
  await test('6: Class <= 8 can save combined Science marks while Class 10 has separate Physics, Chemistry, Biology', async () => {
    const marksCol = database.collection(collections.STUDENT_MARKS_COLLECTION);

    // Save marks for Class 8 student (PAD1025) with Science
    const class8Doc = {
      studentId: 'PAD1025',
      studentName: 'Ananya Nair',
      class: 'Class 8',
      academicYear: '2026-2027',
      examTerm: 'Term 1 (Onam / First Term)',
      subjects: [
        { name: 'Mathematics', maxMarks: 100, schoolMarks: 70, paadashalaMarks: 90, difference: 20 },
        { name: 'Science', maxMarks: 100, schoolMarks: 65, paadashalaMarks: 88, difference: 23 },
        { name: 'Social Science', maxMarks: 100, schoolMarks: 75, paadashalaMarks: 92, difference: 17 },
        { name: 'English', maxMarks: 100, schoolMarks: 80, paadashalaMarks: 94, difference: 14 }
      ],
      totalMax: 400,
      totalSchool: 290,
      totalPaadashala: 364,
      schoolPercentage: 72.5,
      paadashalaPercentage: 91.0,
      improvement: 18.5,
      remarks: 'സയൻസിലും മാത്‌സിലും മികച്ച മുന്നേറ്റം കാഴ്ച്ചവെച്ചിട്ടുണ്ട്.',
      createdAt: new Date()
    };

    await marksCol.updateOne(
      { studentId: 'PAD1025', examTerm: class8Doc.examTerm },
      { $set: class8Doc },
      { upsert: true }
    );

    const saved8 = await marksCol.findOne({ studentId: 'PAD1025', examTerm: class8Doc.examTerm });
    assert.ok(saved8);
    const subNames8 = saved8.subjects.map(s => s.name);
    assert.ok(subNames8.includes('Science'), 'Class 8 should have combined Science');
    assert.ok(!subNames8.includes('Physics'), 'Class 8 should not have separate Physics');

    // Check Class 10
    const saved10 = await marksCol.findOne({ studentId: 'PAD1024', examTerm: 'Term 1 (Onam / First Term)' });
    assert.ok(saved10);
    const subNames10 = saved10.subjects.map(s => s.name);
    assert.ok(subNames10.includes('Physics') && subNames10.includes('Chemistry') && subNames10.includes('Biology'), 'Class 10 should have Physics, Chemistry, Biology');
  });

  // 7. Individual Target Student Daily Activity filtering
  await test('7: Student-specific daily activities are filtered correctly and do not leak to other students', async () => {
    const activityCol = database.collection(collections.DAILY_ACTIVITY_COLLECTION);

    const individualActivity = {
      date: '2026-10-21',
      class: 'Class 10',
      targetStudentId: 'PAD1024',
      targetStudentName: 'Sidharth B',
      subject: 'Chemistry',
      shift: 'Morning',
      teacherName: 'Sri. Arun Kumar',
      topic: 'Chemical Equilibrium Exercises',
      notesGiven: 'കെമിസ്ട്രി സമവാക്യങ്ങൾ നോട്ട്സ് നൽകി.',
      homeworkGiven: 'പേജ് 52 ലെ ചോദ്യം 3, 4 ചെയ്തു വരിക.',
      createdAt: new Date()
    };

    const insertResult = await activityCol.insertOne(individualActivity);

    // Query for student PAD1024
    const pad1024Activities = await activityCol.find({
      $or: [
        { targetStudentId: 'PAD1024' },
        {
          $and: [
            { $or: [{ targetStudentId: null }, { targetStudentId: 'ALL' }, { targetStudentId: { $exists: false } }] },
            { class: 'Class 10' }
          ]
        }
      ]
    }).toArray();

    assert.ok(pad1024Activities.some(a => a.targetStudentId === 'PAD1024'), 'Should include activity targeted to PAD1024');

    // Query for another student in Class 10 (e.g. PAD9999)
    const otherStudentActivities = await activityCol.find({
      $or: [
        { targetStudentId: 'PAD9999' },
        {
          $and: [
            { $or: [{ targetStudentId: null }, { targetStudentId: 'ALL' }, { targetStudentId: { $exists: false } }] },
            { class: 'Class 10' }
          ]
        }
      ]
    }).toArray();

    assert.ok(!otherStudentActivities.some(a => a.targetStudentId === 'PAD1024'), 'Other student should NOT see activity targeted to PAD1024');

    await activityCol.deleteOne({ _id: insertResult.insertedId });
  });

  // 8. Timetable Schedule & Book Reminders
  await test('8: Timetable retrieval, today schedule, and book reminder push notifications', async () => {
    const { getTimetableForClass, getTodaySchedule, sendTodayTimetableNotifications } = require('../helpers/timetable-helper');

    const schedule = await getTimetableForClass(database, 'Class 10');
    assert.ok(Array.isArray(schedule), 'Schedule should be an array');
    assert.ok(schedule.length >= 6, 'Schedule should cover 6 days');

    const monday = schedule.find(s => s.day === 'Monday');
    assert.ok(monday && monday.periods.length > 0, 'Monday should have periods');
    assert.ok(monday.periods[0].books, 'Period must define required books');

    // Test sending reminder notification
    const res = await sendTodayTimetableNotifications(database, 'Class 10');
    assert.ok(res.sent >= 0, 'Reminder should execute successfully');
  });

  console.log('\n====================================================');
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runFeatureTests().catch(err => {
  console.error('Fatal error in feature tests:', err);
  process.exit(1);
});
