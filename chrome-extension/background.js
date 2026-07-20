// Safroi Background Service Worker
let BASE_URL = "http://localhost:3000"; // Fallback
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
      return config;
    })
    .catch(e => {
      console.warn("Background: Config loading failed", e);
      return { BASE_URL };
    });
  return configPromise;
}

// Initial config load
loadConfig();

// Authentication State Sync
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_AUTH' && message.data && message.data.loggedIn) {
    // Only upgrade the session, never clear it from content script sync
    chrome.storage.local.set({ auth_user: message.data });
  }
});

// Throttle analysis to avoid hitting quotas too fast
const domainCache = new Map();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await loadConfig();
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    const url = new URL(tab.url);
    const domain = url.hostname;
    const favicon = tab.favIconUrl;

    // Check if scanning is enabled
    chrome.storage.local.get(['scanningEnabled', domain], (result) => {
      if (result.scanningEnabled === false) {
        resetIcon();
        return;
      }

      if (!result[domain]) {
        console.log("Analyzing new domain:", domain);
        resetIcon();
        analyzeDomain(domain, tab.url, favicon);
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
          resetIcon();
          return;
        }

        if (result[domain]) {
          updateBadge(result[domain].risk_score);
        } else {
          resetIcon();
        }
      });
    }
  });
});

async function resetIcon() {
  try {
    const ICON_SIZE = 32;
    const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    
    // Draw Background Circle
    ctx.beginPath();
    ctx.arc(ICON_SIZE / 2, ICON_SIZE / 2, ICON_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#050B10';
    ctx.fill();
    
    // Draw "C" Logo
    ctx.fillStyle = '#E0FEF6'; // Mint
    ctx.font = 'bold italic 22px "Arial", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', ICON_SIZE / 2, ICON_SIZE / 2 + 1);

    const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
    chrome.action.setIcon({ imageData: { 32: imageData } });
  } catch (err) {
    console.error("resetIcon Error:", err);
  }
  
  chrome.action.setBadgeText({ text: "" });
}

async function analyzeDomain(domain, fullUrl, favicon) {
  try {
    // Before analysis, try to see if BASE_URL is still valid
    try {
      const healthCheck = await fetch(`${BASE_URL}/api/health`).catch(() => null);
      if (!healthCheck || !healthCheck.ok) {
        // Try to update from active tab if it's an app tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        if (currentTab && currentTab.url && (currentTab.url.includes('europe-west1.run.app') || currentTab.url.includes('localhost'))) {
          const newBase = new URL(currentTab.url).origin;
          if (newBase !== BASE_URL) {
            console.log("Background: Auto-updating BASE_URL to tab origin:", newBase);
            BASE_URL = newBase;
          }
        }
      }
    } catch (e) {}

    const cleanBase = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
    const response = await fetch(`${cleanBase}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url: fullUrl })
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok || !contentType || !contentType.includes('application/json')) {
      // Silently fail in background if session expired to avoid spamming console with errors
      return;
    }
    
    const data = await response.json();
    
    // Add additional metadata
    data.favicon = favicon;
    data.timestamp = Date.now();
    data.domain = domain;

    // Store in chrome storage
    chrome.storage.local.set({ [domain]: data });
    
    updateBadge(data.risk_score);
  } catch (error) {
    console.error("Background analysis error:", error);
  }
}

async function updateBadge(score) {
  try {
    const ICON_SIZE = 32;
    const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE);
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    
    // Draw Background Circle
    ctx.beginPath();
    ctx.arc(ICON_SIZE / 2, ICON_SIZE / 2, ICON_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#050B10';
    ctx.fill();
    
    // Draw "C" Logo
    ctx.fillStyle = '#E0FEF6'; // Mint
    ctx.font = 'bold italic 22px "Arial", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', ICON_SIZE / 2, ICON_SIZE / 2 + 1);

    // Determine dot color
    let color = '#CCCCCC'; // Default Gray
    if (score <= 3) color = '#22C55E'; // Green
    else if (score <= 7) color = '#F59E0B'; // Yellow
    else color = '#EF4444'; // Red
    
    // Draw small circular dot in the bottom right corner
    const dotRadius = 5; 
    const padding = 2;
    const centerX = ICON_SIZE - dotRadius - padding;
    const centerY = ICON_SIZE - dotRadius - padding;

    // Dot Shadow for visibility
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.closePath();

    const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
    chrome.action.setIcon({ imageData: { 32: imageData } });
  } catch (err) {
    console.error("updateBadge Error:", err);
  }
  
  chrome.action.setBadgeText({ text: "" });
}
