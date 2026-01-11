(() => {
console.log("FOCUFY content_script loaded on", location.href);
if (window.__FOCUFY_CS_LOADED__) {
  console.log('[Focufy] Content script already injected, skipping re-run');
  return;
}
window.__FOCUFY_CS_LOADED__ = true;

let isBlockingActive = false;
let currentSession = null;
let blockedSelectors = [];
let blockedElements = new Set();
let focusCoachEnabled = true;
let chatUIInitialized = false;
let chatMessagesEl = null;
let chatInputEl = null;
let chatPanelEl = null;
let chatToggleEl = null;
let quizData = null;

// Block page immediately - runs BEFORE page loads
function blockPageImmediately() {
  console.log('[Focufy] 🚫 BLOCKING PAGE IMMEDIATELY');
  
  // Stop page loading
  if (document.readyState === 'loading') {
    window.stop();
  }
  
  // Replace entire page content
  document.documentElement.innerHTML = '';
  const body = document.createElement('body');
  body.style.cssText = `
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
  `;
  const container = document.createElement('div');
  container.className = 'container';
  container.style.maxWidth = '600px';
  container.innerHTML = `
    <h1 style="font-size:48px; margin-bottom:16px;">🚫 Page Blocked</h1>
    <p style="font-size:18px; opacity:0.9; margin-bottom:24px;">This domain is on your always-block list.</p>
  `;
  const btnBack = document.createElement('button');
  btnBack.className = 'button';
  btnBack.textContent = 'Go Back';
  btnBack.style.cssText = 'display:inline-block;padding:12px 24px;background:white;color:#667eea;border-radius:8px;text-decoration:none;font-weight:600;margin:8px;cursor:pointer;border:none;';
  btnBack.addEventListener('click', () => window.history.back());
  const btnEnd = document.createElement('button');
  btnEnd.className = 'button';
  btnEnd.textContent = 'End Session';
  btnEnd.style.cssText = btnBack.style.cssText;
  btnEnd.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'endSession' }, () => window.location.reload()));
  container.appendChild(btnBack);
  container.appendChild(btnEnd);
  body.appendChild(container);
  document.documentElement.appendChild(body);
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
  await maybeInitChatbotUI();
  
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
  document.addEventListener('DOMContentLoaded', maybeInitChatbotUI, { once: true });
} else {
  maybeInitChatbotUI();
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === '__ping') {
    sendResponse({ ok: true });
    return true;
  }
  console.log('[Focufy] Message received:', request.action);
  
  if (request.action === 'startBlocking') {
    startBlocking(request.session);
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'stopBlocking') {
    stopBlocking();
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'applyBlocks') {
    applyBlocks(request.selectors || [], request.reason, request.explanation);
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'clearBlocks') {
    clearAllBlocks();
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'blockPage') {
    blockEntirePage(request.reason);
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'showSearchChoice') {
    showSearchChoiceModal(request.mainTopic, request.subtopic).then(choice => {
      sendResponse({ choice });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'pauseTax') {
    showPauseTaxOverlay(request.goal, request.delayMs, request.elapsed);
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'showPassiveCoach') {
    showPassiveCoachOverlay(request.summary, request.quiz);
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'showOffTaskOverlay') {
    showOffTaskOverlay(request.reason || 'Off-task search detected');
    sendResponse({ success: true, ok: true });
  } else if (request.action === 'reasonChat') {
    openReasonChat(request.reason || 'Explain why this was blocked and whether it relates to my goal.');
    sendResponse({ success: true, ok: true });
  }
  return true;
});

async function maybeInitChatbotUI() {
  if (chatUIInitialized) return;
  focusCoachEnabled = await getCoachEnabled();
  if (!focusCoachEnabled) return;
  initChatbotUI();
}

async function getCoachEnabled() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    if (typeof result.settings?.focusCoachEnabled === 'boolean') {
      return result.settings.focusCoachEnabled;
    }
  } catch (e) {
    console.error('[Focufy] Could not load coach setting:', e);
  }
  return true;
}

// Chatbot UI creation
function initChatbotUI() {
  if (chatUIInitialized) return;
  if (!focusCoachEnabled) return;
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

function showReasonFailPopup(message) {
  const existing = document.getElementById('focufy-reason-fail');
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.id = 'focufy-reason-fail';
  wrap.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 100000001;
    display: flex; align-items: center; justify-content: center; padding: 18px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;
  wrap.innerHTML = `
    <div style="background:#0f172a; color:#e2e8f0; width:min(420px, 100%); border-radius:16px; padding:20px; box-shadow:0 30px 80px rgba(0,0,0,0.4); border:1px solid rgba(0,226,139,0.4); text-align:center;">
      <div style="font-size:18px; font-weight:700; margin-bottom:6px;">AI coach unavailable</div>
      <div style="font-size:13px; opacity:0.9; margin-bottom:14px;">${message || 'Reasoning timed out. Check your API key and try again.'}</div>
      <div style="display:flex; gap:10px; justify-content:center;">
        <button id="focufy-reason-retry" style="padding:10px 14px; border-radius:12px; border:1px solid rgba(0,226,139,0.6); background:#111827; color:#e2e8f0; cursor:pointer;">Retry</button>
        <button id="focufy-reason-close" style="padding:10px 14px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:#1f2937; color:#9ca3af; cursor:pointer;">Close</button>
      </div>
    </div>
  `;
  document.body ? document.body.appendChild(wrap) : document.documentElement.appendChild(wrap);
  wrap.querySelector('#focufy-reason-close')?.addEventListener('click', () => wrap.remove());
  wrap.querySelector('#focufy-reason-retry')?.addEventListener('click', () => {
    wrap.remove();
    openReasonChat('Explain why this was blocked and whether it relates to my goal.');
  });
}

function isReasonAllowing(answer) {
  if (!answer) return false;
  const text = answer.toLowerCase();
  if (text.includes('not relevant') || text.includes('irrelevant') || text.includes('avoid') || text.includes('off-task')) {
    return false;
  }
  return text.includes('relevant') || text.includes('related') || text.includes('allow') || text.includes('okay') || text.includes('supports') || text.includes('fits your goal');
}

function showReasonSuccessToast() {
  const existing = document.getElementById('focufy-reason-success');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'focufy-reason-success';
  toast.style.cssText = `
    position: fixed; bottom: 18px; right: 18px; z-index: 100000002;
    background: #0f172a; color: #e2e8f0; padding: 12px 16px; border-radius: 12px;
    border: 1px solid rgba(0,226,139,0.6); box-shadow: 0 20px 40px rgba(0,0,0,0.35);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px;
  `;
  toast.textContent = 'Coach agreed. Unblocking this page.';
  document.body ? document.body.appendChild(toast) : document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

async function submitChat(prefilled, options = {}) {
  const { showFailurePopup = false, reasonUnlock = false } = options;
  const text = (prefilled || chatInputEl?.value || '').trim();
  if (!text) return { success: false, error: 'No prompt' };
  if (chatInputEl) chatInputEl.value = '';
  
  addChatMessage('user', text);
  const thinkingEl = addChatMessage('bot', 'Thinking...');
  if (!thinkingEl) return { success: false, error: 'UI missing' };
  
  try {
    const selection = window.getSelection ? (window.getSelection().toString() || '') : '';
    const response = await Promise.race([
      chrome.runtime.sendMessage({
        action: 'chatbotQuestion',
        question: text,
        selectionText: selection.substring(0, 1500),
        pageUrl: window.location.href
      }),
      new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'Timed out. Check AI settings/API key.' }), 12000))
    ]);
    
    if (response?.success && response.answer) {
      if (thinkingEl) thinkingEl.textContent = response.answer;
      if (reasonUnlock && isReasonAllowing(response.answer)) {
        clearAllBlocks();
        showReasonSuccessToast();
        try {
          chrome.runtime.sendMessage({ action: 'reasonOverrideAllow', url: window.location.href });
        } catch (_) {}
      }
      return { success: true, answer: response.answer };
    } else {
      const msg = response?.error || 'I could not answer right now.';
      if (thinkingEl) thinkingEl.textContent = msg;
      if (showFailurePopup) showReasonFailPopup(msg);
      return { success: false, error: msg };
    }
  } catch (error) {
    console.error('[Focufy] Chatbot error:', error);
    if (thinkingEl) thinkingEl.textContent = 'Chatbot hit an error. Please try again.';
    if (showFailurePopup) showReasonFailPopup(error?.message || 'AI request failed.');
    return { success: false, error: error?.message || 'AI error' };
  }
}

function showOffTaskOverlay(reason) {
  const existing = document.getElementById('focufy-offtask-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'focufy-offtask-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(15,23,42,0.9); color: #e2e8f0;
    z-index: 99999999; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px;
  `;
  overlay.innerHTML = `
    <div style="max-width: 520px; background: #0b1224; border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:24px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.45);">
      <div style="font-size:22px; font-weight:700; margin-bottom:12px;">Stay on your goal</div>
      <div style="font-size:14px; opacity:0.85; margin-bottom:20px;">${reason || 'This looks off-task. Refocus to continue.'}</div>
      <div style="display:flex; gap:12px; justify-content:center;">
        <button id="focufy-offtask-close" style="padding:10px 16px; border-radius:10px; border:1px solid rgba(255,255,255,0.2); background:#111827; color:#e2e8f0; cursor:pointer;">Stay focused</button>
        <button id="focufy-offtask-dismiss" style="padding:10px 16px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background:#1f2937; color:#9ca3af; cursor:pointer;">Dismiss</button>
      </div>
    </div>
  `;
  document.body ? document.body.appendChild(overlay) : document.documentElement.appendChild(overlay);
  overlay.querySelector('#focufy-offtask-close')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#focufy-offtask-dismiss')?.addEventListener('click', () => overlay.remove());
}

function openReasonChat(reasonText) {
  // ensure chatbot UI exists
  maybeInitChatbotUI();
  if (!chatPanelEl || !chatToggleEl) {
    showReasonFailPopup('AI coach UI is unavailable. Re-open the popup or check permissions.');
    return;
  }
  // open chat and send a prompt to reason about relevance
  chatPanelEl.classList.add('open');
  const prompt = `I think this page might be blocked. ${reasonText} Please decide if it actually supports my focus: "${currentSession?.taskDescription || 'my goal'}". If it does, explain why. If not, tell me briefly.`;
  submitChat(prompt, { showFailurePopup: true, reasonUnlock: true });
}

// Quiz modal for unlocking
async function showQuizModal() {
  let modal = document.getElementById('focufy-quiz-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'focufy-quiz-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 100000000;
      display: flex; align-items: center; justify-content: center; padding: 16px;
    `;
    modal.innerHTML = `
      <div style="background:#0f172a; color:#e2e8f0; width: min(520px, 100%); border-radius: 16px; padding: 20px; box-shadow: 0 30px 80px rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.12);">
        <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 12px;">
          <div>
            <div style="font-size:16px; font-weight:700;">Quick quiz to unlock</div>
            <div style="font-size:12px; opacity:0.75;">Answer correctly to end the block.</div>
          </div>
          <button id="focufy-quiz-close" style="background:transparent; border:1px solid rgba(255,255,255,0.2); color:#e2e8f0; border-radius:10px; width:32px; height:32px; cursor:pointer;">×</button>
        </div>
        <div id="focufy-quiz-question" style="margin-bottom:12px; font-size:14px; line-height:1.4;">Loading quiz...</div>
        <input id="focufy-quiz-answer" type="text" placeholder="Your answer" style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:#e2e8f0; margin-bottom:12px;" />
        <div id="focufy-quiz-feedback" style="min-height:18px; font-size:12px; color:#f6ad55;"></div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button id="focufy-quiz-reason" class="focufy-btn secondary" style="flex:1; background: rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#e2e8f0; padding:10px 12px; border-radius:12px; cursor:pointer;">Reason with Coach</button>
          <button id="focufy-quiz-submit" class="focufy-btn primary" style="flex:1; background: linear-gradient(135deg,#48bb78,#38a169); color:white; border:none; padding:10px 12px; border-radius:12px; cursor:pointer; font-weight:700;">Submit</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';
  document.getElementById('focufy-quiz-feedback').textContent = '';
  document.getElementById('focufy-quiz-answer').value = '';
  document.getElementById('focufy-quiz-close').onclick = () => { modal.style.display = 'none'; };
  document.getElementById('focufy-quiz-reason').onclick = () => {
    toggleChatPanel();
    submitChat('Explain why this page was blocked and if it can be allowed.');
  };
  document.getElementById('focufy-quiz-submit').onclick = submitQuizAnswer;

  await loadQuizQuestion();
}

async function loadQuizQuestion() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'generateQuiz' });
    if (response?.success && response.quiz) {
      quizData = response.quiz;
      document.getElementById('focufy-quiz-question').textContent = response.quiz.question || 'Answer to unlock.';
    } else {
      quizData = { question: 'What is your study goal?', answer: (currentSession?.taskDescription || '').toLowerCase(), explanation: '' };
      document.getElementById('focufy-quiz-question').textContent = quizData.question;
    }
  } catch (error) {
    console.error('[Focufy] Quiz error:', error);
  }
}

async function submitQuizAnswer() {
  const input = document.getElementById('focufy-quiz-answer');
  const feedback = document.getElementById('focufy-quiz-feedback');
  if (!input || !quizData) return;
  const userAns = input.value.trim().toLowerCase();
  const expected = (quizData.answer || '').toLowerCase();

  if (!userAns) {
    feedback.textContent = 'Please enter an answer.';
    return;
  }

  if (expected && userAns.includes(expected.substring(0, Math.min(expected.length, 4)))) {
    feedback.style.color = '#48bb78';
    feedback.textContent = quizData.explanation || 'Great! Unlocking now.';
    setTimeout(async () => {
      const modal = document.getElementById('focufy-quiz-modal');
      if (modal) modal.style.display = 'none';
      await chrome.runtime.sendMessage({ action: 'endSession' });
      clearAllBlocks();
      const overlay = document.getElementById('focus-ai-overlay');
      if (overlay) overlay.remove();
    }, 400);
  } else {
    feedback.style.color = '#f56565';
    feedback.textContent = 'Incorrect. Try again or ask the Coach.';
  }
}

function showPauseTaxOverlay(goal, delayMs = 5000, elapsedMinutes = 0) {
  if (!document.body) return;
  let overlay = document.getElementById('focufy-pause-tax');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'focufy-pause-tax';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999999; background: rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center; padding:16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#0f172a; color:#e2e8f0; width:min(520px,100%); border-radius:16px; padding:20px; box-shadow:0 30px 80px rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.12);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <div style="font-size:16px; font-weight:700;">Hold up—stay focused?</div>
            <div style="font-size:12px; opacity:0.75;">Current goal: <span id="pauseGoal"></span></div>
          </div>
          <div id="pauseCountdown" style="font-weight:700; color:#f6ad55;">--</div>
        </div>
        <div style="font-size:13px; opacity:0.8; margin-bottom:12px;">Elapsed: <span id="pauseElapsed"></span> min</div>
        <div style="display:flex; gap:8px;">
          <button id="pauseStay" class="focufy-btn primary" style="flex:1; background:linear-gradient(135deg,#667eea,#5a67d8); color:white; border:none; padding:10px 12px; border-radius:12px; cursor:pointer;">Stay Focused</button>
          <button id="pauseBreak" class="focufy-btn secondary" style="flex:1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#e2e8f0; padding:10px 12px; border-radius:12px; cursor:pointer;">Break Focus</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  const goalEl = document.getElementById('pauseGoal');
  const elapsedEl = document.getElementById('pauseElapsed');
  const countdownEl = document.getElementById('pauseCountdown');
  if (goalEl) goalEl.textContent = goal || 'Your goal';
  if (elapsedEl) elapsedEl.textContent = elapsedMinutes || 0;
  let remaining = Math.max(1, Math.round(delayMs / 1000));
  if (countdownEl) countdownEl.textContent = `${remaining}s`;
  const interval = setInterval(() => {
    remaining -= 1;
    if (countdownEl) countdownEl.textContent = `${remaining}s`;
    if (remaining <= 0) clearInterval(interval);
  }, 1000);
  const stayBtn = document.getElementById('pauseStay');
  const breakBtn = document.getElementById('pauseBreak');
  if (stayBtn) stayBtn.onclick = () => {
    overlay.style.display = 'none';
    chrome.runtime.sendMessage({ action: 'pauseTaxDecision', choice: 'stay' }).catch(() => {});
  };
  if (breakBtn) breakBtn.onclick = () => {
    overlay.style.display = 'none';
    chrome.runtime.sendMessage({ action: 'pauseTaxDecision', choice: 'break' }).catch(() => {});
  };
}

function showPassiveCoachOverlay(summary, quiz) {
  if (!document.body) return;
  let wrap = document.getElementById('focufy-passive-coach');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'focufy-passive-coach';
    wrap.style.cssText = `
      position: fixed; bottom: 16px; right: 16px; z-index: 9999998;
      max-width: 360px; background: #0f172a; color: #e2e8f0;
      border-radius: 14px; border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 24px 80px rgba(0,0,0,0.35);
      padding: 14px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `;
    wrap.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="font-weight:700;">Focus Coach</div>
        <button id="coachClose" style="background:transparent; color:#e2e8f0; border:1px solid rgba(255,255,255,0.2); border-radius:8px; width:28px; height:28px; cursor:pointer;">×</button>
      </div>
      <div id="coachSummary" style="font-size:13px; color:#cbd5e1; margin-bottom:10px;"></div>
      <div id="coachQuiz" style="font-size:13px; color:#e2e8f0;"></div>
      <div style="margin-top:10px; display:flex; gap:8px;">
        <button id="coachOk" class="focufy-btn primary" style="flex:1; background:linear-gradient(135deg,#667eea,#5a67d8); color:white; border:none; border-radius:10px; padding:8px 10px; cursor:pointer;">Got it</button>
      </div>
    `;
    document.body.appendChild(wrap);
  }
  const summaryEl = document.getElementById('coachSummary');
  const quizEl = document.getElementById('coachQuiz');
  if (summaryEl) summaryEl.textContent = summary || 'Stay focused.';
  if (quizEl) {
    quizEl.innerHTML = quiz && quiz.question ? `<strong>Quiz:</strong> ${quiz.question}` : '';
  }
  const closeBtn = document.getElementById('coachClose');
  const okBtn = document.getElementById('coachOk');
  if (closeBtn) closeBtn.onclick = () => wrap.remove();
  if (okBtn) okBtn.onclick = () => wrap.remove();
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
function applyBlocks(selectors, reason, explanation) {
  console.log('[Focufy] applyBlocks called with', selectors?.length || 0, 'selectors, reason:', reason);
  
  // allow applyBlocks even if not currently active to ensure selectors apply
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
        blockElement(el, explanation || reason);
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
            blockElement(el, reason);
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
function blockElement(element, explanation) {
  if (blockedElements.has(element)) return;
  blockedElements.add(element);
  
  // Hide the element cleanly (no visual indicators for cleaner look)
  const originalDisplay = element.style.display;
  element.style.display = 'none';
  element.setAttribute('data-focus-ai-blocked', 'true');
  element.setAttribute('data-focus-ai-original-display', originalDisplay || '');
  if (explanation) {
    addBlockIndicator(element, explanation);
  }
  
  console.log('[Focufy] Blocked element:', element.tagName, element.className || element.id || 'no-id');
}

function addBlockIndicator(element, explanation) {
  try {
    const badge = document.createElement('div');
    badge.className = 'focus-ai-block-indicator';
    badge.textContent = explanation || 'Blocked by Focufy';
    badge.style.position = 'relative';
    badge.style.display = 'inline-block';
    badge.style.background = 'rgba(102,126,234,0.14)';
    badge.style.color = '#fff';
    badge.style.padding = '6px 10px';
    badge.style.borderRadius = '10px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '600';
    badge.style.border = '1px solid rgba(255,255,255,0.2)';
    badge.style.marginBottom = '6px';
    badge.style.boxShadow = '0 6px 18px rgba(0,0,0,0.15)';
    
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'block';
    wrapper.style.margin = '6px 0';
    wrapper.appendChild(badge);
    
    if (element.parentNode) {
      element.parentNode.insertBefore(wrapper, element);
    }
  } catch (e) {
    console.warn('[Focufy] Failed to add block indicator:', e);
  }
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

  // Restore page visibility if full-page block hid everything
  if (document.body) {
    Array.from(document.body.children).forEach(child => {
      if (child.id !== 'focus-ai-overlay') {
        child.style.display = '';
        child.style.visibility = '';
      }
    });
  }
  if (document.documentElement) {
    Array.from(document.documentElement.children).forEach(child => {
      if (child.tagName !== 'BODY' && child.id !== 'focus-ai-overlay') {
        child.style.display = '';
        child.style.visibility = '';
      }
    });
  }
  if (window.focusAIObserver) {
    try { window.focusAIObserver.disconnect(); } catch (_) {}
  }
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
    const allowIds = new Set([
      'focus-ai-overlay',
      'focufy-chat-container',
      'focufy-reason-fail',
      'focufy-reason-success',
      'focufy-quiz-modal'
    ]);
    const shouldKeep = (el) => allowIds.has(el.id);
    if (document.body) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'relative';
      // Hide all direct children of body except the overlay
      Array.from(document.body.children).forEach(child => {
        if (!shouldKeep(child)) {
          child.style.display = 'none';
          child.style.visibility = 'hidden';
        }
      });
      // Also hide html element content
      if (document.documentElement) {
        Array.from(document.documentElement.children).forEach(child => {
          if (child.tagName !== 'BODY' && !shouldKeep(child)) {
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
  
  const targetNode = document.body || document.documentElement;
  if (targetNode) {
    window.focusAIObserver.observe(targetNode, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      const lateTarget = document.body || document.documentElement;
      if (lateTarget && window.focusAIObserver) {
        window.focusAIObserver.observe(lateTarget, { childList: true, subtree: true });
      }
    }, { once: true });
  }
  
  // Fallback: if overlay fails to appear, show the lightweight block page
  setTimeout(() => {
    if (!document.getElementById('focus-ai-overlay')) {
      console.warn('[Focufy] Overlay missing; using fallback block page');
      blockPageImmediately();
    }
  }, 1000);
  
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
    <div style="max-width: 680px; width: 100%; background: rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; box-shadow: 0 30px 80px rgba(0,0,0,0.35); backdrop-filter: blur(6px);">
      <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px;">
        <div style="font-size: 48px;">🚫</div>
        <div>
          <h1 style="font-size: 26px; margin:0 0 6px 0; color: white;">Blocked to keep you on task</h1>
          <p style="margin:0; color: rgba(255,255,255,0.8); font-size: 14px;">This page looks off-topic for your current focus.</p>
        </div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px; margin-bottom:16px;">
        <div style="background: rgba(255,255,255,0.08); padding: 16px; border-radius: 12px; border:1px solid rgba(255,255,255,0.12);">
          <div style="font-size: 12px; opacity:0.75; margin-bottom:6px;">Your Focus Task</div>
          <div style="font-size: 18px; font-style: italic; color: white;">"${task}"</div>
        </div>
        <div style="background: rgba(255,255,255,0.08); padding: 16px; border-radius: 12px; border:1px solid rgba(255,255,255,0.12);">
          <div style="font-size: 12px; opacity:0.75; margin-bottom:6px;">Time Remaining</div>
          <div style="font-size: 28px; font-weight: 700; color: white;">${time} min</div>
        </div>
      </div>
      <div style="display:flex; flex-wrap: wrap; gap:10px; margin-top:12px;">
        <button id="focufyBackBtn" style="
          padding: 12px 16px;
          background: rgba(255,255,255,0.14);
          color: white;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          flex:1 1 120px;
        ">Go Back</button>
        <button id="focufyReasonBtn" style="
          padding: 12px 16px;
          background: linear-gradient(135deg, #667eea, #5a67d8);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          flex:1 1 160px;
        ">Reason with AI</button>
      </div>
    </div>
  `;
  
  // Wire quiz + reasoning
  setTimeout(() => {
    const backBtn = document.getElementById('focufyBackBtn');
    const reasonBtn = document.getElementById('focufyReasonBtn');
    if (backBtn) backBtn.addEventListener('click', () => {
      const currentUrl = window.location.href;
      const ref = document.referrer;
      let attempted = false;
      // Try normal history back first
      if (window.history && window.history.length > 1) {
        window.history.back();
        attempted = true;
      }
      // Fallback after a short delay if we are still on the same URL
      setTimeout(() => {
        if (window.location.href === currentUrl) {
          const target = ref && ref !== currentUrl ? ref : 'about:blank';
          window.location.assign(target);
        }
      }, attempted ? 700 : 0);
    });
    if (reasonBtn) reasonBtn.addEventListener('click', () => {
      toggleChatPanel();
      openReasonChat('Explain why this page was blocked and whether it can still support my study goal.');
    });
  }, 50);
  
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
  const targetNode = document.body || document.documentElement;
  if (!targetNode) {
    console.warn('[Focufy] No DOM available for observer');
    return;
  }
  
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
  
  window.focusAIObserver.observe(targetNode, {
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

})(); 
