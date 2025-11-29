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
function handleOpenJobTabs(urls) {
  if (urls && Array.isArray(urls)) {
    urls.forEach(url => {
      browser.tabs.create({ url: url });
    });
  }
  return Promise.resolve({ status: "ok" });
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