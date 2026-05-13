// ClauseLens Popup Script
let BASE_URL = "http://localhost:3000"; // Fallback

async function loadConfig() {
    try {
        const response = await fetch(chrome.runtime.getURL('config.json'));
        const config = await response.json();
        BASE_URL = config.BASE_URL;
    } catch (e) {
        console.warn("Config not found, using default URL", e);
    }
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
        const response = await fetch(`${BASE_URL}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'website', value: url })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Analysis failed");
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
    const siteName = document.getElementById('siteName');
    const siteDomain = document.getElementById('siteDomain');
    
    if (data.favicon) {
        siteIcon.src = data.favicon;
        siteIcon.style.display = 'block';
    } else {
        siteIcon.src = 'Clause.png';
    }
    
    siteDomain.textContent = data.domain || 'Target Site';
    siteName.textContent = (data.domain || 'Target Site').split('.')[0].toUpperCase();

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
