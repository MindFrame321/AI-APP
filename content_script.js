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
let chatUIInitialized = false;
let chatMessagesEl = null;
let chatInputEl = null;
let chatPanelEl = null;
let chatToggleEl = null;

// Block page immediately - runs BEFORE page loads
function blockPageImmediately() {
  console.log('[Focufy] 🚫 BLOCKING PAGE IMMEDIATELY');
  
  // Stop page loading
  if (document.readyState === 'loading') {
    window.stop();
  }
  
  // Replace entire page content
  document.documentElement.innerHTML = '';
  document.documentElement.innerHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Page Blocked - Focufy</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          text-align: center;
          padding: 20px;
          margin: 0;
        }
        .container {
          max-width: 600px;
        }
        h1 { font-size: 48px; margin-bottom: 16px; }
        p { font-size: 18px; opacity: 0.9; margin-bottom: 24px; }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background: white;
          color: #667eea;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
          margin: 8px;
          cursor: pointer;
          border: none;
        }
        .button:hover { opacity: 0.9; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚫 Page Blocked</h1>
        <p>This domain is on your always-block list.</p>
        <button class="button" onclick="window.history.back()">Go Back</button>
        <button class="button" onclick="chrome.runtime.sendMessage({action: 'endSession'}, () => window.location.reload())">End Session</button>
      </div>
    </body>
    </html>
  `;
  document.documentElement.scrollTop = 0;
}

// Check if current domain should be blocked (content script - runs immediately)
async function checkAlwaysBlock() {
  try {
    console.log('[Focufy] Checking always-block for:', window.location.href);
    
    // Get session first
    const sessionResponse = await chrome.runtime.sendMessage({ action: 'getSession' });
    console.log('[Focufy] Session response:', sessionResponse);
    
    if (!sessionResponse?.session?.active) {
      console.log('[Focufy] No active session, not blocking');
      return false;
    }
    
    // Check if domain should be blocked
    const blockResponse = await chrome.runtime.sendMessage({ 
      action: 'checkAlwaysBlock', 
      url: window.location.href 
    });
    
    console.log('[Focufy] Block response:', blockResponse);
    
    if (blockResponse && blockResponse.shouldBlock) {
      console.log('[Focufy] 🚫 Domain is always-blocked, blocking page immediately');
      blockPageImmediately();
      return true;
    }
  } catch (error) {
    console.error('[Focufy] Error checking always-block:', error);
  }
  return false;
}

// Initialize - run IMMEDIATELY
(async () => {
  console.log('[Focufy] Content script loaded on:', window.location.href);
  console.log('[Focufy] Document ready state:', document.readyState);
  
  // Check always-block FIRST (before anything else) - run immediately
  const isBlocked = await checkAlwaysBlock();
  if (isBlocked) {
    console.log('[Focufy] Page blocked, stopping initialization');
    return; // Don't continue if blocked
  }

  // Initialize chatbot UI early so it can sit on the side while you browse
  initChatbotUI();
  
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

// Also check on DOMContentLoaded (in case script loaded early)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Focufy] DOMContentLoaded, checking always-block again');
    await checkAlwaysBlock();
  });
}

// Ensure chatbot UI exists even if script loaded before body
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatbotUI, { once: true });
} else {
  initChatbotUI();
}

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

// Chatbot UI creation
function initChatbotUI() {
  if (chatUIInitialized) return;
  if (!document.body) return; // Wait for DOM
  
  chatUIInitialized = true;
  
  const style = document.createElement('style');
  style.id = 'focufy-chatbot-style';
  style.textContent = `
    .focufy-chat-toggle {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 999999;
      background: linear-gradient(135deg, #667eea, #5a67d8);
      color: white;
      border: none;
      border-radius: 999px;
      padding: 12px 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .focufy-chat-toggle:hover { opacity: 0.94; }
    .focufy-chat-toggle .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #48bb78;
      box-shadow: 0 0 0 6px rgba(72,187,120,0.18);
    }
    .focufy-chat-panel {
      position: fixed;
      top: 64px;
      right: 16px;
      width: 360px;
      height: calc(100vh - 96px);
      max-height: 760px;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
      z-index: 999999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: translateX(420px);
      transition: transform 0.25s ease, opacity 0.2s ease;
      opacity: 0;
    }
    .focufy-chat-panel.open {
      transform: translateX(0);
      opacity: 1;
    }
    .focufy-chat-header {
      padding: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(135deg, rgba(102,126,234,0.2), rgba(87,108,209,0.08));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .focufy-chat-title { margin: 0; font-size: 16px; font-weight: 700; }
    .focufy-chat-subtitle { margin: 2px 0 0; font-size: 12px; color: #cbd5e1; }
    .focufy-chat-close {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.2);
      color: #e2e8f0;
      border-radius: 10px;
      width: 32px;
      height: 32px;
      cursor: pointer;
    }
    .focufy-chat-body {
      flex: 1;
      padding: 12px 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: radial-gradient(circle at 20% 20%, rgba(102,126,234,0.08), transparent 30%), #0b1224;
    }
    .focufy-msg {
      border-radius: 12px;
      padding: 10px 12px;
      max-width: 92%;
      line-height: 1.45;
      font-size: 13px;
      box-shadow: 0 10px 24px rgba(0,0,0,0.14);
      white-space: pre-wrap;
    }
    .focufy-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #5a67d8, #7f9cf5);
      color: white;
    }
    .focufy-msg.bot {
      align-self: flex-start;
      background: rgba(226,232,240,0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .focufy-chat-footer {
      padding: 12px;
      border-top: 1px solid rgba(255,255,255,0.08);
      background: #0f172a;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .focufy-chat-input {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: #e2e8f0;
      padding: 10px 12px;
      resize: none;
      min-height: 48px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .focufy-chat-actions {
      display: flex;
      gap: 8px;
    }
    .focufy-btn {
      flex: 1;
      padding: 10px 12px;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .focufy-btn.primary {
      background: linear-gradient(135deg, #667eea, #5a67d8);
      color: white;
    }
    .focufy-btn.secondary {
      background: rgba(255,255,255,0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255,255,255,0.1);
    }
  `;
  document.head.appendChild(style);
  
  chatPanelEl = document.createElement('div');
  chatPanelEl.className = 'focufy-chat-panel';
  chatPanelEl.innerHTML = `
    <div class="focufy-chat-header">
      <div>
        <div class="focufy-chat-title">Focufy Coach</div>
        <div class="focufy-chat-subtitle">Page-aware chat + quizzes</div>
      </div>
        <button class="focufy-chat-close" aria-label="Close">×</button>
    </div>
    <div class="focufy-chat-body" id="focufyChatMessages"></div>
    <div class="focufy-chat-footer">
      <textarea class="focufy-chat-input" id="focufyChatInput" placeholder="Ask about this page or say 'quiz me'..."></textarea>
      <div class="focufy-chat-actions">
        <button class="focufy-btn secondary" id="focufyQuizBtn">Quiz me</button>
        <button class="focufy-btn primary" id="focufySendBtn">Send</button>
      </div>
    </div>
  `;
  
  chatMessagesEl = chatPanelEl.querySelector('#focufyChatMessages');
  chatInputEl = chatPanelEl.querySelector('#focufyChatInput');
  const sendBtn = chatPanelEl.querySelector('#focufySendBtn');
  const quizBtn = chatPanelEl.querySelector('#focufyQuizBtn');
  const closeBtn = chatPanelEl.querySelector('.focufy-chat-close');
  
  chatToggleEl = document.createElement('button');
  chatToggleEl.className = 'focufy-chat-toggle';
  chatToggleEl.innerHTML = `<span class="dot"></span><span>Focufy Coach</span>`;
  
  document.body.appendChild(chatPanelEl);
  document.body.appendChild(chatToggleEl);
  
  chatToggleEl.addEventListener('click', toggleChatPanel);
  closeBtn.addEventListener('click', toggleChatPanel);
  sendBtn.addEventListener('click', () => submitChat());
  quizBtn.addEventListener('click', () => submitChat('Give me a quick quiz on this page and my current focus.'));
  
  chatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  });
  
  addChatMessage('bot', 'I am Focufy Coach. Ask about this page, or hit "Quiz me" for quick practice. I will use the page plus your learning data when available.');
}

function toggleChatPanel() {
  if (!chatPanelEl) return;
  chatPanelEl.classList.toggle('open');
}

function addChatMessage(role, text) {
  if (!chatMessagesEl) return null;
  const msg = document.createElement('div');
  msg.className = `focufy-msg ${role}`;
  msg.textContent = text;
  chatMessagesEl.appendChild(msg);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  return msg;
}

async function submitChat(prefilled) {
  const text = (prefilled || chatInputEl?.value || '').trim();
  if (!text) return;
  if (chatInputEl) chatInputEl.value = '';
  
  addChatMessage('user', text);
  const thinkingEl = addChatMessage('bot', 'Thinking...');
  
  try {
    const selection = window.getSelection ? (window.getSelection().toString() || '') : '';
    const response = await chrome.runtime.sendMessage({
      action: 'chatbotQuestion',
      question: text,
      selectionText: selection.substring(0, 1500),
      pageUrl: window.location.href
    });
    
    if (response?.success && response.answer) {
      thinkingEl.textContent = response.answer;
    } else {
      thinkingEl.textContent = response?.error || 'I could not answer right now.';
    }
  } catch (error) {
    console.error('[Focufy] Chatbot error:', error);
    thinkingEl.textContent = 'Chatbot hit an error. Please try again.';
  }
}


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
  console.log('[Focufy] Document ready state:', document.readyState);
  
  // Force blocking to be active for always-blocked pages
  if (reason === 'always-blocked') {
    isBlockingActive = true;
  }
  
  // Show blocked overlay
  showBlockedOverlay(reason);
  
  // Also hide the body content - more aggressive blocking
  const hideAllContent = () => {
    if (document.body) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'relative';
      // Hide all direct children of body except the overlay
      Array.from(document.body.children).forEach(child => {
        if (child.id !== 'focus-ai-overlay') {
          child.style.display = 'none';
          child.style.visibility = 'hidden';
        }
      });
      // Also hide html element content
      if (document.documentElement) {
        Array.from(document.documentElement.children).forEach(child => {
          if (child.tagName !== 'BODY' && child.id !== 'focus-ai-overlay') {
            child.style.display = 'none';
            child.style.visibility = 'hidden';
          }
        });
      }
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideAllContent);
  } else {
    hideAllContent();
  }
  
  // Also watch for dynamically added content and hide it
  if (window.focusAIObserver) {
    window.focusAIObserver.disconnect();
  }
  
  window.focusAIObserver = new MutationObserver(() => {
    hideAllContent();
  });
  
  window.focusAIObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
  
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
