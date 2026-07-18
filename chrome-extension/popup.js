// ClauseLens Popup Script
let BASE_URL = "https://clauselens.suirify.com"; // Default production
let isConfigLoaded = false;
let configPromise = null;

async function detectEnvironment() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        if (currentTab && currentTab.url) {
            const url = new URL(currentTab.url);
            // If we are currently ON a ClauseLens app domain, prioritize that origin
            if (url.hostname.includes('run.app') || url.hostname.includes('localhost') || url.hostname === 'clauselens.suirify.com') {
                console.log("ClauseLens: Auto-detected environment from tab:", url.origin);
                BASE_URL = url.origin;
                return true; 
            }
        }
    } catch (e) {
        console.warn("ClauseLens: Env detection failed", e);
    }
    return false;
}

function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = (async () => {
        // 1. Try to get persisted URL from previous detection
        const stored = await new Promise(resolve => chrome.storage.local.get(['PERSISTED_BASE_URL'], resolve));
        if (stored.PERSISTED_BASE_URL) {
            console.log("ClauseLens: Using persisted BASE_URL:", stored.PERSISTED_BASE_URL);
            BASE_URL = stored.PERSISTED_BASE_URL;
        }

        // 2. Try to detect environment from current tab (most reliable)
        const detected = await detectEnvironment();
        if (detected) {
            chrome.storage.local.set({ PERSISTED_BASE_URL: BASE_URL });
        }
        
        // 3. Fallback to config.json ONLY if we have no detection or persistence
        if (!detected && !stored.PERSISTED_BASE_URL) {
            try {
                const r = await fetch(chrome.runtime.getURL('config.json'));
                const contentType = r.headers.get('content-type');
                if (r.ok && contentType && contentType.includes('application/json')) {
                    const config = await r.json();
                    if (config.BASE_URL) {
                        console.log("ClauseLens: Using BASE_URL from config.json:", config.BASE_URL);
                        BASE_URL = config.BASE_URL;
                    }
                }
            } catch (e) {
                console.warn("ClauseLens: Config loading skipped or failed", e);
            }
        }
        
        isConfigLoaded = true;
        console.log("ClauseLens: Final BASE_URL for this session:", BASE_URL);
        return { BASE_URL };
    })();
    return configPromise;
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    const scanToggle = document.getElementById('scan-toggle');
    const loadingView = document.getElementById('loading');
    const introView = document.getElementById('intro-view');
    const resultsView = document.getElementById('results');
    const errorView = document.getElementById('error');

    // Get initial toggle state and auth status
    chrome.storage.local.get(['scanningEnabled', 'auth_user'], (result) => {
        updateViewBasedOnAuth(result);
    });

    // Listen for storage changes (for live auth sync)
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.auth_user) {
            chrome.storage.local.get(['scanningEnabled', 'auth_user'], (result) => {
                updateViewBasedOnAuth(result);
            });
        }
    });

    function updateViewBasedOnAuth(result) {
        if (!result.auth_user || !result.auth_user.loggedIn) {
            showLogin();
            return;
        }

        const enabled = result.scanningEnabled !== false; // Default to true
        scanToggle.checked = enabled;
        if (!enabled) {
            showIntro();
        } else {
            initializeAnalysis();
        }
    }

    // Auth Form Logic
    const authForm = document.getElementById('auth-form');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const toggleAuthModeBtn = document.getElementById('toggle-auth-mode');
    const forgotPasswordBtn = document.getElementById('forgot-password-btn');
    const authNameInput = document.getElementById('auth-name');
    const authEmailInput = document.getElementById('auth-email');
    const authPasswordInput = document.getElementById('auth-password');
    const authErrorDiv = document.getElementById('auth-error');
    const authSuccessDiv = document.getElementById('auth-success');

    let currentAuthMode = 'login'; // login, signup, reset

    toggleAuthModeBtn.addEventListener('click', () => {
        if (currentAuthMode === 'login') {
            currentAuthMode = 'signup';
            authTitle.textContent = 'CREATE ACCOUNT';
            authSubtitle.textContent = 'Join ClauseLens to start identifying digital risks.';
            authSubmitBtn.textContent = 'Sign Up';
            toggleAuthModeBtn.textContent = 'Back to Sign In';
            authNameInput.style.display = 'block';
            authPasswordInput.style.display = 'block';
        } else {
            currentAuthMode = 'login';
            authTitle.textContent = 'SIGN IN';
            authSubtitle.textContent = 'Access your history and real-time scans.';
            authSubmitBtn.textContent = 'Sign In';
            toggleAuthModeBtn.textContent = 'Create Account';
            authNameInput.style.display = 'none';
            authPasswordInput.style.display = 'block';
        }
        authErrorDiv.style.display = 'none';
        authSuccessDiv.style.display = 'none';
    });

    forgotPasswordBtn.addEventListener('click', () => {
        currentAuthMode = 'reset';
        authTitle.textContent = 'RESET PASSWORD';
        authSubtitle.textContent = 'Enter your email to receive a reset link.';
        authSubmitBtn.textContent = 'Send Reset Link';
        toggleAuthModeBtn.textContent = 'Back to Sign In';
        authNameInput.style.display = 'none';
        authPasswordInput.style.display = 'none';
        authErrorDiv.style.display = 'none';
        authSuccessDiv.style.display = 'none';
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authErrorDiv.style.display = 'none';
        authSuccessDiv.style.display = 'none';
        authSubmitBtn.disabled = true;
        const originalBtnText = authSubmitBtn.textContent;
        authSubmitBtn.textContent = 'Processing...';

        await loadConfig();
        const cleanBase = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
        
        let endpoint = '/api/auth/login';
        let body = { email: authEmailInput.value, password: authPasswordInput.value };
        
        if (currentAuthMode === 'signup') {
            endpoint = '/api/auth/signup';
            body.name = authNameInput.value;
        } else if (currentAuthMode === 'reset') {
            endpoint = '/api/auth/reset';
            body = { email: authEmailInput.value };
        }

        try {
            const data = await smartFetch(`${cleanBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (currentAuthMode === 'reset') {
                authSuccessDiv.textContent = 'A professional reset link has been dispatched to your inbox. Please check your email to proceed.';
                authSuccessDiv.style.display = 'block';
                setTimeout(() => {
                    currentAuthMode = 'login';
                    authTitle.textContent = 'SIGN IN';
                    authSubmitBtn.textContent = 'Sign In';
                    authPasswordInput.style.display = 'block';
                    authSuccessDiv.style.display = 'none';
                }, 5000);
            } else {
                // Success - logged in
                chrome.storage.local.set({ auth_user: data }, () => {
                    updateViewBasedOnAuth({ auth_user: data });
                });
            }
        } catch (err) {
            let userFriendlyError = err.message;
            if (err.message.includes('Unable to parse API response') || err.message.includes('Unexpected server response')) {
                userFriendlyError = "Connection error. If you are signed in on the web app, please refresh auth below. Otherwise, check your network.";
            }
            authErrorDiv.textContent = userFriendlyError;
            authErrorDiv.style.display = 'block';
        } finally {
            authSubmitBtn.disabled = false;
            authSubmitBtn.textContent = originalBtnText;
        }
    });

    // Refresh Auth Listener
    document.getElementById('refreshAuthBtn').addEventListener('click', async () => {
        const btn = document.getElementById('refreshAuthBtn');
        const originalText = btn.textContent;
        btn.textContent = "Checking...";
        btn.disabled = true;

        try {
            // Find any tab with ClauseLens and ask it to sync
            const tabs = await chrome.tabs.query({});
            let foundApp = false;
            for (const tab of tabs) {
                if (tab.url && (tab.url.includes('europe-west1.run.app') || tab.url.includes('localhost') || tab.url.includes('clauselens.suirify.com'))) {
                    foundApp = true;
                    try {
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: () => {
                                if (typeof syncAuth === 'function') {
                                    syncAuth();
                                    return true;
                                }
                                return false;
                            }
                        });
                    } catch (e) {
                        console.warn("Could not execute sync on tab", tab.id, e);
                    }
                }
            }
            
            if (!foundApp) {
                alert("Please open the ClauseLens web app first, sign in, and then click refresh.");
            } else {
                // Persistent the newly detected URL
                await loadConfig();
                chrome.storage.local.set({ PERSISTED_BASE_URL: BASE_URL });
                
                // Give it a moment to sync
                setTimeout(() => {
                    chrome.storage.local.get(['auth_user'], (result) => {
                        updateViewBasedOnAuth(result);
                        btn.textContent = originalText;
                        btn.disabled = false;
                    });
                }, 1000);
                return;
            }
        } catch (err) {
            console.error("Refresh error:", err);
        }
        
        btn.textContent = originalText;
        btn.disabled = false;
    });

    // Toggle Listener
    scanToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ scanningEnabled: enabled });
        
        chrome.storage.local.get(['auth_user'], (res) => {
            if (!res.auth_user || !res.auth_user.loggedIn) {
                showLogin();
                return;
            }
            if (enabled) {
                initializeAnalysis();
            } else {
                showIntro();
            }
        });
    });

    async function initializeAnalysis() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        
        if (!currentTab || !currentTab.url || !currentTab.url.startsWith('http')) {
            showError("Please open a website to analyze its policies.");
            return;
        }

        const url = currentTab.url;
        const domain = new URL(url).hostname;
        const pageTitle = currentTab.title;
        const favIconUrl = currentTab.favIconUrl;

        // One more check for auth before starting analysis
        chrome.storage.local.get(['auth_user'], (res) => {
            if (!res.auth_user || !res.auth_user.loggedIn) {
                showLogin();
                return;
            }

            // Check storage first for recent analysis
            chrome.storage.local.get([domain], (result) => {
                if (result[domain] && (Date.now() - result[domain].timestamp < 3600000)) { // 1 hour cache
                    displayResult(result[domain]);
                } else {
                    startAnalysis(url, domain, pageTitle, favIconUrl);
                }
            });
        });

        // Update action listeners with current context
        document.getElementById('reanalyzeBtn').onclick = () => initializeAnalysis();
        document.getElementById('retryBtn').onclick = () => initializeAnalysis();
        document.getElementById('dashboardBtn').onclick = () => {
            chrome.tabs.create({ url: `${BASE_URL}/?url=${encodeURIComponent(url)}` });
        };
    }
});

function showIntro() {
    document.getElementById('intro-view').style.display = 'block';
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('results').style.display = 'none';
    document.getElementById('error').style.display = 'none';
}

function showLogin() {
    document.getElementById('login-view').style.display = 'block';
    document.getElementById('intro-view').style.display = 'none';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('results').style.display = 'none';
    document.getElementById('error').style.display = 'none';
}

async function smartFetch(url, options = {}) {
    const contentType = options.headers?.['Content-Type'] || 'application/json';
    // Ensure credentials: 'include' is set to carry AI Studio platform cookies
    const fetchOptions = {
        ...options,
        credentials: 'include'
    };
    const response = await fetch(url, fetchOptions);
    const actualContentType = response.headers.get('content-type');

    if (!response.ok) {
        let errorMessage = `Server error: ${response.status} ${response.statusText}`;
        if (actualContentType && actualContentType.includes('application/json')) {
            const errData = await response.json();
            errorMessage = errData.error || errorMessage;
        } else if (actualContentType && actualContentType.includes('text/html')) {
            // HTML usually means session expired or wrong URL
            errorMessage = "Analysis endpoint returned HTML. This usually means your session needs to be refreshed. Please click 'Sign In' below.";
        }
        throw new Error(errorMessage);
    }

    if (!actualContentType || !actualContentType.includes('application/json')) {
        console.error("API response is not JSON:", actualContentType, "URL:", url);
        // Handle potential redirect to login page (even if 200 OK)
        if (actualContentType && actualContentType.includes('text/html')) {
            throw new Error("Unable to parse API response. Please ensure you are signed in through the extension popup.");
        }
        throw new Error("Unexpected server response format. Please check your connection.");
    }

    return response.json();
}

async function startAnalysis(url, domain, pageTitle, favIconUrl) {
    showLoading();
    
    try {
        // Ensure config is loaded before hitting API
        await loadConfig();
        
        const cleanBase = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
        const data = await smartFetch(`${cleanBase}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type: 'website', 
                value: url,
                title: pageTitle,
                favicon: favIconUrl
            })
        });
        
        // Ensure metadata is preserved even if backend doesn't return it perfectly
        if (!data.favicon && favIconUrl) data.favicon = favIconUrl;
        if ((!data.title || data.title === domain) && pageTitle) data.title = pageTitle;

        // Save to cache
        chrome.storage.local.set({ [domain]: data });
        displayResult(data);
    } catch (err) {
        console.error("Analysis error:", err);
        showError(err.message);
    }
}

function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('results').style.display = 'none';
    document.getElementById('error').style.display = 'none';
}

function showError(msg) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('results').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('errorText').textContent = msg;
}

function displayResult(data) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('results').style.display = 'block';

    const scoreValue = document.getElementById('scoreValue');
    const severityText = document.getElementById('severityText');
    const summaryText = document.getElementById('summaryText');
    const riskList = document.getElementById('riskList');
    
    // Site Info Header
    const siteIcon = document.getElementById('siteIcon');
    const siteLetter = document.getElementById('siteLetter');
    const siteName = document.getElementById('siteName');
    const siteDomain = document.getElementById('siteDomain');
    
    const domain = data.domain || 'Target Site';
    siteDomain.textContent = domain;
    
    // Better name extraction
    let displayName = domain;
    
    // Prioritize the title from data if it exists and isn't just the domain
    if (data.title && data.title !== domain) {
        displayName = data.title;
        // Clean up common title suffixes
        displayName = displayName.split('|')[0].split('-')[0].split('–')[0].trim();
    } else {
        try {
            const parts = domain.split('.');
            if (parts.length >= 2) {
                // Handle common subdomains
                if (parts[0] === 'www' || parts[0] === 'app' || parts[0] === 'docs') {
                    displayName = parts[1];
                } else {
                    displayName = parts[0];
                }
            }
        } catch (e) {}
    }
    
    siteName.textContent = displayName.charAt(0).toUpperCase() + displayName.slice(1);

    // Resilient Icon logic
    siteLetter.textContent = displayName.charAt(0).toUpperCase();
    siteLetter.style.display = 'block';
    siteIcon.style.display = 'none';

    if (data.favicon && data.favicon !== "") {
        const img = new Image();
        img.onload = () => {
            siteIcon.src = data.favicon;
            siteIcon.style.display = 'block';
            siteLetter.style.display = 'none';
        };
        img.onerror = () => {
            siteIcon.style.display = 'none';
            siteLetter.style.display = 'block';
        };
        img.src = data.favicon;
    }

    scoreValue.textContent = `${data.risk_score}/10`;
    summaryText.textContent = data.summary;

    // Reset styles
    severityText.className = 'severity';
    scoreValue.className = 'score';
    
    if (data.risk_score <= 3) {
        severityText.textContent = 'Safe';
        severityText.classList.add('low');
        scoreValue.classList.add('low');
    } else if (data.risk_score <= 7) {
        severityText.textContent = 'Caution';
        severityText.classList.add('medium');
        scoreValue.classList.add('medium');
    } else {
        severityText.textContent = 'High Risk';
        severityText.classList.add('high');
        scoreValue.classList.add('high');
    }

    // Populate Risks
    riskList.innerHTML = '';
    (data.risks || []).slice(0, 3).forEach(risk => {
        const div = document.createElement('div');
        div.className = `risk-item ${risk.severity}`;
        div.innerHTML = `
            <div class="risk-title">${risk.title}</div>
            <div class="risk-desc">${risk.description}</div>
        `;
        riskList.appendChild(div);
    });
}
