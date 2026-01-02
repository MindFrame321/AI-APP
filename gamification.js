/**
 * Focufy - Gamification System
 * Tracks achievements, badges, streaks, and challenges
 */

// Achievement definitions
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
  },
  EARLY_BIRD: {
    id: 'early_bird',
    name: 'Early Bird',
    description: 'Start a session before 6 AM',
    icon: '🌅',
    points: 40
  },
  NIGHT_OWL: {
    id: 'night_owl',
    name: 'Night Owl',
    description: 'Start a session after 10 PM',
    icon: '🦉',
    points: 40
  }
};

// Daily challenges
const DAILY_CHALLENGES = [
  {
    id: 'focus_2_hours',
    name: '2-Hour Focus',
    description: 'Complete 2 hours of focused work today',
    target: 120, // minutes
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

// Get random daily challenge
function getDailyChallenge() {
  const today = new Date().toDateString();
  const stored = localStorage.getItem('dailyChallenge');
  
  if (stored) {
    const challenge = JSON.parse(stored);
    if (challenge.date === today) {
      return challenge;
    }
  }
  
  // New challenge for today
  const challenge = {
    ...DAILY_CHALLENGES[Math.floor(Math.random() * DAILY_CHALLENGES.length)],
    date: today,
    progress: 0,
    completed: false
  };
  
  localStorage.setItem('dailyChallenge', JSON.stringify(challenge));
  return challenge;
}

// Check and award achievements
async function checkAchievements(analytics, sessions) {
  const result = await chrome.storage.local.get(['achievements', 'points']);
  const earnedAchievements = result.achievements || [];
  const totalPoints = result.points || 0;
  const newAchievements = [];
  
  // Check each achievement
  for (const [key, achievement] of Object.entries(ACHIEVEMENTS)) {
    // Skip if already earned
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
        earned = (analytics.totalFocusTime || 0) >= 600; // 10 hours in minutes
        break;
      case 'hour_50':
        earned = (analytics.totalFocusTime || 0) >= 3000; // 50 hours
        break;
      case 'hour_100':
        earned = (analytics.totalFocusTime || 0) >= 6000; // 100 hours
        break;
      case 'block_100':
        earned = (analytics.distractionsBlocked || 0) >= 100;
        break;
      case 'block_1000':
        earned = (analytics.distractionsBlocked || 0) >= 1000;
        break;
      case 'perfect_week':
        // Check if completed session every day for 7 days
        const last7Days = getLast7Days();
        const daysWithSessions = last7Days.filter(date => {
          return sessions.some(s => {
            const sessionDate = new Date(s.startTime).toDateString();
            return sessionDate === date.toDateString();
          });
        });
        earned = daysWithSessions.length === 7;
        break;
    }
    
    if (earned) {
      earnedAchievements.push(achievement.id);
      newAchievements.push(achievement);
      totalPoints += achievement.points;
    }
  }
  
  // Check daily challenge
  const challenge = getDailyChallenge();
  if (!challenge.completed) {
    let challengeProgress = 0;
    
    switch (challenge.id) {
      case 'focus_2_hours':
        challengeProgress = getTodayFocusTime(sessions);
        break;
      case 'block_10':
        challengeProgress = getTodayBlocks(analytics);
        break;
      case 'complete_3_sessions':
        challengeProgress = getTodaySessionCount(sessions);
        break;
      case 'long_session':
        challengeProgress = hasLongSessionToday(sessions);
        break;
    }
    
    challenge.progress = challengeProgress;
    
    if (challengeProgress >= challenge.target) {
      challenge.completed = true;
      if (!earnedAchievements.includes('daily_challenge')) {
        earnedAchievements.push('daily_challenge');
        newAchievements.push(ACHIEVEMENTS.DAILY_CHALLENGE);
        totalPoints += ACHIEVEMENTS.DAILY_CHALLENGE.points;
      }
    }
    
    localStorage.setItem('dailyChallenge', JSON.stringify(challenge));
  }
  
  // Save achievements
  await chrome.storage.local.set({
    achievements: earnedAchievements,
    points: totalPoints,
    dailyChallenge: challenge
  });
  
  return { newAchievements, totalPoints, challenge };
}

// Helper functions
function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date);
  }
  return days;
}

function getTodayFocusTime(sessions) {
  const today = new Date().toDateString();
  return sessions
    .filter(s => new Date(s.startTime).toDateString() === today)
    .reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
}

function getTodayBlocks(analytics) {
  // This would need to track daily blocks separately
  // For now, return 0 and track in analytics
  return analytics.todayBlocks || 0;
}

function getTodaySessionCount(sessions) {
  const today = new Date().toDateString();
  return sessions.filter(s => 
    new Date(s.startTime).toDateString() === today
  ).length;
}

function hasLongSessionToday(sessions) {
  const today = new Date().toDateString();
  return sessions.some(s => {
    const sessionDate = new Date(s.startTime).toDateString();
    return sessionDate === today && (s.durationMinutes || 0) >= 60;
  }) ? 1 : 0;
}

// Get user level based on points
function getUserLevel(points) {
  if (points < 100) return { level: 1, name: 'Beginner', nextLevel: 100 };
  if (points < 300) return { level: 2, name: 'Focused', nextLevel: 300 };
  if (points < 600) return { level: 3, name: 'Dedicated', nextLevel: 600 };
  if (points < 1000) return { level: 4, name: 'Expert', nextLevel: 1000 };
  if (points < 2000) return { level: 5, name: 'Master', nextLevel: 2000 };
  return { level: 6, name: 'Legend', nextLevel: Infinity };
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ACHIEVEMENTS,
    checkAchievements,
    getDailyChallenge,
    getUserLevel
  };
}

