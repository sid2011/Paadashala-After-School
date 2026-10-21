const webpush = require('web-push');
const { ObjectId } = require('mongodb');
const collections = require('../config/collections');

// Deterministic VAPID Keys for Paadashala Web Push
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BO7wWo16eoine_qZjI5PXQ26-XSFbGL0PDNM4k0r3obOFCxH8_kMIII_InIIX1xXlZmd7QsVt-4AakkXm0s5kCM';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '3mMT1n4c0n6vPLyHeNw2HIkgIbq1gWJQ_ufiHcepQms';

try {
  webpush.setVapidDetails(
    'mailto:support@paadashala.in',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.error('VAPID setup notice:', e.message);
}

/**
 * Save or update a parent's Web Push Subscription
 */
async function savePushSubscription(db, { studentId, parentPhone, subscription }) {
  if (!db || !subscription || !subscription.endpoint) return;

  const subCol = db.collection(collections.PUSH_SUBSCRIPTION_COLLECTION);
  await subCol.updateOne(
    { endpoint: subscription.endpoint },
    {
      $set: {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        studentId: studentId || null,
        parentPhone: parentPhone || null,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
}

/**
 * Dispatch Push Notification + In-App Notification Record
 */
async function sendNotification(db, { studentId, parentPhone, targetClass, title, message, type = 'general', url = '/', icon = '/images/apple-touch-icon.png' }) {
  if (!db) return;

  const notifCol = db.collection(collections.NOTIFICATION_COLLECTION);

  // 1. Create in-app notification record
  const notifRecord = {
    studentId: studentId || null,
    parentPhone: parentPhone || null,
    targetClass: targetClass || null,
    title: title || 'Paadashala Notification',
    message: message || '',
    type: type, // 'attendance', 'activity', 'marks', 'fees'
    url: url,
    read: false,
    createdAt: new Date()
  };

  try {
    await notifCol.insertOne(notifRecord);
  } catch (err) {
    console.error('Notification record save error:', err.message);
  }

  // 2. Query push subscriptions for target
  const subCol = db.collection(collections.PUSH_SUBSCRIPTION_COLLECTION);
  const filter = {};
  if (parentPhone) {
    filter.$or = [{ parentPhone: parentPhone }];
    if (studentId) filter.$or.push({ studentId: studentId });
  } else if (studentId) {
    filter.studentId = studentId;
  }

  try {
    const subscriptions = await subCol.find(filter).toArray();
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title: title,
      body: message,
      icon: icon,
      badge: '/images/favicon-96x96.png',
      url: url,
      data: { url: url }
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys
        }, payload);
      } catch (pushErr) {
        // If subscription is expired / unsubscribed (404 or 410 Gone), remove it
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          await subCol.deleteOne({ _id: sub._id });
        } else {
          console.log('Push dispatch notice:', pushErr.message);
        }
      }
    }
  } catch (err) {
    console.error('Push dispatch error:', err.message);
  }
}

/**
 * Fetch unread and recent notifications for student/parent
 */
async function getNotifications(db, { studentId, parentPhone, limit = 20 }) {
  if (!db) return [];
  const notifCol = db.collection(collections.NOTIFICATION_COLLECTION);
  const filter = {
    $or: [
      { studentId: studentId },
      { parentPhone: parentPhone },
      { studentId: null, parentPhone: null }
    ]
  };

  return await notifCol.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
}

module.exports = {
  VAPID_PUBLIC_KEY,
  savePushSubscription,
  sendNotification,
  getNotifications
};
