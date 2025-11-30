// =============================================================================
// BACKGROUND SCRIPT - Manages extension state and message handling
// =============================================================================

// In-memory storage for job matches
let matchesStore = [];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extracts LinkedIn job URL from a match entry string
 * @param {string} entry - The match entry containing job information
 * @returns {string|null} - The extracted URL or null if not found
 */
function extractJobURL(entry) {
  const match = entry.match(/URL\s*:?\s*(https?:\/\/www\.linkedin\.com\/jobs\/view\/[\w\d\-_%/?=]*)/);
  return match ? match[1] : null;
}

/**
 * Delay for ms milliseconds
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random ms between minSeconds and maxSeconds, inclusive
 */
function randomDelayMs(minSeconds = 3, maxSeconds = 5) {
  const min = Math.ceil(minSeconds * 1000);
  const max = Math.floor(maxSeconds * 1000);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg.type) {
    case "add_match":
      return handleAddMatch(msg.data);
    
    case "get_match_count":
      return Promise.resolve({ count: matchesStore.length });
    
    case "get_all_matches":
      return Promise.resolve({ matches: matchesStore });
    
    case "clear_matches":
      matchesStore = [];
      return Promise.resolve({ status: "cleared" });
    
    case "OPEN_JOB_TABS":
      return handleOpenJobTabs(msg.urls);
    
    default:
      return Promise.resolve({ status: "unknown_message_type" });
  }
});

/**
 * Adds a new job match to the store if it's not already present
 */
function handleAddMatch(data) {
  const newJobURL = extractJobURL(data);
  const alreadyStored = matchesStore.some(saved => extractJobURL(saved) === newJobURL);
  
  if (newJobURL && !alreadyStored) {
    matchesStore.push(data);
  }
  
  return Promise.resolve({ status: "ok" });
}

/**
 * Opens all provided job URLs in new tabs
 */
async function handleOpenJobTabs(urls) {
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return Promise.resolve({ status: "ok", opened: 0 });
  }

  let openedCount = 0;

  // Broadcast start
  try {
    browser.runtime.sendMessage({ type: 'OPEN_JOB_TABS_STATUS', status: 'started', total: urls.length });
  } catch (e) {
    // ignore if no listeners
  }

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      // Open tab in the background so the user can keep working in the current tab
      await browser.tabs.create({ url, active: false });
      openedCount += 1;
      // Send progress update
      try {
        browser.runtime.sendMessage({ type: 'OPEN_JOB_TABS_STATUS', status: 'progress', opened: openedCount, total: urls.length });
      } catch (e) {}
    } catch (err) {
      console.error('[background] Failed to open tab:', url, err);
    }

    // Wait a random 3-5 seconds before opening next tab (unless last)
    if (i < urls.length - 1) {
      const waitMs = randomDelayMs(3, 5);
      await delay(waitMs);
    }
  }

  // Completed
  const opened = openedCount;
  try {
    browser.runtime.sendMessage({ type: 'OPEN_JOB_TABS_STATUS', status: 'finished', opened });
  } catch (e) {}

  return Promise.resolve({ status: 'ok', opened });
}

// =============================================================================
// EXTENSION LIFECYCLE
// =============================================================================

// Set default icon and state on install
browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.set({ scraperEnabled: true });
  browser.browserAction.setIcon({ path: "icons/enabled.png" });
});

// Update icon based on scraper state
browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "updateIcon") {
    const path = msg.enabled ? "icons/enabled.png" : "icons/disabled.png";
    browser.browserAction.setIcon({ path });
  }
});