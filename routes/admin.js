var express = require('express');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
var router = express.Router();
const db = require("../config/connections");
const collections = require("../config/collections");
const { generateStudentFees, updateStudentFeeAmount } = require("../helpers/fee-helper");
const { sendNotification } = require("../helpers/notification-helper");

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
        const { date, grade, shift, subject } = req.query;

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

        // Fetch students matching the class and shift
        const students = await db
            .get()
            .collection(collections.STUDENT_COLLECTION)
            .find(query)
            .sort({ name: 1 })
            .toArray();

        // Check if attendance already recorded for this date, class, and subject
        const attendanceFilter = { date: date };
        if (grade && grade !== "all") {
            attendanceFilter.class = grade;
        }
        if (subject) {
            attendanceFilter.subject = subject;
        }

        const existingAttendance = await db
            .get()
            .collection(collections.STUDENT_ATTENDANCE_COLLECTION)
            .find(attendanceFilter)
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
            subject: subject || 'General',
            status: attendanceMap[s.studentId] || 'present'
        }));

        res.json(studentsWithStatus);
    } catch (err) {
        console.error("Load attendance error:", err);
        res.status(500).json([]);
    }
});

// POST /admin/students/attendance (Subject-wise Attendance + Instant Notification)
router.post('/students/attendance', requireAuth, async (req, res) => {
    try {
        const records = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ success: false, message: "No attendance data provided" });
        }

        const database = db.get();
        const studentCol = database.collection(collections.STUDENT_COLLECTION);
        const attendanceCol = database.collection(collections.STUDENT_ATTENDANCE_COLLECTION);

        // Fetch student records to obtain parent contact info for push dispatch
        const studentIds = records.map(r => r.studentId);
        const students = await studentCol.find({ studentId: { $in: studentIds } }).toArray();
        const studentMap = {};
        students.forEach(s => { studentMap[s.studentId] = s; });

        const bulkOps = records.map(record => {
            const subject = record.subject || 'General';
            return {
                updateOne: {
                    filter: {
                        date: record.date,
                        studentId: record.studentId,
                        subject: subject
                    },
                    update: {
                        $set: {
                            date: record.date,
                            studentId: record.studentId,
                            studentName: record.studentName,
                            class: record.class,
                            shift: record.shift,
                            subject: subject,
                            status: record.status,
                            updatedAt: new Date()
                        }
                    },
                    upsert: true
                }
            };
        });

        await attendanceCol.bulkWrite(bulkOps);

        // Dispatch notifications for each student to their parents (Push + In-App)
        for (const record of records) {
            const s = studentMap[record.studentId];
            const parentPhone = s ? (s.parentNo || s.phone) : null;
            const subjectName = record.subject || 'ക്ലാസ്സ്';
            const isAbsent = record.status === 'absent';

            const title = isAbsent 
                ? `⚠️ അറ്റൻഡൻസ് അലേർട്ട്: ${record.studentName}`
                : `✅ അറ്റൻഡൻസ്: ${record.studentName}`;
            
            const message = isAbsent
                ? `ശ്രദ്ധിക്കുക: ${record.studentName} ഇന്ന് (${record.date}) ${subjectName} ക്ലാസ്സിൽ ഹാജരായിട്ടില്ല (Absent).`
                : `${record.studentName} ഇന്ന് (${record.date}) ${subjectName} ക്ലാസ്സിൽ ഹാജരായിട്ടുണ്ട് (Present).`;

            sendNotification(database, {
                studentId: record.studentId,
                parentPhone: parentPhone,
                targetClass: record.class,
                title: title,
                message: message,
                type: 'attendance',
                url: '/attendance'
            }).catch(e => console.error("Notification dispatch error:", e.message));
        }

        res.json({ success: true, message: "Attendance saved and notifications sent successfully" });
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

// ---------------------------------------------
// DAILY CLASS ACTIVITIES & HOMEWORK ROUTES
// ---------------------------------------------

// GET /admin/activities
router.get('/activities', requireAuth, async (req, res) => {
    try {
        const database = db.get();
        const activities = await database
            .collection(collections.DAILY_ACTIVITY_COLLECTION)
            .find()
            .sort({ date: -1, createdAt: -1 })
            .toArray();

        const teachers = await database
            .collection(collections.TEACHER_COLLECTION)
            .find()
            .sort({ name: 1 })
            .toArray();

        const students = await database
            .collection(collections.STUDENT_COLLECTION)
            .find()
            .sort({ name: 1 })
            .toArray();

        res.render('admin/activities', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            activities,
            teachers,
            students
        });
    } catch (err) {
        console.error("Fetch activities error:", err);
        res.render('admin/activities', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            activities: [],
            teachers: [],
            students: []
        });
    }
});

// POST /admin/activities/create
router.post('/activities/create', requireAuth, async (req, res) => {
    try {
        const { date, class: className, studentId, subject, shift, teacherName, topic, notes, description, homework } = req.body;
        const database = db.get();

        const notesGiven = (notes || description || '').trim();
        const homeworkGiven = (homework || '').trim();

        let targetStudentId = null;
        let targetStudentName = 'All Students';

        if (studentId && studentId !== 'ALL') {
            const matchedStudent = await database.collection(collections.STUDENT_COLLECTION).findOne({ studentId });
            if (matchedStudent) {
                targetStudentId = matchedStudent.studentId;
                targetStudentName = matchedStudent.name;
            }
        }

        const activity = {
            date: date || new Date().toISOString().split('T')[0],
            class: className,
            targetStudentId: targetStudentId,
            targetStudentName: targetStudentName,
            subject: subject,
            shift: shift || 'All Batches',
            teacherName: teacherName ? teacherName.trim() : 'Paadashala Faculty',
            topic: topic ? topic.trim() : 'Class Activity',
            notesGiven: notesGiven,
            homeworkGiven: homeworkGiven,
            description: notesGiven, // backward compatibility
            homework: homeworkGiven,  // backward compatibility
            author: req.session.adminUser || 'Paadashala Faculty',
            createdAt: new Date()
        };

        await database.collection(collections.DAILY_ACTIVITY_COLLECTION).insertOne(activity);

        // Notify parents
        if (targetStudentId) {
            // Specific student
            const s = await database.collection(collections.STUDENT_COLLECTION).findOne({ studentId: targetStudentId });
            if (s) {
                const parentPhone = s.parentNo || s.phone;
                sendNotification(database, {
                    studentId: s.studentId,
                    parentPhone: parentPhone,
                    targetClass: className,
                    title: `📝 ${subject} ആക്ടിവിറ്റി: ${s.name}`,
                    message: `${subject} - Notes: ${notesGiven.slice(0, 60)}${homeworkGiven ? ` | ${subject} - Homework: ${homeworkGiven.slice(0, 50)}` : ''}`,
                    type: 'activity',
                    url: '/activities'
                }).catch(e => console.error("Individual activity notification error:", e.message));
            }
        } else {
            // All students in this class
            const students = await database.collection(collections.STUDENT_COLLECTION).find({
                $or: [{ class: className }, { class: Number(String(className).replace(/^Class\s*/i, '')) }]
            }).toArray();

            for (const s of students) {
                const parentPhone = s.parentNo || s.phone;
                sendNotification(database, {
                    studentId: s.studentId,
                    parentPhone: parentPhone,
                    targetClass: className,
                    title: `📚 ${subject} ആക്ടിവിറ്റി (${className})`,
                    message: `${subject} - Notes: ${notesGiven.slice(0, 60)}${homeworkGiven ? ` | ${subject} - Homework: ${homeworkGiven.slice(0, 50)}` : ''}`,
                    type: 'activity',
                    url: '/activities'
                }).catch(e => console.error("Class activity notification error:", e.message));
            }
        }

        return res.redirect('/admin/activities');
    } catch (err) {
        console.error("Create activity error:", err);
        return res.redirect('/admin/activities');
    }
});

// POST /admin/activities/delete/:id
router.post('/activities/delete/:id', requireAuth, async (req, res) => {
    try {
        const activityId = req.params.id;
        await db.get().collection(collections.DAILY_ACTIVITY_COLLECTION).deleteOne({
            _id: new ObjectId(activityId)
        });
        return res.redirect('/admin/activities');
    } catch (err) {
        console.error("Delete activity error:", err);
        return res.redirect('/admin/activities');
    }
});

// ---------------------------------------------
// STUDENT MARKS & COMPARISON GRAPH ROUTES
// ---------------------------------------------

// GET /admin/marks
router.get('/marks', requireAuth, async (req, res) => {
    try {
        const database = db.get();
        const students = await database.collection(collections.STUDENT_COLLECTION).find().sort({ name: 1 }).toArray();
        const marksRecords = await database.collection(collections.STUDENT_MARKS_COLLECTION).find().sort({ createdAt: -1 }).toArray();

        res.render('admin/marks', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            students,
            marksRecords
        });
    } catch (err) {
        console.error("Marks view error:", err);
        res.render('admin/marks', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            students: [],
            marksRecords: []
        });
    }
});

// POST /admin/marks/save
router.post('/admin/marks/save', requireAuth, async (req, res) => {
    return res.redirect(307, '/admin/marks/save');
});

router.post('/marks/save', requireAuth, async (req, res) => {
    try {
        const { studentId, examTerm, academicYear, overallRemarks } = req.body;
        const database = db.get();

        const student = await database.collection(collections.STUDENT_COLLECTION).findOne({ studentId });
        if (!student) {
            return res.redirect('/admin/marks?error=student_not_found');
        }

        // Parse arrays from form submission
        const subjectNames = Array.isArray(req.body.subjectNames) ? req.body.subjectNames : [req.body.subjectNames];
        const maxMarksArr = Array.isArray(req.body.maxMarks) ? req.body.maxMarks : [req.body.maxMarks];
        const schoolMarksArr = Array.isArray(req.body.schoolMarks) ? req.body.schoolMarks : [req.body.schoolMarks];
        const paadashalaMarksArr = Array.isArray(req.body.paadashalaMarks) ? req.body.paadashalaMarks : [req.body.paadashalaMarks];
        const subjectRemarksArr = Array.isArray(req.body.subjectRemarks) ? req.body.subjectRemarks : [req.body.subjectRemarks];

        let totalMax = 0;
        let totalSchool = 0;
        let totalPaadashala = 0;

        const subjects = [];
        for (let i = 0; i < subjectNames.length; i++) {
            const maxM = Number(maxMarksArr[i]) || 100;
            const schM = Number(schoolMarksArr[i]) || 0;
            const paaM = Number(paadashalaMarksArr[i]) || 0;
            const diff = parseFloat((paaM - schM).toFixed(1));

            totalMax += maxM;
            totalSchool += schM;
            totalPaadashala += paaM;

            subjects.push({
                name: subjectNames[i],
                maxMarks: maxM,
                schoolMarks: schM,
                paadashalaMarks: paaM,
                difference: diff,
                remarks: subjectRemarksArr[i] ? subjectRemarksArr[i].trim() : ''
            });
        }

        const schoolPercentage = totalMax > 0 ? parseFloat(((totalSchool / totalMax) * 100).toFixed(1)) : 0;
        const paadashalaPercentage = totalMax > 0 ? parseFloat(((totalPaadashala / totalMax) * 100).toFixed(1)) : 0;
        const improvement = parseFloat((paadashalaPercentage - schoolPercentage).toFixed(1));

        const markDoc = {
            studentId,
            studentName: student.name,
            class: student.class,
            academicYear: academicYear || student.academicYear || '2026-2027',
            examTerm,
            subjects,
            totalMax,
            totalSchool,
            totalPaadashala,
            schoolPercentage,
            paadashalaPercentage,
            improvement,
            remarks: overallRemarks ? overallRemarks.trim() : `പാഠശാലയിലൂടെ ${improvement}% മാർക്ക് വർദ്ധനവ് രേഖപ്പെടുത്തിയിട്ടുണ്ട്.`,
            updatedAt: new Date()
        };

        const marksCol = database.collection(collections.STUDENT_MARKS_COLLECTION);
        await marksCol.updateOne(
            { studentId, examTerm, academicYear: markDoc.academicYear },
            { $set: markDoc, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
        );

        // Notify parent
        const parentPhone = student.parentNo || student.phone;
        sendNotification(database, {
            studentId: student.studentId,
            parentPhone: parentPhone,
            targetClass: student.class,
            title: `📊 ${student.name}ന്റെ ${examTerm} പരീക്ഷാ മാർക്കുകൾ`,
            message: `സ്കൂൾ മാർക്ക്: ${schoolPercentage}%, പാഠശാല മാർക്ക്: ${paadashalaPercentage}% (+${improvement}% വർദ്ധനവ്). പ്രോഗ്രസ്സ് ഗ്രാഫ് പരിശോധിക്കാം.`,
            type: 'marks',
            url: '/marks'
        }).catch(e => console.error("Marks notification error:", e.message));

        return res.redirect('/admin/marks');
    } catch (err) {
        console.error("Save marks error:", err);
        return res.redirect('/admin/marks');
    }
});

// POST /admin/marks/delete/:id
router.post('/marks/delete/:id', requireAuth, async (req, res) => {
    try {
        const markId = req.params.id;
        await db.get().collection(collections.STUDENT_MARKS_COLLECTION).deleteOne({
            _id: new ObjectId(markId)
        });
        return res.redirect('/admin/marks');
    } catch (err) {
        console.error("Delete marks error:", err);
        return res.redirect('/admin/marks');
    }
});

// ---------------------------------------------
// TIMETABLE ROUTES (ADMIN)
// ---------------------------------------------
const { getTimetableForClass, getTodaySchedule, sendTodayTimetableNotifications, DAYS } = require('../helpers/timetable-helper');

// GET /admin/timetable
router.get('/timetable', requireAuth, async (req, res) => {
    try {
        const database = db.get();
        const selectedClass = req.query.class || 'Class 10';
        const schedule = await getTimetableForClass(database, selectedClass);
        const todayData = await getTodaySchedule(database, selectedClass);

        const teachers = await database.collection(collections.TEACHER_COLLECTION).find().sort({ name: 1 }).toArray();

        res.render('admin/timetable', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            selectedClass,
            schedule,
            todayData,
            teachers,
            days: DAYS,
            reminderSuccess: req.query.success === 'reminder_sent',
            sentCount: req.query.count || 0,
            reminderDay: req.query.day || ''
        });
    } catch (err) {
        console.error("Timetable admin view error:", err);
        res.render('admin/timetable', {
            layout: isAjax(req) ? false : 'admin-layout',
            adminUser: req.session.adminUser,
            selectedClass: 'Class 10',
            schedule: [],
            todayData: { day: 'Today', periods: [] },
            teachers: [],
            days: DAYS
        });
    }
});

// POST /admin/timetable/save-period
router.post('/timetable/save-period', requireAuth, async (req, res) => {
    try {
        const { className, day, time, subject, teacher, books } = req.body;
        const database = db.get();
        const col = database.collection(collections.TIMETABLE_COLLECTION);

        let timetableDoc = await col.findOne({ class: className });
        let schedule = (timetableDoc && timetableDoc.schedule) ? timetableDoc.schedule : [];

        let dayEntry = schedule.find(d => d.day.toLowerCase() === (day || '').toLowerCase());
        if (!dayEntry) {
            dayEntry = { day: day, periods: [] };
            schedule.push(dayEntry);
        }

        dayEntry.periods.push({
            time: (time || '').trim(),
            subject: (subject || '').trim(),
            teacher: (teacher || '').trim(),
            books: (books || '').trim() || `${subject} Text Book & Note Book`
        });

        await col.updateOne(
            { class: className },
            { $set: { class: className, schedule, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
        );

        return res.redirect(`/admin/timetable?class=${encodeURIComponent(className)}`);
    } catch (err) {
        console.error("Save timetable period error:", err);
        return res.redirect('/admin/timetable');
    }
});

// POST /admin/timetable/delete-period
router.post('/timetable/delete-period', requireAuth, async (req, res) => {
    try {
        const { className, day, periodIndex } = req.body;
        const database = db.get();
        const col = database.collection(collections.TIMETABLE_COLLECTION);

        let timetableDoc = await col.findOne({ class: className });
        if (timetableDoc && timetableDoc.schedule) {
            const dayEntry = timetableDoc.schedule.find(d => d.day.toLowerCase() === (day || '').toLowerCase());
            if (dayEntry && dayEntry.periods) {
                const idx = parseInt(periodIndex, 10);
                if (!isNaN(idx) && idx >= 0 && idx < dayEntry.periods.length) {
                    dayEntry.periods.splice(idx, 1);
                    await col.updateOne(
                        { class: className },
                        { $set: { schedule: timetableDoc.schedule, updatedAt: new Date() } }
                    );
                }
            }
        }

        return res.redirect(`/admin/timetable?class=${encodeURIComponent(className)}`);
    } catch (err) {
        console.error("Delete timetable period error:", err);
        return res.redirect('/admin/timetable');
    }
});

// POST /admin/timetable/send-reminder
router.post('/timetable/send-reminder', requireAuth, async (req, res) => {
    try {
        const { className } = req.body;
        const database = db.get();
        const result = await sendTodayTimetableNotifications(database, className || null);
        return res.redirect(`/admin/timetable?class=${encodeURIComponent(className || 'Class 10')}&success=reminder_sent&count=${result.sent}&day=${encodeURIComponent(result.day)}`);
    } catch (err) {
        console.error("Send timetable reminder error:", err);
        return res.redirect('/admin/timetable');
    }
});

module.exports = router;
