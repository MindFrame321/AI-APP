/**
 * Focufy - Content Script
 * 
 * Handles element-level blocking on pages
 * Hides/distorts distracting elements while keeping relevant content visible
 */

let isBlockingActive = false;
let currentSession = null;
let blockedSelectors = [];
let blockedElements = new Set();

// Initialize
(async () => {
  console.log('[Focufy] Content script loaded on:', window.location.href);
  // Check if session is active
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSession' });
    console.log('[Focufy] Initial session check:', response?.session ? 'active' : 'inactive');
    if (response && response.session && response.session.active) {
      startBlocking(response.session);
    }
  } catch (error) {
    console.error('[Focufy] Error checking session:', error);
  }
})();

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Focufy] Message received:', request.action);
  
  if (request.action === 'startBlocking') {
    startBlocking(request.session);
    sendResponse({ success: true });
  } else if (request.action === 'stopBlocking') {
    stopBlocking();
    sendResponse({ success: true });
  } else if (request.action === 'applyBlocks') {
    applyBlocks(request.selectors || [], request.reason);
    sendResponse({ success: true });
  } else if (request.action === 'clearBlocks') {
    clearAllBlocks();
    sendResponse({ success: true });
  } else if (request.action === 'blockPage') {
    blockEntirePage(request.reason);
    sendResponse({ success: true });
  } else if (request.action === 'showSearchChoice') {
    showSearchChoiceModal(request.mainTopic, request.subtopic).then(choice => {
      sendResponse({ choice });
    });
    return true; // Keep channel open for async response
  }
  return true;
});

// Start blocking
function startBlocking(session) {
  console.log('[Focufy] startBlocking called, task:', session?.taskDescription);
  isBlockingActive = true;
  currentSession = session;
  
  // Notify background that page is loaded
  chrome.runtime.sendMessage({ action: 'pageLoaded' }).catch(err => {
    console.error('[Focufy] Failed to send pageLoaded:', err);
  });
  
  // Watch for dynamically added content
  observePageChanges();
}

// Stop blocking
function stopBlocking() {
  console.log('[Focufy] stopBlocking called');
  isBlockingActive = false;
  currentSession = null;
  clearAllBlocks();
  console.log('[Focufy] Blocking stopped, all blocks cleared');
}

// Apply blocks to specific selectors
function applyBlocks(selectors, reason) {
  console.log('[Focufy] applyBlocks called with', selectors?.length || 0, 'selectors, reason:', reason);
  
  if (!isBlockingActive) {
    console.log('[Focufy] Blocking not active, ignoring');
    return;
  }
  
  clearAllBlocks();
  blockedSelectors = selectors || [];
  
  if (!selectors || selectors.length === 0) {
    console.log('[Focufy] No selectors to block');
    return;
  }
  
  let blockedCount = 0;
  selectors.forEach(selector => {
    try {
      // Try to find elements matching selector
      let elements = document.querySelectorAll(selector);
      
      // If no elements found and it's a complex selector, try simpler variations
      if (elements.length === 0 && selector.includes('.')) {
        // Try just the class name
        const classMatch = selector.match(/\.([\w-]+)/);
        if (classMatch) {
          elements = document.querySelectorAll(classMatch[1]);
        }
      }
      
      // If still no elements and it's a YouTube selector, try alternative patterns
      if (elements.length === 0 && window.location.hostname.includes('youtube.com')) {
        // Try finding by data attributes or parent structure
        if (selector.includes('ytd-')) {
          const tagName = selector.match(/ytd-[\w-]+/)?.[0];
          if (tagName) {
            elements = document.querySelectorAll(tagName);
          }
        }
      }
      
      console.log('[Focufy] Selector', selector, 'matched', elements.length, 'elements');
      elements.forEach(el => {
        // NEVER block main YouTube player or primary content
        if (window.location.hostname.includes('youtube.com')) {
          const isMainPlayer = el.closest('#player, #primary, ytd-watch-flexy, #watch7-content, #watch7-main-container');
          if (isMainPlayer) {
            console.log('[Focufy] Skipping main player element');
            return;
          }
          // Also check if element itself is the player
          if (el.id === 'player' || el.id === 'primary' || el.classList.contains('ytd-watch-flexy')) {
            console.log('[Focufy] Skipping main player element (by ID)');
            return;
          }
        }
        blockElement(el);
        blockedCount++;
      });
    } catch (e) {
      console.warn('[Focufy] Invalid selector:', selector, e);
      // Try to find by partial match if it's a class selector
      if (selector.startsWith('.')) {
        try {
          const className = selector.substring(1).split('.')[0];
          const elements = document.querySelectorAll(`[class*="${className}"]`);
          console.log('[Focufy] Fallback: found', elements.length, 'elements with class containing', className);
          elements.forEach(el => {
            blockElement(el);
            blockedCount++;
          });
        } catch (e2) {
          console.warn('[Focufy] Fallback also failed:', e2);
        }
      }
    }
  });
  
  console.log('[Focufy] Total elements blocked:', blockedCount);
  
  // If blocking entire page (body), show overlay instead
  if (selectors.includes('body') || selectors.includes('html')) {
    showBlockedOverlay(reason);
  }
}

// Block a single element
function blockElement(element) {
  if (blockedElements.has(element)) return;
  blockedElements.add(element);
  
  // Hide the element cleanly (no visual indicators for cleaner look)
  const originalDisplay = element.style.display;
  element.style.display = 'none';
  element.setAttribute('data-focus-ai-blocked', 'true');
  element.setAttribute('data-focus-ai-original-display', originalDisplay || '');
  
  console.log('[Focufy] Blocked element:', element.tagName, element.className || element.id || 'no-id');
}

// Clear all blocks
function clearAllBlocks() {
  blockedSelectors = [];
  
  // Restore all blocked elements
  blockedElements.forEach(element => {
    element.style.display = '';
    element.removeAttribute('data-focus-ai-blocked');
  });
  blockedElements.clear();
  
  // Remove indicators
  document.querySelectorAll('.focus-ai-block-indicator').forEach(el => el.remove());
  
  // Remove overlay if present
  const overlay = document.getElementById('focus-ai-overlay');
  if (overlay) overlay.remove();
}

// Block entire page
function blockEntirePage(reason) {
  console.log('[Focufy] blockEntirePage called, reason:', reason);
  console.log('[Focufy] Current session:', currentSession);
  
  // Show blocked overlay
  showBlockedOverlay(reason);
  
  // Also hide the body content
  if (document.body) {
    document.body.style.overflow = 'hidden';
    // Hide all direct children of body except the overlay
    Array.from(document.body.children).forEach(child => {
      if (child.id !== 'focus-ai-overlay') {
        child.style.display = 'none';
      }
    });
  }
  
  console.log('[Focufy] ✅ Page blocked successfully');
}

// Show blocked overlay
function showBlockedOverlay(reason) {
  console.log('[Focufy] showBlockedOverlay called, reason:', reason);
  
  // Remove existing overlay
  const existing = document.getElementById('focus-ai-overlay');
  if (existing) {
    console.log('[Focufy] Removing existing overlay');
    existing.remove();
  }
  
  const overlay = document.createElement('div');
  overlay.id = 'focus-ai-overlay';
  overlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    z-index: 99999999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: white !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    text-align: center !important;
    padding: 20px !important;
    margin: 0 !important;
    border: none !important;
  `;
  
  const task = currentSession?.taskDescription || 'your task';
  const time = currentSession ? Math.ceil((currentSession.endTime - Date.now()) / 60000) : 0;
  
  overlay.innerHTML = `
    <div style="max-width: 600px;">
      <div style="font-size: 64px; margin-bottom: 24px;">🚫</div>
      <h1 style="font-size: 32px; margin-bottom: 16px; color: white;">Page Blocked</h1>
      <p style="font-size: 18px; margin-bottom: 32px; opacity: 0.9; color: white;">
        This page is not relevant to your current focus task.
      </p>
      <div style="background: rgba(255,255,255,0.1); padding: 24px; border-radius: 12px; margin: 24px 0;">
        <div style="font-size: 14px; opacity: 0.8; margin-bottom: 8px; color: white;">Your Focus Task</div>
        <div style="font-size: 20px; font-style: italic; color: white;">"${task}"</div>
      </div>
      <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; margin: 24px 0;">
        <div style="font-size: 14px; opacity: 0.8; margin-bottom: 8px; color: white;">Time Remaining</div>
        <div style="font-size: 36px; font-weight: bold; color: white;">${time} min</div>
      </div>
      <button onclick="window.history.back()" style="
        padding: 12px 24px;
        background: white;
        color: #667eea;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 24px;
      ">Go Back</button>
    </div>
  `;
  
  // Append to body
  if (document.body) {
    document.body.appendChild(overlay);
    console.log('[Focufy] ✅ Overlay added to body');
  } else {
    // If body doesn't exist yet, wait for it
    const observer = new MutationObserver(() => {
      if (document.body) {
        document.body.appendChild(overlay);
        console.log('[Focufy] ✅ Overlay added to body (after wait)');
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  }
  
  console.log('[Focufy] Overlay created and should be visible');
}

// Observe page changes (for dynamically added content)
function observePageChanges() {
  if (window.focusAIObserver) {
    window.focusAIObserver.disconnect();
  }
  
  const hostname = window.location.hostname;
  const isYouTube = hostname.includes('youtube.com');
  
  window.focusAIObserver = new MutationObserver((mutations) => {
    if (!isBlockingActive) return;
    
    // Check if new elements match blocked selectors
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) { // Element node
          blockedSelectors.forEach(selector => {
            try {
              if (node.matches && node.matches(selector)) {
                blockElement(node);
              }
              // Also check children
              const matches = node.querySelectorAll && node.querySelectorAll(selector);
              if (matches) {
                matches.forEach(el => blockElement(el));
              }
            } catch (e) {
              // Invalid selector, skip
            }
          });
          
          // Special handling for YouTube - watch for new video elements
          if (isYouTube) {
            const videoElements = node.querySelectorAll && node.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer');
            if (videoElements && videoElements.length > 0) {
              // Re-analyze page if many new videos added (YouTube infinite scroll)
              setTimeout(() => {
                if (isBlockingActive && currentSession) {
                  chrome.runtime.sendMessage({ action: 'pageLoaded' });
                }
              }, 1000);
            }
          }
        }
      });
    });
  });
  
  window.focusAIObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // For YouTube, also watch for navigation changes (SPA)
  if (isYouTube) {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Page changed, re-analyze
        setTimeout(() => {
          if (isBlockingActive && currentSession) {
            chrome.runtime.sendMessage({ action: 'pageLoaded' });
          }
        }, 2000);
      }
    }, 1000);
  }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (window.focusAIObserver) {
    window.focusAIObserver.disconnect();
  }
});
