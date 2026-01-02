/**
 * Focufy - Settings Script
 */

let currentSettings = null;

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
        // Update warning message to be less restrictive
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
    const result = await chrome.storage.local.get(['settings']);
    currentSettings = result.settings || {
      alwaysAllow: [],
      alwaysBlock: [],
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
      backendUrl: '',
      autoNavigateEnabled: true,
      learningModeEnabled: true
    };
    
    document.getElementById('apiUrl').value = currentSettings.apiUrl || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
    document.getElementById('backendUrl').value = currentSettings.backendUrl || '';
    document.getElementById('autoNavigateEnabled').checked = currentSettings.autoNavigateEnabled !== false;
    document.getElementById('learningModeEnabled').checked = currentSettings.learningModeEnabled !== false;
    
    // Always check API key status (will show appropriate message if not configured)
    await checkUserApiKeyStatus();
    
    renderDomainList('alwaysAllowList', currentSettings.alwaysAllow || []);
    renderDomainList('alwaysBlockList', currentSettings.alwaysBlock || []);
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
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

function addDomain(listType, domain) {
  domain = domain.trim().toLowerCase();
  
  if (!domain) {
    showStatus('Please enter a domain', 'error');
    return;
  }
  
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.split('/')[0];
  
  if (!currentSettings[listType]) {
    currentSettings[listType] = [];
  }
  
  if (currentSettings[listType].includes(domain)) {
    showStatus('Domain already in list', 'error');
    return;
  }
  
  currentSettings[listType].push(domain);
  renderDomainList(
    listType === 'alwaysAllow' ? 'alwaysAllowList' : 'alwaysBlockList',
    currentSettings[listType]
  );
  
  const inputId = listType === 'alwaysAllow' ? 'alwaysAllowInput' : 'alwaysBlockInput';
  document.getElementById(inputId).value = '';
}

function removeDomain(listType, domain) {
  if (!currentSettings[listType]) return;
  
  currentSettings[listType] = currentSettings[listType].filter(d => d !== domain);
  renderDomainList(
    listType === 'alwaysAllow' ? 'alwaysAllowList' : 'alwaysBlockList',
    currentSettings[listType]
  );
}

async function saveSettings() {
  try {
    currentSettings.apiUrl = document.getElementById('apiUrl').value.trim() || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
    currentSettings.backendUrl = document.getElementById('backendUrl').value.trim();
    currentSettings.autoNavigateEnabled = document.getElementById('autoNavigateEnabled').checked;
    currentSettings.learningModeEnabled = document.getElementById('learningModeEnabled').checked;
    
    await chrome.storage.local.set({ settings: currentSettings });
    
    // If backend URL was just added, try to generate API key
    if (currentSettings.backendUrl) {
      const result = await chrome.storage.local.get(['authToken', 'user']);
      if (result.authToken && result.user) {
        // Try to generate API key if user is signed in
        await generateApiKeyWithConsent(currentSettings.backendUrl);
      }
      await checkUserApiKeyStatus();
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
    alwaysAllow: [],
    alwaysBlock: [],
    apiKey: '',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
    backendUrl: '',
    autoNavigateEnabled: true,
    learningModeEnabled: true
  };
  
  await chrome.storage.local.set({ settings: currentSettings });
  await loadSettings();
  showStatus('Settings reset to defaults', 'success');
}

function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  
  document.getElementById('addAlwaysAllowBtn').addEventListener('click', () => {
    const input = document.getElementById('alwaysAllowInput');
    addDomain('alwaysAllow', input.value);
  });
  
  document.getElementById('addAlwaysBlockBtn').addEventListener('click', () => {
    const input = document.getElementById('alwaysBlockInput');
    addDomain('alwaysBlock', input.value);
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
  
  // Auto-check API key status when backend URL is entered
  const backendUrlInput = document.getElementById('backendUrl');
  if (backendUrlInput) {
    backendUrlInput.addEventListener('blur', async () => {
      const settings = await chrome.storage.local.get(['settings']);
      if (settings.settings?.backendUrl) {
        await checkUserApiKeyStatus();
      }
    });
  }
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
      statusText.textContent = '⚠️ Please sign in with Google first';
      return;
    }
    
    // Check if backend URL is configured
    if (!result.settings?.backendUrl) {
      statusEl.classList.remove('hidden');
      statusEl.classList.add('error');
      statusEl.classList.remove('success');
      statusText.innerHTML = '⚠️ Backend URL not set. Enter your backend URL above, then click "Generate API Key" below.';
      return;
    }
    
    // Try to check API key status
    try {
      const response = await fetch(`${result.settings.backendUrl}/api/user-api-key`, {
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
              await generateApiKeyWithConsent(result.settings.backendUrl);
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
          await generateApiKeyWithConsent(result.settings.backendUrl);
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
