const collections = require('../config/collections');
const { sendNotification } = require('./notification-helper');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDefaultWeeklySchedule(className = 'Class 10') {
    return [
        {
            day: 'Monday',
            periods: [
                { time: '04:30 PM – 05:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & 200-page Note Book' },
                { time: '05:30 PM – 06:30 PM', subject: 'Physics', teacher: 'Smt. Deepa Nair', books: 'Physics Text Book & Note Book' },
                { time: '06:30 PM – 07:30 PM', subject: 'Chemistry', teacher: 'Sri. Arun Kumar', books: 'Chemistry Text Book & Formula Book' }
            ]
        },
        {
            day: 'Tuesday',
            periods: [
                { time: '04:30 PM – 05:30 PM', subject: 'Biology', teacher: 'Smt. Deepa Nair', books: 'Biology Text Book & Diagram Note Book' },
                { time: '05:30 PM – 06:30 PM', subject: 'Mathematics', teacher: 'Sri. Rajesh Kumar', books: 'Maths Text Book & Geometry Box' },
                { time: '06:30 PM – 07:30 PM', subject: 'English', teacher: 'Smt. Lakshmi', books: 'English Reader & Grammar Work Book' }
            ]
        },
        {
            day: 'Wednesday',
            periods: [
                { time: '04:30 PM – 05:30 PM', subject: 'Physics', teacher: 'Smt. Deepa Nair', books: 'Physics Text Book & Problems Note Book' },
                { time: '05:30 PM – 06:30 PM', subject: 'Chemistry', teacher: 'Sri. Arun Kumar', books: 'Chemistry Text Book & Equation Sheet' },
                { time: '06:30 PM – 07:30 PM', subject: 'Social Science', teacher: 'Sri. Anoop Thomas', books: 'Social Science History/Civics Text Book' }
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
}

async function getTimetableForClass(database, className = 'Class 10') {
    const col = database.collection(collections.TIMETABLE_COLLECTION);
    const existing = await col.findOne({ class: className });
    if (existing && existing.schedule && existing.schedule.length) {
        return existing.schedule;
    }

    // Initialize with default template
    const defaultSchedule = getDefaultWeeklySchedule(className);
    await col.updateOne(
        { class: className },
        { $set: { class: className, schedule: defaultSchedule, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    );
    return defaultSchedule;
}

function getDayName(date = new Date()) {
    const dayIndex = date.getDay();
    // 0 = Sunday, 1 = Monday, ...
    const map = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return map[dayIndex];
}

async function getTodaySchedule(database, className = 'Class 10', targetDate = new Date()) {
    const schedule = await getTimetableForClass(database, className);
    const todayName = getDayName(targetDate);
    const dayEntry = schedule.find(d => d.day.toLowerCase() === todayName.toLowerCase());
    return {
        day: todayName,
        isSunday: todayName === 'Sunday',
        periods: dayEntry ? dayEntry.periods : []
    };
}

async function sendTodayTimetableNotifications(database, filterClass = null) {
    const todayName = getDayName();
    if (todayName === 'Sunday') {
        return { sent: 0, reason: 'Sunday is a holiday' };
    }

    const query = filterClass ? {
        $or: [{ class: filterClass }, { class: Number(String(filterClass).replace(/\D/g, '')) }]
    } : {};

    const students = await database.collection(collections.STUDENT_COLLECTION).find(query).toArray();
    let count = 0;

    for (const student of students) {
        const studentClass = student.class || 'Class 10';
        const todayData = await getTodaySchedule(database, studentClass);
        if (!todayData || !todayData.periods || !todayData.periods.length) continue;

        const subjectNames = todayData.periods.map(p => p.subject);
        const bookItems = todayData.periods.map(p => `${p.subject} (${p.books || 'Text & Note Book'})`);

        const parentPhone = student.parentNo || student.phone;
        const notification = {
            studentId: student.studentId,
            parentPhone: parentPhone,
            targetClass: studentClass,
            title: `🎒 ഇന്നത്തെ പാഠശാല ക്ലാസുകൾ (${todayName})`,
            message: `ഇന്നത്തെ ക്ലാസുകൾ: ${subjectNames.join(', ')}. ടെക്സ്റ്റ് ബുക്കുകളും നോട്ട് ബുക്കുകളും മറക്കാതെ എടുത്തു നൽകുമല്ലോ!`,
            type: 'timetable',
            url: '/timetable',
            booksList: bookItems
        };

        await sendNotification(database, notification).catch(e => console.error("Timetable notification error:", e.message));
        count++;
    }

    return { sent: count, day: todayName };
}

let autoSchedulerRunning = false;
let lastNotifiedDate = null;

function initTimetableAutoScheduler(database) {
    if (autoSchedulerRunning) return;
    autoSchedulerRunning = true;

    // Check periodically (every 15 minutes)
    setInterval(async () => {
        try {
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const currentHour = now.getHours(); // 0 - 23

            // Trigger automatically around 2:00 PM (14:00) or 3:00 PM (15:00) on weekdays before after-school coaching starts
            if (currentHour >= 14 && currentHour <= 16 && lastNotifiedDate !== todayStr) {
                const dayName = getDayName(now);
                if (dayName !== 'Sunday') {
                    console.log(`[Timetable Scheduler] Auto-dispatching daily book reminder notifications for ${todayStr} (${dayName})...`);
                    await sendTodayTimetableNotifications(database);
                    lastNotifiedDate = todayStr;
                    console.log(`[Timetable Scheduler] Completed daily notifications successfully.`);
                }
            }
        } catch (err) {
            console.error("[Timetable Scheduler] Error in auto-check:", err.message);
        }
    }, 15 * 60 * 1000);
}

module.exports = {
    DAYS,
    getDefaultWeeklySchedule,
    getTimetableForClass,
    getDayName,
    getTodaySchedule,
    sendTodayTimetableNotifications,
    initTimetableAutoScheduler
};
