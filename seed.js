/**
 * Paadashala After-School Platform
 * Comprehensive Database Seeder (Students, Parents, Attendance, Opinions, Announcements)
 * 
 * Run with: node seed.js
 */

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const collections = require('./config/collections');
const { ensureFeeIndexes, generateStudentFees } = require('./helpers/fee-helper');

async function seedDatabase() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("❌ ERROR: MONGODB_URI is not defined in your environment.");
        process.exit(1);
    }

    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db("Paadashala");
        console.log(" Connected to MongoDB: Paadashala");

        const hashedPassword = bcrypt.hashSync("parent123", 10);
        console.log("🔒 Generated Bcrypt Hashed Password for 'parent123':", hashedPassword);

        // -------------------------------------------------------------
        // 1. SEED STUDENTS
        // -------------------------------------------------------------
        const students = [
            {
                studentId: "PAD1024",
                name: "Sidharth B",
                parentName: "Radhakrishnan",
                parentNo: "9876543210",
                class: "Class 10",
                shift: "Morning",
                academicYear: "2026-2027",
                monthlyFee: 5000,
                admissionMonth: "June",
                address: "Paadashala Campus, Kozhikode",
                createdAt: new Date("2026-06-01")
            },
            {
                studentId: "PAD1025",
                name: "Ananya Nair",
                parentName: "Suresh Nair",
                parentNo: "9876543211",
                class: "Class 8",
                shift: "Morning",
                academicYear: "2026-2027",
                monthlyFee: 4500,
                admissionMonth: "June",
                address: "Green Valley, Mavoor Road, Calicut",
                createdAt: new Date("2026-06-02")
            },
            {
                studentId: "PAD1026",
                name: "Rahul Krishna",
                parentName: "Krishnan Kutty",
                parentNo: "9876543212",
                class: "Class 8",
                shift: "Afternoon",
                academicYear: "2026-2027",
                monthlyFee: 4500,
                admissionMonth: "June",
                address: "Souparnika, Palazhi, Calicut",
                createdAt: new Date("2026-06-05")
            },
            {
                studentId: "PAD1027",
                name: "Fathima Zahra",
                parentName: "Abdul Rahman",
                parentNo: "9876543213",
                class: "Class 8",
                shift: "Evening",
                academicYear: "2026-2027",
                monthlyFee: 4500,
                admissionMonth: "June",
                address: "Al-Huda, Feroke, Kozhikode",
                createdAt: new Date("2026-06-08")
            },
            {
                studentId: "PAD1028",
                name: "Adithya Varma",
                parentName: "Varma K",
                parentNo: "9876543214",
                class: "Class 5",
                shift: "Morning",
                academicYear: "2026-2027",
                monthlyFee: 4000,
                admissionMonth: "August", // Mid-year admission demo
                address: "Kottaram Road, West Hill, Calicut",
                createdAt: new Date("2026-08-10")
            },
            {
                studentId: "PAD1029",
                name: "Meenakshi S",
                parentName: "Sivadasan",
                parentNo: "9876543215",
                class: "Class 5",
                shift: "Evening",
                academicYear: "2026-2027",
                monthlyFee: 4000,
                admissionMonth: "June",
                address: "Nirmalyam, Medical College, Calicut",
                createdAt: new Date("2026-06-12")
            }
        ];

        const studentCol = db.collection(collections.STUDENT_COLLECTION);
        await ensureFeeIndexes(db);

        for (const s of students) {
            await studentCol.updateOne(
                { studentId: s.studentId },
                { $set: s },
                { upsert: true }
            );
            await generateStudentFees(db, s, s.admissionMonth);
        }
        console.log(`✅ Seeded ${students.length} students and generated their academic fee schedules.`);

        // -------------------------------------------------------------
        // 2. SEED PARENTS (WITH HASHED PASSWORDS)
        // -------------------------------------------------------------
        const parentCol = db.collection(collections.PARENT_COLLECTION);
        for (const s of students) {
            const parentRecord = {
                phone: s.parentNo,
                parentName: s.parentName,
                studentId: s.studentId,
                studentName: s.name,
                password: hashedPassword, // 'parent123' hashed with bcrypt
                updatedAt: new Date()
            };
            await parentCol.updateOne(
                { phone: s.parentNo },
                { $set: parentRecord },
                { upsert: true }
            );
        }
        console.log(`✅ Seeded parents with bcrypt-hashed passwords ('parent123').`);

        // -------------------------------------------------------------
        // 3. SEED ATTENDANCE RECORDS (LAST 10 DAYS)
        // -------------------------------------------------------------
        const attendanceCol = db.collection(collections.STUDENT_ATTENDANCE_COLLECTION);
        const attendanceOps = [];

        const dates = [
            "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14",
            "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"
        ];

        const subjectsList = ["Mathematics", "Physics", "Chemistry", "English"];

        for (const s of students) {
            dates.forEach((d, idx) => {
                // Distribute subjects across dates
                const sub = subjectsList[idx % subjectsList.length];
                // Occasional absent for realistic stats
                const isAbsent = (s.studentId === "PAD1024" && idx === 3) || (s.studentId === "PAD1026" && idx === 5);
                attendanceOps.push({
                    updateOne: {
                        filter: { date: d, studentId: s.studentId, subject: sub },
                        update: {
                            $set: {
                                date: d,
                                studentId: s.studentId,
                                studentName: s.name,
                                class: s.class,
                                shift: s.shift,
                                subject: sub,
                                status: isAbsent ? "absent" : "present",
                                updatedAt: new Date()
                            }
                        },
                        upsert: true
                    }
                });
            });
        }

        await attendanceCol.bulkWrite(attendanceOps);
        console.log(`✅ Seeded subject-wise daily attendance records for all students across test dates.`);

        // -------------------------------------------------------------
        // 4. SEED DAILY ACTIVITIES & HOMEWORK
        // -------------------------------------------------------------
        const activityCol = db.collection(collections.DAILY_ACTIVITY_COLLECTION);
        const sampleActivities = [
            {
                date: "2026-10-21",
                class: "Class 10",
                subject: "Mathematics",
                shift: "Morning",
                teacherName: "Smt. Lakshmi N",
                topic: "Quadratic Equations - Formula Method",
                description: "സൂത്രവാക്യം ഉപയോഗിച്ച് സമവാക്യങ്ങൾ നിർദ്ധാരണം ചെയ്യുന്ന രീതി വിശദീകരിച്ചു. പേജ് 82-ലെ 1 മുതൽ 5 വരെയുള്ള ചോദ്യങ്ങൾ ക്ലാസ്സിൽ ചെയ്തു.",
                homework: "ടെക്സ്റ്റ് ബുക്ക് പേജ് 84-ലെ ചോദ്യം 6, 7 എന്നിവ നോട്ട്ബുക്കിൽ ചെയ്ത് വരിക.",
                author: "Administrator",
                createdAt: new Date("2026-10-21T09:30:00")
            },
            {
                date: "2026-10-21",
                class: "Class 10",
                subject: "Physics",
                shift: "Evening",
                teacherName: "Sri. Rajesh Kumar",
                topic: "Refraction of Light & Snell's Law",
                description: "പ്രകാശത്തിന്റെ അപവർത്തനം, സ്നെൽസ് നിയമം എന്നിവ ചിത്രങ്ങൾ സഹിതം വിശദീകരിച്ചു. പ്രോബ്ലംസ് വർക്ക്ഔട്ട് ചെയ്തു.",
                homework: "സ്നെൽസ് നിയമത്തിന്റെ സമവാക്യം 3 തവണ എഴുതി പഠിക്കുക.",
                author: "Administrator",
                createdAt: new Date("2026-10-21T11:00:00")
            },
            {
                date: "2026-10-20",
                class: "Class 10",
                subject: "Chemistry",
                shift: "All Batches",
                teacherName: "Smt. Divya P",
                topic: "Periodic Table & Periodic Trends",
                description: "പീരിയോഡിക് ടേബിളിലെ മൂലകങ്ങളുടെ ഇലക്ട്രോൺ വിന്യാസം, വലിപ്പം, അയോണീകരണ ഊർജ്ജം എന്നിവ ചർച്ച ചെയ്തു.",
                homework: "ആദ്യത്തെ 20 മൂലകങ്ങളുടെ ഇലക്ട്രോൺ വിന്യാസം പൂർത്തിയാക്കുക.",
                author: "Administrator",
                createdAt: new Date("2026-10-20T10:00:00")
            }
        ];

        for (const act of sampleActivities) {
            await activityCol.updateOne(
                { topic: act.topic, date: act.date },
                { $set: act },
                { upsert: true }
            );
        }
        console.log(`✅ Seeded sample daily class activities and homework.`);

        // -------------------------------------------------------------
        // 5. SEED STUDENT MARKS & SCHOOL VS PAADASHALA COMPARISON
        // -------------------------------------------------------------
        const marksCol = db.collection(collections.STUDENT_MARKS_COLLECTION);
        const sampleMarks = [
            {
                studentId: "PAD1024",
                studentName: "Sidharth B",
                class: "Class 10",
                academicYear: "2026-2027",
                examTerm: "Term 1 (Onam / First Term)",
                subjects: [
                    { name: "Mathematics", maxMarks: 100, schoolMarks: 65, paadashalaMarks: 88, difference: 23, remarks: "Excellent algebra practice" },
                    { name: "Physics", maxMarks: 100, schoolMarks: 58, paadashalaMarks: 82, difference: 24, remarks: "Concepts clarified well" },
                    { name: "Chemistry", maxMarks: 100, schoolMarks: 60, paadashalaMarks: 85, difference: 25, remarks: "Equations mastered" },
                    { name: "Biology", maxMarks: 100, schoolMarks: 70, paadashalaMarks: 90, difference: 20, remarks: "Neat diagram work" },
                    { name: "English", maxMarks: 100, schoolMarks: 72, paadashalaMarks: 86, difference: 14, remarks: "Good grammar grasp" },
                    { name: "Social Science", maxMarks: 100, schoolMarks: 64, paadashalaMarks: 84, difference: 20, remarks: "Historical facts accurate" }
                ],
                totalMax: 600,
                totalSchool: 389,
                totalPaadashala: 515,
                schoolPercentage: 64.8,
                paadashalaPercentage: 85.8,
                improvement: 21.0,
                remarks: "പാഠശാല കോച്ചിംഗിലൂടെ സ്കൂൾ പരീക്ഷയെ അപേക്ഷിച്ച് 21% മാർക്ക് വർദ്ധനവ് നേടിയിട്ടുണ്ട്. മികച്ച മുന്നേറ്റം!",
                createdAt: new Date("2026-09-25")
            },
            {
                studentId: "PAD1024",
                studentName: "Sidharth B",
                class: "Class 10",
                academicYear: "2026-2027",
                examTerm: "Term 2 (Christmas / Second Term)",
                subjects: [
                    { name: "Mathematics", maxMarks: 100, schoolMarks: 72, paadashalaMarks: 94, difference: 22, remarks: "Outstanding problem solving" },
                    { name: "Physics", maxMarks: 100, schoolMarks: 65, paadashalaMarks: 89, difference: 24, remarks: "Formula derivations clear" },
                    { name: "Chemistry", maxMarks: 100, schoolMarks: 68, paadashalaMarks: 91, difference: 23, remarks: "Organic chemistry strong" },
                    { name: "Biology", maxMarks: 100, schoolMarks: 75, paadashalaMarks: 93, difference: 18, remarks: "Full score in diagrams" },
                    { name: "English", maxMarks: 100, schoolMarks: 76, paadashalaMarks: 88, difference: 12, remarks: "Essay writing refined" },
                    { name: "Social Science", maxMarks: 100, schoolMarks: 70, paadashalaMarks: 89, difference: 19, remarks: "Geography maps perfect" }
                ],
                totalMax: 600,
                totalSchool: 426,
                totalPaadashala: 544,
                schoolPercentage: 71.0,
                paadashalaPercentage: 90.7,
                improvement: 19.7,
                remarks: "രണ്ടാം പാദപരീക്ഷയിൽ 90.7% മാർക്കോടെ എ പ്ലസ് നിലവാരത്തിലേക്ക് ഉയർന്നു.",
                createdAt: new Date("2026-10-15")
            }
        ];

        for (const m of sampleMarks) {
            await marksCol.updateOne(
                { studentId: m.studentId, examTerm: m.examTerm },
                { $set: m },
                { upsert: true }
            );
        }
        console.log(`✅ Seeded student comparison marks reports with School vs Paadashala graph data.`);

        // -------------------------------------------------------------
        // 6. SEED TEACHER OPINIONS
        // -------------------------------------------------------------
        const opinionCol = db.collection(collections.TEACHER_OPINION_COLLECTION);
        const sampleOpinions = [
            {
                class: "Class 10",
                studentId: "PAD1024",
                studentName: "Sidharth B",
                subject: "Mathematics",
                teacherName: "Smt. Lakshmi N",
                opinion: "കണക്കിൽ നല്ല പുരോഗതിയുണ്ട്. ത്രികോണമിതിയും ജ്യാമിതിയും കൂടുതൽ സമയം പരിശീലിക്കണം.",
                createdAt: new Date("2026-10-18")
            },
            {
                class: "Class 10",
                studentId: "PAD1024",
                studentName: "Sidharth B",
                subject: "Physics",
                teacherName: "Sri. Rajesh Kumar",
                opinion: "Good active participation in physics homework discussion. Keep up the high focus.",
                createdAt: new Date("2026-10-15")
            },
            {
                class: "Class 8",
                studentId: "PAD1025",
                studentName: "Ananya Nair",
                subject: "Mathematics",
                teacherName: "Smt. Lakshmi N",
                opinion: "കൃത്യസമയത്ത് ഹോംവർക്കുകൾ പൂർത്തിയാക്കുന്നുണ്ട്. ആൾജിബ്ര വിഭാഗത്തിൽ മികച്ച മാർക്ക് നേടിയിട്ടുണ്ട്.",
                createdAt: new Date("2026-10-19")
            }
        ];

        for (const op of sampleOpinions) {
            await opinionCol.updateOne(
                { studentId: op.studentId, subject: op.subject, date: op.createdAt },
                { $set: op },
                { upsert: true }
            );
        }
        console.log(`✅ Seeded sample teacher feedback notes.`);

        // -------------------------------------------------------------
        // 5. SEED TIMETABLES FOR CLASS 10 & CLASS 8
        // -------------------------------------------------------------
        const timetableCol = db.collection(collections.TIMETABLE_COLLECTION);
        const class10Schedule = [
            {
                day: 'Monday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & 200-page Note Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Physics', teacher: 'Smt. Deepa Nair', books: 'Physics Text Book & Note Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'Chemistry', teacher: 'Sri. Arun Kumar', books: 'Chemistry Text Book & Formula Sheet' }
                ]
            },
            {
                day: 'Tuesday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Biology', teacher: 'Smt. Deepa Nair', books: 'Biology Text Book & Diagram Note Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & Geometry Box' },
                    { time: '06:30 PM – 07:30 PM', subject: 'English', teacher: 'Smt. Lakshmi', books: 'English Reader & Note Book' }
                ]
            },
            {
                day: 'Wednesday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Physics', teacher: 'Smt. Deepa Nair', books: 'Physics Text Book & Problems Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Chemistry', teacher: 'Sri. Arun Kumar', books: 'Chemistry Text Book & Equation Sheet' },
                    { time: '06:30 PM – 07:30 PM', subject: 'Social Science', teacher: 'Sri. Anoop Thomas', books: 'History & Civics Text Book' }
                ]
            },
            {
                day: 'Thursday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & Note Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Biology', teacher: 'Smt. Deepa Nair', books: 'Biology Text Book & Note Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'Malayalam', teacher: 'Smt. Sarada', books: 'Malayalam Text Book & Note Book' }
                ]
            },
            {
                day: 'Friday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Chemistry', teacher: 'Sri. Arun Kumar', books: 'Chemistry Text Book & Note Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Physics', teacher: 'Smt. Deepa Nair', books: 'Physics Text Book & Note Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Revision Workbook' }
                ]
            },
            {
                day: 'Saturday',
                periods: [
                    { time: '09:30 AM – 11:30 AM', subject: 'Special Revision / Test Series', teacher: 'Sri. Rajesh Kumar & Smt. Deepa Nair', books: 'All Subject Question Banks & Exam Pad' }
                ]
            }
        ];

        const class8Schedule = [
            {
                day: 'Monday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & Note Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Science', teacher: 'Smt. Deepa Nair', books: 'General Science Text Book & Note Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'English', teacher: 'Smt. Lakshmi', books: 'English Reader & Note Book' }
                ]
            },
            {
                day: 'Tuesday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Social Science', teacher: 'Sri. Anoop Thomas', books: 'Social Science Text Book & Map Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & Note Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'Malayalam', teacher: 'Smt. Sarada', books: 'Malayalam Reader & Note Book' }
                ]
            },
            {
                day: 'Wednesday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Science', teacher: 'Smt. Deepa Nair', books: 'General Science Text Book & Note Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Problem Note Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'Hindi', teacher: 'Sri. Varma', books: 'Hindi Text Book & Note Book' }
                ]
            },
            {
                day: 'Thursday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & Note Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Science', teacher: 'Smt. Deepa Nair', books: 'General Science Text Book & Activity Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'English', teacher: 'Smt. Lakshmi', books: 'English Grammar Book' }
                ]
            },
            {
                day: 'Friday',
                periods: [
                    { time: '04:30 PM – 05:30 PM', subject: 'Social Science', teacher: 'Sri. Anoop Thomas', books: 'Social Science Text Book' },
                    { time: '05:30 PM – 06:30 PM', subject: 'Science', teacher: 'Smt. Deepa Nair', books: 'General Science Revision Book' },
                    { time: '06:30 PM – 07:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Note Book' }
                ]
            },
            {
                day: 'Saturday',
                periods: [
                    { time: '09:30 AM – 11:30 AM', subject: 'Weekly Assessment', teacher: 'Sri. Rajesh Kumar', books: 'Test Pad & Pencil Box' }
                ]
            }
        ];

        await timetableCol.updateOne(
            { class: 'Class 10' },
            { $set: { class: 'Class 10', schedule: class10Schedule, updatedAt: new Date() } },
            { upsert: true }
        );

        await timetableCol.updateOne(
            { class: 'Class 8' },
            { $set: { class: 'Class 8', schedule: class8Schedule, updatedAt: new Date() } },
            { upsert: true }
        );
        console.log(`✅ Seeded weekly timetables for Class 10 and Class 8 with textbooks and notebooks.`);

        // -------------------------------------------------------------
        // 6. SEED BROADCAST ANNOUNCEMENTS
        // -------------------------------------------------------------
        const announcementCol = db.collection(collections.ANNOUNCEMENT_COLLECTION);
        const sampleAnnouncements = [
            {
                title: "സ്പെഷ്യൽ മോർണിംഗ് റിവിഷൻ ക്ലാസുകൾ ആരംഭിക്കുന്നു",
                content: "പത്താം ക്ലാസ്സിലെ വിദ്യാർത്ഥികൾക്കായി രാവിലെ 6:30 മുതൽ 8:30 വരെയുള്ള മോർണിംഗ് ഷിഫ്റ്റ് സ്പെഷ്യൽ റിവിഷൻ ക്ലാസുകൾ ആരംഭിച്ചു. എല്ലാ രക്ഷിതാക്കളും ശ്രദ്ധിക്കുക.",
                category: "General",
                target: "all",
                priority: "Normal",
                pinned: true,
                author: "Administrator",
                createdAt: new Date("2026-10-20")
            },
            {
                title: "ഒന്നാം പാദപരീക്ഷാ ഫലപ്രഖ്യാപനം",
                content: "ആഫ്റ്റർ സ്കൂൾ സെന്ററിലെ മോഡൽ പരീക്ഷാ ഫലങ്ങൾ അടുത്ത തിങ്കളാഴ്ച രക്ഷിതാക്കൾക്ക് പരിശോധിക്കാം.",
                category: "Exam",
                target: "Class 10",
                priority: "Important",
                pinned: false,
                author: "Administrator",
                createdAt: new Date("2026-10-19")
            }
        ];

        for (const ann of sampleAnnouncements) {
            await announcementCol.updateOne(
                { title: ann.title },
                { $set: ann },
                { upsert: true }
            );
        }
        console.log(`✅ Seeded official broadcast announcements.`);

        console.log("\n🎉 ALL SEED DATA SUCCESSFULLY INITIALIZED!");
        console.log("\n🔑 Test Credentials for Parents:");
        console.log("   Phone: 9876543210 (Sidharth B - Class 10 Morning)");
        console.log("   Phone: 9876543211 (Ananya Nair - Class 8 Morning)");
        console.log("   Phone: 9876543212 (Rahul Krishna - Class 8 Afternoon)");
        console.log("   Phone: 9876543213 (Fathima Zahra - Class 8 Evening)");
        console.log("   Password for all test parents: parent123");

    } catch (err) {
        console.error("❌ Seeding Error:", err.message);
    } finally {
        await client.close();
        process.exit(0);
    }
}

seedDatabase();
