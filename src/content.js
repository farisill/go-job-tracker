(function() {
  const browserAPI = typeof browser !== "undefined" ? browser : chrome;

  // --- Keyword Radar (scraper) ---
  const isJobDetailPage = window.location.href.match(/https:\/\/www\.linkedin\.com\/jobs\/view\/(\d+)\//);

  if (isJobDetailPage) {
    const jobRuntimeAPI = browserAPI.runtime;

    browserAPI.storage.local.get(["scraperEnabled", "keywords"]).then((result) => {
      const enabled = result.scraperEnabled !== false;
      if (!enabled) return;

      const keywords = result.keywords && result.keywords.length > 0
        ? result.keywords
        : ["JavaScript", "Python", "Go", "Remote"];

      const MAX_WAIT = 10000;
      const INTERVAL = 500;
      let elapsed = 0;

      const refinedURL = `https://www.linkedin.com/jobs/view/${isJobDetailPage[1]}/`;

      function applyH1Styling(isMatch) {
        const h1 = document.querySelector("h1");
        if (h1 && !h1.dataset.keywordStyled) {
          h1.classList.remove("is-match", "is-not-match");
          
          if (isMatch) {
            h1.classList.add("is-match");
          } else {
            h1.classList.add("is-not-match");
          }
          
          h1.dataset.keywordStyled = "true";
        }
      }

      const scanForMatches = () => {
        const paragraphs = document.querySelectorAll('p[dir="ltr"]');
        if (paragraphs.length === 0) {
          return false;
        }

        const combinedText = Array.from(paragraphs)
          .map(p => p.textContent.trim())
          .filter(t => t.length > 0)
          .join("\n\n");

        const foundKeywords = keywords.filter(k =>
          combinedText.toLowerCase().includes(k.toLowerCase())
        );

        if (foundKeywords.length > 0) {
          const now = new Date();
          const jobTitleH1 = document.querySelector("h1");
          const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
          const entry = `Job Title: ${jobTitleH1 ? jobTitleH1.textContent : "Unknown"}\nURL: ${refinedURL}\nKeywords: ${foundKeywords.join(', ')}\nDate: ${dateStr}\n`;

          jobRuntimeAPI.sendMessage({ type: "add_match", data: entry });
          applyH1Styling(true);
          return true;
        } else {
          applyH1Styling(false);
          return true;
        }

        return false;
      };

      const pollForMatches = () => {
        if (scanForMatches()) return;
        if (elapsed < MAX_WAIT) {
          elapsed += INTERVAL;
          setTimeout(pollForMatches, INTERVAL);
        }
      };

      pollForMatches();

      const observer = new MutationObserver(() => {
        if (scanForMatches()) {
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), MAX_WAIT);
    });
  }

  // --- Job List Page Keyword Matcher ---
  const isJobListPage = window.location.href.match(/^https:\/\/www\.linkedin\.com\/jobs\/(collections\/recommended|search)\/.+/);

  if (isJobListPage) {
    const emberRegex = /^ember\d+$/;
    
    // Function to count jobs
    function countJobs() {
      const elements = Array.from(document.querySelectorAll("li[id^='ember']"));
      const filtered = elements.filter(el => {
        // Must have ember[number] ID AND data-occludable-job-id attribute
        return emberRegex.test(el.id) && el.hasAttribute('data-occludable-job-id');
      });
      return filtered.length;
    }
    
    // Send job count only once when page is fully loaded
    let countSent = false;
    // Persisted in-page count for the popup to retrieve later (session-only)
    let savedJobCount = 0;
    
    function sendJobCountOnce() {
      if (countSent) return;
      
      const count = countJobs();
      // Save the computed count so popup can ask for it later
      savedJobCount = count;
      if (count > 0) {
        browserAPI.runtime.sendMessage({ type: "UPDATE_JOB_COUNT", count: count });
        countSent = true;
        console.log("[Job Counter] Count sent once:", count);
      }
    }
    
    // Wait for page to be fully loaded
    if (document.readyState === 'complete') {
      setTimeout(sendJobCountOnce, 1000);
    } else {
      window.addEventListener('load', () => {
        setTimeout(sendJobCountOnce, 1000);
      });
    }
    
    // Fallback timeout
    setTimeout(() => {
      if (!countSent) {
        sendJobCountOnce();
      }
    }, 3000);

    // Allow other parts (popup) to ask for the current job count
    browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === 'GET_JOB_COUNT') {
        sendResponse({ count: savedJobCount || 0 });
      }
    });

    browserAPI.storage.local.get(["scraperEnabled", "keywords"]).then((result) => {
      const enabled = result.scraperEnabled !== false;
      if (!enabled) return;

      const keywords = result.keywords && result.keywords.length > 0
        ? result.keywords
        : ["JavaScript", "Python", "Go", "Remote"];

      console.log("[Job List Matcher] Keywords in use:", keywords);

      const MAX_WAIT = 10000; // 10 seconds
      let observer = null;
      let contentObserver = null;
      let lastH1Text = "";
      let processedJobs = new Map(); // Store job title -> { matchStatus, strongElement, foundKeywords }

      function checkForMatches() {
        // Get all <p dir="ltr"> elements
        const paragraphs = document.querySelectorAll('p[dir="ltr"]');
        
        if (paragraphs.length === 0) {
          return false; // Not found yet
        }

        console.log("[Job List Matcher] Paragraphs found:", paragraphs.length);

        // Get the h1 element
        const h1 = document.querySelector("h1");
        
        if (!h1) {
          return true;
        }

        const currentH1Text = h1.textContent.trim();

        // Check if this is the same job we already processed
        if (currentH1Text === lastH1Text) {
          return true; // Already processed this content
        }

        console.log("[Job List Matcher] New job detected:", currentH1Text);

        // Remove previous classes from h1 only
        h1.classList.remove("is-match", "is-not-match");

        // Find the <strong> element that matches h1 text
        const allStrongs = document.querySelectorAll("strong");
        let targetContainer = null;
        let matchingStrong = null;

        for (const strong of allStrongs) {
          const strongText = strong.textContent.trim();
          if (strongText === currentH1Text) {
            console.log("[Job List Matcher] Found matching <strong>:", strongText);
            matchingStrong = strong;
            
            // Navigate 7 levels up to find the container
            let element = strong;
            for (let i = 0; i < 7; i++) {
              if (element.parentElement) {
                element = element.parentElement;
              } else {
                console.log("[Job List Matcher] Could not navigate 7 levels up");
                break;
              }
            }
            
            // Check if we successfully navigated 7 levels and it's a div
            if (element && element.tagName === "DIV") {
              targetContainer = element;
              console.log("[Job List Matcher] Found target container (7 levels up):", targetContainer);
              break;
            }
          }
        }

        // Only proceed if we found the container and strong
        if (!targetContainer || !matchingStrong) {
          console.log("[Job List Matcher] Target container or strong not found - skipping styling");
          lastH1Text = currentH1Text;
          return true;
        }

        let matchStatus;
        let foundKeywords = [];

        // Check if we already processed this job
        if (processedJobs.has(currentH1Text)) {
          const cached = processedJobs.get(currentH1Text);
          matchStatus = cached.matchStatus;
          foundKeywords = cached.foundKeywords || [];
          console.log("[Job List Matcher] Using cached result:", matchStatus);
        } else {
          // Combine all text from paragraphs
          const combinedText = Array.from(paragraphs)
            .map(p => p.textContent.trim())
            .filter(t => t.length > 0)
            .join("\n\n");

          // Find matching keywords
          foundKeywords = keywords.filter(k =>
            combinedText.toLowerCase().includes(k.toLowerCase())
          );

          matchStatus = foundKeywords.length > 0 ? "match" : "no-match";
          
          // Store the result with the strong element and keywords
          processedJobs.set(currentH1Text, { 
            matchStatus, 
            strongElement: matchingStrong,
            foundKeywords 
          });

          if (matchStatus === "match") {
            // Log match to background for download
            const now = new Date();
            const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
            
            // Extract job ID from the currently viewed job
            // Look for the job ID in the URL bar or from a link in the page
            let jobURL = window.location.href;
            const urlMatch = jobURL.match(/currentJobId=(\d+)/);
            if (urlMatch) {
              const jobId = urlMatch[1];
              jobURL = `https://www.linkedin.com/jobs/view/${jobId}/`;
            }
            
            const entry = `Job Title: ${currentH1Text}\nURL: ${jobURL}\nKeywords: ${foundKeywords.join(', ')}\nDate: ${dateStr}\n`;
            
            browserAPI.runtime.sendMessage({ type: "add_match", data: entry });
          }
        }

        // Apply styling based on match status
        if (matchStatus === "match") {
          // H1 styling
          h1.classList.add("is-match");
          
          // Container styling (without text)
          targetContainer.classList.add("job-card-match");
          targetContainer.classList.remove("job-card-no-match");
          
          // Strong styling (with text marker)
          matchingStrong.classList.add("strong-match");
          matchingStrong.classList.remove("strong-no-match");
        } else {
          // H1 styling
          h1.classList.add("is-not-match");
          
          // Container styling (without text)
          targetContainer.classList.add("job-card-no-match");
          targetContainer.classList.remove("job-card-match");
          
          // Strong styling (with text marker)
          matchingStrong.classList.add("strong-no-match");
          matchingStrong.classList.remove("strong-match");
        }

        // Update last processed h1 text
        lastH1Text = currentH1Text;

        // Re-apply styling to all visible job cards
        reapplyAllStyling();

        return true; // Found and processed
      }

      function reapplyAllStyling() {
        // Find all <strong> elements and check if we have styling info for them
        const allStrongs = document.querySelectorAll("strong");
        
        for (const strong of allStrongs) {
          const strongText = strong.textContent.trim();
          
          if (processedJobs.has(strongText)) {
            const jobData = processedJobs.get(strongText);
            const matchStatus = jobData.matchStatus;
            
            // Navigate 7 levels up to find the container
            let element = strong;
            for (let i = 0; i < 7; i++) {
              if (element.parentElement) {
                element = element.parentElement;
              } else {
                break;
              }
            }
            
            // Apply styling if it's a div container
            if (element && element.tagName === "DIV") {
              if (matchStatus === "match") {
                element.classList.add("job-card-match");
                element.classList.remove("job-card-no-match");
                
                strong.classList.add("strong-match");
                strong.classList.remove("strong-no-match");
              } else {
                element.classList.add("job-card-no-match");
                element.classList.remove("job-card-match");
                
                strong.classList.add("strong-no-match");
                strong.classList.remove("strong-match");
              }
            }
          }
        }
      }

      // Try immediately
      if (!checkForMatches()) {
        console.log("[Job List Matcher] Waiting for paragraphs to load...");

        // Set up MutationObserver to watch for DOM changes
        observer = new MutationObserver(() => {
          if (checkForMatches()) {
            console.log("[Job List Matcher] Watcher deactivated - paragraphs found");
            observer.disconnect();
            
            // Start watching for content changes
            startContentWatcher();
          }
        });

        observer.observe(document.body, { 
          childList: true, 
          subtree: true 
        });

        // Safety timeout: disconnect after 10 seconds
        setTimeout(() => {
          if (observer) {
            observer.disconnect();
            console.log("[Job List Matcher] Watcher deactivated - timeout reached (10s)");
            
            // Start watching for content changes anyway
            startContentWatcher();
          }
        }, MAX_WAIT);
      } else {
        console.log("[Job List Matcher] Paragraphs found immediately");
        
        // Start watching for content changes
        startContentWatcher();
      }

      function startContentWatcher() {
        const h1 = document.querySelector("h1");
        if (!h1) return;

        console.log("[Job List Matcher] Content watcher started - monitoring for job changes");

        contentObserver = new MutationObserver(() => {
          checkForMatches();
        });

        contentObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    });
  }

  // --- Open Jobs workflow ---
  const runtimeAPI = browserAPI.runtime;
  
  runtimeAPI.onMessage.addListener((message) => {
    if (message.action === "SHOW_ERROR_ALERT") {
      // Show error alert on the page
      alert(message.message);
    } else if (message.action === "EXTRACT_JOB_IDS") {
      // Find all <li> elements with ID starting with "ember" followed by numbers
      const elements = Array.from(document.querySelectorAll("li[id^='ember']"));
      
      // Filter to get only those with ember followed by numbers pattern
      const emberRegex = /^ember\d+$/;
      const filtered = elements.filter(el => emberRegex.test(el.id));
      
      // Extract data-occludable-job-id values and build URLs
      const jobIds = filtered
        .map(el => el.getAttribute("data-occludable-job-id"))
        .filter(v => v && v.trim() !== "");
      
      const jobUrls = jobIds.map(jobId => `https://www.linkedin.com/jobs/view/${jobId}/`);
      
      // Show alert with count
      const count = jobUrls.length;
      const confirmed = confirm(`Would you like to open all the ${count} matches in new tabs?\n\nIMPORTANT: The tabs will open with a small delay between each to avoid overwhelming the browser.`);
      
      if (confirmed && jobUrls.length > 0) {
        // Send URLs to background script to open tabs
        runtimeAPI.sendMessage({ type: "OPEN_JOB_TABS", urls: jobUrls });
      }
    }
  });
})();