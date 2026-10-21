const collections = require('../config/collections');

const ACADEMIC_MONTHS = [
  { name: 'June', order: 1, monthNumber: 6, yearOffset: 0 },
  { name: 'July', order: 2, monthNumber: 7, yearOffset: 0 },
  { name: 'August', order: 3, monthNumber: 8, yearOffset: 0 },
  { name: 'September', order: 4, monthNumber: 9, yearOffset: 0 },
  { name: 'October', order: 5, monthNumber: 10, yearOffset: 0 },
  { name: 'November', order: 6, monthNumber: 11, yearOffset: 0 },
  { name: 'December', order: 7, monthNumber: 12, yearOffset: 0 },
  { name: 'January', order: 8, monthNumber: 1, yearOffset: 1 },
  { name: 'February', order: 9, monthNumber: 2, yearOffset: 1 },
  { name: 'March', order: 10, monthNumber: 3, yearOffset: 1 }
];

function parseAcademicYears(academicYearStr) {
  const parts = String(academicYearStr || '2026-2027').split('-');
  let startYear = parseInt(parts[0], 10);
  if (isNaN(startYear)) startYear = new Date().getFullYear();
  let endYear = parseInt(parts[1], 10);
  if (isNaN(endYear)) {
    endYear = startYear + 1;
  } else if (endYear < 100) {
    endYear = Math.floor(startYear / 100) * 100 + endYear;
  }
  return { startYear, endYear };
}

/**
 * Ensures indexes exist on fee and payment collections
 */
async function ensureFeeIndexes(db) {
  if (!db) return;
  try {
    const feeCol = db.collection(collections.FEE_COLLECTION);
    await feeCol.createIndex(
      { studentId: 1, academicYear: 1, month: 1 },
      { unique: true }
    );
    await feeCol.createIndex({ studentId: 1, academicYear: 1, order: 1 });
    await feeCol.createIndex({ status: 1 });

    const paymentCol = db.collection(collections.PAYMENT_COLLECTION);
    await paymentCol.createIndex({ receiptNumber: 1 }, { unique: true, sparse: true });
    await paymentCol.createIndex({ razorpayOrderId: 1 });
    await paymentCol.createIndex({ studentId: 1, createdAt: -1 });
  } catch (err) {
    console.error('Error creating fee indexes:', err.message);
  }
}

/**
 * Generate academic fee records for a student idempotently
 * @param {object} db - MongoDB Database instance
 * @param {object} student - Student document
 * @param {string} [startMonthName='June'] - The first month to charge for (supports mid-year joins)
 */
async function generateStudentFees(db, student, startMonthName = 'June') {
  if (!db || !student || !student.studentId) return [];

  const feeAmount = Number(student.monthlyFee);
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
    return [];
  }

  const academicYear = student.academicYear || '2026-2027';
  const { startYear, endYear } = parseAcademicYears(academicYear);

  let startIndex = ACADEMIC_MONTHS.findIndex(m => m.name.toLowerCase() === String(startMonthName).toLowerCase());
  if (startIndex === -1) startIndex = 0;

  const feeCol = db.collection(collections.FEE_COLLECTION);
  const now = new Date();

  // Create or preserve fee records for each of the 10 months
  const operations = [];

  for (let i = 0; i < ACADEMIC_MONTHS.length; i++) {
    const m = ACADEMIC_MONTHS[i];
    const calendarYear = m.yearOffset === 0 ? startYear : endYear;
    // 5th of each month is the standard due date
    const dueDate = new Date(calendarYear, m.monthNumber - 1, 5);

    if (i < startIndex) {
      // Prior to student joining - do not charge (not applicable)
      continue;
    }

    const defaultStatus = dueDate <= now ? 'pending' : 'upcoming';

    operations.push({
      updateOne: {
        filter: {
          studentId: student.studentId,
          academicYear: academicYear,
          month: m.name
        },
        update: {
          $setOnInsert: {
            studentId: student.studentId,
            studentName: student.name,
            academicYear: academicYear,
            month: m.name,
            order: m.order,
            monthNumber: m.monthNumber,
            year: calendarYear,
            dueDate: dueDate,
            amount: feeAmount,
            status: defaultStatus,
            createdAt: now
          },
          $set: {
            updatedAt: now
          }
        },
        upsert: true
      }
    });
  }

  if (operations.length > 0) {
    await feeCol.bulkWrite(operations, { ordered: false });
  }

  return await feeCol.find({ studentId: student.studentId, academicYear }).sort({ order: 1 }).toArray();
}

/**
 * Safely update a student's monthly fee amount for unpaid future fee records
 * Paid fee records are never modified.
 */
async function updateStudentFeeAmount(db, studentId, academicYear, newAmount) {
  if (!db || !studentId) return;
  const numAmount = Number(newAmount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    throw new Error('Fee amount must be a positive number');
  }

  const studentCol = db.collection(collections.STUDENT_COLLECTION);
  await studentCol.updateOne(
    { studentId },
    { $set: { monthlyFee: numAmount, updatedAt: new Date() } }
  );

  const feeCol = db.collection(collections.FEE_COLLECTION);
  const filter = {
    studentId,
    status: { $in: ['pending', 'upcoming'] }
  };
  if (academicYear) {
    filter.academicYear = academicYear;
  }

  const result = await feeCol.updateMany(filter, {
    $set: {
      amount: numAmount,
      updatedAt: new Date()
    }
  });

  return result;
}

/**
 * Fetch and calculate summary of a student's academic fees
 */
async function getStudentFeeSummary(db, studentId, academicYear) {
  if (!db || !studentId) {
    return {
      records: [],
      totalAcademicFees: 0,
      totalPaid: 0,
      totalOutstanding: 0,
      paidCount: 0,
      pendingCount: 0,
      upcomingCount: 0
    };
  }

  const feeCol = db.collection(collections.FEE_COLLECTION);
  const filter = { studentId };
  if (academicYear) filter.academicYear = academicYear;

  const records = await feeCol.find(filter).sort({ order: 1 }).toArray();

  let totalAcademicFees = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;
  let paidCount = 0;
  let pendingCount = 0;
  let upcomingCount = 0;

  records.forEach(r => {
    const amt = Number(r.amount) || 0;
    totalAcademicFees += amt;
    if (r.status === 'paid') {
      totalPaid += amt;
      paidCount++;
    } else {
      totalOutstanding += amt;
      if (r.status === 'upcoming') {
        upcomingCount++;
      } else {
        pendingCount++;
      }
    }
  });

  return {
    records,
    totalAcademicFees,
    totalPaid,
    totalOutstanding,
    paidCount,
    pendingCount,
    upcomingCount
  };
}

module.exports = {
  ACADEMIC_MONTHS,
  parseAcademicYears,
  ensureFeeIndexes,
  generateStudentFees,
  updateStudentFeeAmount,
  getStudentFeeSummary
};
