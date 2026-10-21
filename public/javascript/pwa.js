// Paadashala Progressive Web App (PWA) Registration & Install Handler

let deferredInstallPrompt = null;

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('Paadashala PWA: Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('Paadashala PWA: Service Worker registration failed:', err);
      });
  });
}

// Capture Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showPwaInstallButton();
});

// App installed successfully
window.addEventListener('appinstalled', () => {
  console.log('Paadashala PWA: App successfully installed to Home screen.');
  deferredInstallPrompt = null;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.remove();
});

// Function to trigger install from Quick Access tile or anywhere
window.triggerPwaInstallFromTile = async function () {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) {
    alert("ആപ്പ് ഇതിനകം നിങ്ങളുടെ ഉപകരണത്തിൽ ഇൻസ്റ്റാൾ ചെയ്തിട്ടുണ്ട്! (Paadashala is already installed)");
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log(`Paadashala PWA: User response to install prompt: ${outcome}`);
    deferredInstallPrompt = null;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.remove();
  } else {
    // Check if iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      alert("iPhone / iPad-ൽ ഇൻസ്റ്റാൾ ചെയ്യാൻ:\n1. താഴെയുള്ള 'Share' (പങ്കുവെക്കൽ) ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.\n2. താഴേക്ക് സ്ക്രോൾ ചെയ്ത് 'Add to Home Screen' (ഹോം സ്ക്രീനിലേക്ക് ചേർക്കുക) തെരഞ്ഞെടുക്കുക.");
    } else {
      alert("ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്യാൻ:\nബ്രൗസറിന്റെ മുകളിലെ 3 ഡോട്ടുകൾ (Menu) ക്ലിക്ക് ചെയ്ത് 'Install app' അല്ലെങ്കിൽ 'Add to Home screen' തെരഞ്ഞെടുക്കുക.");
    }
  }
};

function showPwaInstallButton() {
  if (document.getElementById('pwaInstallBtn')) return;

  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    return;
  }

  const installBtn = document.createElement('div');
  installBtn.id = 'pwaInstallBtn';
  installBtn.innerHTML = `
    <div class="pwa-install-banner">
      <div class="pwa-icon">
        <img src="/images/apple-touch-icon.png" alt="Paadashala Logo" width="36" height="36" style="border-radius: 8px;" />
      </div>
      <div class="pwa-text">
        <strong>Paadashala ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്യാം</strong>
        <small>ഫോൺ ഹോം സ്ക്രീനിലേക്ക് ചേർക്കുക</small>
      </div>
      <button type="button" class="pwa-btn-action" id="triggerPwaInstall">
        Install
      </button>
      <button type="button" class="pwa-btn-close" id="closePwaBanner" aria-label="Close">
        &times;
      </button>
    </div>
  `;

  if (!document.getElementById('pwa-banner-style')) {
    const style = document.createElement('style');
    style.id = 'pwa-banner-style';
    style.textContent = `
      .pwa-install-banner {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 12px;
        background: #ffffff;
        color: #1e293b;
        padding: 10px 16px;
        border-radius: 50px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
        border: 1.5px solid #2563eb;
        max-width: 92vw;
        animation: slideUpPwa 0.35s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      @keyframes slideUpPwa {
        from { transform: translate(-50%, 60px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
      .pwa-text {
        display: flex;
        flex-direction: column;
        line-height: 1.25;
      }
      .pwa-text strong {
        font-size: 13.5px;
        color: #0f172a;
      }
      .pwa-text small {
        font-size: 11px;
        color: #64748b;
      }
      .pwa-btn-action {
        background: #2563eb;
        color: #ffffff;
        border: none;
        padding: 6px 14px;
        border-radius: 20px;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .pwa-btn-action:hover {
        background: #1d4ed8;
      }
      .pwa-btn-close {
        background: none;
        border: none;
        font-size: 18px;
        line-height: 1;
        color: #94a3b8;
        cursor: pointer;
        padding: 0 4px;
      }
      .pwa-btn-close:hover {
        color: #334155;
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(installBtn);

  document.getElementById('triggerPwaInstall').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log(`Paadashala PWA: User response to install prompt: ${outcome}`);
    deferredInstallPrompt = null;
    installBtn.remove();
  });

  document.getElementById('closePwaBanner').addEventListener('click', () => {
    installBtn.remove();
  });
}
