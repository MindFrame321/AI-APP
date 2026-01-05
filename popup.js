/**
 * Focufy - Popup Script
 */

let updateInterval = null;
let currentSession = null; // Track current session state
let subgoals = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('Popup loaded, initializing...');
    await checkAuthStatus();
    await checkSessionStatus();
    setupEventListeners();
    if (currentSession && currentSession.active) {
      updateInterval = setInterval(updateRemainingTime, 1000);
    }
    console.log('Initialization complete');
  } catch (error) {
    console.error('Initialization error:', error);
  }
});

// Check if user is authenticated
async function checkAuthStatus() {
  try {
    const result = await chrome.storage.local.get(['user', 'oauthClientId']);
    if (result.user && result.user.email) {
      await showUserProfile(result.user);
      hideLoginScreen();
    } else {
      showLoginScreen();
      hideUserProfile();
    }
    
    // Load saved OAuth client ID if exists
    if (result.oauthClientId) {
      const clientIdInput = document.getElementById('oauthClientId');
      if (clientIdInput) {
        clientIdInput.value = result.oauthClientId;
      }
    }
  } catch (error) {
    console.error('Error checking auth:', error);
    showLoginScreen();
    hideUserProfile();
  }
}

// Show login screen
function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('sessionInactive').classList.add('hidden');
  document.getElementById('sessionActive').classList.add('hidden');
}

// Hide login screen
function hideLoginScreen() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('sessionInactive').classList.remove('hidden');
}

// Show user profile
async function showUserProfile(user) {
  try {
    const userProfile = document.getElementById('userProfile');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');
    
    if (!userProfile || !userName || !userEmail) {
      console.error('User profile elements not found');
      return;
    }
    
    userProfile.classList.remove('hidden');
    userName.textContent = user.name || 'User';
    userEmail.textContent = user.email || '';
    
    if (userAvatar && user.avatar) {
      userAvatar.src = user.avatar;
      userAvatar.style.display = 'block';
    }
    
    // Update gamification stats
    await updateGamificationStats();
  } catch (error) {
    console.error('Error showing user profile:', error);
  }
}

// Hide user profile
function hideUserProfile() {
  document.getElementById('userProfile').classList.add('hidden');
}

async function checkSessionStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSession' });
    console.log('Session status response:', response);
    
    if (response && response.session && response.session.active) {
      currentSession = response.session;
      showActiveSession(response.session);
    } else {
      currentSession = null;
      showInactiveSession();
    }
    
    // Update gamification stats
    await updateGamificationStats();
  } catch (error) {
    console.error('Error checking session:', error);
    currentSession = null;
    showInactiveSession();
  }
}

function showActiveSession(session) {
  document.getElementById('sessionActive').classList.remove('hidden');
  document.getElementById('sessionInactive').classList.add('hidden');
  
  document.getElementById('activeTask').textContent = `"${session.taskDescription}"`;
  if (session.subgoals && session.subgoals.length > 0) {
    subgoals = session.subgoals;
    renderSubgoals(true);
  }
  updateRemainingTime();
}

function showInactiveSession() {
  document.getElementById('sessionActive').classList.add('hidden');
  document.getElementById('sessionInactive').classList.remove('hidden');
  renderSubgoals(false);
}

async function updateRemainingTime() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getRemainingTime' });
    const minutes = response.time || 0;
    
    if (minutes <= 0) {
      clearInterval(updateInterval);
      showInactiveSession();
      showStatus('Focus session completed!', 'success');
      return;
    }
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    let timeString;
    if (hours > 0) {
      timeString = `${hours}:${mins.toString().padStart(2, '0')}`;
    } else {
      timeString = `${mins}:00`;
    }
    
    document.getElementById('remainingTime').textContent = timeString;
  } catch (error) {
    console.error('Error updating time:', error);
  }
}

function setupEventListeners() {
  console.log('Setting up event listeners...');
  
  // Sign-in buttons - use direct assignment for reliability
  const googleBtn = document.getElementById('googleSignInBtn');
  const emailBtn = document.getElementById('emailSignInBtn');
  const githubBtn = document.getElementById('githubSignInBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  
  console.log('Buttons found:', {
    google: !!googleBtn,
    email: !!emailBtn,
    github: !!githubBtn,
    logout: !!logoutBtn
  });
  
  // Direct onclick assignment (more reliable)
  if (googleBtn) {
    googleBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('Google sign-in button clicked!');
      signInWithGoogle().catch(err => {
        console.error('Google sign-in error:', err);
        alert('Google sign-in error: ' + err.message);
      });
      return false;
    };
    console.log('✅ Google button listener attached');
  } else {
    console.error('❌ Google sign-in button not found!');
  }
  
  if (emailBtn) {
    emailBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('Email sign-in button clicked!');
      signInWithEmail().catch(err => {
        console.error('Email sign-in error:', err);
        alert('Email sign-in error: ' + err.message);
      });
      return false;
    };
    console.log('✅ Email button listener attached');
  } else {
    console.error('❌ Email sign-in button not found!');
  }
  
  if (githubBtn) {
    githubBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('GitHub sign-in button clicked!');
      signInWithGitHub().catch(err => {
        console.error('GitHub sign-in error:', err);
        alert('GitHub sign-in error: ' + err.message);
      });
      return false;
    };
    console.log('✅ GitHub button listener attached');
  } else {
    console.error('❌ GitHub sign-in button not found!');
  }
  
  if (logoutBtn) {
    logoutBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('Logout button clicked!');
      signOut();
      return false;
    };
    console.log('✅ Logout button listener attached');
  }
  
  // OAuth Client ID input - save on blur
  const oauthClientIdInput = document.getElementById('oauthClientId');
  if (oauthClientIdInput) {
    oauthClientIdInput.addEventListener('blur', async (e) => {
      const clientId = e.target.value.trim();
      if (clientId) {
        await chrome.storage.local.set({ oauthClientId: clientId });
        console.log('OAuth Client ID saved:', clientId);
      }
    });
  }
  
  // Session buttons
  const startBtn = document.getElementById('startSessionBtn');
  const endBtn = document.getElementById('endSessionBtn');
  
  console.log('Session buttons found:', { start: !!startBtn, end: !!endBtn });
  
  if (startBtn) {
    startBtn.onclick = function(e) {
      e.preventDefault();
      console.log('Start session button clicked via onclick');
      startSession();
      return false;
    };
    console.log('✅ Start session button listener attached');
  } else {
    console.error('❌ Start session button not found!');
  }
  
  if (endBtn) {
    endBtn.onclick = function(e) {
      e.preventDefault();
      console.log('End session button clicked via onclick');
      endSession();
      return false;
    };
    console.log('✅ End session button listener attached');
  } else {
    console.error('❌ End session button not found!');
  }
  
  // Password modal buttons
  const confirmEndBtn = document.getElementById('confirmEndBtn');
  const cancelEndBtn = document.getElementById('cancelEndBtn');
  const savePasswordBtn = document.getElementById('savePasswordBtn');
  const skipPasswordBtn = document.getElementById('skipPasswordBtn');
  
  if (confirmEndBtn) {
    confirmEndBtn.onclick = async (e) => {
      e.preventDefault();
      await verifyAndEndSession();
    };
  }
  
  if (cancelEndBtn) {
    cancelEndBtn.onclick = (e) => {
      e.preventDefault();
      hidePasswordModal();
    };
  }
  
  if (savePasswordBtn) {
    savePasswordBtn.onclick = async (e) => {
      e.preventDefault();
      await savePassword();
    };
  }
  
  if (skipPasswordBtn) {
    skipPasswordBtn.onclick = async (e) => {
      e.preventDefault();
      hideSetupPasswordModal();
      await confirmEndSession();
    };
  }
  
  // Duration select
  const durationSelect = document.getElementById('durationSelect');
  if (durationSelect) {
    durationSelect.addEventListener('change', (e) => {
      const customGroup = document.getElementById('customDurationGroup');
      if (customGroup) {
        if (e.target.value === 'custom') {
          customGroup.classList.remove('hidden');
        } else {
          customGroup.classList.add('hidden');
        }
      }
    });
  }
  
  // Navigation links
  const settingsLink = document.getElementById('settingsLink');
  const analyticsLink = document.getElementById('analyticsLink');
  const helpLink = document.getElementById('helpLink');
  const gamificationLink = document.getElementById('gamificationLink');
  
  if (settingsLink) {
    const url = chrome.runtime.getURL('settings.html');
    settingsLink.href = url;
    settingsLink.target = '_blank';
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        chrome.tabs.create({ url });
      } catch (err) {
        window.location.href = url;
      }
    });
  }
  
  if (analyticsLink) {
    const url = chrome.runtime.getURL('analytics.html');
    analyticsLink.href = url;
    analyticsLink.target = '_blank';
    analyticsLink.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        chrome.tabs.create({ url });
      } catch (err) {
        window.location.href = url;
      }
    });
  }
  
  if (helpLink) {
    const url = chrome.runtime.getURL('help.html');
    helpLink.href = url;
    helpLink.target = '_blank';
    helpLink.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        chrome.tabs.create({ url });
      } catch (err) {
        window.location.href = url;
      }
    });
  }
  
  if (gamificationLink) {
    gamificationLink.addEventListener('click', (e) => {
      e.preventDefault();
      showGamification();
    });
  }
}

// Show gamification panel
async function showGamification() {
  document.getElementById('gamificationPanel').classList.remove('hidden');
  await loadGamification();
}

// Hide gamification panel
function hideGamification() {
  document.getElementById('gamificationPanel').classList.add('hidden');
}

// Load gamification data
async function loadGamification() {
  try {
    const result = await chrome.storage.local.get(['analytics', 'sessions', 'achievements', 'points', 'dailyChallenge']);
    const analytics = result.analytics || {};
    const sessions = result.sessions || [];
    const achievements = result.achievements || [];
    const points = result.points || 0;
    
    // Update level
    const level = getUserLevel(points);
    const levelBadge = document.getElementById('levelBadge');
    const levelName = document.getElementById('levelName');
    const levelProgress = document.getElementById('levelProgress');
    const currentPoints = document.getElementById('currentPoints');
    const nextLevelPoints = document.getElementById('nextLevelPoints');
    
    if (levelBadge) levelBadge.textContent = `Level ${level.level}`;
    if (levelName) levelName.textContent = level.name;
    
    const progressPercent = level.nextLevel === Infinity ? 100 : (points / level.nextLevel) * 100;
    if (levelProgress) levelProgress.style.width = `${progressPercent}%`;
    if (currentPoints) currentPoints.textContent = points;
    if (nextLevelPoints) nextLevelPoints.textContent = level.nextLevel === Infinity ? '∞' : level.nextLevel;
    
    // Update daily challenge
    const challenge = result.dailyChallenge || getDailyChallenge();
    const challengeName = document.getElementById('challengeName');
    const challengeDesc = document.getElementById('challengeDesc');
    const challengeProgress = document.getElementById('challengeProgress');
    const challengeProgressText = document.getElementById('challengeProgressText');
    
    if (challengeName) challengeName.textContent = challenge.name || 'No challenge';
    if (challengeDesc) challengeDesc.textContent = challenge.description || '';
    
    const challengeProgressValue = challenge.progress || 0;
    const challengeTarget = challenge.target || 1;
    const challengePercent = Math.min(100, (challengeProgressValue / challengeTarget) * 100);
    if (challengeProgress) challengeProgress.style.width = `${challengePercent}%`;
    if (challengeProgressText) challengeProgressText.textContent = `${challengeProgressValue} / ${challengeTarget}`;
    
    // Load achievements
    await loadAchievements(achievements);
    
    // Update user stats in profile
    updateUserStats(analytics, points, level);
  } catch (error) {
    console.error('Error loading gamification:', error);
  }
}

// Get daily challenge
function getDailyChallenge() {
  const challenges = [
    { name: '2-Hour Focus', description: 'Complete 2 hours of focused work today', target: 120, points: 50, icon: '⏱️' },
    { name: 'Block 10 Distractions', description: 'Block 10 distracting elements today', target: 10, points: 30, icon: '🚫' },
    { name: 'Triple Session', description: 'Complete 3 focus sessions today', target: 3, points: 40, icon: '🎯' },
    { name: 'Deep Work', description: 'Complete a 60+ minute session', target: 60, points: 35, icon: '🧠' }
  ];
  
  const today = new Date().toDateString();
  const stored = localStorage.getItem('dailyChallenge');
  
  if (stored) {
    const challenge = JSON.parse(stored);
    if (challenge.date === today) {
      return challenge;
    }
  }
  
  const challenge = {
    ...challenges[Math.floor(Math.random() * challenges.length)],
    date: today,
    progress: 0,
    completed: false
  };
  
  localStorage.setItem('dailyChallenge', JSON.stringify(challenge));
  return challenge;
}

// Load achievements
async function loadAchievements(earnedAchievements) {
  try {
    const ACHIEVEMENTS = {
      FIRST_SESSION: { id: 'first_session', name: 'Getting Started', icon: '🎯', points: 10, description: 'Complete your first focus session' },
      STREAK_3: { id: 'streak_3', name: 'On Fire', icon: '🔥', points: 25, description: 'Maintain a 3-day focus streak' },
      STREAK_7: { id: 'streak_7', name: 'Week Warrior', icon: '⚡', points: 50, description: 'Maintain a 7-day focus streak' },
      STREAK_30: { id: 'streak_30', name: 'Focus Master', icon: '👑', points: 200, description: 'Maintain a 30-day focus streak' },
      HOUR_10: { id: 'hour_10', name: 'Dedicated', icon: '⏰', points: 50, description: 'Complete 10 hours of focused work' },
      HOUR_50: { id: 'hour_50', name: 'Time Master', icon: '🏆', points: 150, description: 'Complete 50 hours of focused work' },
      HOUR_100: { id: 'hour_100', name: 'Centurion', icon: '💎', points: 300, description: 'Complete 100 hours of focused work' },
      BLOCK_100: { id: 'block_100', name: 'Distraction Destroyer', icon: '🛡️', points: 75, description: 'Block 100 distractions' },
      BLOCK_1000: { id: 'block_1000', name: 'Focus Guardian', icon: '🦾', points: 250, description: 'Block 1,000 distractions' },
      DAILY_CHALLENGE: { id: 'daily_challenge', name: 'Challenge Accepted', icon: '🎮', points: 30, description: 'Complete a daily challenge' },
      PERFECT_WEEK: { id: 'perfect_week', name: 'Perfect Week', icon: '⭐', points: 100, description: 'Complete a session every day for a week' }
    };
    
    const grid = document.getElementById('achievementsGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    Object.values(ACHIEVEMENTS).forEach(achievement => {
      const earned = earnedAchievements.includes(achievement.id);
      const item = document.createElement('div');
      item.className = `achievement-item ${earned ? 'earned' : 'locked'}`;
      item.innerHTML = `
        <div class="achievement-icon">${achievement.icon}</div>
        <div class="achievement-name">${achievement.name}</div>
        <div class="achievement-points">${achievement.points} pts</div>
      `;
      if (earned) {
        item.title = achievement.description;
      } else {
        item.title = `Locked: ${achievement.description}`;
      }
      grid.appendChild(item);
    });
    
    // Load recent achievements
    const recentList = document.getElementById('recentAchievements');
    if (recentList) {
      recentList.innerHTML = '';
      const recent = earnedAchievements.slice(-3).reverse();
      recent.forEach(achievementId => {
        const achievement = Object.values(ACHIEVEMENTS).find(a => a.id === achievementId);
        if (!achievement) return;
        const item = document.createElement('div');
        item.className = 'recent-item';
        item.innerHTML = `
          <span class="recent-icon">${achievement.icon}</span>
          <span class="recent-text">${achievement.name}</span>
          <span class="recent-points">+${achievement.points}</span>
        `;
        recentList.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Error loading achievements:', error);
  }
}

// Update user stats in profile
function updateUserStats(analytics, points, level) {
  const streakValue = document.getElementById('streakValue');
  const pointsValue = document.getElementById('pointsValue');
  const levelValue = document.getElementById('levelValue');
  
  if (streakValue) streakValue.textContent = analytics.focusStreak || 0;
  if (pointsValue) pointsValue.textContent = points || 0;
  if (levelValue) levelValue.textContent = level?.level || 1;
}

// Update gamification stats
async function updateGamificationStats() {
  try {
    const result = await chrome.storage.local.get(['analytics', 'points']);
    const analytics = result.analytics || {};
    const points = result.points || 0;
    const level = getUserLevel(points);
    updateUserStats(analytics, points, level);
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}

// Get user level
function getUserLevel(points) {
  if (points < 100) return { level: 1, name: 'Beginner', nextLevel: 100 };
  if (points < 300) return { level: 2, name: 'Focused', nextLevel: 300 };
  if (points < 600) return { level: 3, name: 'Dedicated', nextLevel: 600 };
  if (points < 1000) return { level: 4, name: 'Expert', nextLevel: 1000 };
  if (points < 2000) return { level: 5, name: 'Master', nextLevel: 2000 };
  return { level: 6, name: 'Legend', nextLevel: Infinity };
}

// Automatically generate API key after Google sign-in
async function autoGenerateApiKeyAfterSignIn() {
  try {
    // Get settings to check if backend URL is configured
    const result = await chrome.storage.local.get(['settings', 'authToken', 'user']);
    
    if (!result.authToken || !result.user) {
      console.log('No auth token or user found');
      return;
    }
    
    // Pre-configured backend URL (fallback if not in settings)
    const backendUrl = result.settings?.backendUrl || 'https://focufy-extension-1.onrender.com';
    
    // Ensure backend URL is saved in settings
    if (!result.settings?.backendUrl) {
      await chrome.storage.local.set({
        settings: {
          ...result.settings,
          backendUrl: backendUrl
        }
      });
    }
    
    console.log('🔄 Auto-generating API key after sign-in...');
    showStatus('Setting up your API key...', 'success');
    
    // Check if user already has an API key
    let statusData = null;
    try {
      const statusResponse = await fetch(`${backendUrl}/api/user-api-key`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${result.authToken}`
        }
      });
      
      if (statusResponse.ok) {
        statusData = await statusResponse.json();
        if (statusData.hasApiKey) {
          console.log('✅ User already has an API key');
          showStatus('✅ All set! Your API key is ready.', 'success');
          return;
        }
      } else {
        console.warn('Failed to check API key status:', statusResponse.status);
      }
    } catch (error) {
      console.error('Error checking API key status:', error);
      showStatus('⚠️ Could not connect to backend. Check your backend URL.', 'error');
      return;
    }
    
    // Generate API key automatically (user already gave consent by signing in)
    console.log('Generating new API key...');
    try {
      const generateResponse = await fetch(`${backendUrl}/api/generate-api-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${result.authToken}`
        }
      });
      
      if (generateResponse.ok) {
        const generateData = await generateResponse.json();
        console.log('✅ API key generated successfully:', generateData);
        showStatus('✅ API key generated! You\'re all set.', 'success');
      } else {
        const error = await generateResponse.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to generate API key:', error);
        showStatus(`⚠️ Failed: ${error.error || 'Check backend configuration'}`, 'error');
      }
    } catch (fetchError) {
      console.error('Network error generating API key:', fetchError);
      showStatus('⚠️ Could not connect to backend server', 'error');
    }
  } catch (error) {
    console.error('Error auto-generating API key:', error);
    showStatus('⚠️ API key setup error. Check settings.', 'error');
  }
}

// Make functions global for onclick handlers
window.hideGamification = hideGamification;
window.signInWithGoogle = signInWithGoogle;
window.signInWithEmail = signInWithEmail;
window.signInWithGitHub = signInWithGitHub;

async function startSession() {
  console.log('Start session button clicked');
  
  const taskInput = document.getElementById('taskInput');
  const durationSelect = document.getElementById('durationSelect');
  const customDuration = document.getElementById('customDuration');
  const energySelect = document.getElementById('energySelect');
  
  const taskDescription = taskInput.value.trim();
  console.log('Task description:', taskDescription);
  
  if (!taskDescription) {
    showStatus('Please enter a task description', 'error');
    return;
  }
  
  let durationMinutes;
  if (durationSelect.value === 'custom') {
    durationMinutes = parseInt(customDuration.value, 10);
    if (isNaN(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
      showStatus('Please enter a valid duration (1-480 minutes)', 'error');
      return;
    }
  } else {
    durationMinutes = parseInt(durationSelect.value, 10);
  }
  
  console.log('Duration:', durationMinutes, 'minutes');
  const energyTag = energySelect ? energySelect.value || null : null;
  
  // Auto-generate subgoals if enabled and none present
  if (!subgoals || subgoals.length === 0) {
    await decomposeGoal(true);
  }
  
  try {
    console.log('Sending startSession message to background...');
    const response = await chrome.runtime.sendMessage({
      action: 'startSession',
      taskDescription,
      durationMinutes,
      subgoals,
      energyTag
    });
    
    console.log('Start session response:', response);
    
    if (response && response.success) {
      showStatus('Focus session started!', 'success');
      // Update the session state
      currentSession = {
        taskDescription,
        durationMinutes,
        active: true,
        subgoals
      };
      // Update UI immediately
      showActiveSession({ taskDescription, active: true, endTime: Date.now() + durationMinutes * 60000 });
      // Start the timer
      updateInterval = setInterval(updateRemainingTime, 1000);
    } else {
      showStatus(`Error: ${response?.error || 'Failed to start session'}`, 'error');
    }
  } catch (error) {
    console.error('Error starting session:', error);
    showStatus('Error starting session: ' + error.message, 'error');
  }
}

async function endSession() {
  console.log('End session button clicked');
  
  // Check if password is set
  const result = await chrome.storage.local.get(['sessionPassword']);
  
  if (result.sessionPassword) {
    // Show password modal
    showPasswordModal();
  } else {
    // No password set, ask if they want to set one
    const setupPassword = window.confirm('No password set. Would you like to set one now? (Click Cancel to end without password)');
    if (setupPassword) {
      showSetupPasswordModal();
      return;
    }
    // Continue without password
    await confirmEndSession();
  }
}

function showPasswordModal() {
  const modal = document.getElementById('passwordModal');
  const passwordInput = document.getElementById('endSessionPassword');
  const errorDiv = document.getElementById('passwordError');
  
  modal.classList.remove('hidden');
  passwordInput.value = '';
  errorDiv.classList.add('hidden');
  passwordInput.focus();
  
  // Handle Enter key
  passwordInput.onkeypress = async (e) => {
    if (e.key === 'Enter') {
      await verifyAndEndSession();
    }
  };
}

function hidePasswordModal() {
  document.getElementById('passwordModal').classList.add('hidden');
}

function showSetupPasswordModal() {
  const modal = document.getElementById('setupPasswordModal');
  modal.classList.remove('hidden');
  document.getElementById('newPassword').focus();
}

function hideSetupPasswordModal() {
  document.getElementById('setupPasswordModal').classList.add('hidden');
}

async function verifyAndEndSession() {
  const passwordInput = document.getElementById('endSessionPassword');
  const errorDiv = document.getElementById('passwordError');
  const password = passwordInput.value;
  
  const result = await chrome.storage.local.get(['sessionPassword']);
  const storedPassword = result.sessionPassword;
  
  if (!storedPassword || password === storedPassword) {
    hidePasswordModal();
    await confirmEndSession();
  } else {
    errorDiv.textContent = 'Incorrect password. Try again.';
    errorDiv.classList.remove('hidden');
    passwordInput.value = '';
    passwordInput.focus();
  }
}

async function confirmEndSession() {
  try {
    console.log('Sending endSession message to background...');
    const response = await chrome.runtime.sendMessage({ action: 'endSession' });
    console.log('End session response:', response);
    
    if (response && response.success) {
      showStatus('Focus session ended', 'success');
      await maybeCaptureReflection();
      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }
      currentSession = null;
      // Immediately update UI
      showInactiveSession();
    } else {
      showStatus(`Error: ${response?.error || 'Failed to end session'}`, 'error');
    }
  } catch (error) {
    console.error('Error ending session:', error);
    showStatus('Error ending session: ' + error.message, 'error');
  }
}

async function decomposeGoal(silent) {
  const taskInput = document.getElementById('taskInput');
  const goal = taskInput.value.trim();
  if (!goal) {
    if (!silent) showStatus('Enter a goal first', 'error');
    return;
  }
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'decomposeGoal', goal });
    if (resp?.success && resp.subgoals) {
      subgoals = resp.subgoals.map(s => ({ text: s.text || s, done: s.done || false }));
      renderSubgoals(false);
      if (!silent) showStatus('Subgoals ready', 'success');
    } else {
      if (!silent) showStatus(resp?.error || 'Could not generate subgoals', 'error');
    }
  } catch (e) {
    console.error('Decompose error', e);
    if (!silent) showStatus('Error creating subgoals', 'error');
  }
}

function renderSubgoals(disableInput) {
  const container = document.getElementById('subgoalContainer');
  const list = document.getElementById('subgoalList');
  if (!container || !list) return;
  if (!subgoals || subgoals.length === 0) {
    container.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');
  list.innerHTML = '';
  subgoals.forEach((sg, idx) => {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!sg.done;
    cb.disabled = !!disableInput;
    cb.addEventListener('change', async () => {
      subgoals[idx].done = cb.checked;
      if (disableInput) {
        await chrome.runtime.sendMessage({ action: 'toggleSubgoal', index: idx, done: cb.checked });
      }
    });
    const span = document.createElement('span');
    span.textContent = sg.text || '';
    li.appendChild(cb);
    li.appendChild(span);
    list.appendChild(li);
  });
}

async function savePassword() {
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const errorDiv = document.getElementById('passwordSetupError');
  
  if (!newPassword) {
    errorDiv.textContent = 'Password cannot be empty';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    errorDiv.textContent = 'Passwords do not match';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  if (newPassword.length < 4) {
    errorDiv.textContent = 'Password must be at least 4 characters';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  await chrome.storage.local.set({ sessionPassword: newPassword });
  hideSetupPasswordModal();
  showStatus('Password saved!', 'success');
  
  // Now end the session
  await confirmEndSession();
}

async function maybeCaptureReflection() {
  try {
    const settings = await chrome.storage.local.get(['settings']);
    const cfg = settings.settings || {};
    if (!cfg.sessionReflectionEnabled) return;
    const prompts = cfg.reflectionPrompts || [
      'What helped you stay focused this session?',
      'What will you change next time?',
      'Key takeaway from this session?'
    ];
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];
    const answer = window.prompt(prompt, '');
    if (answer && answer.trim()) {
      await chrome.runtime.sendMessage({ action: 'saveReflection', text: answer.trim() });
    }
  } catch (e) {
    console.warn('Reflection capture failed:', e);
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

// Sign in with Google
async function signInWithGoogle() {
  let clientId = ''; // Declare outside try block for error handler access
  
  try {
    console.log('=== signInWithGoogle CALLED ===');
    showStatus('Signing in with Google...', 'success');
    
    // Check if chrome.identity is available
    if (!chrome.identity || !chrome.identity.launchWebAuthFlow) {
      showStatus('Chrome Identity API not available. Make sure you\'re running this as an installed Chrome extension (not the raw HTML).', 'error');
      alert('Chrome Identity API not available. Install the extension and try again.');
      return;
    }

    // Use manifest OAuth (Chrome Identity) as primary
    const manifestToken = await new Promise((resolve) => {
      try {
        chrome.identity.getAuthToken({ interactive: true }, (t) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(t);
          }
        });
      } catch (e) {
        resolve(null);
      }
    });

    if (manifestToken) {
      const userInfo = await fetchUserInfoFromGoogle(manifestToken);
      if (userInfo && userInfo.email) {
        await chrome.storage.local.set({ user: userInfo, authToken: manifestToken, tokenTimestamp: Date.now() });
        await showUserProfile(userInfo);
        hideLoginScreen();
        showStatus('Signed in successfully!', 'success');
        const result = await chrome.storage.local.get(['subscription']);
        if (!result.subscription) {
          await initializeTrial();
        }
        setTimeout(async () => {
          await autoGenerateApiKeyAfterSignIn();
        }, 500);
        return;
      }
    }
    
    // Get OAuth client ID from input or storage, fallback to default
    const clientIdInput = document.getElementById('oauthClientId');
    clientId = clientIdInput?.value?.trim() || '';
    
    // Try to get from storage if input is empty
    if (!clientId) {
      const result = await chrome.storage.local.get(['oauthClientId']);
      clientId = result.oauthClientId || '';
    }
    
    // Fallback to default if still empty
  if (!clientId) {
      clientId = '42484888880-o3h9svrq1cp5u53hhlrooeohmin89pci.apps.googleusercontent.com';
    }
    
    // Save the client ID to storage for future use
    if (clientIdInput?.value?.trim()) {
      await chrome.storage.local.set({ oauthClientId: clientIdInput.value.trim() });
    }
    
    // Use chrome.identity.launchWebAuthFlow for Web application OAuth clients
    const extensionId = chrome.runtime.id;
    const redirectUri = chrome.identity.getRedirectURL();
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ].join(' ');
    
    console.log('=== OAuth Debug Info ===');
    console.log('Extension ID:', extensionId);
    console.log('Redirect URI:', redirectUri);
    console.log('⚠️ COPY THIS REDIRECT URI AND ADD IT TO YOUR OAUTH CLIENT!');
    console.log('Client ID:', clientId);
    
    // Show the redirect URI prominently in console and status
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚠️  REQUIRED: Add this redirect URI to your OAuth client:');
    console.log('═══════════════════════════════════════════════════════');
    console.log(redirectUri);
    console.log('═══════════════════════════════════════════════════════');
    console.log('Steps:');
    console.log('1. Go to: https://console.cloud.google.com/apis/credentials');
    console.log(`2. Click on client: ${clientId}`);
    console.log(`3. Under "Authorized redirect URIs", click "+ ADD URI"`);
    console.log(`4. Copy the ENTIRE URL including https:// : ${redirectUri}`);
    console.log('5. Paste it exactly as shown (must include https://)');
    console.log('6. Click SAVE');
    console.log('7. Wait 2-3 minutes, then try again');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Using Client ID: ${clientId}`);
    console.log(`⚠️ IMPORTANT: Copy the ENTIRE redirect URI including https://`);
    console.log(`Redirect URI: ${redirectUri}`);
    
    // Show in status message for visibility (but don't block if client ID is set)
    if (!clientIdInput?.value?.trim()) {
      showStatus(`⚠️ Add redirect URI first!\n\nCopy ENTIRE URL:\n${redirectUri}\n\nSee console (F12) for steps`, 'error');
      // Small delay to let user see the message
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Build OAuth URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('access_type', 'online');
    
    const token = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl.toString(),
          interactive: true
        },
        (responseUrl) => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message;
            console.error('launchWebAuthFlow error:', error);
            console.error('Full error:', chrome.runtime.lastError);
            
            // If redirect_uri_mismatch, show helpful message
            if (error.includes('redirect_uri_mismatch') || error.includes('invalid_request')) {
              const helpMessage = `Redirect URI mismatch!\n\nYour redirect URI: ${redirectUri}\n\nAdd this to your OAuth client:\n1. Go to Google Cloud Console\n2. Open OAuth client: ${clientId}\n3. Add redirect URI: ${redirectUri}\n4. Save and try again`;
              console.error(helpMessage);
              reject(new Error(`Redirect URI not configured. Add this to OAuth client: ${redirectUri}`));
            } else {
              reject(new Error(error));
            }
          } else if (!responseUrl) {
            reject(new Error('Authentication was cancelled or failed'));
          } else {
            // Extract token from response URL
            const url = new URL(responseUrl);
            const hash = url.hash.substring(1);
            const params = new URLSearchParams(hash);
            const accessToken = params.get('access_token');
            
            if (accessToken) {
              console.log('✅ TOKEN OK - Successfully got auth token');
              resolve(accessToken);
            } else {
              const error = params.get('error') || 'No access token in response';
              console.error('OAuth error:', error);
              reject(new Error(error));
            }
          }
        }
      );
    });
    
    console.log('Got token! Fetching user info...');
    
    // Get user info from Google using the token
    const userInfo = await fetchUserInfoFromGoogle(token);
    
    if (!userInfo || !userInfo.email) {
      throw new Error('Failed to fetch user information from Google.');
    }
    
    // Save user and token to storage
    console.log('Saving user to storage...');
    await chrome.storage.local.set({ 
      user: userInfo,
      authToken: token,
      tokenTimestamp: Date.now()
    });
    console.log('User saved to storage');
    
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log('Showing user profile...');
    await showUserProfile(userInfo);
    hideLoginScreen();
    showStatus('Signed in successfully!', 'success');
    console.log('Google sign-in complete!');
    
    // Initialize trial if first time
    const result = await chrome.storage.local.get(['subscription']);
    if (!result.subscription) {
      await initializeTrial();
    }
    
    // Automatically generate API key if backend is configured
    // Use setTimeout to ensure UI is updated first
    setTimeout(async () => {
      await autoGenerateApiKeyAfterSignIn();
    }, 500);
  } catch (error) {
    console.error('Google sign-in error:', error);
    let errorMessage = 'Sign-in failed. ';
    
    // Enhanced error logging
    if (chrome.runtime.lastError) {
      console.error('chrome.runtime.lastError:', chrome.runtime.lastError.message);
    }
    
    if (error.message.includes('redirect_uri_mismatch') || error.message.includes('Redirect URI not configured')) {
      const extensionId = chrome.runtime.id;
      const redirectUri = chrome.identity.getRedirectURL();
      const setupUrl = 'https://console.cloud.google.com/apis/credentials';
      
      errorMessage = `❌ Redirect URI Not Configured\n\nYour Extension ID: ${extensionId}\nYour Redirect URI: ${redirectUri}\nYour Client ID: ${clientId || 'Not set'}\n\n✅ SOLUTION:\n1. Go to: ${setupUrl}\n2. Click on OAuth client: ${clientId || 'YOUR_CLIENT_ID'}\n3. Under "Authorized redirect URIs", click "+ ADD URI"\n4. Copy the ENTIRE URL including https:// : ${redirectUri}\n5. Paste it exactly as shown (must include https://)\n6. Click "SAVE"\n7. Wait 2-3 minutes for changes to propagate\n8. Try signing in again\n\n⚠️ IMPORTANT: Copy the ENTIRE URL including https://\n⚠️ Each user (you and your friend) needs to add their own redirect URI!`;
      
      console.error('❌ Redirect URI mismatch');
      console.error('Extension ID:', extensionId);
      console.error('Redirect URI:', redirectUri);
      console.error('Client ID:', clientId);
      console.error('Add this to OAuth client:', redirectUri);
    } else if (error.message.includes('invalid_request')) {
      const extensionId = chrome.runtime.id;
      const redirectUri = chrome.identity.getRedirectURL();
      const setupUrl = 'https://console.cloud.google.com/apis/credentials';
      
      errorMessage = `❌ Invalid Request\n\nThis usually means the redirect URI is missing from your OAuth client.\n\nYour Redirect URI: ${redirectUri}\nYour Client ID: ${clientId || 'Not set'}\n\n✅ SOLUTION:\n1. Go to: ${setupUrl}\n2. Click on OAuth client: ${clientId || 'YOUR_CLIENT_ID'}\n3. Under "Authorized redirect URIs", click "+ ADD URI"\n4. Copy the ENTIRE URL including https:// : ${redirectUri}\n5. Paste it exactly as shown (must include https://)\n6. Click "SAVE" and wait 2-3 minutes\n\n⚠️ IMPORTANT: Copy the ENTIRE URL including https://`;
      
      console.error('❌ Invalid request - likely missing redirect URI');
      console.error('Redirect URI:', redirectUri);
      console.error('Client ID:', clientId);
    } else if (error.message.includes('OAuth2') || error.message.includes('invalid_client')) {
      errorMessage += 'OAuth configuration error. Please check the extension\'s OAuth client ID in manifest.json.';
    } else if (error.message.includes('access_denied')) {
      errorMessage = 'Access denied. Please try again.';
    } else if (error.message.includes('cancelled') || error.message.includes('closed')) {
      errorMessage = 'Sign-in was cancelled.';
    } else {
      errorMessage += error.message || 'Please try email sign-in instead.';
    }
    
    showStatus(errorMessage, 'error');
  }
}

// Sign in with GitHub
async function signInWithGitHub() {
  try {
    console.log('=== signInWithGitHub CALLED ===');
    alert('GitHub sign-in clicked!');
    showStatus('GitHub sign-in requires a backend server. Use email or Google sign-in for now.', 'error');
    
    // GitHub OAuth requires a backend server to:
    // 1. Exchange authorization code for access token (needs Client Secret)
    // 2. Fetch user info from GitHub API
    
    // The Client Secret must stay on the backend, not in the extension!
    
    const message = `GitHub OAuth Setup Required:

Your Client ID has been added, but GitHub OAuth needs a backend server to complete the flow.

For now, please use:
✅ Email Sign-In (works immediately)
✅ Google Sign-In (works with your Client ID)

To enable GitHub sign-in later:
1. Build a backend server
2. Add endpoint to exchange code for token
3. Update extension to call backend

See GITHUB_OAUTH_NOTE.md for details.`;
    
    alert(message);
  } catch (error) {
    console.error('GitHub sign-in error:', error);
    alert('GitHub sign-in error: ' + error.message);
    showStatus('GitHub sign-in requires backend setup. Use email or Google sign-in.', 'error');
  }
}

// Sign in with Email
async function signInWithEmail() {
  try {
    console.log('=== signInWithEmail CALLED ===');
    alert('Email sign-in clicked!');
    showStatus('Opening email sign-in...', 'success');
    
    // Create a simple modal for email input
    const email = prompt('Enter your email address:');
    
    console.log('Email entered:', email ? 'yes' : 'no');
    
    if (!email) {
      // User cancelled
      console.log('User cancelled email input');
      return;
    }
    
    const trimmedEmail = email.trim();
    
    if (!trimmedEmail || !trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      alert('Please enter a valid email address');
      showStatus('Please enter a valid email address', 'error');
      return;
    }
    
    alert('Processing sign-in for: ' + trimmedEmail);
    showStatus('Signing in...', 'success');
    console.log('Processing email sign-in for:', trimmedEmail);
    
    // Simple email-based auth
    const userName = trimmedEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').trim() || 'User';
    const user = {
      email: trimmedEmail,
      name: userName,
      provider: 'email',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=667eea&color=fff`,
      id: trimmedEmail.toLowerCase()
    };
    
    console.log('Saving user to storage...');
    await chrome.storage.local.set({ user });
    console.log('User saved to storage');
    
    // Wait a bit for storage to save
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log('Showing user profile...');
    await showUserProfile(user);
    hideLoginScreen();
    alert('Signed in successfully!');
    showStatus('Signed in successfully!', 'success');
    console.log('Email sign-in complete!');
    
    // Initialize trial if first time
    const result = await chrome.storage.local.get(['subscription']);
    if (!result.subscription) {
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 7);
      await chrome.storage.local.set({
        subscription: {
          plan: 'trial',
          trialStartDate: new Date().toISOString(),
          trialEndDate: trialEndDate.toISOString()
        }
      });
    }
    
    // Refresh the page state
    await checkSessionStatus();
  } catch (error) {
    console.error('Email sign-in error:', error);
    showStatus('Sign-in failed: ' + (error.message || 'Unknown error'), 'error');
  }
}

// Sign out
async function signOut() {
  if (confirm('Are you sure you want to sign out?')) {
    // Revoke Google token if exists
    try {
      const result = await chrome.storage.local.get(['user']);
      if (result.user?.provider === 'google') {
        const token = await chrome.identity.getAuthToken({ interactive: false });
        if (token) {
          await chrome.identity.removeCachedAuthToken({ token });
        }
      }
    } catch (e) {
      console.log('Token revoke error:', e);
    }
    
    await chrome.storage.local.remove(['user']);
    showLoginScreen();
    hideUserProfile();
    showStatus('Signed out', 'success');
  }
}

// Fetch user info from Google
async function fetchUserInfoFromGoogle(token) {
  try {
    // Try v2 API first
    let response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    // If v2 fails, try v3
    if (!response.ok) {
      response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google API error:', response.status, errorText);
      throw new Error(`Failed to fetch user info: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.email) {
      throw new Error('No email returned from Google');
    }
    
    return {
      email: data.email,
      name: data.name || data.email.split('@')[0],
      avatar: data.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name || data.email.split('@')[0])}&background=667eea&color=fff`,
      provider: 'google',
      id: data.id || data.sub || data.email
    };
  } catch (error) {
    console.error('Error fetching user info:', error);
    throw new Error(`Failed to get user information: ${error.message}`);
  }
}

// Initialize trial
async function initializeTrial() {
  const result = await chrome.storage.local.get(['subscription']);
  if (result.subscription) return; // Already initialized
  
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 7);
  
  await chrome.storage.local.set({
    subscription: {
      plan: 'trial',
      trialStartDate: new Date().toISOString(),
      trialEndDate: trialEndDate.toISOString()
    }
  });
}

// Export functions to window for onclick handlers (backup)
// These are defined here at the end to ensure all functions are available
window.signInWithGoogle = signInWithGoogle;
window.signInWithEmail = signInWithEmail;
window.signInWithGitHub = signInWithGitHub;
window.hideGamification = hideGamification;
console.log('Functions exported to window');
