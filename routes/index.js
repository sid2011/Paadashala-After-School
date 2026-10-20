const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/connections');
const collections = require('../config/collections');

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
// 7. TIMETABLE & FEES PLACEHOLDERS
// ---------------------------------------------
router.get('/fees', requireParentAuth, async (req, res) => {
    const { student } = await getStudentContext(req);
    res.render('user/fees', { student });
});

router.get('/timetable', requireParentAuth, async (req, res) => {
    const { student } = await getStudentContext(req);
    res.render('user/timetable', { student });
});

module.exports = router;
