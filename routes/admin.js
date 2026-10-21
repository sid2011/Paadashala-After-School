var express = require('express');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
var router = express.Router();
const db = require("../config/connections");
const collections = require("../config/collections");
const { generateStudentFees, updateStudentFeeAmount } = require("../helpers/fee-helper");

// Helper: check if request is an AJAX/Fetch request
function isAjax(req) {
    return req.xhr ||
        req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        req.headers['sec-fetch-dest'] === 'empty' ||
        req.query.ajax === '1';
}

// Authentication Middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    if (isAjax(req)) {
        return res.status(401).send('<script>window.location.href="/admin/login";</script>');
    }

    return res.redirect('/admin/login');
}
// ---------------------------------------------
// LOGIN & LOGOUT ROUTES
// ---------------------------------------------

// GET /admin/login
router.get('/login', (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.redirect('/admin');
    }
    res.render('admin/login', { layout: false });
});

// POST /admin/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // First check in DB admin collection if exists
        let admin = null;
        try {
            if (db.get()) {
                admin = await db.get().collection(collections.ADMIN_COLLECTION).findOne({
                    $or: [{ username: username }, { email: username }]
                });
            }
        } catch (dbErr) {
            console.log("DB Admin lookup notice:", dbErr.message);
        }

        // Validate credentials: check DB or default credentials (admin / admin123 or admin / admin)
        const isDefaultValid = (username === 'admin' && (password === 'admin123' || password === 'admin'));
        const isDbValid = admin && (admin.password === password);

        if (isDbValid || isDefaultValid) {
            req.session.isAdmin = true;
            req.session.adminUser = admin ? (admin.name || admin.username) : 'Administrator';
            return res.redirect('/admin');
        } else {
            return res.render('admin/login', {
                layout: false,
                error: 'യൂസർനെയിം അല്ലെങ്കിൽ പാസ്‌വേഡ് തെറ്റാണ്! (Invalid credentials)'
            });
        }
    } catch (err) {
        console.error("Login error:", err);
        return res.render('admin/login', {
            layout: false,
            error: 'ലോഗിൻ ചെയ്യുന്നതിൽ സാങ്കേതിക തടസ്സം ഉണ്ടായി. വീണ്ടും ശ്രമിക്കുക.'
        });
    }
});

// GET /admin/logout
router.get('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy(() => {
            res.redirect('/admin/login');
        });
    } else {
        res.redirect('/admin/login');
    }
});

// ---------------------------------------------
// DASHBOARD ROUTE
// ---------------------------------------------

// GET /admin (Dashboard)
router.get('/', requireAuth, async (req, res) => {
    try {
        const studentCol = db.get().collection(collections.STUDENT_COLLECTION);
        const teacherCol = db.get().collection(collections.TEACHER_COLLECTION);

        const totalStudents = await studentCol.countDocuments();
        const totalTeachers = await teacherCol.countDocuments();

        const morningCount = await studentCol.countDocuments({ shift: 'Morning' });
        const afternoonEveningCount = await studentCol.countDocuments({
            $or: [{ shift: 'Afternoon' }, { shift: 'Evening' }]
        });

        const recentStudents = await studentCol.find().sort({ _id: -1 }).limit(5).toArray();

        const renderOptions = {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser || 'Administrator',
            totalStudents,
            totalTeachers,
            morningCount,
            afternoonEveningCount,
            recentStudents
        };

        res.render('admin/admin', renderOptions);
    } catch (err) {
        console.error("Dashboard error:", err);
        res.render('admin/admin', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser || 'Administrator',
            totalStudents: 0,
            totalTeachers: 0,
            morningCount: 0,
            afternoonEveningCount: 0,
            recentStudents: []
        });
    }
});

// ---------------------------------------------
// STUDENTS ROUTES
// ---------------------------------------------

// GET /admin/students
router.get('/students', requireAuth, async (req, res) => {
    try {
        const student = await db.get().collection(collections.STUDENT_COLLECTION).find().sort({ _id: -1 }).toArray();
        res.render('admin/students', {
            layout: isAjax(req) ? false : 'admin-layout',
            student,
            adminUser: req.session.adminUser
        });
    } catch (err) {
        console.error("Fetch students error:", err);
        res.render('admin/students', { layout: isAjax(req) ? false : 'admin-layout', student: [] });
    }
});

// POST /admin/students/register
router.post('/students/register', requireAuth, async (req, res) => {
    try {
        const studentId = "PAD" + Math.floor(1000 + Math.random() * 9000);
        // Convert "Class 4" or "4" into the number 4
        const classNumber = Number(
            String(req.body.class)
                .replace(/^Class\s*/i, "")
                .trim()
        );

        // Clean and validate monthly fee
        const rawFee = String(req.body.monthlyFee || '').replace(/[^\d.]/g, '');
        const monthlyFee = Number(rawFee);

        if (!Number.isFinite(monthlyFee) || monthlyFee <= 0 || monthlyFee > 1000000) {
            if (isAjax(req)) {
                return res.status(400).json({ error: 'Valid monthly fee (₹) is required and must be greater than 0.' });
            }
            return res.redirect('/admin/students?error=invalid_fee');
        }

        const admissionMonth = req.body.admissionMonth || 'June';

        const student = {
            studentId: studentId,
            name: req.body.name ? req.body.name.trim() : '',
            parentName: req.body.parentName ? req.body.parentName.trim() : '',
            parentNo: req.body.phone ? req.body.phone.trim() : '',
            phone: req.body.phone ? req.body.phone.trim() : '',
            class: classNumber,
            shift: req.body.shift || 'Evening',
            academicYear: req.body.academicYear || '2026-2027',
            monthlyFee: monthlyFee,
            admissionMonth: admissionMonth,
            address: req.body.address ? req.body.address.trim() : '',
            createdAt: new Date()
        };

        const studentCol = db.get().collection(collections.STUDENT_COLLECTION);
        await studentCol.insertOne(student);

        // Also ensure parent account is initialized in parent collection if not existing
        if (student.parentNo) {
            const parentCol = db.get().collection(collections.PARENT_COLLECTION);
            const existingParent = await parentCol.findOne({ phone: student.parentNo });
            if (!existingParent) {
                const defaultHash = bcrypt.hashSync('parent123', 10);
                await parentCol.insertOne({
                    phone: student.parentNo,
                    parentName: student.parentName,
                    studentId: student.studentId,
                    studentName: student.name,
                    password: defaultHash,
                    createdAt: new Date()
                });
            }
        }

        // Idempotently generate the 10-month academic fee schedule starting from admissionMonth
        await generateStudentFees(db.get(), student, admissionMonth);

        return res.redirect('/admin/students');
    } catch (err) {
        console.error("Register student error:", err);
        return res.redirect('/admin/students');
    }
});

// POST /admin/students/update-fee
router.post('/students/update-fee', requireAuth, async (req, res) => {
    try {
        const { studentId, monthlyFee } = req.body;
        const cleanFee = Number(String(monthlyFee || '').replace(/[^\d.]/g, ''));

        if (!studentId || !Number.isFinite(cleanFee) || cleanFee <= 0 || cleanFee > 1000000) {
            if (isAjax(req)) {
                return res.status(400).json({ success: false, error: 'Valid positive monthly fee is required.' });
            }
            return res.redirect('/admin/students?error=invalid_fee');
        }

        const student = await db.get().collection(collections.STUDENT_COLLECTION).findOne({ studentId });
        if (!student) {
            if (isAjax(req)) {
                return res.status(404).json({ success: false, error: 'Student not found.' });
            }
            return res.redirect('/admin/students?error=student_not_found');
        }

        // If the student previously had no fee records, generate the initial schedule
        const feeCol = db.get().collection(collections.FEE_COLLECTION);
        const existingCount = await feeCol.countDocuments({ studentId });

        if (existingCount === 0) {
            student.monthlyFee = cleanFee;
            await db.get().collection(collections.STUDENT_COLLECTION).updateOne(
                { studentId },
                { $set: { monthlyFee: cleanFee, updatedAt: new Date() } }
            );
            await generateStudentFees(db.get(), student, student.admissionMonth || 'June');
        } else {
            // Update student record and update future unpaid fee records
            await updateStudentFeeAmount(db.get(), studentId, student.academicYear, cleanFee);
        }

        if (isAjax(req)) {
            return res.json({ success: true, message: 'Fee updated successfully', monthlyFee: cleanFee });
        }
        return res.redirect('/admin/students');
    } catch (err) {
        console.error("Update fee error:", err);
        if (isAjax(req)) {
            return res.status(500).json({ success: false, error: 'Server error updating fee.' });
        }
        return res.redirect('/admin/students');
    }
});

// API: GET students by class (used by Teacher Opinions dropdown)

router.get('/students/by-class', requireAuth, async (req, res) => {
    try {
        const { className } = req.query;

        // Convert the selected class to a number
        const classNumber = Number(
            String(className)
                .replace(/^Class\s*/i, '')
                .trim()
        );

        // Validate the class number
        if (
            !Number.isInteger(classNumber) ||
            classNumber < 1 ||
            classNumber > 10
        ) {
            return res.status(400).json([]);
        }

        const students = await db.get()
            .collection(collections.STUDENT_COLLECTION)
            .find({ class: classNumber })
            .project({
                _id: 0,
                studentId: 1,
                name: 1,
                class: 1,
                shift: 1
            })
            .sort({ name: 1 })
            .toArray();

        res.json(students);
    } catch (err) {
        console.error("Fetch students by class error:", err);
        res.status(500).json([]);
    }
});
// ---------------------------------------------
// TEACHERS ROUTES
// ---------------------------------------------

// GET /admin/teachers
router.get('/teachers', requireAuth, async (req, res) => {
    try {
        const teacher = await db.get().collection(collections.TEACHER_COLLECTION).find().sort({ _id: -1 }).toArray();
        res.render('admin/teachers', {
            layout: isAjax(req) ? false : 'admin-layout',
            teacher,
            adminUser: req.session.adminUser
        });
    } catch (err) {
        console.error("Fetch teachers error:", err);
        res.render('admin/teachers', { layout: isAjax(req) ? false : 'admin-layout', teacher: [] });
    }
});

// POST /admin/teachers/register
router.post('/teachers/register', requireAuth, async (req, res) => {
    try {
        const teacherId = "TCH" + Math.floor(1000 + Math.random() * 9000);
        const teacher = {
            teacherId: teacherId,
            name: req.body.name,
            email: req.body.email,
            phoneNo: req.body.phone,
            subject: req.body.subject,
            address: req.body.address,
            createdAt: new Date()
        };
        await db.get().collection(collections.TEACHER_COLLECTION).insertOne(teacher);
        return res.redirect('/admin/teachers');
    } catch (err) {
        console.error("Register teacher error:", err);
        return res.redirect('/admin/teachers');
    }
});

// ---------------------------------------------
// ATTENDANCE ROUTES
// ---------------------------------------------

// GET /admin/students/attendance
router.get('/students/attendance', requireAuth, async (req, res) => {
    res.render('admin/attendance', {
        layout: isAjax(req) ? false : 'admin-layout',
        adminUser: req.session.adminUser
    });
});

// GET /admin/students/loadAttendance
router.get("/students/loadAttendance", requireAuth, async (req, res) => {
    try {

        const { date, grade, shift } = req.query;

        const query = {};
        if (grade && grade !== "all") {
            const classNumber = Number(grade.replace(/^Class\s*/i, "").trim());

            if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10) {
                return res.status(400).json([]);
            }

            query.class = classNumber;
            if (shift && shift !== "all") {
    query.shift = shift;
}
        }
        console.log("Selected grade:", grade);
console.log("Selected shift:", shift);
console.log("MongoDB filter:", query);
        // Fetch students matching the class and shift
        const students = await db
            .get()
            .collection(collections.STUDENT_COLLECTION)
            .find(query)
            .sort({ name: 1 })
            .toArray();
        // Check if attendance already recorded for this date and class
        const existingAttendance = await db
            .get()
            .collection(collections.STUDENT_ATTENDANCE_COLLECTION)
            .find({ date: date, class: grade })
            .toArray();

        const attendanceMap = {};
        existingAttendance.forEach(item => {
            attendanceMap[item.studentId] = item.status;
        });

        const studentsWithStatus = students.map(s => ({
            studentId: s.studentId,
            name: s.name,
            class: s.class,
            shift: s.shift || 'General',
            status: attendanceMap[s.studentId] || 'present'
        }));

        res.json(studentsWithStatus);
    } catch (err) {
        console.error("Load attendance error:", err);
        res.status(500).json([]);
    }
});

// POST /admin/students/attendance
router.post('/students/attendance', requireAuth, async (req, res) => {
    try {
        const records = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ success: false, message: "No attendance data provided" });
        }

        const bulkOps = records.map(record => ({
            updateOne: {
                filter: { date: record.date, studentId: record.studentId },
                update: {
                    $set: {
                        date: record.date,
                        studentId: record.studentId,
                        studentName: record.studentName,
                        class: record.class,
                        shift: record.shift,
                        status: record.status,
                        updatedAt: new Date()
                    }
                },
                upsert: true
            }
        }));

        await db.get().collection(collections.STUDENT_ATTENDANCE_COLLECTION).bulkWrite(bulkOps);
        res.json({ success: true, message: "Attendance saved successfully" });
    } catch (err) {
        console.error("Save attendance error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------
// TEACHER OPINIONS & VOICE RECORDING ROUTES
// ---------------------------------------------

// GET /admin/teacher-opinions
router.get('/teacher-opinions', requireAuth, async (req, res) => {
    try {
        const teachers = await db.get().collection(collections.TEACHER_COLLECTION).find().sort({ name: 1 }).toArray();
        const opinions = await db.get().collection(collections.TEACHER_OPINION_COLLECTION).find().sort({ createdAt: -1 }).toArray();

        res.render('admin/teacher-opinions', {
            layout: isAjax(req) ? false : 'admin-layout',
            teachers,
            opinions,
            adminUser: req.session.adminUser
        });
    } catch (err) {
        console.error("Fetch teacher opinions error:", err);
        res.render('admin/teacher-opinions', {
            layout: isAjax(req) ? false : 'admin-layout',
            teachers: [],
            opinions: []
        });
    }
});

// POST /admin/teacher-opinions
router.post('/teacher-opinions', requireAuth, async (req, res) => {
    try {
        const { class: className, studentId, studentName, subject, teacherName, opinion } = req.body;

        const opinionRecord = {
            class: className,
            studentId,
            studentName: studentName || 'Student',
            subject,
            teacherName,
            opinion,
            createdAt: new Date()
        };

        await db.get().collection(collections.TEACHER_OPINION_COLLECTION).insertOne(opinionRecord);
        res.redirect('/admin/teacher-opinions');
    } catch (err) {
        console.error("Save teacher opinion error:", err);
        res.redirect('/admin/teacher-opinions');
    }
});

// ---------------------------------------------
// BROADCAST MESSAGES & ANNOUNCEMENTS ROUTES
// ---------------------------------------------

// GET /admin/messages
router.get('/messages', requireAuth, async (req, res) => {
    try {
        const announcements = await db.get()
            .collection(collections.ANNOUNCEMENT_COLLECTION)
            .find()
            .sort({ pinned: -1, createdAt: -1 })
            .toArray();

        const totalMessages = announcements.length;
        const urgentCount = announcements.filter(a => a.priority === 'Urgent' || a.category === 'Urgent').length;
        const generalCount = announcements.filter(a => a.category === 'General').length;

        res.render('admin/messages', {
            layout: isAjax(req) ? false : 'admin-layout',
            announcements,
            totalMessages,
            urgentCount,
            generalCount,
            adminUser: req.session.adminUser
        });
    } catch (err) {
        console.error("Fetch announcements error:", err);
        res.render('admin/messages', {
            layout: isAjax(req) ? false : 'admin-layout',
            announcements: [],
            totalMessages: 0,
            urgentCount: 0,
            generalCount: 0,
            adminUser: req.session.adminUser
        });
    }
});

// POST /admin/messages/broadcast
router.post('/messages/broadcast', requireAuth, async (req, res) => {
    try {
        const { title, category, target, priority, content, pinned } = req.body;

        const announcement = {
            title: title ? title.trim() : 'Official Announcement',
            content: content ? content.trim() : '',
            category: category || 'General',
            target: target || 'all',
            priority: priority || 'Normal',
            pinned: pinned === 'true' || pinned === 'on' || pinned === true,
            author: req.session.adminUser || 'Paadashala Administration',
            createdAt: new Date()
        };

        await db.get().collection(collections.ANNOUNCEMENT_COLLECTION).insertOne(announcement);
        return res.redirect('/admin/messages');
    } catch (err) {
        console.error("Broadcast message error:", err);
        return res.redirect('/admin/messages');
    }
});

// POST /admin/messages/delete/:id
router.post('/messages/delete/:id', requireAuth, async (req, res) => {
    try {
        const messageId = req.params.id;
        await db.get().collection(collections.ANNOUNCEMENT_COLLECTION).deleteOne({
            _id: new ObjectId(messageId)
        });
        return res.redirect('/admin/messages');
    } catch (err) {
        console.error("Delete broadcast error:", err);
        return res.redirect('/admin/messages');
    }
});

// ---------------------------------------------
// FEES & FINANCIAL OVERVIEW ROUTE
// ---------------------------------------------

// GET /admin/fees
router.get('/fees', requireAuth, async (req, res) => {
    try {
        const studentCol = db.get().collection(collections.STUDENT_COLLECTION);
        const feeCol = db.get().collection(collections.FEE_COLLECTION);
        const paymentCol = db.get().collection(collections.PAYMENT_COLLECTION);

        const totalStudents = await studentCol.countDocuments();
        const studentsWithFeeCount = await studentCol.countDocuments({ monthlyFee: { $exists: true, $gt: 0 } });

        const paidFees = await feeCol.find({ status: 'paid' }).toArray();
        const totalCollected = paidFees.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

        const pendingFees = await feeCol.find({ status: { $in: ['pending', 'upcoming'] } }).toArray();
        const totalPending = pendingFees.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

        const transactions = await paymentCol.find({ status: 'successful' }).sort({ createdAt: -1 }).limit(25).toArray();

        res.render('admin/fees', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            totalStudents,
            studentsWithFeeCount,
            totalCollected,
            totalPending,
            transactions
        });
    } catch (err) {
        console.error("Admin fees route error:", err);
        res.render('admin/fees', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            totalStudents: 0,
            studentsWithFeeCount: 0,
            totalCollected: 0,
            totalPending: 0,
            transactions: []
        });
    }
});

module.exports = router;
