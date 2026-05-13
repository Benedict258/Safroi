// ClauseLens Background Service Worker
let BASE_URL = "http://localhost:3000"; // Fallback

async function loadConfig() {
  try {
    const response = await fetch(chrome.runtime.getURL('config.json'));
    const config = await response.json();
    BASE_URL = config.BASE_URL;
  } catch (e) {
    console.warn("Background: Config not found, using default URL", e);
  }
}

// Initial config load
loadConfig();

// Throttle analysis to avoid hitting quotas too fast
const domainCache = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    const url = new URL(tab.url);
    const domain = url.hostname;

    // Check if scanning is enabled
    chrome.storage.local.get(['scanningEnabled', domain], (result) => {
      if (result.scanningEnabled === false) {
        chrome.action.setBadgeText({ text: "" });
        return;
      }

      if (!result[domain]) {
        console.log("Analyzing new domain:", domain);
        analyzeDomain(domain, tab.url);
      } else {
        updateBadge(result[domain].risk_score);
      }
    });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url && tab.url.startsWith('http')) {
      const domain = new URL(tab.url).hostname;
      chrome.storage.local.get(['scanningEnabled', domain], (result) => {
        if (result.scanningEnabled === false) {
          chrome.action.setBadgeText({ text: "" });
          return;
        }

        if (result[domain]) {
          updateBadge(result[domain].risk_score);
        } else {
          chrome.action.setBadgeText({ text: "" });
        }
      });
    }
  });
});

async function analyzeDomain(domain, fullUrl) {
  try {
    const response = await fetch(`${BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl })
    });

    if (!response.ok) throw new Error("Analysis failed");
    const data = await response.json();

    // Store in chrome storage
    chrome.storage.local.set({ [domain]: data });
    
    updateBadge(data.risk_score);
  } catch (error) {
    console.error("Background analysis error:", error);
  }
}

function updateBadge(score) {
  let color = '#CCCCCC'; // Default Gray
  let text = score.toString();

  if (score <= 3) color = '#22C55E'; // Green
  else if (score <= 7) color = '#F59E0B'; // Yellow
  else color = '#EF4444'; // Red

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
