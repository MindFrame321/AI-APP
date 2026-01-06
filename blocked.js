// Get reason from URL params
(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const reason = urlParams.get('reason');
  const task = urlParams.get('task');
  const time = urlParams.get('time');

  const messageEl = document.getElementById('message');
  if (!messageEl) return;

  if (reason === 'always-blocked') {
    messageEl.textContent = 'This domain is on your always-block list.';
  } else if (reason === 'extensions-page-blocked') {
    messageEl.textContent = 'Chrome extensions page is blocked during focus sessions to prevent tampering.';
  } else if (reason === 'settings-blocked') {
    messageEl.textContent = 'Settings access is restricted during active focus sessions.';
  } else if (task) {
    messageEl.textContent = `This page is not relevant to your focus task: "${task}"`;
  } else {
    messageEl.textContent = 'This page is blocked during your focus session.';
  }

  if (time) {
    const timeEl = document.createElement('p');
    timeEl.textContent = `Time remaining: ${time} minutes`;
    timeEl.style.fontSize = '16px';
    timeEl.style.opacity = '0.8';
    messageEl.parentNode.insertBefore(timeEl, messageEl.nextSibling);
  }

  // Wire buttons (no inline handlers)
  const backBtn = document.getElementById('blockedGoBack');
  const endBtn = document.getElementById('blockedEndSession');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.history.back();
    });
  }
  if (endBtn) {
    endBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'endSession' }, () => window.location.reload());
    });
  }
})();
