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
                address: "Kottaram Road, West Hill, Calicut",
                createdAt: new Date("2026-06-10")
            },
            {
                studentId: "PAD1029",
                name: "Meenakshi S",
                parentName: "Sivadasan",
                parentNo: "9876543215",
                class: "Class 5",
                shift: "Evening",
                academicYear: "2026-2027",
                address: "Nirmalyam, Medical College, Calicut",
                createdAt: new Date("2026-06-12")
            }
        ];

        const studentCol = db.collection(collections.STUDENT_COLLECTION);
        for (const s of students) {
            await studentCol.updateOne(
                { studentId: s.studentId },
                { $set: s },
                { upsert: true }
            );
        }
        console.log(`✅ Seeded ${students.length} students across Morning, Afternoon, and Evening shifts.`);

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

        for (const s of students) {
            dates.forEach((d, idx) => {
                // Occasional absent for realistic stats
                const isAbsent = (s.studentId === "PAD1024" && idx === 3) || (s.studentId === "PAD1026" && idx === 5);
                attendanceOps.push({
                    updateOne: {
                        filter: { date: d, studentId: s.studentId },
                        update: {
                            $set: {
                                date: d,
                                studentId: s.studentId,
                                studentName: s.name,
                                class: s.class,
                                shift: s.shift,
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
        console.log(`✅ Seeded daily attendance records for all students across test dates.`);

        // -------------------------------------------------------------
        // 4. SEED TEACHER OPINIONS
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
        // 5. SEED BROADCAST ANNOUNCEMENTS
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
