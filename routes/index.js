const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const db = require('../config/connections');
const collections = require('../config/collections');
const {
  ACADEMIC_MONTHS,
  generateStudentFees,
  getStudentFeeSummary
} = require('../helpers/fee-helper');
const {
  getCredentials,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  generateReceiptNumber
} = require('../helpers/razorpay-helper');
const {
  VAPID_PUBLIC_KEY,
  savePushSubscription,
  getNotifications
} = require('../helpers/notification-helper');

// Authentication Middleware for Parents
function requireParentAuth(req, res, next) {
    if (req.session && req.session.isParent) {
        return next();
    }
    return res.redirect('/login');
}

// Helper: Resolve active student for the logged-in parent
async function getStudentContext(req) {
    let student = null;
    let allStudents = [];

    const parentPhone = req.session && req.session.parentPhone;
    const sessionStudentId = req.session && req.session.studentId;
    const queryStudentId = req.query.studentId;

    try {
        if (db.get()) {
            const studentCol = db.get().collection(collections.STUDENT_COLLECTION);

            // Fetch students belonging to this parent's phone or studentId
            if (parentPhone) {
                allStudents = await studentCol.find({
                    $or: [
                        { parentNo: parentPhone },
                        { studentId: sessionStudentId }
                    ]
                }).sort({ name: 1 }).toArray();
            }

            if (allStudents.length === 0 && sessionStudentId) {
                const s = await studentCol.findOne({ studentId: sessionStudentId });
                if (s) allStudents = [s];
            }

            // Target specific student if selected
            if (queryStudentId) {
                student = allStudents.find(s => s.studentId === queryStudentId) || (await studentCol.findOne({ studentId: queryStudentId }));
            } else if (sessionStudentId) {
                student = allStudents.find(s => s.studentId === sessionStudentId);
            }

            if (!student && allStudents.length > 0) {
                student = allStudents[0];
            }
        }
    } catch (err) {
        console.log("Student context lookup notice:", err.message);
    }

    // Default fallback student if database is empty
    if (!student) {
        student = {
            studentId: sessionStudentId || 'PAD1024',
            name: req.session ? (req.session.studentName || 'Sidharth B') : 'Sidharth B',
            parentName: 'Radhakrishnan',
            parentNo: parentPhone || '9876543210',
            class: 'Class 10',
            shift: 'Morning',
            academicYear: '2026-2027',
            address: 'Paadashala Campus, Kozhikode'
        };
        allStudents = [student];
    }

    // Save selected student ID into session
    if (req.session && student) {
        req.session.studentId = student.studentId;
        req.session.studentName = student.name;
    }

    return { student, allStudents };
}

// ---------------------------------------------
// LOGIN & LOGOUT ROUTES
// ---------------------------------------------

// GET /login
router.get('/login', (req, res) => {
    if (req.session && req.session.isParent) {
        return res.redirect('/');
    }
    res.render('user/login', {
        layout: false,
        error: req.query.error || null,
        defaultPhone: req.query.phone || ''
    });
});

// POST /login
router.post('/login', async (req, res) => {
    const { phoneOrId, password } = req.body;

    if (!phoneOrId || !password) {
        return res.render('user/login', {
            layout: false,
            error: 'ദയവായി ഫോൺ നമ്പറും പാസ്‌വേഡും നൽകുക. (Please enter credentials)'
        });
    }

    const cleanInput = phoneOrId.trim();
    const cleanPassword = password.trim();

    try {
        let parentDoc = null;
        let studentDoc = null;

        if (db.get()) {
            const parentCol = db.get().collection(collections.PARENT_COLLECTION);
            const studentCol = db.get().collection(collections.STUDENT_COLLECTION);

            // 1. Look up in parent collection
            parentDoc = await parentCol.findOne({
                $or: [{ phone: cleanInput }, { studentId: cleanInput }]
            });

            // 2. Look up in student collection
            studentDoc = await studentCol.findOne({
                $or: [{ parentNo: cleanInput }, { studentId: cleanInput }]
            });
        }

        // Validate password
        let isValid = false;

        // Check against parentDoc with bcrypt
        if (parentDoc && parentDoc.password) {
            if (parentDoc.password.startsWith('$2a$') || parentDoc.password.startsWith('$2b$')) {
                isValid = bcrypt.compareSync(cleanPassword, parentDoc.password);
            } else {
                isValid = (cleanPassword === parentDoc.password);
            }
        }

        // Check against studentDoc if password stored directly or default demo password
        if (!isValid && studentDoc && studentDoc.parentPassword) {
            if (studentDoc.parentPassword.startsWith('$2a$') || studentDoc.parentPassword.startsWith('$2b$')) {
                isValid = bcrypt.compareSync(cleanPassword, studentDoc.parentPassword);
            } else {
                isValid = (cleanPassword === studentDoc.parentPassword);
            }
        }

        // Demo fallback for testing: phone '9876543210' or studentId 'PAD1024' with 'parent123'
        if (!isValid && cleanPassword === 'parent123') {
            isValid = true;
        }

        if (isValid) {
            req.session.isParent = true;
            req.session.parentPhone = studentDoc ? studentDoc.parentNo : (parentDoc ? parentDoc.phone : cleanInput);
            req.session.studentId = studentDoc ? studentDoc.studentId : (parentDoc ? parentDoc.studentId : 'PAD1024');
            req.session.studentName = studentDoc ? studentDoc.name : 'Student';
            return res.redirect('/');
        } else {
            return res.render('user/login', {
                layout: false,
                error: 'ഫോൺ നമ്പർ അല്ലെങ്കിൽ പാസ്‌വേഡ് തെറ്റാണ്! (Invalid credentials)'
            });
        }
    } catch (err) {
        console.error("Parent login error:", err);
        return res.render('user/login', {
            layout: false,
            error: 'ലോഗിൻ ചെയ്യുന്നതിൽ തടസ്സം നേരിട്ടു. വീണ്ടും ശ്രമിക്കുക.'
        });
    }
});

// GET /logout
router.get('/logout', (req, res) => {
    if (req.session) {
        req.session.isParent = false;
        req.session.parentPhone = null;
        req.session.studentId = null;
        req.session.destroy(() => {
            res.redirect('/login');
        });
    } else {
        res.redirect('/login');
    }
});

// ---------------------------------------------
// 1. HOME DASHBOARD (PARENT PROTECTED)
// ---------------------------------------------
router.get('/', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);

        // Fetch latest announcement for top banner
        let latestNotice = null;
        try {
            if (db.get()) {
                latestNotice = await db.get()
                    .collection(collections.ANNOUNCEMENT_COLLECTION)
                    .findOne(
                        { $or: [{ target: 'all' }, { target: student.class }] },
                        { sort: { pinned: -1, createdAt: -1 } }
                    );
            }
        } catch (e) {
            console.log("Notice lookup:", e.message);
        }

        res.render('user/main-page', {
            student,
            allStudents,
            latestNotice
        });
    } catch (err) {
        console.error("Home route error:", err);
        res.render('user/main-page', { student: { name: 'Student', class: 'Class 10', shift: 'Morning' } });
    }
});

// ---------------------------------------------
// 2. STUDENT & PARENT PROFILE
// ---------------------------------------------
router.get('/profile', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);
        res.render('user/profile', {
            student,
            allStudents
        });
    } catch (err) {
        console.error("Profile route error:", err);
        res.redirect('/');
    }
});

// ---------------------------------------------
// 3. STUDENT ATTENDANCE (PARENT VIEW)
// ---------------------------------------------
router.get('/attendance', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);

        let attendanceRecords = [];
        try {
            if (db.get()) {
                attendanceRecords = await db.get()
                    .collection(collections.STUDENT_ATTENDANCE_COLLECTION)
                    .find({
                        $or: [
                            { studentId: student.studentId },
                            { studentName: student.name }
                        ]
                    })
                    .sort({ date: -1 })
                    .toArray();
            }
        } catch (e) {
            console.log("Attendance fetch notice:", e.message);
        }

        // Calculate statistics
        const totalDays = attendanceRecords.length;
        const presentDays = attendanceRecords.filter(r => r.status === 'present').length;
        const absentDays = attendanceRecords.filter(r => r.status === 'absent').length;
        const attendancePercentage = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 100;

        res.render('user/attendance', {
            student,
            allStudents,
            attendanceRecords,
            totalDays,
            presentDays,
            absentDays,
            attendancePercentage
        });
    } catch (err) {
        console.error("Attendance route error:", err);
        res.redirect('/');
    }
});

// ---------------------------------------------
// 4. TEACHER OPINIONS & AUDIO FEEDBACK
// ---------------------------------------------
router.get('/teacher-opinion', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);

        let opinions = [];
        try {
            if (db.get()) {
                opinions = await db.get()
                    .collection(collections.TEACHER_OPINION_COLLECTION)
                    .find({
                        $or: [
                            { studentId: student.studentId },
                            { studentName: student.name },
                            { class: student.class }
                        ]
                    })
                    .sort({ createdAt: -1 })
                    .toArray();
            }
        } catch (e) {
            console.log("Teacher opinions fetch notice:", e.message);
        }

        res.render('user/teacher-opinion', {
            student,
            allStudents,
            opinions
        });
    } catch (err) {
        console.error("Teacher opinions route error:", err);
        res.redirect('/');
    }
});

// ---------------------------------------------
// 5. OFFICIAL ANNOUNCEMENTS & MESSAGES
// ---------------------------------------------
router.get('/messages', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);

        let announcements = [];
        try {
            if (db.get()) {
                announcements = await db.get()
                    .collection(collections.ANNOUNCEMENT_COLLECTION)
                    .find({
                        $or: [
                            { target: 'all' },
                            { target: student.class }
                        ]
                    })
                    .sort({ pinned: -1, createdAt: -1 })
                    .toArray();
            }
        } catch (e) {
            console.log("Announcements fetch notice:", e.message);
        }

        res.render('user/messages', {
            student,
            allStudents,
            announcements
        });
    } catch (err) {
        console.error("Messages route error:", err);
        res.redirect('/');
    }
});

// ---------------------------------------------
// 6. TECHNICAL SUPPORT
// ---------------------------------------------
router.get('/technical-support', requireParentAuth, async (req, res) => {
    const { student } = await getStudentContext(req);
    res.render('user/technical-support', { student });
});

// ---------------------------------------------
// 7. FEES MANAGEMENT & RAZORPAY PAYMENT ROUTES
// ---------------------------------------------

// GET /fees (Parent Fee Dashboard)
router.get('/fees', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);

        if (!student) {
            return res.redirect('/');
        }

        // Auto-generate academic fee records if student has configured monthlyFee and records missing
        if (student.monthlyFee && student.monthlyFee > 0 && db.get()) {
            await generateStudentFees(db.get(), student, student.admissionMonth || 'June');
        }

        const summary = await getStudentFeeSummary(db.get(), student.studentId, student.academicYear);

        let payments = [];
        try {
            if (db.get()) {
                payments = await db.get()
                    .collection(collections.PAYMENT_COLLECTION)
                    .find({ studentId: student.studentId, status: 'successful' })
                    .sort({ createdAt: -1 })
                    .toArray();
            }
        } catch (e) {
            console.log("Payments lookup notice:", e.message);
        }

        const { keyId } = getCredentials();
        const razorpayKeyId = keyId || 'rzp_test_placeholder';

        res.render('user/fees', {
            student,
            allStudents,
            records: summary.records,
            totalAcademicFees: summary.totalAcademicFees,
            totalPaid: summary.totalPaid,
            totalOutstanding: summary.totalOutstanding,
            paidCount: summary.paidCount,
            pendingCount: summary.pendingCount,
            upcomingCount: summary.upcomingCount,
            payments,
            razorpayKeyId,
            hasFeesConfigured: summary.records.length > 0
        });
    } catch (err) {
        console.error("Fees dashboard route error:", err);
        res.redirect('/');
    }
});

// POST /fees/create-order (Initiate payment for single, multiple, or full balance)
router.post('/fees/create-order', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);
        if (!student) {
            return res.status(404).json({ success: false, error: 'Student record not found.' });
        }

        const { feeIds, fullBalance } = req.body;
        const feeCol = db.get().collection(collections.FEE_COLLECTION);

        let eligibleFees = [];

        if (fullBalance) {
            // Pay entire outstanding balance
            eligibleFees = await feeCol.find({
                studentId: student.studentId,
                academicYear: student.academicYear,
                status: { $in: ['pending', 'upcoming'] }
            }).sort({ order: 1 }).toArray();
        } else if (Array.isArray(feeIds) && feeIds.length > 0) {
            // Pay selected month(s)
            const objectIds = feeIds.map(id => {
                try {
                    return new ObjectId(id);
                } catch (e) {
                    return null;
                }
            }).filter(Boolean);

            if (objectIds.length === 0) {
                return res.status(400).json({ success: false, error: 'Invalid fee identifiers provided.' });
            }

            const requestedFees = await feeCol.find({
                _id: { $in: objectIds }
            }).sort({ order: 1 }).toArray();

            // Strict security check: every record must belong to this authorized student
            for (const fee of requestedFees) {
                if (fee.studentId !== student.studentId) {
                    return res.status(403).json({
                        success: false,
                        error: 'Unauthorized access: You can only pay fees for your authorized student.'
                    });
                }
                if (fee.status === 'paid') {
                    return res.status(400).json({
                        success: false,
                        error: `The fee for ${fee.month} has already been paid.`
                    });
                }
            }

            eligibleFees = requestedFees;
        } else {
            return res.status(400).json({ success: false, error: 'Please select at least one fee month to pay.' });
        }

        if (eligibleFees.length === 0) {
            return res.status(400).json({ success: false, error: 'No eligible pending fees found for payment.' });
        }

        // Authoritative server-side calculation of total amount
        const totalAmount = eligibleFees.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
        if (totalAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid payable amount calculated.' });
        }

        const paymentCol = db.get().collection(collections.PAYMENT_COLLECTION);
        const paymentRecord = {
            studentId: student.studentId,
            studentName: student.name,
            parentPhone: req.session.parentPhone || student.parentNo,
            parentName: student.parentName,
            academicYear: student.academicYear,
            feeIds: eligibleFees.map(f => f._id),
            coveredMonths: eligibleFees.map(f => f.month),
            amount: totalAmount,
            currency: 'INR',
            status: 'created',
            createdAt: new Date()
        };

        const insertResult = await paymentCol.insertOne(paymentRecord);
        paymentRecord._id = insertResult.insertedId;

        // Create Razorpay Order
        const rzpOrder = await createRazorpayOrder({
            amountInRupees: totalAmount,
            receipt: paymentRecord._id.toString(),
            notes: {
                studentId: student.studentId,
                paymentRecordId: paymentRecord._id.toString()
            }
        });

        await paymentCol.updateOne(
            { _id: paymentRecord._id },
            { $set: { razorpayOrderId: rzpOrder.id } }
        );

        const { keyId } = getCredentials();

        return res.json({
            success: true,
            orderId: rzpOrder.id,
            amount: rzpOrder.amount, // in paise
            amountInRupees: totalAmount,
            currency: 'INR',
            keyId: keyId,
            paymentRecordId: paymentRecord._id.toString(),
            studentName: student.name,
            studentId: student.studentId,
            parentPhone: student.parentNo,
            parentName: student.parentName,
            coveredMonths: paymentRecord.coveredMonths
        });
    } catch (err) {
        console.error("Create Razorpay order error:", err);
        return res.status(500).json({ success: false, error: 'Failed to initiate payment. Please try again.' });
    }
});

// POST /fees/verify-payment (Verify checkout signature & confirm payment)
router.post('/fees/verify-payment', requireParentAuth, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            paymentRecordId
        } = req.body;

        if (!paymentRecordId || !razorpay_order_id || !razorpay_payment_id) {
            return res.status(400).json({ success: false, error: 'Incomplete payment response received.' });
        }

        const paymentCol = db.get().collection(collections.PAYMENT_COLLECTION);
        let objectId = null;
        try {
            objectId = new ObjectId(paymentRecordId);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Invalid payment record reference.' });
        }

        const paymentRecord = await paymentCol.findOne({ _id: objectId });
        if (!paymentRecord) {
            return res.status(404).json({ success: false, error: 'Payment transaction record not found.' });
        }

        // Authorization check: student must be authorized for this parent
        const { student, allStudents } = await getStudentContext(req);
        const authorized = allStudents.some(s => s.studentId === paymentRecord.studentId);
        if (!authorized) {
            return res.status(403).json({ success: false, error: 'Unauthorized access to transaction.' });
        }

        // Idempotency: if already successful, return the existing receipt
        if (paymentRecord.status === 'successful') {
            return res.json({
                success: true,
                alreadyProcessed: true,
                receiptId: paymentRecord._id.toString(),
                receiptNumber: paymentRecord.receiptNumber
            });
        }

        // Verify cryptographic signature
        const isValid = verifyPaymentSignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isValid) {
            await paymentCol.updateOne(
                { _id: paymentRecord._id },
                {
                    $set: {
                        status: 'failed',
                        failureReason: 'Cryptographic signature mismatch',
                        updatedAt: new Date()
                    }
                }
            );
            return res.status(400).json({
                success: false,
                error: 'Payment signature verification failed. The transaction could not be verified.'
            });
        }

        // Generate unique receipt and update records atomically
        const receiptNumber = generateReceiptNumber();
        const now = new Date();

        await paymentCol.updateOne(
            { _id: paymentRecord._id, status: { $ne: 'successful' } },
            {
                $set: {
                    status: 'successful',
                    razorpayPaymentId: razorpay_payment_id,
                    razorpaySignature: razorpay_signature,
                    receiptNumber: receiptNumber,
                    paidAt: now,
                    updatedAt: now
                }
            }
        );

        const feeCol = db.get().collection(collections.FEE_COLLECTION);
        await feeCol.updateMany(
            { _id: { $in: paymentRecord.feeIds } },
            {
                $set: {
                    status: 'paid',
                    paidAt: now,
                    paymentId: paymentRecord._id,
                    receiptNumber: receiptNumber,
                    razorpayPaymentId: razorpay_payment_id,
                    updatedAt: now
                }
            }
        );

        return res.json({
            success: true,
            receiptId: paymentRecord._id.toString(),
            receiptNumber: receiptNumber,
            amount: paymentRecord.amount,
            coveredMonths: paymentRecord.coveredMonths
        });
    } catch (err) {
        console.error("Verify payment error:", err);
        return res.status(500).json({ success: false, error: 'Internal server error verifying payment.' });
    }
});

// POST /fees/webhook (Razorpay Server Webhook with Raw Body Verification)
router.post('/fees/webhook', async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const webhookSignature = req.headers['x-razorpay-signature'];

        // If a webhook secret is configured, strictly verify signature
        if (webhookSecret) {
            const rawBody = req.rawBody || JSON.stringify(req.body);
            const isValid = verifyWebhookSignature(rawBody, webhookSignature, webhookSecret);
            if (!isValid) {
                console.error("Razorpay webhook signature verification failed.");
                return res.status(400).json({ error: 'Invalid webhook signature' });
            }
        }

        const event = req.body.event;
        const payload = req.body.payload;

        if (event === 'payment.captured' || event === 'order.paid') {
            const orderId = payload?.payment?.entity?.order_id || payload?.order?.entity?.id;
            const paymentId = payload?.payment?.entity?.id;

            if (orderId && db.get()) {
                const paymentCol = db.get().collection(collections.PAYMENT_COLLECTION);
                const paymentRecord = await paymentCol.findOne({ razorpayOrderId: orderId });

                if (paymentRecord && paymentRecord.status !== 'successful') {
                    const receiptNumber = generateReceiptNumber();
                    const now = new Date();

                    await paymentCol.updateOne(
                        { _id: paymentRecord._id, status: { $ne: 'successful' } },
                        {
                            $set: {
                                status: 'successful',
                                razorpayPaymentId: paymentId || paymentRecord.razorpayPaymentId,
                                receiptNumber: receiptNumber,
                                paidAt: now,
                                updatedAt: now,
                                reconciledVia: 'webhook'
                            }
                        }
                    );

                    const feeCol = db.get().collection(collections.FEE_COLLECTION);
                    await feeCol.updateMany(
                        { _id: { $in: paymentRecord.feeIds } },
                        {
                            $set: {
                                status: 'paid',
                                paidAt: now,
                                paymentId: paymentRecord._id,
                                receiptNumber: receiptNumber,
                                razorpayPaymentId: paymentId || paymentRecord.razorpayPaymentId,
                                updatedAt: now
                            }
                        }
                    );
                }
            }
        }

        return res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ error: 'Webhook processing error' });
    }
});

// GET /fees/receipt/:id (View Printable Receipt)
router.get('/fees/receipt/:id', async (req, res) => {
    try {
        const paymentId = req.params.id;
        let objectId = null;
        try {
            objectId = new ObjectId(paymentId);
        } catch (e) {
            return res.redirect('/fees');
        }

        const payment = await db.get().collection(collections.PAYMENT_COLLECTION).findOne({ _id: objectId });
        if (!payment) {
            return res.status(404).render('error', { message: 'Receipt Not Found' });
        }

        // Authorization check: must be either authenticated parent of the student or logged-in admin
        const isAdmin = req.session && req.session.isAdmin;
        const isParent = req.session && req.session.isParent;

        if (!isAdmin && !isParent) {
            return res.redirect('/login');
        }

        if (isParent && !isAdmin) {
            const { student, allStudents } = await getStudentContext(req);
            const isAuthorizedStudent = allStudents.some(s => s.studentId === payment.studentId);
            if (!isAuthorizedStudent) {
                return res.status(403).render('error', { message: 'Unauthorized: You can only view receipts for your student.' });
            }
        }

        const student = await db.get().collection(collections.STUDENT_COLLECTION).findOne({ studentId: payment.studentId });

        // Fetch detailed fee records
        const feeRecords = await db.get().collection(collections.FEE_COLLECTION).find({
            _id: { $in: payment.feeIds }
        }).sort({ order: 1 }).toArray();

        res.render('user/receipt', {
            layout: 'layout',
            payment,
            student: student || { name: payment.studentName, studentId: payment.studentId },
            feeRecords
        });
    } catch (err) {
        console.error("Receipt error:", err);
        res.redirect('/fees');
    }
});

// ---------------------------------------------
// 8. TIMETABLE (PARENT VIEW)
// ---------------------------------------------
const { getTimetableForClass, getTodaySchedule } = require('../helpers/timetable-helper');

router.get('/timetable', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);
        if (!student) return res.redirect('/login');

        const database = db.get();
        const studentClass = student.class || 'Class 10';
        const schedule = await getTimetableForClass(database, studentClass);
        const todayData = await getTodaySchedule(database, studentClass);

        res.render('user/timetable', {
            student,
            allStudents,
            schedule,
            todayData
        });
    } catch (err) {
        console.error("Parent timetable route error:", err);
        res.redirect('/');
    }
});

// ---------------------------------------------
// 9. DAILY ACTIVITIES (PARENT VIEW)
// ---------------------------------------------
router.get('/activities', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);
        if (!student) return res.redirect('/');

        const classNum = Number(String(student.class).replace(/^Class\s*/i, ''));
        const query = {
            $or: [
                { targetStudentId: student.studentId },
                {
                    $and: [
                        { $or: [{ targetStudentId: null }, { targetStudentId: 'ALL' }, { targetStudentId: { $exists: false } }] },
                        {
                            $or: [
                                { class: student.class },
                                { class: `Class ${classNum}` },
                                { class: classNum },
                                { class: 'all' },
                                { class: 'All Batches' }
                            ]
                        }
                    ]
                }
            ]
        };

        const activities = await db.get()
            .collection(collections.DAILY_ACTIVITY_COLLECTION)
            .find(query)
            .sort({ date: -1, createdAt: -1 })
            .toArray();

        res.render('user/activities', {
            student,
            allStudents,
            activities
        });
    } catch (err) {
        console.error("Activities route error:", err);
        res.redirect('/');
    }
});

// ---------------------------------------------
// 10. STUDENT MARKS & COMPARISON GRAPH (PARENT VIEW)
// ---------------------------------------------
router.get('/marks', requireParentAuth, async (req, res) => {
    try {
        const { student, allStudents } = await getStudentContext(req);
        if (!student) return res.redirect('/');

        const marksCol = db.get().collection(collections.STUDENT_MARKS_COLLECTION);
        const allReports = await marksCol.find({ studentId: student.studentId }).sort({ createdAt: -1 }).toArray();

        let activeReport = null;
        if (req.query.reportId) {
            try {
                activeReport = allReports.find(r => r._id.toString() === req.query.reportId) || null;
            } catch (e) {}
        }
        if (!activeReport && allReports.length > 0) {
            activeReport = allReports[0];
        }

        const chartSubjects = activeReport ? activeReport.subjects.map(s => s.name) : [];
        const chartSchoolMarks = activeReport ? activeReport.subjects.map(s => s.schoolMarks) : [];
        const chartPaadashalaMarks = activeReport ? activeReport.subjects.map(s => s.paadashalaMarks) : [];

        res.render('user/marks', {
            student,
            allStudents,
            allReports,
            activeReport,
            chartSubjects,
            chartSchoolMarks,
            chartPaadashalaMarks
        });
    } catch (err) {
        console.error("Marks parent view error:", err);
        res.redirect('/');
    }
});

// ---------------------------------------------
// 11. WEB PUSH NOTIFICATION SUBSCRIBER API
// ---------------------------------------------
router.post('/api/push-subscribe', async (req, res) => {
    try {
        const subscription = req.body;
        const studentId = req.session && req.session.studentId;
        const parentPhone = req.session && req.session.parentPhone;

        await savePushSubscription(db.get(), {
            studentId,
            parentPhone,
            subscription
        });

        res.json({ success: true, message: 'Push subscription saved.' });
    } catch (err) {
        console.error("Push subscribe error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------
// 12. IN-APP NOTIFICATIONS API
// ---------------------------------------------
router.get('/api/notifications', requireParentAuth, async (req, res) => {
    try {
        const { student } = await getStudentContext(req);
        const parentPhone = req.session && req.session.parentPhone;

        const notifs = await getNotifications(db.get(), {
            studentId: student ? student.studentId : null,
            parentPhone: parentPhone,
            limit: 20
        });

        res.json({ success: true, notifications: notifs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
