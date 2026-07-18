// ClauseLens Content Script
// Syncs auth status with the extension

function syncAuth() {
    // Only attempt sync on known ClauseLens domains
    const isAppDomain = window.location.hostname.includes('europe-west1.run.app') || 
                        window.location.hostname === 'localhost' ||
                        window.location.hostname.includes('ais-pre-') ||
                        window.location.hostname.includes('ais-dev-') ||
                        window.location.hostname === 'clauselens.suirify.com';

    if (!isAppDomain) return;

    console.log("ClauseLens: Checking auth status on app domain...");
    // Check our custom key first
    const userStatusStr = localStorage.getItem('clauselens_auth_status');
    
    if (userStatusStr) {
        try {
            const data = JSON.parse(userStatusStr);
            if (data && data.loggedIn) {
                console.log("ClauseLens: Found custom auth status:", data.loggedIn);
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({ type: 'SYNC_AUTH', data: data }).catch(e => {});
                }
            }
        } catch (e) {
            console.error("ClauseLens: Error parsing auth status", e);
        }
    } else {
        // Check for Firebase standard keys as a fallback
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('firebase:authUser:')) {
                    const val = localStorage.getItem(key);
                    if (val) {
                        const data = JSON.parse(val);
                        if (data) {
                            console.log("ClauseLens: Found Firebase auth status for:", data.email);
                            if (chrome.runtime?.id) {
                                chrome.runtime.sendMessage({ 
                                    type: 'SYNC_AUTH', 
                                    data: {
                                        uid: data.uid,
                                        email: data.email,
                                        displayName: data.displayName,
                                        loggedIn: true
                                    } 
                                }).catch(e => {});
                            }
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("ClauseLens: Error scanning localStorage", e);
        }
    }
}

// Listen for storage changes in the window
window.addEventListener('storage', (event) => {
    if (event.key === 'clauselens_auth_status' || (event.key && event.key.startsWith('firebase:authUser:'))) {
        syncAuth();
    }
});

// Run immediately and periodically
syncAuth();
setInterval(syncAuth, 3000);
