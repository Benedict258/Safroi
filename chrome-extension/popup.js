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

    // Get initial toggle state
    chrome.storage.local.get(['scanningEnabled'], (result) => {
        const enabled = result.scanningEnabled !== false; // Default to true
        scanToggle.checked = enabled;
        if (!enabled) {
            showIntro();
        } else {
            initializeAnalysis();
        }
    });

    // Toggle Listener
    scanToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ scanningEnabled: enabled });
        if (enabled) {
            initializeAnalysis();
        } else {
            showIntro();
        }
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

        // Check storage first for recent analysis
        chrome.storage.local.get([domain], (result) => {
            if (result[domain] && (Date.now() - result[domain].timestamp < 3600000)) { // 1 hour cache
                displayResult(result[domain]);
            } else {
                startAnalysis(url, domain);
            }
        });

        // Update action listeners with current context
        document.getElementById('reanalyzeBtn').onclick = () => startAnalysis(url, domain);
        document.getElementById('retryBtn').onclick = () => startAnalysis(url, domain);
        document.getElementById('dashboardBtn').onclick = () => {
            chrome.tabs.create({ url: `${BASE_URL}/?url=${encodeURIComponent(url)}` });
        };
    }
});

function showIntro() {
    document.getElementById('intro-view').style.display = 'block';
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

    scoreValue.textContent = ''; // Dot based, no number
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
