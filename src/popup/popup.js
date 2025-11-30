// =============================================================================
// POPUP SCRIPT - Controls the extension popup interface
// =============================================================================

// Cross-browser API compatibility
const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
const storageAPI = browserAPI.storage;
const runtimeAPI = browserAPI.runtime;
const tabsAPI = browserAPI.tabs;

// =============================================================================
// DOM ELEMENTS
// =============================================================================

const searchKeywordsBtn = document.getElementById("search-keywords-btn");
const openJobsBtn = document.getElementById("open-jobs-btn");
const setKeywordsBtn = document.getElementById("set-keywords-btn");
const downloadBtn = document.getElementById('downloadMatchesBtn');
const flushBtn = document.getElementById('flushMatchesBtn');
const jobCounter = document.getElementById('job-counter');

const keywordsModal = document.getElementById("keywords-modal");
const keywordsInput = document.getElementById("keywords-input");
const keywordsSaveBtn = document.getElementById("keywords-save-btn");
const keywordsClose = document.getElementById("keywords-close");

// =============================================================================
// KEYWORD RADAR TOGGLE
// =============================================================================

// Initialize button state on load
storageAPI.local.get(["scraperEnabled"], (result) => {
  const enabled = result.scraperEnabled !== false;
  updateRadarButton(enabled);
});

// Toggle the keyword radar on/off
searchKeywordsBtn.addEventListener("click", () => {
  storageAPI.local.get(["scraperEnabled"], (result) => {
    const current = result.scraperEnabled !== false;
    const newState = !current;

    storageAPI.local.set({ scraperEnabled: newState }, () => {
      runtimeAPI.sendMessage({ action: "updateIcon", enabled: newState });
      updateRadarButton(newState);
    });
  });
});

/**
 * Updates the radar button text and styling based on enabled state
 */
function updateRadarButton(enabled) {
  searchKeywordsBtn.textContent = enabled ? "Keyword Radar ON" : "Keyword Radar OFF";
  
  if (enabled) {
    searchKeywordsBtn.classList.add("active");
  } else {
    searchKeywordsBtn.classList.remove("active");
  }
}

// =============================================================================
// JOB COUNTER
// =============================================================================

/**
 * Updates the job counter display
 */
function updateJobCounter(count) {
  if (jobCounter) {
    jobCounter.textContent = `${count} Job(s) Found`;
  }
}

// Listen for job count updates from content script (sent once per page load)
runtimeAPI.onMessage.addListener((message) => {
  if (message.type === "UPDATE_JOB_COUNT") {
    updateJobCounter(message.count);
  }
  else if (message.type === 'OPEN_JOB_TABS_STATUS') {
    // Handle background status updates for opening job tabs
    if (message.status === 'started') {
      // disable open button while opening
      if (openJobsBtn) openJobsBtn.disabled = true;
      if (openJobsBtn) openJobsBtn.classList.add('disabled');
    } else if (message.status === 'progress') {
      // optional: update UI about progress
      // message.opened, message.total
    } else if (message.status === 'finished') {
      if (openJobsBtn) openJobsBtn.disabled = false;
      if (openJobsBtn) openJobsBtn.classList.remove('disabled');
    }
  }
});

// Initialize counter on popup load
document.addEventListener("DOMContentLoaded", () => {
  // Request the current job count from the active tab's content script so
  // the popup shows a persisted value even if it was computed previously.
  try {
    tabsAPI.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) return;
      tabsAPI.sendMessage(tab.id, { type: 'GET_JOB_COUNT' }, (response) => {
        if (!response) return;
        if (typeof response.count === 'number') {
          updateJobCounter(response.count);
        }
      });
    });
  } catch (err) {
    // Not critical: if we can't query the tab, the UPDATE_JOB_COUNT listener
    // will still update the UI if the content script sends a message.
    console.warn('Failed to request GET_JOB_COUNT from active tab:', err);
  }
});

// =============================================================================
// OPEN JOBS FEATURE
// =============================================================================

openJobsBtn.addEventListener("click", async () => {
  try {
    const tabs = await new Promise((resolve) => {
      tabsAPI.query({ active: true, currentWindow: true }, resolve);
    });
    const tab = tabs[0];

    // Validate that we're on a LinkedIn jobs page
    const jobsSearchPattern = /^https:\/\/www\.linkedin\.com\/jobs\/(search|collections)\/.*/;
    if (!jobsSearchPattern.test(tab.url)) {
      tabsAPI.sendMessage(tab.id, { 
        action: "SHOW_ERROR_ALERT",
        message: "Error: This feature works only on a webpage with a list of jobs.\nMake a search and try it again."
      });
      return;
    }

    // Request job extraction from content script
    tabsAPI.sendMessage(tab.id, { action: "EXTRACT_JOB_IDS" });
    // when content script sends the OPEN_JOB_TABS message to background, we'll get status updates
    
  } catch (err) {
    showAlert("Failed to communicate with the page. Make sure you are on a LinkedIn jobs page.");
  }
});

// (cancel button removed)

// =============================================================================
// SET KEYWORDS MODAL
// =============================================================================

setKeywordsBtn.addEventListener("click", () => {
  storageAPI.local.get(["keywords"], (result) => {
    keywordsInput.value = (result.keywords || []).join(", ");
    keywordsModal.classList.remove("hidden");
    keywordsModal.style.display = "flex";
  });
});

keywordsSaveBtn.addEventListener("click", () => {
  const raw = keywordsInput.value;
  const keywordsArray = raw
    .split(",")
    .map(k => k.trim())
    .filter(k => k.length > 0);
  
  storageAPI.local.set({ keywords: keywordsArray }, () => {
    keywordsModal.classList.add("hidden");
    keywordsModal.style.display = "none";
  });
});

keywordsClose.addEventListener("click", () => {
  keywordsModal.classList.add("hidden");
  keywordsModal.style.display = "none";
});

// =============================================================================
// DOWNLOAD MATCHES FEATURE
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  if (downloadBtn) {
    updateDownloadButton();

    downloadBtn.addEventListener('click', () => {
      if (downloadBtn.disabled) return;

      runtimeAPI.sendMessage({ type: "get_all_matches" }, (response) => {
        if (!response) return;
        
        const matches = response.matches || [];
        const content = matches.map((match, idx) => `#${idx + 1}\n${match}`).join('\n');
        
        downloadFile(content, 'matches_found.txt');

        // Clear matches after download
        runtimeAPI.sendMessage({ type: "clear_matches" }, () => {
          updateDownloadButton();
        });
      });
    });
  }

  // Flush button: clear matches without downloading
  if (flushBtn) {
    flushBtn.addEventListener('click', () => {
      if (flushBtn.disabled) return;

      // Send message to clear matches list in background
      runtimeAPI.sendMessage({ type: "clear_matches" }, () => {
        updateDownloadButton();
      });
    });
  }
});

/**
 * Updates the download button text and state based on match count
 */
function updateDownloadButton() {
  runtimeAPI.sendMessage({ type: "get_match_count" }, (response) => {
    if (!response) return;
    
    const count = response.count || 0;
    downloadBtn.textContent = `Download (${count}) Matches`;
    
    if (count === 0) {
      downloadBtn.disabled = true;
      downloadBtn.classList.add('disabled');
    } else {
      downloadBtn.disabled = false;
      downloadBtn.classList.remove('disabled');
    }

    // Enable or disable the flush button along with download button
    if (flushBtn) {
      if (count === 0) {
        flushBtn.disabled = true;
        flushBtn.classList.add('disabled');
      } else {
        flushBtn.disabled = false;
        flushBtn.classList.remove('disabled');
      }
    }
  });
}

/**
 * Downloads content as a text file
 */
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Shows a modal alert with a custom message
 */
function showAlert(message) {
  const tempModal = document.createElement("div");
  tempModal.className = "modal";
  tempModal.innerHTML = `
    <div class="modal-content">
      <p>${message}</p>
      <button class="btn" id="close-temp-alert">Close</button>
    </div>
  `;
  document.body.appendChild(tempModal);
  tempModal.style.display = "flex";

  document.getElementById("close-temp-alert").addEventListener("click", () => {
    tempModal.remove();
  });
}