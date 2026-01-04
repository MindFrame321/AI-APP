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
    const result = await chrome.storage.local.get(['analytics', 'sessions', 'learningFeed']);
    const analytics = result.analytics || {
      totalFocusTime: 0,
      distractionsBlocked: 0,
      focusStreak: 0,
      lastSessionDate: null,
      blockedSites: {},
      dailyFocus: {}
    };
    
    const sessions = result.sessions || [];
    const learningFeed = result.learningFeed || [];
    
    // Update stats
    updateStats(analytics, sessions);
    updateCharts(analytics, sessions);
    updateSessionList(sessions);
    renderLearningFeed(learningFeed);
    renderReflectionFeed(sessions);
    renderInsights(sessions, analytics);
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
    const result = await chrome.storage.local.get(['analytics', 'sessions', 'learningFeed']);
    const data = {
      analytics: result.analytics,
      sessions: result.sessions,
      learningFeed: result.learningFeed,
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
  const headers = ['Date', 'Task', 'Duration (minutes)', 'Start Time', 'End Time', 'Energy', 'Smoothness', 'Tab Switches', 'Blocked Attempts', 'Idle Seconds'];
  const rows = sessions.map(s => [
    new Date(s.startTime).toLocaleDateString(),
    `"${(s.taskDescription || '').replace(/"/g, '""')}"`,
    s.durationMinutes || 0,
    new Date(s.startTime).toISOString(),
    s.endTime ? new Date(s.endTime).toISOString() : '',
    s.energyTag || '',
    s.smoothness ?? '',
    s.metrics?.tabSwitches ?? '',
    s.metrics?.blockedAttempts ?? '',
    s.metrics?.idleSeconds ?? ''
  ]);
  
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

function renderLearningFeed(feed) {
  const list = document.getElementById('learningFeed');
  if (!list) return;
  list.innerHTML = '';
  if (!feed || feed.length === 0) {
    list.innerHTML = '<p class="help-text">No activity yet.</p>';
    return;
  }
  feed.slice(-30).reverse().forEach(item => {
    const div = document.createElement('div');
    div.className = 'feed-item';
    const ts = item.ts ? new Date(item.ts).toLocaleString() : '';
    if (item.type === 'page') {
      div.innerHTML = `<strong>Page:</strong> ${item.title || item.url || ''}<div style="font-size:12px;color:#6b7280;">${ts}</div>`;
    } else if (item.type === 'session') {
      div.innerHTML = `<strong>Session:</strong> ${item.goal || ''} <span style="color:#64748b;">(smoothness ${item.smoothness ?? '--'})</span><div style="font-size:12px;color:#6b7280;">${ts}</div>`;
    } else if (item.type === 'reflection') {
      div.innerHTML = `<strong>Reflection:</strong> ${item.text || ''}<div style="font-size:12px;color:#6b7280;">${ts}</div>`;
    } else if (item.type === 'contract') {
      div.innerHTML = `<strong>Contract:</strong> ${item.text || ''}<div style="font-size:12px;color:#6b7280;">${ts}</div>`;
    } else {
      div.textContent = JSON.stringify(item);
    }
    list.appendChild(div);
  });
}

function renderReflectionFeed(sessions) {
  const list = document.getElementById('reflectionFeed');
  if (!list) return;
  list.innerHTML = '';
  const withReflections = sessions.filter(s => s.reflection);
  if (withReflections.length === 0) {
    list.innerHTML = '<p class="help-text">Reflections will appear here after sessions.</p>';
    return;
  }
  withReflections.slice(-10).reverse().forEach(s => {
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.innerHTML = `<div style="font-weight:600;">"${s.taskDescription || ''}"</div><div style="font-size:13px;color:#334155;margin:4px 0;">${s.reflection}</div><div style="font-size:12px;color:#6b7280;">${new Date(s.endTime || s.startTime).toLocaleString()}</div>`;
    list.appendChild(div);
  });
}

function renderInsights(sessions, analytics) {
  const list = document.getElementById('insightsList');
  if (!list) return;
  list.innerHTML = '';
  const insights = [];
  if (sessions.length > 2) {
    const mornings = sessions.filter(s => new Date(s.startTime).getHours() < 12).length;
    const evens = sessions.filter(s => new Date(s.startTime).getHours() >= 17).length;
    insights.push(`You start ${mornings >= evens ? 'more' : 'fewer'} sessions in the morning than evening. Try scheduling focus when you’re freshest.`);
  }
  const lowSmooth = sessions.filter(s => (s.smoothness ?? 100) < 50).length;
  if (lowSmooth > 0) {
    insights.push(`Some sessions had low smoothness (<50). Consider reducing tab switches or blocked attempts.`);
  }
  if ((analytics.totalFocusTime || 0) > 0) {
    const hours = Math.round((analytics.totalFocusTime / 60) * 10) / 10;
    insights.push(`Total focus logged: ${hours}h. Keep the streak going!`);
  }
  if (insights.length === 0) {
    insights.push('Not enough data yet. Complete a few sessions to see insights.');
  }
  insights.forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    list.appendChild(li);
  });
}
