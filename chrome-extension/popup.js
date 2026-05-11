// ClauseLens Popup Script
const BASE_URL = "https://ais-dev-wndzybiqm3ibh34ikg4x5u-337842956729.europe-west1.run.app";

document.addEventListener('DOMContentLoaded', async () => {
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

    // Event Listeners
    document.getElementById('reanalyzeBtn').addEventListener('click', () => startAnalysis(url, domain));
    document.getElementById('retryBtn').addEventListener('click', () => startAnalysis(url, domain));
    document.getElementById('dashboardBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: `${BASE_URL}/?url=${encodeURIComponent(url)}` });
    });
});

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

    scoreValue.textContent = data.risk_score;
    summaryText.textContent = data.summary;

    // Reset styles
    severityText.className = 'severity';
    
    if (data.risk_score <= 3) {
        severityText.textContent = 'Safe';
        severityText.classList.add('low');
    } else if (data.risk_score <= 7) {
        severityText.textContent = 'Caution';
        severityText.classList.add('medium');
    } else {
        severityText.textContent = 'High Risk';
        severityText.classList.add('high');
    }

    // Populate Risks
    riskList.innerHTML = '';
    (data.risks || []).slice(0, 3).forEach(risk => {
        const div = document.createElement('div');
        div.className = 'risk-item';
        div.innerHTML = `
            <div class="risk-title">${risk.title}</div>
            <div class="risk-desc">${risk.description}</div>
        `;
        riskList.appendChild(div);
    });
}
