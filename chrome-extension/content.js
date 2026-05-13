// ClauseLens Content Script
// Syncs auth status with the extension

function syncAuth() {
    // Check our custom key first
    const userStatusStr = localStorage.getItem('clauselens_auth_status');
    
    if (userStatusStr) {
        try {
            const data = JSON.parse(userStatusStr);
            chrome.runtime.sendMessage({ type: 'SYNC_AUTH', data: data });
        } catch (e) {
            console.error("ClauseLens: Error parsing auth status", e);
        }
    } else {
        // Check for Firebase standard keys as a fallback
        let firebaseAuthFound = false;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('firebase:authUser:')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data) {
                        chrome.runtime.sendMessage({ 
                            type: 'SYNC_AUTH', 
                            data: {
                                uid: data.uid,
                                email: data.email,
                                displayName: data.displayName,
                                loggedIn: true
                            } 
                        });
                        firebaseAuthFound = true;
                        break;
                    }
                } catch (e) {}
            }
        }
        
        if (!firebaseAuthFound) {
            chrome.runtime.sendMessage({ type: 'SYNC_AUTH', data: { loggedIn: false } });
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
