// Safroi Content Script — syncs auth status with the extension

function syncAuth() {
    const isAppDomain = window.location.hostname.includes('onrender.com') || 
                        window.location.hostname.includes('vercel.app') ||
                        window.location.hostname === 'localhost';

    if (!isAppDomain) return;

    const userStatusStr = localStorage.getItem('safroi_auth_status');
    if (userStatusStr) {
        try {
            const data = JSON.parse(userStatusStr);
            if (data && data.loggedIn && chrome.runtime?.id) {
                chrome.runtime.sendMessage({ type: 'SYNC_AUTH', data: data }).catch(() => {});
            }
        } catch (_) {}
    }
}

window.addEventListener('storage', (event) => {
    if (event.key === 'safroi_auth_status') syncAuth();
});

syncAuth();
setInterval(syncAuth, 5000);
