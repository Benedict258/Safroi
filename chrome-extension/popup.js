// ClauseLens Popup Script
let BASE_URL = "http://localhost:3000"; // Fallback
let isConfigLoaded = false;
let configPromise = null;

function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = fetch(chrome.runtime.getURL('config.json'))
        .then(async r => {
            const contentType = r.headers.get('content-type');
            if (!r.ok || !contentType || !contentType.includes('application/json')) {
                throw new Error("Invalid config response");
            }
            return r.json();
        })
        .then(config => {
            BASE_URL = config.BASE_URL;
            isConfigLoaded = true;
            return config;
        })
        .catch(e => {
            console.warn("Config loading failed, using default URL", e);
            isConfigLoaded = true;
            return { BASE_URL };
        });
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

    // Login Listener
    document.getElementById('loginBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: `${BASE_URL}` });
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
                    startAnalysis(url, domain);
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

async function startAnalysis(url, domain) {
    showLoading();
    
    try {
        // Ensure config is loaded before hitting API
        await loadConfig();
        
        const response = await fetch(`${BASE_URL}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'website', value: url })
        });

        const contentType = response.headers.get('content-type');
        if (!response.ok) {
            let errorMessage = "Analysis failed";
            if (contentType && contentType.includes('application/json')) {
                const errData = await response.json();
                errorMessage = errData.error || errorMessage;
            }
            throw new Error(errorMessage);
        }

        if (!contentType || !contentType.includes('application/json')) {
            throw new Error("Server returned non-JSON response. Please check if you are logged in and the server is running.");
        }

        const data = await response.json();
        
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
