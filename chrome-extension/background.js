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

// Authentication State Sync
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_AUTH') {
    chrome.storage.local.set({ auth_user: message.data });
  }
});

// Throttle analysis to avoid hitting quotas too fast
const domainCache = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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

function resetIcon() {
  const ICON_SIZE = 32;
  const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas.getContext('2d');

  fetch(chrome.runtime.getURL('Clause.png'))
    .then(r => r.blob())
    .then(createImageBitmap)
    .then(bitmap => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ICON_SIZE / 2, ICON_SIZE / 2, ICON_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(bitmap, 0, 0, ICON_SIZE, ICON_SIZE);
      ctx.restore();
      const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
      chrome.action.setIcon({ imageData: { 32: imageData } });
    });
  
  chrome.action.setBadgeText({ text: "" });
}

async function analyzeDomain(domain, fullUrl, favicon) {
  try {
    const response = await fetch(`${BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl })
    });

    if (!response.ok) throw new Error("Analysis failed");
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
  const ICON_SIZE = 32;
  const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas.getContext('2d');

  // Load the base icon
  const response = await fetch(chrome.runtime.getURL('Clause.png'));
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  // Clear canvas and draw circular clipped icon
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ICON_SIZE / 2, ICON_SIZE / 2, ICON_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(bitmap, 0, 0, ICON_SIZE, ICON_SIZE);
  ctx.restore();

  // Determine dot color
  let color = '#CCCCCC'; // Default Gray
  if (score <= 3) color = '#22C55E'; // Green
  else if (score <= 7) color = '#F59E0B'; // Yellow
  else color = '#EF4444'; // Red
  // Reset any global states that might interfere
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1.0;

  // Draw small circular dot in the bottom right corner
  const dotRadius = 4.8; 
  const padding = 2.5;
  const centerX = ICON_SIZE - dotRadius - padding;
  const centerY = ICON_SIZE - dotRadius - padding;

  // Draw the colored dot - EXPLICITLY SOLID
  ctx.beginPath();
  ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.closePath();
  const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
  chrome.action.setIcon({ imageData: { 32: imageData } });
  
  // Clear any existing text badge
  chrome.action.setBadgeText({ text: "" });
}
