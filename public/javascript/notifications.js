// Paadashala Client Push Notification Manager

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function initPushNotifications(vapidPublicKey) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push messaging is not supported in this browser.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered successfully.');

    // If permission not granted, request permission
    if (Notification.permission === 'default') {
      const banner = document.getElementById('pushPermissionBanner');
      if (banner) banner.style.display = 'block';
    } else if (Notification.permission === 'granted') {
      subscribeUserToPush(registration, vapidPublicKey);
    }
  } catch (err) {
    console.warn('Service Worker registration failed:', err);
  }
}

async function subscribeUserToPush(registration, vapidPublicKey) {
  try {
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
      });
    }

    // Send subscription to server
    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    console.log('Push notification subscription synchronized with server.');
  } catch (err) {
    console.warn('Failed to subscribe user to push:', err);
  }
}

async function requestNotificationPermission(vapidPublicKey) {
  if (!('Notification' in window)) return;

  const permission = await Notification.requestPermission();
  const banner = document.getElementById('pushPermissionBanner');
  if (banner) banner.style.display = 'none';

  if (permission === 'granted') {
    const reg = await navigator.serviceWorker.ready;
    await subscribeUserToPush(reg, vapidPublicKey);
    alert('നോട്ടിഫിക്കേഷൻ വിജയകരമായി ഓൺ ചെയ്തു! ഇനി അറ്റൻഡൻസ്, ആക്ടിവിറ്റി വിവരങ്ങൾ തത്സമയം ഫോണിൽ ലഭിക്കും.');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const vapidKeyMeta = document.querySelector('meta[name="vapid-public-key"]');
  const vapidKey = vapidKeyMeta ? vapidKeyMeta.getAttribute('content') : 'BO7wWo16eoine_qZjI5PXQ26-XSFbGL0PDNM4k0r3obOFCxH8_kMIII_InIIX1xXlZmd7QsVt-4AakkXm0s5kCM';
  if (vapidKey) {
    initPushNotifications(vapidKey);
  }
});
