
let currentSettings = null;

async function readSettingsRaw() {
  try {
    const syncResult = await chrome.storage.sync.get(['settings']);
    if (syncResult && syncResult.settings) {
      return syncResult.settings;
    }
  } catch (e) {
    console.warn('[Settings] sync get failed, using local:', e);
  }
  const localResult = await chrome.storage.local.get(['settings']);
  return localResult.settings;
}

async function writeSettingsRaw(settings) {
  try {
    await chrome.storage.sync.set({ settings });
  } catch (e) {
    console.warn('[Settings] sync set failed, writing local only:', e);
  }
  await chrome.storage.local.set({ settings });
}

async function persistSettings(settings) {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
    if (resp && resp.success) return true;
    throw new Error(resp?.error || 'Unknown error');
  } catch (err) {
    console.warn('[Settings] save via background failed, falling back to local-only:', err);
    await writeSettingsRaw(settings);
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await checkSessionStatus();
  await loadSettings();
  setupEventListeners();
});

async function checkSessionStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSession' });
    
    if (response.session && response.session.active) {
      // Show warning but allow settings access
      const warningEl = document.getElementById('sessionWarning');
      if (warningEl) {
        warningEl.classList.remove('hidden');

        const warningText = warningEl.querySelector('p');
        if (warningText) {
          warningText.textContent = '⚠️ You have an active focus session. Settings are available but changing them may affect your session.';
        }
      }
      // Keep settings visible - don't hide them
      const settingsContent = document.getElementById('settingsContent');
      if (settingsContent) {
        settingsContent.classList.remove('hidden');
      }
    } else {
      const warningEl = document.getElementById('sessionWarning');
      if (warningEl) {
        warningEl.classList.add('hidden');
      }
      const settingsContent = document.getElementById('settingsContent');
      if (settingsContent) {
        settingsContent.classList.remove('hidden');
      }
    }
  } catch (error) {
    console.error('Error checking session:', error);
  }
}

async function loadSettings() {
  try {
    const stored = await readSettingsRaw();
    currentSettings = stored || {
      settingsVersion: 2,
      dataVersion: 1,
      alwaysAllow: [],
      alwaysBlock: [],
      apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
      backendUrl: 'https://focufy-extension-1.onrender.com',
      aiFeaturesEnabled: false,
      autoNavigateEnabled: false,
      learningModeEnabled: false,
      focusCoachEnabled: false,
      goalDecompositionEnabled: false,
      focusQualityEnabled: false,
      contextualBlockingEnabled: false,
      sessionReflectionEnabled: false,
      passiveCoachEnabled: false,
      narrativeAnalyticsEnabled: false,
      personalContractsEnabled: false,
      pauseTaxEnabled: false,
      learningFeedEnabled: false,
      energyModeEnabled: false,
      dataRetentionEnabled: false,
      posthogEnabled: false,
      dataRetentionDays: 90
    };
    
    document.getElementById('autoNavigateEnabled').checked = currentSettings.autoNavigateEnabled !== false;
    document.getElementById('learningModeEnabled').checked = currentSettings.learningModeEnabled !== false;
    document.getElementById('focusCoachEnabled').checked = currentSettings.focusCoachEnabled !== false;
    setFlag('aiFeaturesEnabled', currentSettings.aiFeaturesEnabled);
    setFlag('goalDecompositionEnabled', currentSettings.goalDecompositionEnabled);
    setFlag('focusQualityEnabled', currentSettings.focusQualityEnabled);
    setFlag('contextualBlockingEnabled', currentSettings.contextualBlockingEnabled);
    setFlag('sessionReflectionEnabled', currentSettings.sessionReflectionEnabled);
    setFlag('passiveCoachEnabled', currentSettings.passiveCoachEnabled);
    setFlag('narrativeAnalyticsEnabled', currentSettings.narrativeAnalyticsEnabled);
    setFlag('personalContractsEnabled', currentSettings.personalContractsEnabled);
    setFlag('pauseTaxEnabled', currentSettings.pauseTaxEnabled);
    setFlag('learningFeedEnabled', currentSettings.learningFeedEnabled);
    setFlag('energyModeEnabled', currentSettings.energyModeEnabled);
    setFlag('dataRetentionEnabled', currentSettings.dataRetentionEnabled);
    setFlag('posthogEnabled', currentSettings.posthogEnabled);
    
    const retentionInput = document.getElementById('dataRetentionDays');
    if (retentionInput) retentionInput.value = currentSettings.dataRetentionDays || 90;
    
    // Always check API key status (will show appropriate message if not configured)
    await checkUserApiKeyStatus();
    
    renderDomainList('alwaysAllowList', currentSettings.alwaysAllow || []);
    renderDomainList('alwaysBlockList', currentSettings.alwaysBlock || []);
    renderRules(currentSettings.contextualRules || []);
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
}

function setFlag(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function renderDomainList(listId, domains) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  
  domains.forEach(domain => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="domain">${escapeHtml(domain)}</span>
      <button class="remove-btn" data-domain="${escapeHtml(domain)}">Remove</button>
    `;
    list.appendChild(li);
  });
  
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const domain = e.target.getAttribute('data-domain');
      removeDomain(listId === 'alwaysAllowList' ? 'alwaysAllow' : 'alwaysBlock', domain);
    });
  });
}

async function addDomain(listType, domain) {
  domain = domain.trim();
  
  if (!domain) {
    showStatus('Please enter a domain', 'error');
    return;
  }
  
  // Extract domain from URL if full URL provided
  domain = domain.replace(/^https?:\/\//, ''); // Remove protocol
  domain = domain.split('/')[0]; // Remove path
  domain = domain.split('?')[0]; // Remove query params
  domain = domain.split('#')[0]; // Remove hash
  domain = domain.toLowerCase().replace(/^www\./, ''); // Normalize: lowercase, remove www
  domain = domain.trim();
  
  if (!domain) {
    showStatus('Please enter a valid domain', 'error');
    return;
  }
  
  if (!currentSettings[listType]) {
    currentSettings[listType] = [];
  }
  
  if (currentSettings[listType].includes(domain)) {
    showStatus('Domain already in list', 'error');
    return;
  }
  
  currentSettings[listType].push(domain);
  console.log(`[addDomain] Added ${domain} to ${listType}, new list:`, currentSettings[listType]);
  
  renderDomainList(
    listType === 'alwaysAllow' ? 'alwaysAllowList' : 'alwaysBlockList',
    currentSettings[listType]
  );
  
  const inputId = listType === 'alwaysAllow' ? 'alwaysAllowInput' : 'alwaysBlockInput';
  const input = document.getElementById(inputId);
  if (input) {
    input.value = '';
  }
  
  // Auto-save settings and update blocking rules
  await saveSettings();
  
  // Show success message
  showStatus(`Added ${domain} to ${listType === 'alwaysAllow' ? 'Always Allow' : 'Always Block'}`, 'success');
}

function removeDomain(listType, domain) {
  if (!currentSettings[listType]) return;
  
  currentSettings[listType] = currentSettings[listType].filter(d => d !== domain);
  renderDomainList(
    listType === 'alwaysAllow' ? 'alwaysAllowList' : 'alwaysBlockList',
    currentSettings[listType]
  );
  
  // Auto-save settings
  saveSettings();
}

async function saveSettings() {
  try {
    // API URL is now hardcoded to the default (no user configuration needed)
    currentSettings.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    // Backend URL is pre-configured
    currentSettings.backendUrl = 'https://focufy-extension-1.onrender.com';
    currentSettings.autoNavigateEnabled = document.getElementById('autoNavigateEnabled').checked;
    currentSettings.learningModeEnabled = document.getElementById('learningModeEnabled').checked;
    currentSettings.focusCoachEnabled = document.getElementById('focusCoachEnabled').checked;
    currentSettings.aiFeaturesEnabled = document.getElementById('aiFeaturesEnabled').checked;
    currentSettings.goalDecompositionEnabled = document.getElementById('goalDecompositionEnabled').checked;
    currentSettings.focusQualityEnabled = document.getElementById('focusQualityEnabled').checked;
    currentSettings.contextualBlockingEnabled = document.getElementById('contextualBlockingEnabled').checked;
    currentSettings.sessionReflectionEnabled = document.getElementById('sessionReflectionEnabled').checked;
    currentSettings.passiveCoachEnabled = document.getElementById('passiveCoachEnabled').checked;
    currentSettings.narrativeAnalyticsEnabled = document.getElementById('narrativeAnalyticsEnabled').checked;
    currentSettings.personalContractsEnabled = document.getElementById('personalContractsEnabled').checked;
    currentSettings.pauseTaxEnabled = document.getElementById('pauseTaxEnabled').checked;
    currentSettings.learningFeedEnabled = document.getElementById('learningFeedEnabled').checked;
    currentSettings.energyModeEnabled = document.getElementById('energyModeEnabled').checked;
    currentSettings.dataRetentionEnabled = document.getElementById('dataRetentionEnabled').checked;
    currentSettings.posthogEnabled = document.getElementById('posthogEnabled').checked;
    const retentionInput = document.getElementById('dataRetentionDays');
    currentSettings.dataRetentionDays = retentionInput ? parseInt(retentionInput.value || '90', 10) || 90 : 90;
    currentSettings.contextualRules = readRulesFromUI();
    
    await persistSettings(currentSettings);
    
    // Update declarativeNetRequest blocking rules
    try {
      await chrome.runtime.sendMessage({ action: 'updateBlockingRules' });
      console.log('Blocking rules updated');
    } catch (err) {
      console.error('Error updating blocking rules:', err);
    }
    
    // If backend URL was just added, try to generate API key
    if (currentSettings.backendUrl) {
      const result = await chrome.storage.local.get(['authToken', 'user']);
      if (result.authToken && result.user) {
        // Try to generate API key if user is signed in
        await generateApiKeyWithConsent(currentSettings.backendUrl);
      }
      await checkUserApiKeyStatus();
    }
    
    // Optional telemetry (PostHog)
    if (currentSettings.posthogEnabled) {
      chrome.runtime.sendMessage({
        action: 'posthogCapture',
        event: 'settings_saved',
        properties: { page: 'settings', posthogEnabled: true }
      }).catch(() => {});
    }
    
    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  }
}

async function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) {
    return;
  }
  
  currentSettings = {
    settingsVersion: 2,
    dataVersion: 1,
    alwaysAllow: [],
    alwaysBlock: [],
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    backendUrl: 'https://focufy-extension-1.onrender.com', // Pre-configured
    aiFeaturesEnabled: false,
    autoNavigateEnabled: false,
    learningModeEnabled: false,
    focusCoachEnabled: false,
    goalDecompositionEnabled: false,
    focusQualityEnabled: false,
    contextualBlockingEnabled: false,
    sessionReflectionEnabled: false,
    passiveCoachEnabled: false,
    narrativeAnalyticsEnabled: false,
    personalContractsEnabled: false,
    pauseTaxEnabled: false,
    learningFeedEnabled: false,
    energyModeEnabled: false,
    dataRetentionEnabled: false,
    posthogEnabled: false,
    dataRetentionDays: 90,
    contextualRules: []
  };
  
  await writeSettingsRaw(currentSettings);
  await loadSettings();
  showStatus('Settings reset to defaults', 'success');
}

function setupEventListeners() {
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const exportBtn = document.getElementById('exportDataBtn');
  const clearBtn = document.getElementById('clearDataBtn');
  const addAlwaysAllowBtn = document.getElementById('addAlwaysAllowBtn');
  const addAlwaysBlockBtn = document.getElementById('addAlwaysBlockBtn');
  const alwaysAllowInput = document.getElementById('alwaysAllowInput');
  const alwaysBlockInput = document.getElementById('alwaysBlockInput');
  const addRuleBtn = document.getElementById('addRuleBtn');
  
  if (!saveBtn || !resetBtn || !addAlwaysAllowBtn || !addAlwaysBlockBtn) {
    console.error('Settings: Missing required buttons', {
      saveBtn: !!saveBtn,
      resetBtn: !!resetBtn,
      exportBtn: !!exportBtn,
      clearBtn: !!clearBtn,
      addAlwaysAllowBtn: !!addAlwaysAllowBtn,
      addAlwaysBlockBtn: !!addAlwaysBlockBtn
    });
    return;
  }
  
  saveBtn.addEventListener('click', saveSettings);
  resetBtn.addEventListener('click', resetSettings);
  if (exportBtn) exportBtn.addEventListener('click', exportData);
  if (clearBtn) clearBtn.addEventListener('click', clearData);
  if (addRuleBtn) addRuleBtn.addEventListener('click', () => addRule());
  
  addAlwaysAllowBtn.addEventListener('click', () => {
    console.log('Add Always Allow button clicked');
    if (alwaysAllowInput) {
      addDomain('alwaysAllow', alwaysAllowInput.value);
    } else {
      console.error('alwaysAllowInput not found');
    }
  });
  
  addAlwaysBlockBtn.addEventListener('click', () => {
    console.log('Add Always Block button clicked');
    if (alwaysBlockInput) {
      addDomain('alwaysBlock', alwaysBlockInput.value);
    } else {
      console.error('alwaysBlockInput not found');
    }
  });
  
  document.getElementById('alwaysAllowInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addDomain('alwaysAllow', e.target.value);
    }
  });
  
  document.getElementById('alwaysBlockInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addDomain('alwaysBlock', e.target.value);
    }
  });
  
  document.getElementById('endSessionBtn').addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'endSession' });
      if (response.success) {
        await checkSessionStatus();
        showStatus('Session ended', 'success');
      }
    } catch (error) {
      console.error('Error ending session:', error);
    }
  });
  
  // Backend URL is pre-configured, no need for input field
}

function showStatus(message, type) {
  const statusEl = document.getElementById('statusMessage');
  statusEl.textContent = message;
  statusEl.className = `status-message ${type}`;
  statusEl.classList.remove('hidden');
  
  setTimeout(() => {
    statusEl.classList.add('hidden');
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function exportData() {
  try {
    const data = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'focufy-export.json';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Data exported as JSON', 'success');
  } catch (e) {
    console.error('Export error', e);
    showStatus('Failed to export data', 'error');
  }
}

async function clearData() {
  if (!confirm('Clear analytics, sessions, and learning data? Settings will stay.')) return;
  try {
    await chrome.storage.local.remove(['analytics','sessions','learningData','session','pageAnalysisCache','learningFeed']);
    showStatus('Data cleared', 'success');
  } catch (e) {
    console.error('Clear data error', e);
    showStatus('Failed to clear data', 'error');
  }
}

// Contextual rules UI
function renderRules(rules) {
  const list = document.getElementById('rulesList');
  if (!list) return;
  list.innerHTML = '';
  if (!rules || rules.length === 0) {
    list.innerHTML = '<p class="help-text">No rules yet. Click "Add Rule" to create one.</p>';
    return;
  }
  rules.forEach((rule, idx) => {
    const item = document.createElement('div');
    item.className = 'rule-item';
    item.innerHTML = `
      <div class="rule-controls">
        <label class="input-label">Type</label>
        <select data-field="type">
          <option value="allowIfDomainMatchesGoalKeywords">Allow if domain matches goal keywords</option>
          <option value="allowIfYoutubeVideoUnderMinutes">Allow YouTube video under minutes</option>
          <option value="allowOnlySubredditListDuringSession">Allow only subreddits</option>
          <option value="blockAfterMinutesIntoSession">Block after minutes into session</option>
        </select>
      </div>
      <div class="rule-controls" data-extra="limitMinutes">
        <label class="input-label">Minutes</label>
        <input type="number" min="1" max="240" placeholder="e.g., 10">
      </div>
      <div class="rule-controls" data-extra="subreddits">
        <label class="input-label">Subreddits (comma)</label>
        <input type="text" placeholder="e.g., productivity, learnprogramming">
      </div>
      <div class="rule-controls">
        <label class="input-label">Disabled</label>
        <select data-field="disabled">
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </div>
      <button class="btn btn-small" data-action="remove">Remove</button>
    `;
    const typeSel = item.querySelector('select[data-field="type"]');
    const disabledSel = item.querySelector('select[data-field="disabled"]');
    const limitInput = item.querySelector('[data-extra="limitMinutes"] input');
    const subInput = item.querySelector('[data-extra="subreddits"] input');
    typeSel.value = rule.type || 'allowIfDomainMatchesGoalKeywords';
    disabledSel.value = rule.disabled ? 'true' : 'false';
    if (rule.limitMinutes && limitInput) limitInput.value = rule.limitMinutes;
    if (rule.subreddits && subInput) subInput.value = (rule.subreddits || []).join(', ');
    item.querySelector('[data-action="remove"]').addEventListener('click', () => {
      const newRules = (currentSettings.contextualRules || []).filter((_, i) => i !== idx);
      currentSettings.contextualRules = newRules;
      renderRules(newRules);
    });
    list.appendChild(item);
  });
}

function addRule() {
  if (!currentSettings.contextualRules) currentSettings.contextualRules = [];
  currentSettings.contextualRules.push({ type: 'allowIfDomainMatchesGoalKeywords', disabled: false });
  renderRules(currentSettings.contextualRules);
}

function readRulesFromUI() {
  const list = document.getElementById('rulesList');
  if (!list) return currentSettings.contextualRules || [];
  const items = Array.from(list.querySelectorAll('.rule-item'));
  return items.map(item => {
    const type = item.querySelector('select[data-field="type"]').value;
    const disabled = item.querySelector('select[data-field="disabled"]').value === 'true';
    const limitVal = item.querySelector('[data-extra="limitMinutes"] input')?.value;
    const subVal = item.querySelector('[data-extra="subreddits"] input')?.value || '';
    return {
      type,
      disabled,
      limitMinutes: limitVal ? parseInt(limitVal, 10) : undefined,
      subreddits: subVal ? subVal.split(',').map(s => s.trim()).filter(Boolean) : []
    };
  });
}

// Check user API key status from backend
async function checkUserApiKeyStatus() {
  try {
    const result = await chrome.storage.local.get(['user', 'authToken', 'settings']);
    const statusEl = document.getElementById('userApiKeyStatus');
    const statusText = statusEl.querySelector('.status-text');
    
    // Check if user is signed in
    if (!result.user || !result.authToken) {
      statusEl.classList.remove('hidden');
      statusEl.classList.add('error');
      statusEl.classList.remove('success');
      statusText.textContent = '⚠️ Please sign in with Google to get your API key automatically';
      return;
    }
    
    // Backend URL is pre-configured
    const backendUrl = result.settings?.backendUrl || 'https://focufy-extension-1.onrender.com';
    
    // Try to check API key status
    try {
      const response = await fetch(`${backendUrl}/api/user-api-key`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${result.authToken}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.hasApiKey) {
          statusEl.classList.remove('hidden');
          statusEl.classList.add('success');
          statusEl.classList.remove('error');
          const date = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'just now';
          statusText.textContent = `✅ API key is active (created ${date})`;
        } else {
          // User doesn't have a key - show option to generate
          statusEl.classList.remove('hidden');
          statusEl.classList.add('error');
          statusEl.classList.remove('success');
          statusText.innerHTML = '⚠️ No API key found. <button id="generateApiKeyBtn" style="margin-left: 8px; padding: 4px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">Generate Now</button>';
          
          // Add click handler for generate button
          const generateBtn = document.getElementById('generateApiKeyBtn');
          if (generateBtn) {
            // Remove old listeners
            const newBtn = generateBtn.cloneNode(true);
            generateBtn.parentNode.replaceChild(newBtn, generateBtn);
            newBtn.addEventListener('click', async () => {
              await generateApiKeyWithConsent(backendUrl);
            });
          }
        }
      } else {
        throw new Error(`Backend returned ${response.status}`);
      }
    } catch (fetchError) {
      statusEl.classList.remove('hidden');
      statusEl.classList.add('error');
      statusEl.classList.remove('success');
      statusText.innerHTML = `⚠️ Could not connect to backend. Check your URL. <button id="generateApiKeyBtn" style="margin-left: 8px; padding: 4px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">Try Generate</button>`;
      
      const generateBtn = document.getElementById('generateApiKeyBtn');
      if (generateBtn) {
        const newBtn = generateBtn.cloneNode(true);
        generateBtn.parentNode.replaceChild(newBtn, generateBtn);
        newBtn.addEventListener('click', async () => {
          await generateApiKeyWithConsent(backendUrl);
        });
      }
    }
  } catch (error) {
    console.error('Error checking API key status:', error);
    const statusEl = document.getElementById('userApiKeyStatus');
    const statusText = statusEl.querySelector('.status-text');
    statusEl.classList.remove('hidden');
    statusEl.classList.add('error');
    statusText.textContent = '⚠️ Error checking API key status';
  }
}

// Generate API key using user's Google account (with consent)
async function generateApiKeyWithConsent(backendUrl) {
  try {
    const result = await chrome.storage.local.get(['authToken', 'user']);
    if (!result.authToken || !result.user) {
      showStatus('Please sign in with Google first', 'error');
      return false;
    }
    
    // No consent needed - user already signed in with Google
    showStatus('Generating API key...', 'success');
    
    const response = await fetch(`${backendUrl}/api/generate-api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${result.authToken}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      showStatus('✅ API key generated successfully!', 'success');
      await checkUserApiKeyStatus();
      return true;
    } else {
      const error = await response.json();
      if (error.requiresScope) {
        showStatus('⚠️ Please sign in again and grant cloud-platform permissions', 'error');
        // Optionally trigger re-login
      } else {
        showStatus(`Failed: ${error.error}`, 'error');
      }
      return false;
    }
  } catch (error) {
    console.error('Error generating API key:', error);
    showStatus('Error generating API key', 'error');
    return false;
  }
}
