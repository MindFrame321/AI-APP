/**
 * Focufy - Gamification Page
 */

// Achievement definitions (same as gamification.js)
const ACHIEVEMENTS = {
  FIRST_SESSION: {
    id: 'first_session',
    name: 'Getting Started',
    description: 'Complete your first focus session',
    icon: '🎯',
    points: 10
  },
  STREAK_3: {
    id: 'streak_3',
    name: 'On Fire',
    description: 'Maintain a 3-day focus streak',
    icon: '🔥',
    points: 25
  },
  STREAK_7: {
    id: 'streak_7',
    name: 'Week Warrior',
    description: 'Maintain a 7-day focus streak',
    icon: '⚡',
    points: 50
  },
  STREAK_30: {
    id: 'streak_30',
    name: 'Focus Master',
    description: 'Maintain a 30-day focus streak',
    icon: '👑',
    points: 200
  },
  HOUR_10: {
    id: 'hour_10',
    name: 'Dedicated',
    description: 'Complete 10 hours of focused work',
    icon: '⏰',
    points: 50
  },
  HOUR_50: {
    id: 'hour_50',
    name: 'Time Master',
    description: 'Complete 50 hours of focused work',
    icon: '🏆',
    points: 150
  },
  HOUR_100: {
    id: 'hour_100',
    name: 'Centurion',
    description: 'Complete 100 hours of focused work',
    icon: '💎',
    points: 300
  },
  BLOCK_100: {
    id: 'block_100',
    name: 'Distraction Destroyer',
    description: 'Block 100 distractions',
    icon: '🛡️',
    points: 75
  },
  BLOCK_1000: {
    id: 'block_1000',
    name: 'Focus Guardian',
    description: 'Block 1,000 distractions',
    icon: '🦾',
    points: 250
  },
  DAILY_CHALLENGE: {
    id: 'daily_challenge',
    name: 'Challenge Accepted',
    description: 'Complete a daily challenge',
    icon: '🎮',
    points: 30
  },
  PERFECT_WEEK: {
    id: 'perfect_week',
    name: 'Perfect Week',
    description: 'Complete a session every day for a week',
    icon: '⭐',
    points: 100
  }
};

// Daily challenges
const DAILY_CHALLENGES = [
  {
    id: 'focus_2_hours',
    name: '2-Hour Focus',
    description: 'Complete 2 hours of focused work today',
    target: 120,
    points: 50,
    icon: '⏱️'
  },
  {
    id: 'block_10',
    name: 'Block 10 Distractions',
    description: 'Block 10 distracting elements today',
    target: 10,
    points: 30,
    icon: '🚫'
  },
  {
    id: 'complete_3_sessions',
    name: 'Triple Session',
    description: 'Complete 3 focus sessions today',
    target: 3,
    points: 40,
    icon: '🎯'
  },
  {
    id: 'long_session',
    name: 'Deep Work',
    description: 'Complete a 60+ minute session',
    target: 60,
    points: 35,
    icon: '🧠'
  }
];

document.addEventListener('DOMContentLoaded', async () => {
  await loadGamification();
});

async function loadGamification() {
  try {
    const result = await chrome.storage.local.get(['analytics', 'sessions', 'achievements', 'points', 'dailyChallenge']);
    const analytics = result.analytics || {};
    const sessions = result.sessions || [];
    const achievements = result.achievements || [];
    const points = result.points || 0;
    
    // Update level
    const level = getUserLevel(points);
    document.getElementById('levelBadge').textContent = `Level ${level.level}`;
    document.getElementById('levelName').textContent = level.name;
    
    const progressPercent = level.nextLevel === Infinity ? 100 : (points / level.nextLevel) * 100;
    document.getElementById('levelProgress').style.width = `${progressPercent}%`;
    document.getElementById('currentPoints').textContent = points;
    document.getElementById('nextLevelPoints').textContent = level.nextLevel === Infinity ? '∞' : level.nextLevel;
    
    // Update stats
    document.getElementById('totalPoints').textContent = points;
    document.getElementById('totalAchievements').textContent = achievements.length;
    document.getElementById('currentStreak').textContent = analytics.focusStreak || 0;
    
    // Load daily challenge
    await loadDailyChallenge(analytics, sessions);
    
    // Load achievements
    loadAchievements(achievements);
    
    // Load recent achievements
    loadRecentAchievements(achievements);
  } catch (error) {
    console.error('Error loading gamification:', error);
  }
}

function getUserLevel(points) {
  if (points < 100) return { level: 1, name: 'Beginner', nextLevel: 100 };
  if (points < 300) return { level: 2, name: 'Focused', nextLevel: 300 };
  if (points < 600) return { level: 3, name: 'Dedicated', nextLevel: 600 };
  if (points < 1000) return { level: 4, name: 'Expert', nextLevel: 1000 };
  if (points < 2000) return { level: 5, name: 'Master', nextLevel: 2000 };
  return { level: 6, name: 'Legend', nextLevel: Infinity };
}

async function loadDailyChallenge(analytics, sessions) {
  const stored = await chrome.storage.local.get(['dailyChallenge']);
  let challenge = stored.dailyChallenge;
  
  const today = new Date().toDateString();
  if (!challenge || challenge.date !== today) {
    // New challenge for today
    challenge = {
      ...DAILY_CHALLENGES[Math.floor(Math.random() * DAILY_CHALLENGES.length)],
      date: today,
      progress: 0,
      completed: false
    };
    await chrome.storage.local.set({ dailyChallenge: challenge });
  }
  
  // Calculate progress
  let progress = 0;
  const todaySessions = sessions.filter(s => {
    return new Date(s.startTime).toDateString() === today;
  });
  
  switch (challenge.id) {
    case 'focus_2_hours':
      progress = todaySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
      break;
    case 'block_10':
      progress = analytics.todayBlocks || 0;
      break;
    case 'complete_3_sessions':
      progress = todaySessions.length;
      break;
    case 'long_session':
      progress = todaySessions.some(s => (s.durationMinutes || 0) >= 60) ? 1 : 0;
      break;
  }
  
  challenge.progress = progress;
  const progressPercent = Math.min(100, (progress / challenge.target) * 100);
  
  document.getElementById('challengeIcon').textContent = challenge.icon;
  document.getElementById('challengeName').textContent = challenge.name;
  document.getElementById('challengeDesc').textContent = challenge.description;
  document.getElementById('challengeProgress').style.width = `${progressPercent}%`;
  document.getElementById('challengeProgressText').textContent = `${progress} / ${challenge.target}`;
  document.getElementById('challengePoints').textContent = challenge.points;
  
  if (challenge.completed) {
    document.getElementById('dailyChallenge').style.background = 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)';
    document.getElementById('dailyChallenge').style.borderColor = '#10b981';
  }
}

function loadAchievements(earnedAchievements) {
  const grid = document.getElementById('achievementsGrid');
  grid.innerHTML = '';
  
  Object.values(ACHIEVEMENTS).forEach(achievement => {
    const earned = earnedAchievements.includes(achievement.id);
    const item = document.createElement('div');
    item.className = `achievement-item ${earned ? 'earned' : 'locked'}`;
    item.innerHTML = `
      <div class="achievement-icon">${achievement.icon}</div>
      <div class="achievement-name">${achievement.name}</div>
      <div class="achievement-description">${achievement.description}</div>
      <div class="achievement-points">${achievement.points} pts</div>
    `;
    grid.appendChild(item);
  });
}

function loadRecentAchievements(earnedAchievements) {
  const list = document.getElementById('recentAchievements');
  list.innerHTML = '';
  
  if (earnedAchievements.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">No achievements unlocked yet. Keep focusing!</p>';
    return;
  }
  
  // Show last 5 achievements
  const recent = earnedAchievements.slice(-5).reverse();
  
  recent.forEach(achievementId => {
    const achievement = Object.values(ACHIEVEMENTS).find(a => a.id === achievementId);
    if (!achievement) return;
    
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `
      <div class="recent-icon">${achievement.icon}</div>
      <div class="recent-content">
        <div class="recent-name">${achievement.name}</div>
        <div class="recent-time">Unlocked</div>
      </div>
      <div class="recent-points">+${achievement.points}</div>
    `;
    list.appendChild(item);
  });
}

