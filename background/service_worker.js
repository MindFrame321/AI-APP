/**
 * Focufy - Background Service Worker
 * 
 * Element-level blocking with Gemini API
 * Blocks specific parts of pages instead of entire pages
 */

let currentSession = null;
let pageAnalysisCache = new Map(); // Cache per domain+task
const CACHE_TTL = 60 * 60 * 1000; // 60 minutes (longer cache to reduce API calls)

// DeclarativeNetRequest rule IDs - use range 1000-1999 for always-block rules
const DNR_RULE_ID_START = 1000;
const DNR_RULE_ID_END = 1999;

// Learning system - tracks user's focus topics
let learningData = {
  mainTopic: null,        // Main study goal (e.g., "linear algebra")
  currentSubtopics: [],   // Current subtopics user is exploring (e.g., ["vectors", "matrices"])
  browsingHistory: [],    // Recent pages visited
  topicFrequency: {}      // How often each topic appears
};

// Rate limiting
let apiCallQueue = [];
let isProcessingQueue = false;
let lastApiCallTime = 0;
const MIN_API_CALL_INTERVAL = 2000; // Minimum 2 seconds between API calls
const MAX_QUEUE_SIZE = 10;

// Current supported model
const CURRENT_MODEL_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
const DEFAULT_API_KEY = 'AIzaSyDtmZYEgp9XwqIO4VgCE8J2QH7IIE_gJt4';

// Initialize immediately when service worker loads
(async () => {
  console.log('Service worker initializing...');
  await migrateSettings();
  await loadSessionState();
  
  // Set up webNavigation listeners immediately
  setupWebNavigationListeners();
  
  // Apply blocking rules from storage on startup (works independently of session)
  const settings = await getSettings();
  if (settings.alwaysBlock && settings.alwaysBlock.length > 0) {
    const normalizedBlocked = settings.alwaysBlock
      .map(d => normalizeToHostname(d))
      .filter(h => h);
    if (normalizedBlocked.length > 0) {
      console.log('[Init] Applying blocking rules on startup:', normalizedBlocked);
      await applyBlockedSites(normalizedBlocked);
    }
  }
  
  console.log('Service worker ready, currentSession:', currentSession ? 'active' : 'none');
})();

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Focufy installed/updated');
  await migrateSettings(); // Fix old cached settings
  await loadSessionState();
});

// Also run on startup (in case service worker was restarted)
chrome.runtime.onStartup.addListener(async () => {
  console.log('Focufy started');
  await migrateSettings();
  await loadSessionState();
});

// Migrate settings to fix deprecated model URLs
async function migrateSettings() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    if (result.settings) {
      let needsUpdate = false;
      const settings = result.settings;
      
      // Fix deprecated model URLs
      if (settings.apiUrl && (
        settings.apiUrl.includes('gemini-pro') || 
        settings.apiUrl.includes('gemini-1.5') || 
        settings.apiUrl.includes('gemini-2') ||
        settings.apiUrl.includes('gemini-3')
      )) {
        console.log('Migrating deprecated model URL:', settings.apiUrl);
        settings.apiUrl = CURRENT_MODEL_URL;
        needsUpdate = true;
      }
      
      // Update API key if using old key or if missing
      const OLD_API_KEY = 'AIzaSyASqArHzBl0atkALCuaincq6ymM6m8V2yk';
      if (!settings.apiKey || settings.apiKey === OLD_API_KEY) {
        settings.apiKey = DEFAULT_API_KEY;
        needsUpdate = true;
        console.log('Updating API key to new key');
      }

      // Add defaults for new navigation/learning toggles
      if (typeof settings.autoNavigateEnabled === 'undefined') {
        settings.autoNavigateEnabled = true;
        needsUpdate = true;
        console.log('Enabling auto-navigation by default');
      }
      if (typeof settings.learningModeEnabled === 'undefined') {
        settings.learningModeEnabled = true;
        needsUpdate = true;
        console.log('Enabling learning mode by default');
      }
      if (typeof settings.focusCoachEnabled === 'undefined') {
        settings.focusCoachEnabled = true;
        needsUpdate = true;
        console.log('Enabling focus coach by default');
      }
      
      if (needsUpdate) {
        await chrome.storage.local.set({ settings });
        console.log('Settings migrated successfully');
      }
    }
  } catch (error) {
    console.error('Migration error:', error);
  }
}

// Load session state
async function loadSessionState() {
  const result = await chrome.storage.local.get(['session', 'learningData']);
  console.log('[loadSessionState] Loading from storage:', result);
  
  if (result.session) {
    currentSession = result.session;
    console.log('[loadSessionState] Session loaded:', currentSession);
    console.log('[loadSessionState] Session active:', currentSession.active);
    console.log('[loadSessionState] Current time:', Date.now());
    console.log('[loadSessionState] Session end time:', currentSession.endTime);
    console.log('[loadSessionState] Time remaining:', currentSession.endTime - Date.now(), 'ms');
    
    if (Date.now() < currentSession.endTime) {
      console.log('[loadSessionState] ✅ Session is still active, starting monitoring');
      currentSession.active = true; // Ensure active flag is set
      startSessionMonitoring();
      
      // Apply blocking rules for always-block list
      const settings = await getSettings();
      if (settings.alwaysBlock && settings.alwaysBlock.length > 0) {
        const normalizedBlocked = settings.alwaysBlock
          .map(d => normalizeToHostname(d))
          .filter(h => h);
        await applyBlockedSites(normalizedBlocked);
      }
    } else {
      console.log('[loadSessionState] ⚠️ Session expired, ending session');
      await endSession();
    }
  } else {
    console.log('[loadSessionState] No session found in storage');
    currentSession = null;
    // Clear blocking rules if no session
    await clearBlockedSites();
  }
  
  // Load learning data if exists
  if (result.learningData) {
    learningData = result.learningData;
  }
}

// Start focus session
async function startSession(taskDescription, durationMinutes) {
  // Initialize learning data for new session
  learningData = {
    mainTopic: taskDescription.toLowerCase(),
    currentSubtopics: [],
    browsingHistory: [],
    topicFrequency: {}
  };
  await chrome.storage.local.set({ learningData });
  
  // Check trial/subscription status
  const subscription = await getSubscriptionStatus();
  if (!subscription.isActive && !subscription.isTrial) {
    throw new Error('Trial expired. Please upgrade to continue.');
  }
  
  // Check daily session limit for free users
  if (subscription.plan === 'free') {
    const todaySessions = await getTodaySessionCount();
    if (todaySessions >= 3) {
      throw new Error('Free tier limit reached (3 sessions/day). Upgrade to Premium for unlimited sessions.');
    }
  }
  
  const startTime = Date.now();
  const endTime = startTime + (durationMinutes * 60 * 1000);
  
  currentSession = {
    taskDescription,
    startTime,
    endTime,
    durationMinutes,
    active: true
  };
  
  console.log('[startSession] Creating session:', currentSession);
  await chrome.storage.local.set({ session: currentSession });
  console.log('[startSession] ✅ Session saved to storage');
  
  // Verify it was saved
  const verify = await chrome.storage.local.get(['session']);
  console.log('[startSession] Verification - session in storage:', verify.session);
  
  chrome.alarms.create('sessionEnd', { when: endTime });
  startSessionMonitoring();
  
  // Apply blocking rules for always-block list (works independently of session)
  const settings = await getSettings();
  console.log('[startSession] Settings alwaysBlock list:', settings.alwaysBlock);
  if (settings.alwaysBlock && settings.alwaysBlock.length > 0) {
    const normalizedBlocked = settings.alwaysBlock
      .map(d => normalizeToHostname(d))
      .filter(h => h);
    console.log('[startSession] Normalized blocked domains:', normalizedBlocked);
    if (normalizedBlocked.length > 0) {
      console.log('[startSession] Applying blocking rules for:', normalizedBlocked);
      await applyBlockedSites(normalizedBlocked);
      
      // Verify rules were created
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      const blockingRules = rules.filter(r => r.id >= DNR_RULE_ID_START && r.id <= DNR_RULE_ID_END);
      console.log('[startSession] ✅ Verified', blockingRules.length, 'blocking rules are active');
    } else {
      console.log('[startSession] ⚠️ No valid domains to block after normalization');
    }
  } else {
    console.log('[startSession] No domains in always-block list');
  }
  
  // Track analytics
  await trackSessionStart(taskDescription, durationMinutes);
  
  // Notify all tabs to start blocking
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'startBlocking',
        session: currentSession
      }).catch(() => {}); // Ignore errors for tabs that can't receive messages
    }
  });
  
  console.log('Focus session started:', currentSession);
}

// End session
async function endSession() {
  console.log('=== END SESSION CALLED ===');
  console.log('Current session before end:', currentSession);
  
  try {
  if (currentSession) {
    // Track session completion
    await trackSessionEnd(currentSession);
    }
  } catch (error) {
    console.error('Error tracking session end:', error);
    // Continue with cleanup even if tracking fails
  }
  
  // Clear session state
  const wasActive = currentSession !== null;
  currentSession = null;
  
  try {
  await chrome.storage.local.remove(['session']);
    console.log('Session removed from storage');
  } catch (error) {
    console.error('Error removing session from storage:', error);
  }
  
  try {
  chrome.alarms.clear('sessionEnd');
    console.log('Session alarm cleared');
  } catch (error) {
    console.error('Error clearing alarm:', error);
  }
  
  // Clear blocking rules when session ends
  try {
    await clearBlockedSites();
    console.log('Blocking rules cleared');
  } catch (error) {
    console.error('Error clearing blocking rules:', error);
  }
  
  pageAnalysisCache.clear();
  console.log('Page cache cleared');
  
  // Notify all tabs to stop blocking
  try {
  const tabs = await chrome.tabs.query({});
    console.log('Notifying', tabs.length, 'tabs to stop blocking');
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'stopBlocking' });
          console.log('Sent stopBlocking to tab', tab.id);
        } catch (err) {
          // Tab might not have content script, that's okay
          console.log('Could not send stopBlocking to tab', tab.id, err.message);
        }
      }
    }
  } catch (error) {
    console.error('Error notifying tabs:', error);
  }
  
  console.log('=== END SESSION COMPLETE ===');
  return { success: true, wasActive };
}

// Handle session end alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sessionEnd') {
    endSession();
  }
});

// Domain normalization helper - normalize to hostname only
function normalizeToHostname(input) {
  if (!input) return null;
  let s = (input || "").trim();
  
  // If user typed "example.com" without scheme, add one so URL() can parse it
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  
  let u;
  try {
    u = new URL(s);
  } catch {
    return null; // invalid
  }
  
  // Remove leading www. so "www.example.com" and "example.com" are treated the same
  return u.hostname.replace(/^www\./i, "").toLowerCase();
}

// Legacy function for backward compatibility
function normalizeDomain(d) {
  const normalized = normalizeToHostname(d);
  return normalized || '';
}

// Build a DNR rule that blocks the domain and its subdomains
function makeDomainBlockRule(id, hostname) {
  // This matches both the domain and any subdomain using regexFilter
  // Example: example.com -> matches *.example.com/*
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: `^[^:]+://([^/]*\\.)?${hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`,
      resourceTypes: ["main_frame", "sub_frame"]
    }
  };
}

// Apply blocked sites using declarativeNetRequest
// Works independently of session state - based on storage settings
async function applyBlockedSites(blockedHostnames) {
  if (!chrome.declarativeNetRequest) {
    console.warn('[DNR] declarativeNetRequest API not available');
    return;
  }
  
  if (!blockedHostnames || blockedHostnames.length === 0) {
    console.log('[DNR] No blocked sites, clearing rules');
    await clearBlockedSites();
    return;
  }
  
  console.log('[DNR] Applying blocked sites:', blockedHostnames);
  
  // Give each hostname a stable numeric ID
  const rules = blockedHostnames
    .filter(h => h) // Filter out null/empty
    .map((h, idx) => makeDomainBlockRule(DNR_RULE_ID_START + idx, h));
  
  console.log('[DNR] Created', rules.length, 'blocking rules');
  
  // Remove old rules in the range
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules
    .filter(rule => rule.id >= DNR_RULE_ID_START && rule.id <= DNR_RULE_ID_END)
    .map(rule => rule.id);
  
  console.log('[DNR] Removing', removeRuleIds.length, 'old rules');
  
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: rules
    });
    console.log('[DNR] ✅ Successfully updated blocking rules');
  } catch (error) {
    console.error('[DNR] ❌ Error updating rules:', error);
    throw error;
  }
}

// Clear all blocking rules
async function clearBlockedSites() {
  if (!chrome.declarativeNetRequest) {
    console.warn('[DNR] declarativeNetRequest API not available');
    return;
  }
  
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules
    .filter(rule => rule.id >= DNR_RULE_ID_START && rule.id <= DNR_RULE_ID_END)
    .map(rule => rule.id);
  
  if (removeRuleIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: []
    });
    console.log('[DNR] ✅ Cleared all blocking rules');
  }
}

// Check if domain should be blocked
async function shouldBlockDomain(url) {
  console.log('[shouldBlockDomain] Checking:', url);
  
  // Reload session from storage in case service worker restarted
  if (!currentSession || !currentSession.active) {
    console.log('[shouldBlockDomain] Session not in memory, reloading from storage...');
    await loadSessionState();
    console.log('[shouldBlockDomain] Reloaded session:', currentSession);
  }
  
  console.log('[shouldBlockDomain] currentSession:', currentSession);
  console.log('[shouldBlockDomain] currentSession?.active:', currentSession?.active);
  
  if (!currentSession?.active) {
    console.log('[shouldBlockDomain] ⚠️ No active session - blocking only works during active focus sessions');
    console.log('[shouldBlockDomain] 💡 Start a focus session from the extension popup to enable blocking');
    return false;
  }
  
  try {
    const urlObj = new URL(url);
    const domain = normalizeDomain(urlObj.hostname);
    console.log('[shouldBlockDomain] Normalized domain:', domain);
    
    const settings = await getSettings();
    console.log('[shouldBlockDomain] Settings loaded, alwaysBlock (raw):', settings.alwaysBlock);
    
    const normalizedAlwaysBlock = (settings.alwaysBlock || []).map(normalizeDomain).filter(d => d);
    console.log('[shouldBlockDomain] Normalized always-block list:', normalizedAlwaysBlock);
    console.log('[shouldBlockDomain] Is domain in list?', normalizedAlwaysBlock.includes(domain));
    
    const result = normalizedAlwaysBlock.includes(domain);
    console.log('[shouldBlockDomain] Result:', result);
    return result;
  } catch (e) {
    console.error('[shouldBlockDomain] Error:', e);
    return false;
  }
}

// Set up webNavigation listeners ONCE (not every time session starts)
let webNavListenersSetup = false;

function setupWebNavigationListeners() {
  if (webNavListenersSetup) {
    console.log('[WebNav] Listeners already set up, skipping');
    return;
  }
  
  console.log('[WebNav] ⚙️ Setting up webNavigation listeners...');
  
  // Use onBeforeNavigate to catch navigation EARLIEST (before page starts loading)
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    console.log('[WebNav] onBeforeNavigate:', details.url, 'frameId:', details.frameId);
    // Only process main frame navigation (not iframes)
    if (details.frameId !== 0) return;
    
    // Skip chrome:// and extension:// URLs
    if (details.url.startsWith('chrome://') || 
        details.url.startsWith('chrome-extension://') ||
        details.url.startsWith('moz-extension://')) {
      return;
    }
    
    // Skip extension pages
    if (details.url.includes('settings.html') ||
        details.url.includes('blocked.html') ||
        details.url.includes('analytics.html') ||
        details.url.includes('help.html')) {
      return;
    }
    
    // Check always-block list from storage (works independently of session)
    const settings = await getSettings();
    if (settings.alwaysBlock && settings.alwaysBlock.length > 0) {
      const host = normalizeToHostname(details.url);
      if (host) {
        const normalizedBlocked = settings.alwaysBlock
          .map(d => normalizeToHostname(d))
          .filter(h => h);
        
        // Check if host matches any blocked domain (including subdomains)
        const isBlocked = normalizedBlocked.some(b => 
          host === b || host.endsWith("." + b)
        );
        
        if (isBlocked) {
          console.log('[WebNav] 🚫 Domain is blocked (always-block):', host);
          // DNR should handle this at network level, but redirect as backup
          try {
            await chrome.tabs.update(details.tabId, {
              url: chrome.runtime.getURL(`blocked.html?reason=always-blocked&url=${encodeURIComponent(details.url)}`)
            });
            console.log('[WebNav] ✅ Redirect successful (backup)');
          } catch (err) {
            console.error('[WebNav] ❌ Redirect failed:', err);
          }
          return;
        }
      }
    }
    
    // For session-based element-level blocking, check session state
    if (!currentSession?.active) {
      console.log('[WebNav] No active session, skipping element-level analysis');
      return;
    }
    
    // Session-based blocking continues for element-level analysis
    const shouldBlock = await shouldBlockDomain(details.url);
    console.log('[WebNav] shouldBlockDomain check:', details.url, '->', shouldBlock);
    
    if (shouldBlock) {
      const urlObj = new URL(details.url);
      const domain = normalizeDomain(urlObj.hostname);
      console.log('[WebNav] 🚫 BLOCKING domain (session-based):', domain, 'URL:', details.url);
      
      // Redirect IMMEDIATELY - this happens before page loads
      try {
        await chrome.tabs.update(details.tabId, {
          url: chrome.runtime.getURL(`blocked.html?reason=always-blocked&url=${encodeURIComponent(details.url)}`)
        });
        console.log('[WebNav] ✅ Redirect successful');
      } catch (err) {
        console.error('[WebNav] ❌ Redirect failed:', err);
      }
      return;
    }
  });
  
  // Also use onCommitted as backup and for always-allow check
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    // Only process main frame navigation (not iframes)
    if (details.frameId !== 0) return;
    
    // Skip chrome:// and extension:// URLs
    if (details.url.startsWith('chrome://') || 
        details.url.startsWith('chrome-extension://') ||
        details.url.startsWith('moz-extension://')) {
      return;
    }
    
    // Skip extension pages
    if (details.url.includes('settings.html') ||
        details.url.includes('blocked.html') ||
        details.url.includes('analytics.html') ||
        details.url.includes('help.html')) {
      return;
    }
    
    if (!currentSession?.active) {
      return;
    }
    
    // Double-check always-block (backup)
    if (await shouldBlockDomain(details.url)) {
      const urlObj = new URL(details.url);
      const domain = normalizeDomain(urlObj.hostname);
      console.log('[WebNav] 🚫 Blocking domain (onCommitted backup):', domain);
      chrome.tabs.update(details.tabId, {
        url: chrome.runtime.getURL(`blocked.html?reason=always-blocked&url=${encodeURIComponent(details.url)}`)
      });
      return;
    }
    
    // Check always-allow
    const settings = await getSettings();
    const urlObj = new URL(details.url);
    const domain = normalizeDomain(urlObj.hostname);
    const normalizedAlwaysAllow = (settings.alwaysAllow || []).map(normalizeDomain).filter(d => d);
    
    if (normalizedAlwaysAllow.includes(domain)) {
      console.log('[WebNav] ✅ Domain is always-allowed:', domain);
      return; // Don't analyze, just allow
    }
    
    // For other domains, analyze after page loads
    setTimeout(async () => {
      try {
        const tab = await chrome.tabs.get(details.tabId);
        if (tab.url === details.url && currentSession?.active) {
          await analyzeAndBlockPage(details.tabId, details.url);
        }
      } catch (err) {
        console.error('[WebNav] Error analyzing page:', err);
      }
    }, 500);
  });
  
  // Also keep tabs.onUpdated as backup for pages that load before webNavigation fires
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && currentSession?.active) {
      // Skip chrome:// and extension:// URLs
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        return;
      }
      
      // Skip if already handled by webNavigation
      if (tab.url.includes('blocked.html')) {
        return;
      }
      
      // Analyze and block elements on this page (for non-blocked domains)
      await analyzeAndBlockPage(tabId, tab.url);
    }
  });
  
  enforceAntiTampering();
  
  webNavListenersSetup = true;
  console.log('[WebNav] ✅ Listeners set up successfully');
}

// Start monitoring (just ensures listeners are set up)
function startSessionMonitoring() {
  setupWebNavigationListeners();
}

// Analyze page and block irrelevant elements - SIMPLIFIED VERSION
async function analyzeAndBlockPage(tabId, url) {
  if (!currentSession || !currentSession.active) {
    console.log('No active session, skipping analysis');
    return;
  }
  
  // Skip extension pages, chrome:// pages, and settings
  if (!url || 
      url.startsWith('chrome://') || 
      url.startsWith('chrome-extension://') ||
      url.startsWith('moz-extension://') ||
      url.includes('settings.html') ||
      url.includes('blocked.html') ||
      url.includes('analytics.html') ||
      url.includes('help.html')) {
    console.log('Skipping analysis for extension/system page:', url);
    return;
  }
  
  try {
    const urlObj = new URL(url);
    let domain = urlObj.hostname.toLowerCase().replace(/^www\./, ''); // Normalize: lowercase, remove www
    console.log('[Analyze] Analyzing page:', domain, 'Task:', currentSession.taskDescription);
    
    // Note: Always-block/allow is now handled in webNavigation.onCommitted
    // This function only runs for domains that passed the webNavigation check
    const settings = await getSettings();
    console.log('[Analyze] Settings loaded, API Key present:', !!settings.apiKey);
    
    // Double-check always-allow (safety net in case webNavigation missed it)
    const normalizeDomain = (d) => {
      if (!d) return '';
      let normalized = d.toLowerCase().trim();
      normalized = normalized.replace(/^https?:\/\//, '');
      normalized = normalized.split('/')[0].split('?')[0].split('#')[0];
      normalized = normalized.replace(/^www\./, '');
      normalized = normalized.replace(/\.$/, '');
      return normalized;
    };
    
    const normalizedDomain = normalizeDomain(domain);
    const normalizedAlwaysAllow = (settings.alwaysAllow || []).map(normalizeDomain).filter(d => d);
    
    if (normalizedAlwaysAllow.includes(normalizedDomain)) {
      // Always allowed - don't block anything
      console.log('[Analyze] ✅ Domain is in always-allow list, clearing all blocks');
      chrome.tabs.sendMessage(tabId, { action: 'clearBlocks' }).catch((err) => {
        console.error('[Analyze] Error sending clearBlocks message:', err);
      });
      return;
    }
    
    // Check cache - more aggressive caching
    const cacheKey = `${domain}:${currentSession.taskDescription}`;
    const domainOnlyCacheKey = `domain:${domain}`; // Declare once for reuse
    
    const cached = pageAnalysisCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      // Use cached analysis
      console.log('Using cached analysis (avoiding API call)');
      let cachedAction;
      if (cached.shouldBlock && cached.selectors.includes('body')) {
        cachedAction = 'blockPage';
      } else if (cached.selectors && cached.selectors.length > 0) {
        cachedAction = 'applyBlocks';
      } else {
        cachedAction = 'clearBlocks';
      }
      
      chrome.tabs.sendMessage(tabId, {
        action: cachedAction,
        selectors: cached.selectors || [],
        reason: cached.reason,
        shouldBlock: cached.shouldBlock,
        score: cached.score
      }).catch(() => {});
      return;
    }
    
    // Also check if we've analyzed this domain recently (even with different tasks)
    // This helps reduce API calls when user visits same site multiple times
    const domainCached = pageAnalysisCache.get(domainOnlyCacheKey);
    if (domainCached && (Date.now() - domainCached.timestamp) < (CACHE_TTL / 2)) {
      console.log('Using domain-level cached analysis');
      let cachedAction;
      if (domainCached.shouldBlock && domainCached.selectors && domainCached.selectors.includes('body')) {
        cachedAction = 'blockPage';
      } else if (domainCached.selectors && domainCached.selectors.length > 0) {
        cachedAction = 'applyBlocks';
      } else {
        cachedAction = 'clearBlocks';
      }
      
      chrome.tabs.sendMessage(tabId, {
        action: cachedAction,
        selectors: domainCached.selectors || [],
        reason: domainCached.reason,
        shouldBlock: domainCached.shouldBlock,
        score: domainCached.score
      }).catch(() => {});
      return;
    }
    
    // Check if this is a search page - allow search functionality
    const isSearchPage = isSearchPageUrl(url, domain);
    
    // Check if this is a search engine homepage - auto-navigate
    const isSearchEngine = domain.includes('youtube.com') || 
                          domain.includes('reddit.com') ||
                          domain.includes('wikipedia.org') ||
                          domain.includes('google.com');
    
    // Check if this is YouTube or streaming site - use element-level blocking
    const isYouTube = domain.includes('youtube.com');
    const isStreaming = domain.includes('netflix.com') || domain.includes('hulu.com') || 
                       domain.includes('disneyplus.com') || domain.includes('primevideo.com') ||
                       domain.includes('hbo.com') || domain.includes('paramount.com');
    
    let analysis;
    
    // Auto-navigate to search engines if on homepage (before other checks)
    if (isSearchEngine && !isSearchPage) {
      const navigated = await autoNavigateToSearch(tabId, url, domain);
      if (navigated) {
        // Wait a bit for the new page to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Get the new URL and re-analyze
        const tab = await chrome.tabs.get(tabId);
        if (tab.url) {
          return await analyzeAndBlockPage(tabId, tab.url);
        }
      }
    }
    
    if (isSearchPage) {
      // SEARCH PAGE - Allow search, analyze results element-by-element
      console.log('[Analyze] Search page detected - allowing and analyzing search results');
    const pageStructure = await extractPageStructure(tabId);
    
      if (pageStructure && pageStructure.elements && pageStructure.elements.length > 0) {
        // Analyze search results individually
        analysis = await analyzeElementsWithGemini(pageStructure, currentSession.taskDescription);
        console.log('[Analyze] Search results analyzed:', {
          selectorsToBlock: analysis.selectorsToBlock?.length || 0,
          hasRelatedContent: analysis.hasRelatedContent
        });
        analysis.shouldBlock = false; // Never block search pages themselves
      } else {
        // No search results yet or couldn't extract - allow the page
        analysis = {
          shouldBlock: false,
          score: 70,
          reason: 'search-page',
          selectorsToBlock: []
        };
      }
    } else if (isYouTube || isStreaming) {
      // ELEMENT-LEVEL BLOCKING for YouTube/Streaming
      console.log('[Analyze] YouTube/Streaming detected - using element-level analysis');
      
      // Check if we're on a watch page (watching a specific video)
      const isWatchPage = url.includes('/watch') || url.includes('/embed/');
      const isSearchPage = url.includes('/results?search_query=');
      
      // Wait a bit for YouTube's dynamic content to load (especially for SPA navigation)
      console.log('[Analyze] Waiting for YouTube content to load...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let pageStructure = await extractPageStructure(tabId);
      
      if (!pageStructure || !pageStructure.elements || pageStructure.elements.length === 0) {
        console.log('[Analyze] ⚠️ Could not extract page structure - retrying in 2 seconds...');
        // Retry once after a delay (YouTube loads content dynamically)
        await new Promise(resolve => setTimeout(resolve, 2000));
        const retryStructure = await extractPageStructure(tabId);
        
        if (!retryStructure || !retryStructure.elements || retryStructure.elements.length === 0) {
          console.log('[Analyze] ⚠️ Retry also failed - allowing page');
          // If we can't extract structure, don't block - allow the page
          analysis = {
            shouldBlock: false,
            score: isWatchPage ? 70 : 50, // Higher score for watch pages
            reason: 'extraction-failed',
            selectorsToBlock: []
          };
        } else {
          console.log('[Analyze] ✅ Retry successful! Extracted', retryStructure.elements.length, 'elements');
          pageStructure = retryStructure;
        }
      }
      
      if (pageStructure && pageStructure.elements && pageStructure.elements.length > 0) {
        console.log('[Analyze] Extracted', pageStructure.elements.length, 'elements to analyze');
        
        // Analyze individual elements
        analysis = await analyzeElementsWithGemini(pageStructure, currentSession.taskDescription);
        
        console.log('[Analyze] Element analysis complete!');
        console.log('[Analyze] Result:', {
          selectorsToBlock: analysis.selectorsToBlock?.length || 0,
          hasRelatedContent: analysis.hasRelatedContent,
          reason: analysis.reason
        });
        
        // NEVER block the entire YouTube page - only block specific unrelated elements
        // Even if no related content found, allow the page (user might be watching something)
        analysis.shouldBlock = false; // Never block entire page
        
        // Filter out selectors that might block the main player
        if (analysis.selectorsToBlock) {
          analysis.selectorsToBlock = analysis.selectorsToBlock.filter(sel => {
            // Don't block main player, primary content, or body
            return !sel.includes('body') && 
                   !sel.includes('html') && 
                   !sel.includes('#player') && 
                   !sel.includes('#primary') &&
                   !sel.includes('ytd-watch-flexy'); // Main watch page container
          });
        }
        
        // If we filtered out all selectors, make sure we have an empty array
        if (!analysis.selectorsToBlock) {
          analysis.selectorsToBlock = [];
        }
      }
      
    } else {
      // FULL-PAGE ANALYSIS for other sites
      console.log('[Analyze] Regular site - using full-page analysis');
      
      const pageContent = await extractPageContent(tabId);
      
      if (!pageContent || !pageContent.text) {
        console.log('[Analyze] Could not extract page content');
        // Still set analysis to allow page if extraction fails
        analysis = {
          shouldBlock: false,
          score: 50,
          reason: 'extraction-failed',
          selectorsToBlock: [],
          hasRelatedContent: true
        };
      } else {
        console.log('[Analyze] Page content extracted, length:', pageContent.text.length);
        
        // Update learning data if learning mode is enabled
        const settings = await getSettings();
        if (settings && settings.learningModeEnabled) {
          await updateLearningData(pageContent, currentSession.taskDescription);
        }
        try {
          await recordBrowsingHistory(pageContent);
        } catch (e) {
          console.warn('[Analyze] Failed to record browsing history:', e);
        }
        
        // Analyze with Gemini - full page approach
        const pageAnalysis = await analyzePageContent(pageContent, currentSession.taskDescription);
        
        analysis = {
          shouldBlock: pageAnalysis.shouldBlock || false,
          score: pageAnalysis.score || 50,
          reason: pageAnalysis.reason || 'analyzed',
          selectorsToBlock: pageAnalysis.shouldBlock ? ['body'] : [],
          hasRelatedContent: !pageAnalysis.shouldBlock
        };
        
        console.log('[Analyze] Full-page analysis result:', {
          shouldBlock: analysis.shouldBlock,
          score: analysis.score,
          reason: analysis.reason
        });
      }
    }
    
    // Cache the result
    const cacheData = {
      selectors: analysis.selectorsToBlock || [],
      reason: analysis.reason || 'irrelevant',
      shouldBlock: analysis.shouldBlock || false,
      score: analysis.score || 50,
      hasRelatedContent: analysis.hasRelatedContent || false,
      timestamp: Date.now()
    };
    
    pageAnalysisCache.set(cacheKey, cacheData);
    pageAnalysisCache.set(domainOnlyCacheKey, cacheData);
    
    // Limit cache size
    if (pageAnalysisCache.size > 100) {
      const firstKey = pageAnalysisCache.keys().next().value;
      pageAnalysisCache.delete(firstKey);
    }
    
    // Ensure analysis exists
    if (!analysis) {
      console.error('[Block] No analysis result!');
      return;
    }
    
    // Apply blocks
    let action;
    if (analysis.shouldBlock && analysis.selectorsToBlock && analysis.selectorsToBlock.includes('body')) {
      action = 'blockPage'; // Block entire page
    } else if (analysis.selectorsToBlock && analysis.selectorsToBlock.length > 0) {
      action = 'applyBlocks'; // Block specific elements
    } else {
      action = 'clearBlocks'; // No blocking needed
    }
    
    console.log('[Block] Sending', action, 'to tab', tabId);
    console.log('[Block] Analysis:', {
      shouldBlock: analysis.shouldBlock,
      selectorsCount: analysis.selectorsToBlock?.length || 0,
      reason: analysis.reason
    });
    
    try {
      const message = {
        action: action,
        reason: analysis.reason || 'irrelevant',
        score: analysis.score || 50,
        selectors: analysis.selectorsToBlock || [],
        explanation: analysis.reason ? `Blocked because: ${analysis.reason}` : undefined
      };
      
      await chrome.tabs.sendMessage(tabId, message);
      console.log('[Block] ✅ Successfully sent', action, 'message');
    } catch (err) {
      console.error('[Block] ❌ Failed to send message:', err);
      
      // Try to inject content script if it's not loaded
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content_script.js']
        });
        
        setTimeout(async () => {
          try {
            await chrome.tabs.sendMessage(tabId, {
              action: action,
              reason: analysis.reason || 'irrelevant',
              selectors: analysis.selectorsToBlock || []
            });
          } catch (retryErr) {
            console.error('[Block] ❌ Retry failed:', retryErr);
          }
        }, 1000);
      } catch (injectErr) {
        console.error('[Block] ❌ Failed to inject content script:', injectErr);
      }
    }
    
  } catch (error) {
    console.error('Error analyzing page:', error);
  }
}

// Extract full page content (simpler approach)
async function extractPageContent(tabId) {
  try {
    console.log('[Extract] Starting page content extraction for tab', tabId);
    
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title || '';
        const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        const url = window.location.href;
        const hostname = window.location.hostname;
        
        const text = `${title}\n\n${bodyText}`.trim();
        
        console.log('[Extract] Extracted:', {
          title: title.substring(0, 50),
          textLength: text.length,
          url: url.substring(0, 50),
          hostname
        });
        
        return {
          title,
          text,
          url,
          hostname
        };
      }
    });
    
    const content = results[0]?.result;
    console.log('[Extract] Extraction result:', {
      hasContent: !!content,
      textLength: content?.text?.length || 0,
      title: content?.title?.substring(0, 50) || 'none'
    });
    
    return content;
  } catch (error) {
    console.error('[Extract] Error extracting page content:', error);
    return null;
  }
}

// Rate-limited API call with retry logic
async function makeRateLimitedApiCall(apiCallFn, retries = 3) {
  // Wait if we're calling too frequently
  const timeSinceLastCall = Date.now() - lastApiCallTime;
  if (timeSinceLastCall < MIN_API_CALL_INTERVAL) {
    const waitTime = MIN_API_CALL_INTERVAL - timeSinceLastCall;
    console.log(`Rate limiting: waiting ${waitTime}ms before next API call`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastApiCallTime = Date.now();
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await apiCallFn();
      
      if (response.status === 429) {
        // Rate limited - exponential backoff
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 2000;
        
        console.warn(`Rate limited (429). Waiting ${waitTime}ms before retry ${attempt + 1}/${retries}`);
        
        // Show notification to user (only on first retry to avoid spam)
        if (attempt === 0) {
          try {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon48.png'),
              title: 'Focufy - Rate Limited',
              message: `Too many requests. Waiting ${Math.round(waitTime/1000)}s before retry...`
            }).catch(() => {}); // Ignore notification errors
          } catch (e) {
            // Ignore
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue; // Retry
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }
      
      return response;
      
    } catch (error) {
      if (attempt === retries - 1) {
        throw error; // Last attempt failed
      }
      
      if (error.message.includes('429')) {
        // Already handled above, but just in case
        const waitTime = Math.pow(2, attempt) * 2000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Other errors - retry with backoff
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`API error, retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error('All retry attempts failed');
}

// Analyze individual elements (for YouTube/streaming) - ELEMENT-LEVEL BLOCKING
async function analyzeElementsWithGemini(pageStructure, taskDescription) {
  const settings = await getSettings();
  const apiKey = settings?.apiKey || DEFAULT_API_KEY;
  const backendUrl = settings?.backendUrl;
  
  const tokenResult = await chrome.storage.local.get(['authToken']);
  const authToken = tokenResult.authToken;
  
  if (!backendUrl && !apiKey) {
    console.warn('[Elements] No API key configured');
    return { selectorsToBlock: [], hasRelatedContent: false, reason: 'no-api-key' };
  }
  
  try {
    const isYouTube = pageStructure.isYouTube || false;
    const isStreaming = pageStructure.isStreaming || false;
    
    // Build description of elements
    let elementsDescription;
    if (isYouTube) {
      elementsDescription = pageStructure.elements.map((el, idx) => {
        if (el.isVideo) {
          return `${idx + 1}. ${el.selector} - VIDEO: "${el.videoTitle}" by ${el.videoChannel || 'unknown'}`;
        }
        return `${idx + 1}. ${el.selector}: "${el.heading || el.text.substring(0, 50)}"`;
      }).join('\n');
    } else {
      elementsDescription = pageStructure.elements.map((el, idx) => {
        return `${idx + 1}. ${el.selector}: "${el.heading || el.text.substring(0, 50)}"`;
      }).join('\n');
    }
    
    // Create prompt for element-level analysis
    let prompt;
    if (isYouTube) {
      prompt = `You are a focus assistant for YouTube. Analyze videos to show ONLY content related to the user's study goal.

User's Study Goal: "${taskDescription}"

Page: ${pageStructure.title}
URL: ${pageStructure.url}

Videos and Content:
${elementsDescription}

Instructions:
1. For each video, determine if it's RELATED to "${taskDescription}"
2. Return a JSON object with:
   - "block": array of selectors for UNRELATED videos/elements to block
   - "keep": array of selectors for RELATED videos/elements to keep
   - "hasRelatedContent": true if ANY video is related, false if NONE are related

Example response:
{
  "block": ["ytd-rich-item-renderer:nth-of-type(3)", "#secondary ytd-video-renderer:nth-of-type(5)"],
  "keep": ["ytd-rich-item-renderer:nth-of-type(1)"],
  "hasRelatedContent": true
}

Respond with ONLY valid JSON, no other text.`;
    } else {
      prompt = `You are a focus assistant for streaming sites. Analyze content to show ONLY items related to the user's study goal.

User's Study Goal: "${taskDescription}"

Page: ${pageStructure.title}
URL: ${pageStructure.url}

Content Items:
${elementsDescription}

Instructions:
1. For each item, determine if it's RELATED to "${taskDescription}"
2. Return a JSON object with:
   - "block": array of selectors for UNRELATED items to block
   - "keep": array of selectors for RELATED items to keep
   - "hasRelatedContent": true if ANY item is related, false if NONE are related

Respond with ONLY valid JSON, no other text.`;
    }
    
    let response;
    
    if (backendUrl && authToken) {
      response = await makeRateLimitedApiCall(() => 
        fetch(backendUrl + '/api/analyze-page', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ prompt })
        })
      );
    } else {
      let apiUrl = settings?.apiUrl || CURRENT_MODEL_URL;
      
      if (apiUrl.includes('gemini-pro') || apiUrl.includes('gemini-1.5') || apiUrl.includes('gemini-2') || apiUrl.includes('gemini-3')) {
        apiUrl = CURRENT_MODEL_URL;
      }
      
      console.log('[Elements] Calling Gemini API for element analysis');
      response = await makeRateLimitedApiCall(() =>
        fetch(`${apiUrl}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
          })
        })
      );
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';
    
    console.log('[Elements] Gemini response:', responseText.substring(0, 300));
    console.log('[Elements] ✅ Using Gemini AI for element analysis');
    
    // Parse JSON response
    let result;
    try {
      const jsonMatch = responseText.match(/\{.*\}/s);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = JSON.parse(responseText);
      }
    } catch (e) {
      console.error('[Elements] Failed to parse response, using keyword fallback');
      // Fallback: use keyword matching on elements
      return analyzeElementsWithKeywords(pageStructure, taskDescription);
    }
    
    return {
      selectorsToBlock: result.block || [],
      selectorsToKeep: result.keep || [],
      hasRelatedContent: result.hasRelatedContent !== false, // Default to true if not specified
      reason: 'ai-analyzed',
      score: result.hasRelatedContent ? 80 : 20
    };
    
  } catch (error) {
    console.error('[Elements] Gemini API error:', error);
    // Fallback to keyword matching
    return analyzeElementsWithKeywords(pageStructure, taskDescription);
  }
}

// Keyword-based fallback for element analysis
function analyzeElementsWithKeywords(pageStructure, taskDescription) {
  console.log('[Elements] Using keyword-based fallback');
  
  const taskWords = taskDescription.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter(w => !['the', 'and', 'or', 'for', 'with', 'from', 'learn', 'study', 'practice'].includes(w));
  
  const selectorsToBlock = [];
  let hasRelatedContent = false;
  
  pageStructure.elements.forEach((el, idx) => {
    const text = (el.videoTitle || el.heading || el.text || '').toLowerCase();
    const matches = taskWords.filter(word => text.includes(word)).length;
    const relevance = taskWords.length > 0 ? matches / taskWords.length : 0;
    
    if (relevance < 0.2) {
      // Not relevant - block it
      selectorsToBlock.push(el.selector);
    } else {
      // Relevant - keep it
      hasRelatedContent = true;
    }
  });
  
  return {
    selectorsToBlock,
    hasRelatedContent,
    reason: 'keyword-fallback',
    score: hasRelatedContent ? 60 : 10
  };
}

// Analyze page content with Gemini (simpler scoring approach)
async function analyzePageContent(pageContent, taskDescription) {
  const settings = await getSettings();
  const apiKey = settings?.apiKey || DEFAULT_API_KEY;
  const backendUrl = settings?.backendUrl;
  
  // Get auth token for backend auth if available
  const tokenResult = await chrome.storage.local.get(['authToken']);
  const authToken = tokenResult.authToken;
  
  if (!backendUrl && !apiKey) {
    console.warn('No API key or Backend URL configured');
    return { shouldBlock: false, reason: 'no-api-key', score: 50 };
  }
  
  try {
    // Create a simpler prompt
    const prompt = `You are a focus assistant. Analyze if a webpage is relevant to the user's study goal.

User's Study Goal: "${taskDescription}"

Page Information:
- URL: ${pageContent.url}
- Title: ${pageContent.title}
- Content Preview: ${pageContent.text.substring(0, 1000)}...

Instructions:
1. Determine if this page is RELEVANT to "${taskDescription}"
2. If RELEVANT: respond with {"action": "allow", "score": 80-100, "reason": "relevant"}
3. If NOT RELEVANT: respond with {"action": "block", "score": 0-30, "reason": "distraction"}
4. If SOMEWHAT RELEVANT: respond with {"action": "allow", "score": 40-70, "reason": "partially relevant"}

Respond with ONLY valid JSON, no other text.`;

    let response;
    
    if (backendUrl && authToken) {
      // Use Backend Proxy with rate limiting
      response = await makeRateLimitedApiCall(() => 
        fetch(backendUrl + '/api/analyze-page', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ prompt })
        })
      );
    } else {
      // Direct API Call with rate limiting
      let apiUrl = settings?.apiUrl || CURRENT_MODEL_URL;
      
      if (apiUrl.includes('gemini-pro') || apiUrl.includes('gemini-1.5') || apiUrl.includes('gemini-2') || apiUrl.includes('gemini-3')) {
        apiUrl = CURRENT_MODEL_URL;
      }
      
      console.log('[API] Calling Gemini API (rate-limited):', apiUrl);
      console.log('[API] API Key present:', !!apiKey, 'Length:', apiKey?.length);
      console.log('[API] Prompt length:', prompt.length);
      
      response = await makeRateLimitedApiCall(() =>
        fetch(`${apiUrl}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
          })
        })
      );
      
      console.log('[API] Response status:', response.status, response.statusText);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Response not OK:', response.status, errorText);
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log('[API] Response data received:', Object.keys(data));
    console.log('[API] ✅ Using Gemini AI (not keyword fallback)');
    
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';
    
    console.log('[API] Gemini response:', responseText.substring(0, 200));
    
    // Parse JSON response
    let result;
    try {
      const jsonMatch = responseText.match(/\{.*\}/s);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = JSON.parse(responseText);
      }
    } catch (e) {
      console.error('Failed to parse response, using fallback');
      // Fallback: check if page text contains task keywords
      const taskWords = taskDescription.toLowerCase().split(/\s+/);
      const pageText = pageContent.text.toLowerCase();
      const matches = taskWords.filter(word => pageText.includes(word)).length;
      const relevance = matches / taskWords.length;
      
      result = {
        action: relevance > 0.3 ? 'allow' : 'block',
        score: Math.round(relevance * 100),
        reason: relevance > 0.3 ? 'keyword match' : 'no relevance'
      };
    }
    
    return {
      shouldBlock: result.action === 'block',
      score: result.score || 50,
      reason: result.reason || 'analyzed',
      selectors: []
    };
    
  } catch (error) {
    console.error('[Analyze] Gemini API error:', error);
    console.error('[Analyze] Error message:', error.message);
    
    // Use keyword-based fallback for ALL errors (not just 429)
    console.log('[Analyze] ⚠️ Using KEYWORD FALLBACK (Gemini API unavailable)');
    console.log('[Analyze] This means blocking decisions are based on keyword matching, not AI analysis');
    
    // Keyword-based relevance check
    const taskWords = taskDescription.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2) // Include shorter words too
      .filter(w => !['the', 'and', 'or', 'for', 'with', 'from', 'learn', 'study', 'practice'].includes(w)); // Remove common words
    
    const pageText = pageContent.text.toLowerCase();
    const titleText = pageContent.title.toLowerCase();
    const urlText = pageContent.url.toLowerCase();
    const hostname = pageContent.hostname.toLowerCase();
    
    console.log('[Analyze] Task words:', taskWords);
    console.log('[Analyze] Page text length:', pageText.length);
    console.log('[Analyze] Title:', titleText);
    console.log('[Analyze] Hostname:', hostname);
    
    // Check for common distracting sites (always block these unless task matches)
    const distractingSites = ['youtube.com', 'facebook.com', 'instagram.com', 'twitter.com', 
                              'tiktok.com', 'reddit.com', 'netflix.com', 'hulu.com', 
                              'disneyplus.com', 'primevideo.com', 'spotify.com'];
    const isDistractingSite = distractingSites.some(site => hostname.includes(site));
    
    // Educational/research sites - allow by default unless clearly not relevant
    const educationalSites = ['wikipedia.org', 'edu', 'scholar.google.com', 'pubmed', 
                             'jstor.org', 'arxiv.org', 'coursera.org', 'edx.org', 
                             'khanacademy.org', 'udemy.com'];
    const isEducationalSite = educationalSites.some(site => hostname.includes(site));
    
    // Check for matches in title, URL, and page text (check first 5000 chars for better matching)
    const pageTextSample = pageText.substring(0, 5000); // Check more content
    const titleMatches = taskWords.filter(word => titleText.includes(word)).length;
    const urlMatches = taskWords.filter(word => urlText.includes(word)).length;
    const textMatches = taskWords.filter(word => pageTextSample.includes(word)).length;
    
    // Also check for related terms (e.g., "biology" -> "biological", "biologist", etc.)
    const relatedMatches = taskWords.filter(word => {
      const wordStem = word.substring(0, Math.min(5, word.length));
      return pageTextSample.includes(wordStem) || titleText.includes(wordStem);
    }).length;
    
    // Weight: title matches are most important, then URL, then text, then related
    const totalMatches = (titleMatches * 4) + (urlMatches * 3) + (textMatches * 2) + relatedMatches;
    const maxPossibleMatches = taskWords.length * 10; // 4 for title, 3 for URL, 2 for text, 1 for related
    const relevance = taskWords.length > 0 ? totalMatches / maxPossibleMatches : 0;
    
    // Smarter blocking logic:
    // - Educational sites: allow by default (they're research/learning tools)
    // - Distracting sites: block unless high relevance (>50%)
    // - Other sites: block if less than 30% relevance
    let shouldBlock;
    if (isEducationalSite) {
      // Educational sites are generally allowed - they're learning tools
      shouldBlock = false;
      console.log('[Analyze] Educational site detected - allowing by default');
    } else if (isDistractingSite) {
      shouldBlock = relevance < 0.5; // Need 50%+ relevance to allow distracting sites
      console.log('[Analyze] Distracting site detected, relevance threshold: 50%');
    } else {
      shouldBlock = relevance < 0.3; // 30% threshold for other sites
    }
    
    console.log('[Analyze] Keyword analysis:', {
      titleMatches,
      urlMatches,
      textMatches,
      relatedMatches,
      totalMatches,
      relevance: Math.round(relevance * 100) + '%',
      shouldBlock,
      isEducationalSite,
      isDistractingSite
    });
    
    // Show notification if API failed (only once per session to avoid spam)
    try {
      if (error.message.includes('429') || error.message.includes('TooManyRequests')) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon48.png'),
          title: 'Focufy - Rate Limited',
          message: 'Using keyword matching due to rate limits.'
        }).catch(() => {}); // Ignore notification errors
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon48.png'),
          title: 'Focufy - API Error',
          message: 'Using keyword matching. Check API key in settings.'
        }).catch(() => {}); // Ignore notification errors
      }
    } catch (notifError) {
      // Silently ignore notification errors
      console.log('Notification error (ignored):', notifError);
    }
    
    return {
      shouldBlock,
      score: Math.round(relevance * 100),
      reason: shouldBlock ? 'keyword-fallback-not-relevant' : 'keyword-fallback-relevant',
      selectors: []
    };
  }
}

// Check if URL is a search page
function isSearchPageUrl(url, domain) {
  if (!url) return false;
  
  const urlLower = url.toLowerCase();
  const domainLower = domain.toLowerCase();
  
  // Google search
  if (domainLower.includes('google.com') && (urlLower.includes('/search') || urlLower.includes('?q=') || urlLower.includes('&q='))) {
    return true;
  }
  
  // Wikipedia search
  if (domainLower.includes('wikipedia.org') && (urlLower.includes('/wiki/') || urlLower.includes('search='))) {
    return true;
  }
  
  // Bing search
  if (domainLower.includes('bing.com') && urlLower.includes('/search')) {
    return true;
  }
  
  // DuckDuckGo search
  if (domainLower.includes('duckduckgo.com') && urlLower.includes('?q=')) {
    return true;
  }
  
  // YouTube search
  if (domainLower.includes('youtube.com') && urlLower.includes('/results?search_query=')) {
    return true;
  }
  
  // Reddit search
  if (domainLower.includes('reddit.com') && urlLower.includes('/search')) {
    return true;
  }
  
  // Generic search patterns
  if (urlLower.includes('search?') || urlLower.includes('?search=') || urlLower.includes('&search=')) {
    return true;
  }
  
  return false;
}

// Extract page structure (identify main content areas, ads, sidebars, etc.)
async function extractPageStructure(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const hostname = window.location.hostname;
        const url = window.location.href.toLowerCase();
        const isYouTube = hostname.includes('youtube.com');
        const isStreaming = hostname.includes('netflix.com') || hostname.includes('hulu.com') || 
                           hostname.includes('disneyplus.com') || hostname.includes('primevideo.com');
        const isGoogle = hostname.includes('google.com');
        const isWikipedia = hostname.includes('wikipedia.org');
        
        // Extract page structure with semantic information
        const elements = [];
        const seen = new Set();
        
        // Common patterns for ads and distractions
        const adPatterns = [
          'ad', 'advertisement', 'sponsor', 'promo', 'banner',
          'sidebar', 'widget', 'recommendation', 'trending',
          'popular', 'related', 'suggested', 'you-may-like'
        ];
        
        // Get main content containers
        const mainContent = document.querySelector('main, article, [role="main"], .content, .main-content, #content, #main');
        const body = document.body;
        
        // Special handling for YouTube
        if (isYouTube) {
          console.log('[Extract] YouTube detected, extracting video elements...');
          
          // Improved YouTube selectors - try multiple patterns
          const videoSelectors = [
            'ytd-rich-item-renderer',
            'ytd-video-renderer', 
            'ytd-compact-video-renderer',
            'ytd-grid-video-renderer',
            'ytd-playlist-video-renderer',
            'ytd-video-meta-block',
            '#dismissible', // Common YouTube container
            '[class*="ytd-rich-item-renderer"]',
            '[class*="ytd-video-renderer"]'
          ];
          
          let videoItems = [];
          for (const selector of videoSelectors) {
            try {
              const found = document.querySelectorAll(selector);
              if (found.length > 0) {
                videoItems = Array.from(found);
                console.log('[Extract] Found', videoItems.length, 'videos using selector:', selector);
                break;
              }
            } catch (e) {
              // Invalid selector, continue
            }
          }
          
          // If still no videos, try finding by structure
          if (videoItems.length === 0) {
            console.log('[Extract] Primary selectors failed, trying fallback method...');
            const allLinks = document.querySelectorAll('a[href*="/watch"]');
            console.log('[Extract] Found', allLinks.length, 'video links');
            allLinks.forEach(link => {
              // Skip if it's the main video player
              const isMainPlayer = link.closest('#player, #primary, ytd-watch-flexy, #watch7-content');
              if (isMainPlayer) return;
              
              const container = link.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, #dismissible, [class*="ytd-rich-item"]');
              if (container && !seen.has(container)) {
                videoItems.push(container);
              } else if (!container) {
                // If no container found, use the link's parent
                const parent = link.parentElement;
                if (parent && !seen.has(parent) && parent.textContent.trim().length > 10) {
                  videoItems.push(parent);
                }
              }
            });
            console.log('[Extract] Fallback found', videoItems.length, 'video items');
          }
          
          // Filter out main player content - only get sidebar/recommended videos
          // But be less strict - if we're on homepage, include all videos
          const isHomePage = !window.location.href.includes('/watch');
          const primaryContainer = document.querySelector('#primary, #player, ytd-watch-flexy');
          
          if (!isHomePage) {
            // On watch page - only get sidebar/recommended videos
            videoItems = videoItems.filter(item => {
              // Exclude if it's in the main player/primary area
              if (primaryContainer && primaryContainer.contains(item)) {
                return false;
              }
              // Only include sidebar/recommended videos
              const isInSecondary = item.closest('#secondary, #related, #watch-sidebar, ytd-watch-next-secondary-results-renderer');
              const isInRecommendations = item.closest('[class*="recommendation"], [class*="related"], ytd-item-section-renderer');
              return isInSecondary || isInRecommendations || !primaryContainer;
            });
          }
          // On homepage - include all videos (they're all recommendations)
          
          videoItems.forEach((item, idx) => {
            if (seen.has(item)) return;
            seen.add(item);
            
            // Try multiple selectors for title
            const titleSelectors = [
              '#video-title',
              'a#video-title',
              'h3 a',
              'a[href*="/watch"]',
              '[id*="title"]',
              '.ytd-video-meta-block h3 a'
            ];
            
            let title = '';
            for (const sel of titleSelectors) {
              const el = item.querySelector(sel);
              if (el && el.textContent) {
                title = el.textContent.trim();
                break;
              }
            }
            
            // Try multiple selectors for channel
            const channelSelectors = [
              '#channel-name',
              '#metadata-line a',
              'ytd-channel-name a',
              '[class*="channel"] a'
            ];
            
            let channel = '';
            for (const sel of channelSelectors) {
              const el = item.querySelector(sel);
              if (el && el.textContent) {
                channel = el.textContent.trim();
                break;
              }
            }
            
            // Get description
            const descriptionEl = item.querySelector('#description-text, #metadata-line, .ytd-video-meta-block');
            const description = descriptionEl?.textContent?.trim() || '';
            
            // Better selector generation
            let selector = '';
            if (item.id) {
              selector = `#${item.id}`;
            } else {
              // Use data attribute if available
              const dataId = item.getAttribute('data-id');
              if (dataId) {
                selector = `[data-id="${dataId}"]`;
              } else {
                // Use class names (filter out generic ones)
                const classes = Array.from(item.classList || [])
                  .filter(c => c && !c.includes('style-scope') && !c.includes('ytd-'))
                  .slice(0, 2);
              if (classes.length > 0) {
                selector = `.${classes.join('.')}`;
              } else {
                  // Fallback: use parent + nth-child
                  const parent = item.parentElement;
                  if (parent) {
                    const index = Array.from(parent.children).indexOf(item);
                    selector = `${parent.tagName.toLowerCase()}:nth-child(${index + 1})`;
            } else {
              selector = `${item.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
                  }
                }
              }
            }
            
            elements.push({
              selector: selector,
              tag: item.tagName.toLowerCase(),
              text: `${title} ${channel} ${description}`.substring(0, 200),
              heading: title,
              isMainContent: false,
              isLikelyDistraction: true,
              isVideo: true,
              videoTitle: title,
              videoChannel: channel
            });
          });
          
          // Get sidebar sections
          const sidebarSelectors = [
            '#secondary',
            '#related',
            'ytd-watch-next-secondary-results-renderer',
            '#watch-sidebar',
            '[class*="secondary"]'
          ];
          
          for (const sel of sidebarSelectors) {
            const sections = document.querySelectorAll(sel);
            sections.forEach(section => {
            if (seen.has(section)) return;
            seen.add(section);
            
            elements.push({
              selector: section.id ? `#${section.id}` : section.tagName.toLowerCase(),
              tag: section.tagName.toLowerCase(),
              text: section.textContent?.substring(0, 200) || '',
              heading: '',
              isMainContent: false,
              isLikelyDistraction: true,
              isVideo: false
            });
          });
          }
          
          console.log('[Extract] YouTube extraction complete:', {
            totalElements: elements.length,
            videos: elements.filter(e => e.isVideo).length,
            url: window.location.href
          });
          
          return {
            url: window.location.href,
            title: document.title,
            elements: elements,
            mainContentSelector: '#primary, #player',
            isYouTube: true
          };
        }
        
        // Special handling for Google Search
        if (isGoogle && url.includes('/search')) {
          const searchResults = document.querySelectorAll('div[data-ved], .g, .tF2Cxc, [class*="result"]');
          searchResults.forEach((result, idx) => {
            if (seen.has(result)) return;
            seen.add(result);
            
            const titleEl = result.querySelector('h3, a h3, [role="heading"]');
            const title = titleEl?.textContent?.trim() || '';
            const snippetEl = result.querySelector('.VwiC3b, .s, [class*="snippet"]');
            const snippet = snippetEl?.textContent?.trim() || '';
            
            let selector = '';
            if (result.id) {
              selector = `#${result.id}`;
            } else if (result.getAttribute('data-ved')) {
              selector = `[data-ved="${result.getAttribute('data-ved')}"]`;
            } else {
              const classes = Array.from(result.classList || []).filter(c => c).slice(0, 2);
              if (classes.length > 0) {
                selector = `.${classes.join('.')}`;
              } else {
                selector = `div:nth-of-type(${idx + 1})`;
              }
            }
            
            elements.push({
              selector: selector,
              tag: result.tagName.toLowerCase(),
              text: `${title} ${snippet}`.substring(0, 200),
              heading: title,
              isMainContent: true,
              isLikelyDistraction: false,
              isSearchResult: true
            });
          });
          
          return {
            url: window.location.href,
            title: document.title,
            elements: elements,
            mainContentSelector: '#main, #search',
            isSearchPage: true
          };
        }
        
        // Special handling for Wikipedia
        if (isWikipedia) {
          // Wikipedia search results or article list
          const results = document.querySelectorAll('.mw-search-result, .searchresult, .mw-search-results li');
          if (results.length > 0) {
            results.forEach((result, idx) => {
              if (seen.has(result)) return;
              seen.add(result);
              
              const titleEl = result.querySelector('a, h3, .mw-search-result-heading');
              const title = titleEl?.textContent?.trim() || '';
              const snippetEl = result.querySelector('.searchresult, .mw-search-result-data');
              const snippet = snippetEl?.textContent?.trim() || '';
              
              elements.push({
                selector: result.id ? `#${result.id}` : `.mw-search-result:nth-of-type(${idx + 1})`,
                tag: result.tagName.toLowerCase(),
                text: `${title} ${snippet}`.substring(0, 200),
                heading: title,
                isMainContent: true,
                isLikelyDistraction: false,
                isSearchResult: true
              });
            });
          } else {
            // Single article page - allow it
            elements.push({
              selector: '#content, #bodyContent',
              tag: 'div',
              text: document.querySelector('#content, #bodyContent')?.textContent?.substring(0, 200) || '',
              heading: document.querySelector('h1')?.textContent || '',
              isMainContent: true,
              isLikelyDistraction: false
            });
          }
          
          return {
            url: window.location.href,
            title: document.title,
            elements: elements,
            mainContentSelector: '#content, #bodyContent',
            isSearchPage: true
          };
        }
        
        // Special handling for streaming sites
        if (isStreaming) {
          // Similar structure extraction for streaming sites
          const recommendations = document.querySelectorAll('[class*="recommendation"], [class*="suggested"], [class*="trending"]');
          recommendations.forEach((rec, idx) => {
            if (seen.has(rec)) return;
            seen.add(rec);
            
            const title = rec.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || '';
            
            elements.push({
              selector: rec.id ? `#${rec.id}` : `${rec.tagName.toLowerCase()}:nth-of-type(${idx + 1})`,
              tag: rec.tagName.toLowerCase(),
              text: rec.textContent?.substring(0, 200) || '',
              heading: title,
              isMainContent: false,
              isLikelyDistraction: true,
              isVideo: false
            });
          });
          
          return {
            url: window.location.href,
            title: document.title,
            elements: elements,
            mainContentSelector: 'main, [role="main"]',
            isStreaming: true
          };
        }
        
        // Function to check if element likely contains ads/distractions
        function isLikelyDistraction(el) {
          const id = (el.id || '').toLowerCase();
          const className = (el.className || '').toLowerCase();
          const text = el.textContent?.substring(0, 100).toLowerCase() || '';
          
          return adPatterns.some(pattern => 
            id.includes(pattern) || 
            className.includes(pattern) ||
            text.includes(pattern)
          );
        }
        
        // Function to get element identifier
        function getElementId(el) {
          if (el.id) return `#${el.id}`;
          if (el.className) {
            const classes = el.className.split(' ').filter(c => c).slice(0, 2);
            if (classes.length > 0) return `.${classes.join('.')}`;
          }
          return el.tagName.toLowerCase();
        }
        
        // Analyze major sections
        const sections = body.querySelectorAll('section, div[class*="section"], aside, nav, header, footer, [role="complementary"], [role="navigation"]');
        
        sections.forEach((section, index) => {
          if (seen.has(section)) return;
          seen.add(section);
          
          const rect = section.getBoundingClientRect();
          if (rect.width < 50 || rect.height < 50) return; // Skip tiny elements
          
          const isMainContent = mainContent && mainContent.contains(section);
          const isDistraction = isLikelyDistraction(section);
          
          // Get text preview
          const text = section.textContent?.substring(0, 200) || '';
          const heading = section.querySelector('h1, h2, h3, h4, h5, h6')?.textContent || '';
          
          elements.push({
            selector: getElementId(section),
            tag: section.tagName.toLowerCase(),
            text: text,
            heading: heading,
            isMainContent: isMainContent,
            isLikelyDistraction: isDistraction,
            position: {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            }
          });
        });
        
        // Also get page metadata
        return {
          url: window.location.href,
          title: document.title,
          elements: elements.slice(0, 20), // Limit to 20 elements to reduce API payload
          mainContentSelector: mainContent ? getElementId(mainContent) : null
        };
      }
    });
    
    return results[0]?.result;
  } catch (error) {
    console.error('Error extracting page structure:', error);
    return null;
  }
}

// Analyze page with Gemini API
async function analyzePageWithGemini(pageStructure, taskDescription) {
  const settings = await getSettings();
  const apiKey = settings?.apiKey;
  const backendUrl = settings?.backendUrl;
  
  // Get auth token for backend auth if available
  const tokenResult = await chrome.storage.local.get(['authToken']);
  const authToken = tokenResult.authToken;
  
  // If no backend URL and no API key, we can't do anything
  if (!backendUrl && !apiKey) {
    console.warn('No API key or Backend URL configured');
    return { selectorsToBlock: [], reason: 'no-api-key' };
  }
  
  try {
    // Prepare prompt for Gemini
    const isYouTube = pageStructure.isYouTube || false;
    const isStreaming = pageStructure.isStreaming || false;
    
    let elementsDescription;
    if (isYouTube) {
      // For YouTube, include video titles and channels
      elementsDescription = pageStructure.elements.map((el, idx) => {
        if (el.isVideo) {
          return `${idx + 1}. ${el.selector} - VIDEO: "${el.videoTitle}" by ${el.videoChannel || 'unknown'} - ${el.text.substring(0, 100)}`;
        }
        return `${idx + 1}. ${el.selector} (${el.tag}): "${el.heading || el.text.substring(0, 50)}"`;
      }).join('\n');
    } else {
      elementsDescription = pageStructure.elements.map((el, idx) => {
        return `${idx + 1}. ${el.selector} (${el.tag}): "${el.heading || el.text.substring(0, 50)}" - ${el.isLikelyDistraction ? 'LIKELY DISTRACTION' : 'content'} - ${el.isMainContent ? 'MAIN CONTENT' : 'other'}`;
      }).join('\n');
    }
    
    let prompt;
    if (isYouTube) {
      prompt = `You are a focus assistant for YouTube. Analyze videos and recommendations to show ONLY content related to the user's study goal.

User's Study Goal: "${taskDescription}"

Page Information:
- URL: ${pageStructure.url}
- Title: ${pageStructure.title}

Videos and Recommendations:
${elementsDescription}

Instructions:
1. For each video, determine if it's RELATED to "${taskDescription}"
2. BLOCK videos that are UNRELATED (entertainment, different subjects, distractions)
3. KEEP videos that are RELATED (educational content matching the goal)
4. Example: If goal is "Learn biology", block math videos, gaming videos, but keep biology tutorials
5. Block sidebar sections with unrelated recommendations
6. DO NOT block the currently playing video (main content)
7. Return ONLY a JSON array of selectors for UNRELATED videos/elements to block

Respond with ONLY valid JSON array, no other text. Example: ["ytd-rich-item-renderer:nth-of-type(3)", "#secondary ytd-video-renderer:nth-of-type(5)"]`;
    } else if (isStreaming) {
      prompt = `You are a focus assistant for streaming sites. Show ONLY content related to the user's study goal.

User's Study Goal: "${taskDescription}"

Page Information:
- URL: ${pageStructure.url}
- Title: ${pageStructure.title}

Content Sections:
${elementsDescription}

Instructions:
1. Identify sections that are UNRELATED to "${taskDescription}"
2. Block entertainment, unrelated shows, trending content
3. Keep educational/documentary content if it matches the goal
4. Return ONLY a JSON array of selectors to block

Respond with ONLY valid JSON array. Example: ["[class*='trending']", "[class*='recommendation']"]`;
    } else {
      prompt = `You are a focus assistant. Analyze a webpage and identify which elements should be BLOCKED because they are distractions from the user's study goal.

User's Study Goal: "${taskDescription}"

Page Information:
- URL: ${pageStructure.url}
- Title: ${pageStructure.title}
- Main Content Area: ${pageStructure.mainContentSelector || 'unknown'}

Page Elements:
${elementsDescription}

Instructions:
1. Identify elements that are DISTRACTIONS unrelated to "${taskDescription}"
2. DO NOT block the main content area
3. Block sidebars, ads, recommendations, trending sections, unrelated articles
4. Keep content that helps with the study goal
5. Return ONLY a JSON array of selectors to block

Respond with ONLY valid JSON array, no other text. Example: ["#sidebar", ".advertisement", "#trending"]`;
    }

    let response;
    
    // DECISION: Use Backend Proxy (if configured) OR Direct API
    if (backendUrl && authToken) {
      // OPTION 1: Use Backend Proxy with Bearer Token
      // This allows limiting API use per person
      response = await fetch(backendUrl + '/api/analyze-page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` // Identifying the user
        },
        body: JSON.stringify({
          prompt: prompt
        })
      });
    } else {
      // OPTION 2: Direct API Call (current method)
      // Uses the shared or user-provided API key
      let apiUrl = settings?.apiUrl || CURRENT_MODEL_URL;
      
      // Fix for cached old model names that no longer exist
      if (apiUrl.includes('gemini-pro') || apiUrl.includes('gemini-1.5') || apiUrl.includes('gemini-2') || apiUrl.includes('gemini-3')) {
        console.log('Updating deprecated model URL to current model');
        apiUrl = CURRENT_MODEL_URL;
      }
      
      console.log('Calling Gemini API:', apiUrl);
      response = await fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500
        }
      })
    });
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || ''; // backend might return { text: ... }
    
    console.log('Gemini API response text:', responseText.substring(0, 200));
    
    // Parse JSON response
    let selectorsToBlock = [];
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\[.*\]/s);
      if (jsonMatch) {
        selectorsToBlock = JSON.parse(jsonMatch[0]);
        console.log('Parsed selectors from JSON match:', selectorsToBlock.length);
      } else {
        // Try to parse the whole response
        selectorsToBlock = JSON.parse(responseText);
        console.log('Parsed selectors from full response:', selectorsToBlock.length);
      }
    } catch (e) {
      console.error('Failed to parse Gemini response:', e);
      console.error('Response text was:', responseText);
      // Fallback: use heuristics
      selectorsToBlock = pageStructure.elements
        .filter(el => el.isLikelyDistraction && !el.isMainContent)
        .map(el => el.selector)
        .slice(0, 5);
      console.log('Using fallback selectors:', selectorsToBlock.length);
    }
    
    // Ensure selectors are valid
    selectorsToBlock = selectorsToBlock.filter(s => s && typeof s === 'string' && s.length > 0);
    console.log('Final selectors to block:', selectorsToBlock.length, selectorsToBlock);
    
    return {
      selectorsToBlock,
      reason: selectorsToBlock.length > 0 ? 'contains-distractions' : 'all-relevant'
    };
    
  } catch (error) {
    console.error('Gemini API error:', error);
    // Fallback to heuristic blocking
    const selectorsToBlock = pageStructure.elements
      .filter(el => el.isLikelyDistraction && !el.isMainContent)
      .map(el => el.selector)
      .slice(0, 5);
    
    return {
      selectorsToBlock,
      reason: 'api-error-fallback'
    };
  }
}

// Learning system: Update learning data based on page content
async function updateLearningData(pageContent, taskDescription) {
  if (!pageContent || !taskDescription) return;
  
  // Initialize learning data if session starts
  if (!learningData.mainTopic) {
    learningData.mainTopic = taskDescription.toLowerCase();
    learningData.browsingHistory = [];
    learningData.topicFrequency = {};
  }
  
  // Extract keywords from page
  const pageText = (pageContent.title + ' ' + pageContent.text).toLowerCase();
  const mainTopicWords = learningData.mainTopic.split(/\s+/).filter(w => w.length > 3);
  
  // Find potential subtopics (words that appear frequently but aren't the main topic)
  const words = pageText.match(/\b[a-z]{4,}\b/g) || [];
  const wordFreq = {};
  words.forEach(word => {
    if (!mainTopicWords.includes(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  });
  
  // Track subtopics that appear frequently
  const potentialSubtopics = Object.entries(wordFreq)
    .filter(([word, count]) => count >= 3 && word.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);
  
  // Update current subtopics
  potentialSubtopics.forEach(subtopic => {
    if (!learningData.currentSubtopics.includes(subtopic)) {
      learningData.currentSubtopics.push(subtopic);
    }
    learningData.topicFrequency[subtopic] = (learningData.topicFrequency[subtopic] || 0) + 1;
  });
  
  // Keep only recent subtopics (last 5)
  if (learningData.currentSubtopics.length > 5) {
    learningData.currentSubtopics = learningData.currentSubtopics.slice(-5);
  }
  
  // Save to storage
  await chrome.storage.local.set({ learningData });
}

// Track recent browsing history for learning mode
async function recordBrowsingHistory(pageContent) {
  if (!pageContent) return;
  const entry = {
    title: pageContent.title || '',
    url: pageContent.url || '',
    ts: Date.now()
  };
  if (!learningData.browsingHistory) {
    learningData.browsingHistory = [];
  }
  learningData.browsingHistory.push(entry);
  learningData.browsingHistory = learningData.browsingHistory.slice(-10);
  await chrome.storage.local.set({ learningData });
}

// Get smart search query based on learning data
async function getSmartSearchQuery(taskDescription) {
  const settings = await getSettings();
  if (!settings.learningModeEnabled) {
    return {
      main: taskDescription,
      hasChoice: false
    };
  }
  
  // Load learning data from storage
  const stored = await chrome.storage.local.get(['learningData']);
  if (stored.learningData) {
    learningData = stored.learningData;
  }
  
  // If user has been exploring subtopics, offer choice
  if (learningData.currentSubtopics && learningData.currentSubtopics.length > 0) {
    const mostRecentSubtopic = learningData.currentSubtopics[learningData.currentSubtopics.length - 1];
    const subtopicFreq = learningData.topicFrequency[mostRecentSubtopic] || 0;
    
    // If subtopic appears frequently, suggest it
    if (subtopicFreq >= 3) {
      return {
        main: taskDescription,
        subtopic: mostRecentSubtopic,
        hasChoice: true
      };
    }
  }
  
  return {
    main: taskDescription,
    hasChoice: false
  };
}

// Auto-navigate to search engines
async function autoNavigateToSearch(tabId, url, domain) {
  const settings = await getSettings();
  if (!settings.autoNavigateEnabled || !currentSession?.taskDescription) {
    return false;
  }
  
  const urlObj = new URL(url);
  const path = urlObj.pathname || '/';
  const isHomePage = (path === '/' || path === '') &&
                     !url.includes('/search') && 
                     !url.includes('/results') && 
                     !url.includes('/wiki/') &&
                     !url.includes('?q=') &&
                     !url.includes('search_query=');

  // Do NOT auto-navigate when already on a content page (e.g., Reddit thread, YouTube watch page, Google result)
  const isContentPage = path.includes('/watch') ||
                        path.includes('/r/') ||
                        path.includes('/comments/') ||
                        path.includes('/gallery/') ||
                        path.includes('/video') ||
                        path.includes('/channel/') ||
                        path.split('/').filter(Boolean).length > 1; // more than one segment usually means specific content
  
  if (!isHomePage || isContentPage) return false;
  
  const searchQuery = await getSmartSearchQuery(currentSession.taskDescription);
  let searchUrl = '';
  let platform = '';
  
  // Determine search URL based on domain
  if (domain.includes('youtube.com')) {
    platform = 'YouTube';
    if (searchQuery.hasChoice) {
      // Show prompt for choice
      const choice = await showSearchChoicePrompt(tabId, searchQuery);
      if (choice === 'subtopic') {
        searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery.subtopic)}`;
      } else {
        searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery.main)}`;
      }
    } else {
      searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery.main)}`;
    }
  } else if (domain.includes('reddit.com')) {
    platform = 'Reddit';
    if (searchQuery.hasChoice) {
      const choice = await showSearchChoicePrompt(tabId, searchQuery);
      if (choice === 'subtopic') {
        searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(searchQuery.subtopic)}`;
      } else {
        searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(searchQuery.main)}`;
      }
    } else {
      searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(searchQuery.main)}`;
    }
  } else if (domain.includes('wikipedia.org')) {
    platform = 'Wikipedia';
    if (searchQuery.hasChoice) {
      const choice = await showSearchChoicePrompt(tabId, searchQuery);
      if (choice === 'subtopic') {
        searchUrl = `https://en.wikipedia.org/wiki/Special:Search/${encodeURIComponent(searchQuery.subtopic)}`;
      } else {
        searchUrl = `https://en.wikipedia.org/wiki/Special:Search/${encodeURIComponent(searchQuery.main)}`;
      }
    } else {
      searchUrl = `https://en.wikipedia.org/wiki/Special:Search/${encodeURIComponent(searchQuery.main)}`;
    }
  } else if (domain.includes('google.com')) {
    platform = 'Google';
    if (searchQuery.hasChoice) {
      const choice = await showSearchChoicePrompt(tabId, searchQuery);
      if (choice === 'subtopic') {
        searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery.subtopic)}`;
      } else {
        searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery.main)}`;
      }
    } else {
      searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery.main)}`;
    }
  } else {
    return false; // Not a supported search engine
  }
  
  if (searchUrl) {
    console.log(`[${platform}] Auto-navigating to search for:`, searchQuery.hasChoice ? (searchQuery.subtopic || searchQuery.main) : searchQuery.main);
    try {
      await chrome.tabs.update(tabId, { url: searchUrl });
      console.log(`[${platform}] ✅ Navigated to search page`);
      return true;
    } catch (err) {
      console.error(`[${platform}] Failed to navigate:`, err);
    }
  }
  
  return false;
}

// Show prompt for search choice (main topic vs subtopic)
async function showSearchChoicePrompt(tabId, searchQuery) {
  return new Promise((resolve) => {
    // Send message to content script to show prompt
    chrome.tabs.sendMessage(tabId, {
      action: 'showSearchChoice',
      mainTopic: searchQuery.main,
      subtopic: searchQuery.subtopic
    }, (response) => {
      if (response && response.choice) {
        resolve(response.choice);
      } else {
        // Default to main topic if no response
        resolve('main');
      }
    });
  });
}

// Get settings
async function getSettings() {
  const defaultSettings = {
    alwaysAllow: [],
    alwaysBlock: [],
    apiKey: DEFAULT_API_KEY,
    apiUrl: CURRENT_MODEL_URL,
    schedule: null,
    backendUrl: 'https://focufy-extension-1.onrender.com', // Pre-configured backend URL
    autoNavigateEnabled: true,
    learningModeEnabled: true,
    focusCoachEnabled: true
  };

  const result = await chrome.storage.local.get(['settings']);
  const merged = { ...defaultSettings, ...(result.settings || {}) };

  // Ensure boolean flags are initialized to sensible defaults
  if (typeof merged.autoNavigateEnabled !== 'boolean') {
    merged.autoNavigateEnabled = true;
  }
  if (typeof merged.learningModeEnabled !== 'boolean') {
    merged.learningModeEnabled = true;
  }
  if (typeof merged.focusCoachEnabled !== 'boolean') {
    merged.focusCoachEnabled = true;
  }

  // Persist defaults if we had to fill them in
  const shouldPersist = !result.settings ||
    result.settings.autoNavigateEnabled !== merged.autoNavigateEnabled ||
    result.settings.learningModeEnabled !== merged.learningModeEnabled ||
    result.settings.focusCoachEnabled !== merged.focusCoachEnabled ||
    !result.settings.apiKey ||
    !result.settings.apiUrl;

  if (shouldPersist) {
    await chrome.storage.local.set({ settings: merged });
  }

  return merged;
}

// Build chatbot prompt using page context + learning data
async function buildChatbotPrompt(question, pageContent, selectionText = '', urlOverride = '') {
  const settings = await getSettings();
  const stored = await chrome.storage.local.get(['learningData']);
  const learning = settings.learningModeEnabled ? (stored.learningData || learningData) : null;
  
  const sessionGoal = currentSession?.taskDescription || 'general learning';
  const pageTitle = pageContent?.title || 'Untitled page';
  const pageUrl = urlOverride || pageContent?.url || 'unknown';
  
  // Trim context to avoid giant prompts
  const contextChunks = [];
  if (selectionText) {
    contextChunks.push(`User highlighted:\n${selectionText.substring(0, 1500)}`);
  }
  if (pageContent?.text) {
    contextChunks.push(`Page content:\n${pageContent.text.substring(0, 5000)}`);
  }
  const contextText = contextChunks.join('\n\n') || 'No readable content extracted from the page.';
  
  const learningSummary = learning ? `
- Main topic: ${learning.mainTopic || 'unknown'}
- Current subtopics: ${(learning.currentSubtopics || []).slice(-5).join(', ') || 'none tracked yet'}
- Frequent topics: ${Object.keys(learning.topicFrequency || {}).slice(0, 5).join(', ') || 'none'}
- Recent pages: ${(learning.browsingHistory || []).slice(-3).map(h => h.title || h.url || '').join(' | ') || 'none'}
` : 'Learning mode disabled or no data yet.';
  
  return `You are Focufy, a focused study chatbot that answers succinctly and can quiz the user.

Study goal: "${sessionGoal}"
Current page: ${pageTitle}
URL: ${pageUrl}

Learning mode summary:
${learningSummary}

Use the page and learning context to answer the user. If they ask for a quiz or practice, give 2-3 short, self-contained questions with brief answers or hints. Keep replies tight and actionable. If context is thin, acknowledge and give a best-effort answer. Avoid fabricating details not supported by the provided text.

Context to use:
${contextText}

User question: "${question}"

Respond as plain text (no JSON).`;
}

// Build short quiz prompt for unlocks
async function buildQuizPrompt(pageContent) {
  const sessionGoal = currentSession?.taskDescription || 'general learning';
  const contextText = pageContent?.text ? pageContent.text.substring(0, 1200) : '';
  return `Create ONE short quiz question to confirm the user understands the topic.

Study goal: "${sessionGoal}"
Page title: ${pageContent?.title || 'Unknown'}
Page excerpt: ${contextText}

Return STRICT JSON: {"question":"...","answer":"...","explanation":"..."}
- Keep question concise and answer short (few words).
- Explanation should be one sentence.
`;
}

async function generateQuizQuestion(tabId) {
  const settings = await getSettings();
  const apiKey = settings?.apiKey || DEFAULT_API_KEY;
  const backendUrl = settings?.backendUrl;
  const tokenResult = await chrome.storage.local.get(['authToken']);
  const authToken = tokenResult.authToken;

  let pageContent = null;
  if (tabId) {
    try { pageContent = await extractPageContent(tabId); } catch (e) {}
  }
  const prompt = await buildQuizPrompt(pageContent);

  if (!backendUrl && !apiKey) {
    return { question: 'What is your current study goal?', answer: (currentSession?.taskDescription || '').toLowerCase(), explanation: 'We want to confirm you remember your focus.' };
  }

  try {
    let response;
    if (backendUrl && authToken) {
      response = await makeRateLimitedApiCall(() =>
        fetch(backendUrl + '/api/analyze-page', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ prompt })
        })
      );
    } else {
      let apiUrl = settings?.apiUrl || CURRENT_MODEL_URL;
      if (apiUrl.includes('gemini-pro') || apiUrl.includes('gemini-1.5') || apiUrl.includes('gemini-2') || apiUrl.includes('gemini-3')) {
        apiUrl = CURRENT_MODEL_URL;
      }
      response = await makeRateLimitedApiCall(() =>
        fetch(`${apiUrl}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
          })
        })
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Quiz API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('[Quiz] Error generating quiz:', error);
  }

  return {
    question: 'Name one key term from your current study goal.',
    answer: (currentSession?.taskDescription || '').split(' ')[0] || 'focus',
    explanation: 'Quick recall helps verify focus.'
  };
}

// Chatbot handler
async function handleChatbotQuestion({ question, tabId, selectionText, pageUrl }) {
  const settings = await getSettings();
  const apiKey = settings?.apiKey || DEFAULT_API_KEY;
  const backendUrl = settings?.backendUrl;
  const tokenResult = await chrome.storage.local.get(['authToken']);
  const authToken = tokenResult.authToken;

  if (settings.focusCoachEnabled === false) {
    return 'Focus Coach is disabled in Settings.';
  }
  
  // Extract page context if possible
  let pageContent = null;
  if (tabId) {
    try {
      pageContent = await extractPageContent(tabId);
    } catch (e) {
      console.warn('[Chatbot] Could not extract page content:', e);
    }
  }
  
  const prompt = await buildChatbotPrompt(question, pageContent, selectionText, pageUrl);
  
  if (!backendUrl && !apiKey) {
    throw new Error('No API key configured for chatbot.');
  }
  
  try {
    let response;
    if (backendUrl && authToken) {
      response = await makeRateLimitedApiCall(() =>
        fetch(backendUrl + '/api/analyze-page', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ prompt })
        })
      );
    } else {
      let apiUrl = settings?.apiUrl || CURRENT_MODEL_URL;
      if (apiUrl.includes('gemini-pro') || apiUrl.includes('gemini-1.5') || apiUrl.includes('gemini-2') || apiUrl.includes('gemini-3')) {
        apiUrl = CURRENT_MODEL_URL;
      }
      response = await makeRateLimitedApiCall(() =>
        fetch(`${apiUrl}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.35, maxOutputTokens: 600 }
          })
        })
      );
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401 || response.status === 403) {
        return 'Authentication failed. Please sign in and ensure your API key is valid in Settings.';
      }
      throw new Error(`Chatbot API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';
    return responseText.trim() || 'I could not generate a response. Please try again.';
  } catch (error) {
    console.error('[Chatbot] Error answering question:', error);
    return 'I hit an issue reaching the model. Please try again in a moment or check your API key in Settings.';
  }
}

// Anti-tampering - Allow settings but warn user
function enforceAntiTampering() {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!currentSession || !currentSession.active) return;
    
    // Allow settings page - don't block it
    if (tab.url && tab.url.includes(chrome.runtime.getURL('settings.html'))) {
      // Settings page is allowed - just log it
      console.log('Settings page accessed during active session');
      return;
    }
    
    // Block chrome://extensions during active session (to prevent disabling extension)
    if (tab.url && tab.url.includes('chrome://extensions')) {
      chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL('blocked.html') + 
          `?task=${encodeURIComponent(currentSession.taskDescription)}` +
          `&time=${encodeURIComponent(getRemainingTime())}` +
          `&reason=extensions-page-blocked`
      });
    }
  });
}

// Get remaining time
function getRemainingTime() {
  if (!currentSession) return 0;
  const remaining = Math.max(0, currentSession.endTime - Date.now());
  return Math.ceil(remaining / 60000);
}

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startSession') {
    startSession(request.taskDescription, request.durationMinutes)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (request.action === 'endSession') {
    endSession()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (request.action === 'checkAlwaysBlock') {
    // Reload session first in case service worker restarted
    (async () => {
      if (!currentSession || !currentSession.active) {
        await loadSessionState();
      }
      shouldBlockDomain(request.url)
        .then(shouldBlock => sendResponse({ shouldBlock }))
        .catch(err => sendResponse({ shouldBlock: false }));
    })();
    return true;
  }
  
  if (request.action === 'debugSession') {
    // Debug command to check session state
    (async () => {
      await loadSessionState();
      const storage = await chrome.storage.local.get(['session']);
      sendResponse({ 
        currentSession,
        sessionFromStorage: storage.session,
        sessionActive: currentSession?.active
      });
    })();
    return true;
  }
  
  if (request.action === 'updateBlockingRules') {
    // Update DNR rules when settings change
    (async () => {
      // Reload session first
      if (!currentSession || !currentSession.active) {
        await loadSessionState();
      }
      
      const settings = await getSettings();
      if (settings.alwaysBlock && settings.alwaysBlock.length > 0 && currentSession?.active) {
        const normalizedBlocked = settings.alwaysBlock
          .map(d => normalizeToHostname(d))
          .filter(h => h);
        console.log('[updateBlockingRules] Applying rules for:', normalizedBlocked);
        await applyBlockedSites(normalizedBlocked);
        sendResponse({ success: true, rulesApplied: normalizedBlocked });
      } else {
        console.log('[updateBlockingRules] No active session or no blocked sites, clearing rules');
        await clearBlockedSites();
        sendResponse({ success: true, rulesCleared: true });
      }
    })();
    return true;
  }
  
  if (request.action === 'debugDNR') {
    // Debug command to check DNR rules
    (async () => {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      const blockingRules = rules.filter(r => r.id >= DNR_RULE_ID_START && r.id <= DNR_RULE_ID_END);
      sendResponse({ 
        allRules: rules.length,
        blockingRules: blockingRules.length,
        rules: blockingRules,
        currentSession,
        sessionActive: currentSession?.active
      });
    })();
    return true;
  }
  
  if (request.action === 'getSession') {
    sendResponse({ session: currentSession });
    return;
  }
  
  if (request.action === 'getRemainingTime') {
    sendResponse({ time: getRemainingTime() });
    return;
  }
  
  if (request.action === 'pageLoaded') {
    // New page loaded, analyze it
    if (currentSession?.active && sender.tab?.id) {
      analyzeAndBlockPage(sender.tab.id, sender.tab.url || '');
    }
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'generateQuiz') {
    (async () => {
      try {
        const quiz = await generateQuizQuestion(sender.tab?.id);
        sendResponse({ success: true, quiz });
      } catch (error) {
        console.error('[Quiz] Failed to generate quiz:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'chatbotQuestion') {
    (async () => {
      try {
        const answer = await handleChatbotQuestion({
          question: request.question || '',
          tabId: sender.tab?.id,
          selectionText: request.selectionText || '',
          pageUrl: request.pageUrl || sender.tab?.url || ''
        });
        sendResponse({ success: true, answer });
      } catch (error) {
        console.error('[Chatbot] Failed to handle question:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // async
  }
  
  if (request.action === 'testBlock') {
    // Test action to force block current tab
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: 'blockPage',
        reason: 'test',
        score: 0
      }).then(() => {
        sendResponse({ success: true, message: 'Test block sent' });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    sendResponse({ success: false, error: 'No tab ID' });
          return;
        }
        
  if (request.action === 'signInWithGitHub') {
    try {
      // Handle GitHub OAuth flow
      // NOTE: GitHub OAuth requires a backend server (Client Secret cannot be in extension)
      // This is disabled until backend is implemented
      sendResponse({ 
        success: false, 
        error: 'GitHub OAuth requires a backend server. Use Google or Email sign-in instead.' 
      });
      return false;
    } catch (error) {
      console.error('GitHub OAuth error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  // Handle GitHub OAuth callback
  async function handleGitHubOAuthCallback(code, redirectUri) {
    try {
      // Note: This requires a backend server to exchange code for token
      // For MVP, we'll use a public approach or prompt for token
      
      // For now, show message that backend is needed
      // In production, you'd call your backend API:
      // const response = await fetch('https://your-backend.com/auth/github', {
      //   method: 'POST',
      //   body: JSON.stringify({ code, redirectUri })
      // });
      
      // For testing, we can use GitHub's API directly if we had the token
      // But we need the Client Secret which should be on backend
      
      return null; // Will need backend implementation
    } catch (error) {
      console.error('GitHub callback error:', error);
      return null;
    }
  }
  
  if (request.action === 'signInWithGitHub') {
    // GitHub OAuth flow (requires OAuth app setup)
    handleGitHubSignIn()
      .then(user => sendResponse({ success: true, user }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Handle GitHub sign-in (requires OAuth app)
async function handleGitHubSignIn() {
  // For GitHub, you'll need to:
  // 1. Create a GitHub OAuth app at https://github.com/settings/developers
  // 2. Get Client ID and Client Secret
  // 3. Add redirect URI: chrome-extension://YOUR_EXTENSION_ID/oauth.html
  
  // For now, return error - user needs to set up OAuth app
  throw new Error('GitHub OAuth not configured. Please set up a GitHub OAuth app first.');
}

// Analytics tracking
async function trackSessionStart(taskDescription, durationMinutes) {
  const result = await chrome.storage.local.get(['analytics', 'sessions']);
  const analytics = result.analytics || {
    totalFocusTime: 0,
    distractionsBlocked: 0,
    focusStreak: 0,
    lastSessionDate: null,
    blockedSites: {},
    dailyFocus: {}
  };
  
  const sessions = result.sessions || [];
  const today = new Date().toDateString();
  
  // Initialize trial if first session
  if (sessions.length === 0) {
    await initializeTrial();
  }
  
  await chrome.storage.local.set({ 
    analytics,
    sessions 
  });
}

async function trackSessionEnd(session) {
  const result = await chrome.storage.local.get(['analytics', 'sessions']);
  const analytics = result.analytics || {
    totalFocusTime: 0,
    distractionsBlocked: 0,
    focusStreak: 0,
    lastSessionDate: null,
    blockedSites: {},
    dailyFocus: {}
  };
  
  const sessions = result.sessions || [];
  
  // Add completed session
  sessions.push({
    ...session,
    completed: true,
    actualDuration: Math.floor((Date.now() - session.startTime) / 60000)
  });
  
  // Update analytics
  analytics.totalFocusTime = (analytics.totalFocusTime || 0) + session.durationMinutes;
  
  // Update streak
  const today = new Date().toDateString();
  const lastDate = analytics.lastSessionDate;
  if (lastDate === today) {
    // Same day, no change
  } else if (lastDate && isConsecutiveDay(lastDate, today)) {
    analytics.focusStreak = (analytics.focusStreak || 0) + 1;
  } else {
    analytics.focusStreak = 1;
  }
  analytics.lastSessionDate = today;
  
  // Update daily focus
  const dateKey = new Date().toISOString().split('T')[0];
  analytics.dailyFocus[dateKey] = (analytics.dailyFocus[dateKey] || 0) + session.durationMinutes;
  
  await chrome.storage.local.set({ 
    analytics,
    sessions: sessions.slice(-100) // Keep last 100 sessions
  });
}

function isConsecutiveDay(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2 - d1);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays === 1;
}

// Track blocked site
async function trackBlockedSite(domain) {
  const result = await chrome.storage.local.get(['analytics', 'sessions']);
  const analytics = result.analytics || { blockedSites: {} };
  const sessions = result.sessions || [];
  
  if (!analytics.blockedSites) analytics.blockedSites = {};
  analytics.blockedSites[domain] = (analytics.blockedSites[domain] || 0) + 1;
  analytics.distractionsBlocked = (analytics.distractionsBlocked || 0) + 1;
  
  // Track today's blocks for daily challenge
  const today = new Date().toDateString();
  const todayKey = new Date().toISOString().split('T')[0];
  if (!analytics.dailyBlocks) analytics.dailyBlocks = {};
  analytics.dailyBlocks[todayKey] = (analytics.dailyBlocks[todayKey] || 0) + 1;
  analytics.todayBlocks = analytics.dailyBlocks[todayKey] || 0;
  
  await chrome.storage.local.set({ analytics });
  
  // Check achievements after blocking
  await checkAchievements(analytics, sessions);
}

// Check and award achievements
async function checkAchievements(analytics, sessions) {
  try {
    // Import gamification (simplified inline version)
    const ACHIEVEMENTS = {
      FIRST_SESSION: { id: 'first_session', name: 'Getting Started', icon: '🎯', points: 10 },
      STREAK_3: { id: 'streak_3', name: 'On Fire', icon: '🔥', points: 25 },
      STREAK_7: { id: 'streak_7', name: 'Week Warrior', icon: '⚡', points: 50 },
      STREAK_30: { id: 'streak_30', name: 'Focus Master', icon: '👑', points: 200 },
      HOUR_10: { id: 'hour_10', name: 'Dedicated', icon: '⏰', points: 50 },
      HOUR_50: { id: 'hour_50', name: 'Time Master', icon: '🏆', points: 150 },
      HOUR_100: { id: 'hour_100', name: 'Centurion', icon: '💎', points: 300 },
      BLOCK_100: { id: 'block_100', name: 'Distraction Destroyer', icon: '🛡️', points: 75 },
      BLOCK_1000: { id: 'block_1000', name: 'Focus Guardian', icon: '🦾', points: 250 }
    };
    
    const result = await chrome.storage.local.get(['achievements', 'points']);
    const earnedAchievements = result.achievements || [];
    let totalPoints = result.points || 0;
    const newAchievements = [];
    
    // Check each achievement
    for (const [key, achievement] of Object.entries(ACHIEVEMENTS)) {
      if (earnedAchievements.includes(achievement.id)) continue;
      
      let earned = false;
      
      switch (achievement.id) {
        case 'first_session':
          earned = sessions.length >= 1;
          break;
        case 'streak_3':
          earned = (analytics.focusStreak || 0) >= 3;
          break;
        case 'streak_7':
          earned = (analytics.focusStreak || 0) >= 7;
          break;
        case 'streak_30':
          earned = (analytics.focusStreak || 0) >= 30;
          break;
        case 'hour_10':
          earned = (analytics.totalFocusTime || 0) >= 600;
          break;
        case 'hour_50':
          earned = (analytics.totalFocusTime || 0) >= 3000;
          break;
        case 'hour_100':
          earned = (analytics.totalFocusTime || 0) >= 6000;
          break;
        case 'block_100':
          earned = (analytics.distractionsBlocked || 0) >= 100;
          break;
        case 'block_1000':
          earned = (analytics.distractionsBlocked || 0) >= 1000;
          break;
      }
      
      if (earned) {
        earnedAchievements.push(achievement.id);
        newAchievements.push(achievement);
        totalPoints += achievement.points;
        
        // Notify user of new achievement
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Achievement Unlocked! 🏆',
          message: `${achievement.name}: ${achievement.icon} +${achievement.points} points`
        });
      }
    }
    
    if (newAchievements.length > 0) {
      await chrome.storage.local.set({
        achievements: earnedAchievements,
        points: totalPoints
      });
    }
    
    return { newAchievements, totalPoints };
  } catch (error) {
    console.error('Error checking achievements:', error);
    return { newAchievements: [], totalPoints: 0 };
  }
}

// Subscription management
async function getSubscriptionStatus() {
  const result = await chrome.storage.local.get(['subscription', 'user']);
  
  if (!result.user) {
    return { plan: 'none', isActive: false, isTrial: false };
  }
  
  const subscription = result.subscription || {};
  
  // Check if trial is active
  if (subscription.trialEndDate) {
    const trialEnd = new Date(subscription.trialEndDate);
    if (trialEnd > new Date()) {
      return { plan: 'trial', isActive: true, isTrial: true, trialEndDate: subscription.trialEndDate };
    }
  }
  
  // Check if premium is active
  if (subscription.plan === 'premium' && subscription.endDate) {
    const endDate = new Date(subscription.endDate);
    if (endDate > new Date()) {
      return { plan: 'premium', isActive: true, isTrial: false };
    }
  }
  
  // Default to free
  return { plan: 'free', isActive: true, isTrial: false };
}

async function initializeTrial() {
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 7); // 7-day trial
  
  await chrome.storage.local.set({
    subscription: {
      plan: 'trial',
      trialStartDate: new Date().toISOString(),
      trialEndDate: trialEndDate.toISOString()
    }
  });
}

async function getTodaySessionCount() {
  const result = await chrome.storage.local.get(['sessions']);
  const sessions = result.sessions || [];
  const today = new Date().toDateString();
  
  return sessions.filter(s => {
    const sessionDate = new Date(s.startTime).toDateString();
    return sessionDate === today;
  }).length;
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.session) {
    if (changes.session.newValue) {
      currentSession = changes.session.newValue;
    } else {
      currentSession = null;
    }
  }
});
