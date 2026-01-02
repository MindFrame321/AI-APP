/**
 * Focufy - Analytics Dashboard
 */

let focusTimeChart, blockedSitesChart;

document.addEventListener('DOMContentLoaded', async () => {
  await loadAnalytics();
  setupCharts();
  setupEventListeners();
});

async function loadAnalytics() {
  try {
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
    
    // Update stats
    updateStats(analytics, sessions);
    updateCharts(analytics, sessions);
    updateSessionList(sessions);
  } catch (error) {
    console.error('Error loading analytics:', error);
  }
}

function updateStats(analytics, sessions) {
  // Total focus time
  const totalMinutes = analytics.totalFocusTime || 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  document.getElementById('totalFocusTime').textContent = `${hours}h ${minutes}m`;
  
  // Distractions blocked
  document.getElementById('distractionsBlocked').textContent = analytics.distractionsBlocked || 0;
  
  // Focus streak
  document.getElementById('focusStreak').textContent = `${analytics.focusStreak || 0} days`;
  
  // Productivity score (0-100)
  const score = calculateProductivityScore(analytics, sessions);
  document.getElementById('productivityScore').textContent = score;
}

function calculateProductivityScore(analytics, sessions) {
  if (sessions.length === 0) return 0;
  
  // Base score from focus time
  const avgSessionLength = analytics.totalFocusTime / Math.max(sessions.length, 1);
  const timeScore = Math.min(avgSessionLength / 60 * 20, 40); // Max 40 points
  
  // Streak bonus
  const streakScore = Math.min(analytics.focusStreak * 2, 30); // Max 30 points
  
  // Consistency bonus
  const consistencyScore = Math.min(sessions.length * 2, 30); // Max 30 points
  
  return Math.round(timeScore + streakScore + consistencyScore);
}

function setupCharts() {
  // Focus time chart
  const focusCtx = document.getElementById('focusTimeChart').getContext('2d');
  focusTimeChart = new Chart(focusCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Focus Time (minutes)',
        data: [],
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });
  
  // Blocked sites chart
  const blockedCtx = document.getElementById('blockedSitesChart').getContext('2d');
  blockedSitesChart = new Chart(blockedCtx, {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [
          '#667eea',
          '#764ba2',
          '#f093fb',
          '#4facfe',
          '#43e97b'
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true
    }
  });
}

function updateCharts(analytics, sessions) {
  // Update focus time chart (last 7 days)
  const last7Days = getLast7Days();
  const dailyData = last7Days.map(date => {
    const daySessions = sessions.filter(s => {
      const sessionDate = new Date(s.startTime).toDateString();
      return sessionDate === date.toDateString();
    });
    return daySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  });
  
  focusTimeChart.data.labels = last7Days.map(d => d.toLocaleDateString('en-US', { weekday: 'short' }));
  focusTimeChart.data.datasets[0].data = dailyData;
  focusTimeChart.update();
  
  // Update blocked sites chart
  const blockedSites = analytics.blockedSites || {};
  const topSites = Object.entries(blockedSites)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  blockedSitesChart.data.labels = topSites.map(([site]) => site);
  blockedSitesChart.data.datasets[0].data = topSites.map(([, count]) => count);
  blockedSitesChart.update();
}

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date);
  }
  return days;
}

function updateSessionList(sessions) {
  const list = document.getElementById('sessionList');
  list.innerHTML = '';
  
  const recentSessions = sessions
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 10);
  
  if (recentSessions.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">No sessions yet. Start your first focus session!</p>';
    return;
  }
  
  recentSessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item';
    
    const duration = session.durationMinutes || 0;
    const date = new Date(session.startTime).toLocaleDateString();
    
    item.innerHTML = `
      <div class="session-info">
        <div class="session-task">"${session.taskDescription}"</div>
        <div class="session-meta">${date}</div>
      </div>
      <div class="session-duration">${duration}m</div>
    `;
    
    list.appendChild(item);
  });
}

function setupEventListeners() {
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('backBtn').addEventListener('click', () => {
    window.close();
  });
}

async function exportData() {
  try {
    const result = await chrome.storage.local.get(['analytics', 'sessions']);
    const data = {
      analytics: result.analytics,
      sessions: result.sessions,
      exportDate: new Date().toISOString()
    };
    
    const csv = convertToCSV(data.sessions || []);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focufy-analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting data:', error);
    alert('Error exporting data. Please try again.');
  }
}

function convertToCSV(sessions) {
  const headers = ['Date', 'Task', 'Duration (minutes)', 'Start Time', 'End Time'];
  const rows = sessions.map(s => [
    new Date(s.startTime).toLocaleDateString(),
    s.taskDescription,
    s.durationMinutes || 0,
    new Date(s.startTime).toISOString(),
    new Date(s.endTime || s.startTime).toISOString()
  ]);
  
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

