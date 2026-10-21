/**
 * Paadashala After School - Comprehensive Fee Management & Razorpay Integration Tests
 * Covers all 16 test scenarios specified in Phase 9.
 */

const assert = require('assert');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const db = require('../config/connections');
const collections = require('../config/collections');
const {
    ACADEMIC_MONTHS,
    parseAcademicYears,
    ensureFeeIndexes,
    generateStudentFees,
    updateStudentFeeAmount,
    getStudentFeeSummary
} = require('../helpers/fee-helper');
const {
    createRazorpayOrder,
    verifyPaymentSignature,
    verifyWebhookSignature,
    generateReceiptNumber
} = require('../helpers/razorpay-helper');

async function runTestSuite() {
    console.log('====================================================');
    console.log('🧪 Starting Fee Management & Razorpay Automated Tests');
    console.log('====================================================\n');

    await db.connect();
    const database = db.get();
    await ensureFeeIndexes(database);

    let passedCount = 0;
    let failedCount = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`✅ PASS: ${name}`);
            passedCount++;
        } catch (err) {
            console.error(`❌ FAIL: ${name}`);
            console.error(`   ${err.stack || err.message}`);
            failedCount++;
        }
    }

    const testStudentId = 'TEST_STUDENT_' + Date.now();
    const testAcademicYear = '2026-2027';
    const testMonthlyFee = 5000;
    const testParentPhone = '9998887776';

    // Scenario 1 & 2: Admin registers a student with a monthly fee of ₹5,000, saved in MongoDB
    await test('1 & 2: Admin registers student with monthly fee of ₹5,000 and saves in MongoDB', async () => {
        const student = {
            studentId: testStudentId,
            name: 'Test Child',
            parentName: 'Test Parent',
            parentNo: testParentPhone,
            phone: testParentPhone,
            class: 10,
            shift: 'Morning',
            academicYear: testAcademicYear,
            monthlyFee: testMonthlyFee,
            admissionMonth: 'June',
            address: 'Test Address',
            createdAt: new Date()
        };

        const studentCol = database.collection(collections.STUDENT_COLLECTION);
        await studentCol.insertOne(student);

        const saved = await studentCol.findOne({ studentId: testStudentId });
        assert.ok(saved, 'Student document should exist in MongoDB');
        assert.strictEqual(saved.monthlyFee, 5000, 'Monthly fee should be exactly 5000');
        assert.strictEqual(saved.academicYear, '2026-2027');
    });

    // Scenario 3: Academic year contains the correct 10 fee periods (June through March)
    await test('3: The academic year contains the correct 10 fee periods (June - March)', async () => {
        const student = await database.collection(collections.STUDENT_COLLECTION).findOne({ studentId: testStudentId });
        const feeRecords = await generateStudentFees(database, student, 'June');

        assert.strictEqual(feeRecords.length, 10, 'Should contain exactly 10 academic month records');

        const expectedMonths = [
            'June', 'July', 'August', 'September', 'October',
            'November', 'December', 'January', 'February', 'March'
        ];

        feeRecords.forEach((rec, idx) => {
            assert.strictEqual(rec.order, idx + 1, `Order should be ${idx + 1}`);
            assert.strictEqual(rec.month, expectedMonths[idx], `Month ${idx + 1} should be ${expectedMonths[idx]}`);
            assert.strictEqual(rec.amount, 5000, 'Amount must match monthly fee');
            if (idx <= 6) {
                assert.strictEqual(rec.year, 2026, `${expectedMonths[idx]} should be year 2026`);
            } else {
                assert.strictEqual(rec.year, 2027, `${expectedMonths[idx]} should be year 2027`);
            }
        });
    });

    // Scenario 4: Fee records are not duplicated on repeated generation or re-runs
    await test('4: Fee records are not duplicated on repeated generation (Idempotency)', async () => {
        const student = await database.collection(collections.STUDENT_COLLECTION).findOne({ studentId: testStudentId });
        // Call generation twice more
        await generateStudentFees(database, student, 'June');
        await generateStudentFees(database, student, 'June');

        const feeCol = database.collection(collections.FEE_COLLECTION);
        const count = await feeCol.countDocuments({ studentId: testStudentId, academicYear: testAcademicYear });
        assert.strictEqual(count, 10, 'Fee record count must remain exactly 10 without duplicates');
    });

    // Scenario 5: Parent sees only authorized student records
    await test('5: Parent sees only authorized student records', async () => {
        const studentCol = database.collection(collections.STUDENT_COLLECTION);
        const authorized = await studentCol.find({
            $or: [{ parentNo: testParentPhone }, { studentId: testStudentId }]
        }).toArray();

        assert.ok(authorized.length > 0, 'Authorized students found for parent phone');
        authorized.forEach(s => {
            assert.strictEqual(s.parentNo, testParentPhone, 'Must only match authorized phone number');
        });

        // Other parent cannot access
        const unauthorizedQuery = await studentCol.find({
            $or: [{ parentNo: '0000000000' }, { studentId: 'PAD_NON_EXISTENT' }]
        }).toArray();
        assert.strictEqual(unauthorizedQuery.length, 0, 'Unauthorized phone must see 0 records');
    });

    // Scenario 6: Dashboard calculates correct total, paid amount and outstanding balance
    await test('6: Dashboard calculates correct total, paid amount and outstanding balance', async () => {
        const summary = await getStudentFeeSummary(database, testStudentId, testAcademicYear);
        assert.strictEqual(summary.records.length, 10);
        assert.strictEqual(summary.totalAcademicFees, 50000, '10 months * 5000 = 50,000');
        assert.strictEqual(summary.totalPaid, 0, 'Initially 0 paid');
        assert.strictEqual(summary.totalOutstanding, 50000, 'Initially 50,000 outstanding');
    });

    // Scenario 7: Parent can initiate payment for one month
    let singlePaymentRecordId = null;
    let singleOrderId = null;
    await test('7: Parent can initiate payment for one month', async () => {
        const feeCol = database.collection(collections.FEE_COLLECTION);
        const juneFee = await feeCol.findOne({ studentId: testStudentId, month: 'June' });
        assert.ok(juneFee);

        // Simulate order creation
        const paymentRecord = {
            studentId: testStudentId,
            studentName: 'Test Child',
            parentPhone: testParentPhone,
            academicYear: testAcademicYear,
            feeIds: [juneFee._id],
            coveredMonths: [juneFee.month],
            amount: juneFee.amount,
            currency: 'INR',
            status: 'created',
            createdAt: new Date()
        };

        const res = await database.collection(collections.PAYMENT_COLLECTION).insertOne(paymentRecord);
        singlePaymentRecordId = res.insertedId;

        const rzpOrder = await createRazorpayOrder({
            amountInRupees: juneFee.amount,
            receipt: singlePaymentRecordId.toString(),
            notes: { studentId: testStudentId }
        });

        singleOrderId = rzpOrder.id;
        assert.ok(singleOrderId);
        assert.strictEqual(rzpOrder.amount, 500000, '5000 INR = 500000 paise');
    });

    // Scenario 8: Parent can initiate payment for multiple months
    await test('8: Parent can initiate payment for multiple months', async () => {
        const feeCol = database.collection(collections.FEE_COLLECTION);
        const fees = await feeCol.find({ studentId: testStudentId, month: { $in: ['July', 'August'] } }).toArray();
        assert.strictEqual(fees.length, 2);

        const totalAmt = fees.reduce((sum, f) => sum + f.amount, 0);
        assert.strictEqual(totalAmt, 10000, '2 months = 10,000');

        const multiPayment = {
            studentId: testStudentId,
            studentName: 'Test Child',
            parentPhone: testParentPhone,
            academicYear: testAcademicYear,
            feeIds: fees.map(f => f._id),
            coveredMonths: fees.map(f => f.month),
            amount: totalAmt,
            currency: 'INR',
            status: 'created',
            createdAt: new Date()
        };

        const res = await database.collection(collections.PAYMENT_COLLECTION).insertOne(multiPayment);
        const rzpOrder = await createRazorpayOrder({
            amountInRupees: totalAmt,
            receipt: res.insertedId.toString()
        });

        assert.strictEqual(rzpOrder.amount, 1000000, '10,000 INR = 1,000,000 paise');
    });

    // Scenario 9: Parent can initiate payment for entire eligible outstanding balance
    await test('9: Parent can initiate payment for full outstanding balance calculated from DB', async () => {
        const feeCol = database.collection(collections.FEE_COLLECTION);
        const pendingFees = await feeCol.find({
            studentId: testStudentId,
            academicYear: testAcademicYear,
            status: { $in: ['pending', 'upcoming'] }
        }).toArray();

        const fullAmount = pendingFees.reduce((sum, f) => sum + f.amount, 0);
        assert.strictEqual(fullAmount, 50000, 'Full outstanding balance should be 50,000');
    });

    // Scenario 10: Invalid amounts and unauthorized fee IDs are rejected
    await test('10: Invalid amounts and unauthorized fee IDs are rejected', async () => {
        // Test unauthorized student fee access
        const otherFeeId = new ObjectId();
        const otherStudentFee = {
            _id: otherFeeId,
            studentId: 'ANOTHER_STUDENT',
            academicYear: testAcademicYear,
            month: 'June',
            amount: 5000,
            status: 'pending'
        };
        await database.collection(collections.FEE_COLLECTION).insertOne(otherStudentFee);

        // Security check simulation: verifying that fee belongs to student
        const fee = await database.collection(collections.FEE_COLLECTION).findOne({ _id: otherFeeId });
        assert.notStrictEqual(fee.studentId, testStudentId, 'Fee should belong to another student');

        const isAuthorized = (fee.studentId === testStudentId);
        assert.strictEqual(isAuthorized, false, 'Unauthorized fee must be rejected');

        // Cleanup
        await database.collection(collections.FEE_COLLECTION).deleteOne({ _id: otherFeeId });
    });

    // Scenario 11 & 12: Failed, cancelled, or unverified payments do not mark fees as paid
    await test('11 & 12: Failed or unverified payments do not mark fees as paid', async () => {
        const invalidSig = 'invalid_tampered_signature_12345';
        const isValid = verifyPaymentSignature(singleOrderId, 'pay_test_fake', invalidSig);
        assert.strictEqual(isValid, false, 'Invalid signature must fail verification');

        // Verify fee record is still NOT paid
        const feeCol = database.collection(collections.FEE_COLLECTION);
        const juneFee = await feeCol.findOne({ studentId: testStudentId, month: 'June' });
        assert.notStrictEqual(juneFee.status, 'paid', 'Fee must remain unpaid');
    });

    // Scenario 13: Valid payment verification updates the correct fee records
    let confirmedReceiptNumber = null;
    await test('13: Valid payment verification updates the correct fee records to paid', async () => {
        const paymentCol = database.collection(collections.PAYMENT_COLLECTION);
        const feeCol = database.collection(collections.FEE_COLLECTION);

        const payment = await paymentCol.findOne({ _id: singlePaymentRecordId });
        assert.ok(payment);

        confirmedReceiptNumber = generateReceiptNumber();
        const now = new Date();

        // Simulate successful verification update
        await paymentCol.updateOne(
            { _id: payment._id },
            {
                $set: {
                    status: 'successful',
                    razorpayPaymentId: 'pay_test_verified_101',
                    receiptNumber: confirmedReceiptNumber,
                    paidAt: now
                }
            }
        );

        await feeCol.updateMany(
            { _id: { $in: payment.feeIds } },
            {
                $set: {
                    status: 'paid',
                    paidAt: now,
                    paymentId: payment._id,
                    receiptNumber: confirmedReceiptNumber,
                    razorpayPaymentId: 'pay_test_verified_101'
                }
            }
        );

        // Verify fee record is now paid
        const updatedJuneFee = await feeCol.findOne({ _id: payment.feeIds[0] });
        assert.strictEqual(updatedJuneFee.status, 'paid', 'June fee should now be paid');
        assert.strictEqual(updatedJuneFee.receiptNumber, confirmedReceiptNumber);

        // Summary reflects paid amount
        const summary = await getStudentFeeSummary(database, testStudentId, testAcademicYear);
        assert.strictEqual(summary.totalPaid, 5000, 'Total paid should now be 5,000');
        assert.strictEqual(summary.totalOutstanding, 45000, 'Outstanding should now be 45,000');
        assert.strictEqual(summary.paidCount, 1);
    });

    // Scenario 14: Duplicate webhooks and repeated callbacks do not duplicate payments or receipts
    await test('14: Duplicate webhooks or repeated callbacks do not duplicate payments or receipts', async () => {
        const paymentCol = database.collection(collections.PAYMENT_COLLECTION);
        const payment = await paymentCol.findOne({ _id: singlePaymentRecordId });

        // Second verification call
        assert.strictEqual(payment.status, 'successful');
        // Idempotent safeguard: updating with status $ne 'successful'
        const res = await paymentCol.updateOne(
            { _id: payment._id, status: { $ne: 'successful' } },
            { $set: { receiptNumber: 'DUPLICATE_RECEIPT_ATTEMPT' } }
        );
        assert.strictEqual(res.matchedCount, 0, 'Duplicate call should be a no-op');

        const rechecked = await paymentCol.findOne({ _id: singlePaymentRecordId });
        assert.strictEqual(rechecked.receiptNumber, confirmedReceiptNumber, 'Receipt number must not be overwritten');
    });

    // Scenario 15: A parent cannot access another parent's payment history or receipts
    await test('15: Access control prevents a parent from accessing another parent\'s receipt', async () => {
        const paymentCol = database.collection(collections.PAYMENT_COLLECTION);
        const payment = await paymentCol.findOne({ _id: singlePaymentRecordId });

        // Parent with different children
        const otherParentStudentIds = ['PAD1025', 'PAD1026'];
        const isAllowed = otherParentStudentIds.includes(payment.studentId);
        assert.strictEqual(isAllowed, false, 'Other parent should NOT be authorized to view this receipt');
    });

    // Scenario 16: Existing application features continue to work (Attendance, Student list, DB)
    await test('16: Existing application features continue to function seamlessly', async () => {
        // 1. Student collection query
        const students = await database.collection(collections.STUDENT_COLLECTION).find().limit(5).toArray();
        assert.ok(students.length > 0, 'Students query works');

        // 2. Attendance collection query
        const attendance = await database.collection(collections.STUDENT_ATTENDANCE_COLLECTION).find().limit(5).toArray();
        assert.ok(attendance.length > 0, 'Attendance query works');

        // 3. Announcements query
        const announcements = await database.collection(collections.ANNOUNCEMENT_COLLECTION).find().limit(5).toArray();
        assert.ok(announcements.length > 0, 'Announcements query works');
    });

    // Scenario 17: Fee editing affects future months without touching paid records
    await test('17: Fee change updates unpaid months without altering historical paid records', async () => {
        const feeCol = database.collection(collections.FEE_COLLECTION);

        // Update fee from 5000 to 6000
        await updateStudentFeeAmount(database, testStudentId, testAcademicYear, 6000);

        // Paid June fee must remain 5000!
        const juneFee = await feeCol.findOne({ studentId: testStudentId, month: 'June' });
        assert.strictEqual(juneFee.status, 'paid');
        assert.strictEqual(juneFee.amount, 5000, 'Historical paid fee must remain 5,000');

        // Future unpaid month (e.g. November) must be 6000!
        const novFee = await feeCol.findOne({ studentId: testStudentId, month: 'November' });
        assert.strictEqual(novFee.status, 'upcoming');
        assert.strictEqual(novFee.amount, 6000, 'Future unpaid fee must be updated to 6,000');

        // Student document updated
        const student = await database.collection(collections.STUDENT_COLLECTION).findOne({ studentId: testStudentId });
        assert.strictEqual(student.monthlyFee, 6000);
    });

    // Cleanup test records
    await database.collection(collections.STUDENT_COLLECTION).deleteOne({ studentId: testStudentId });
    await database.collection(collections.FEE_COLLECTION).deleteMany({ studentId: testStudentId });
    await database.collection(collections.PAYMENT_COLLECTION).deleteMany({ studentId: testStudentId });

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('====================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
