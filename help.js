/**
 * Focufy - Enhanced Customer Support System
 */

const SUPPORT_EMAIL = 'prithivponns@gmail.com';
const DEFAULT_BACKEND_URL = 'https://focufy-extension-1.onrender.com';

let conversationHistory = [];
let backendUrl = DEFAULT_BACKEND_URL;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupTabs();
  setupEventListeners();
  addWelcomeMessage();
  await loadTickets();
});

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['settings']);
    if (result.settings?.backendUrl) {
      backendUrl = result.settings.backendUrl;
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      
      // Update active states
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(`${targetTab}Tab`).classList.add('active');

      // Load tickets when tickets tab is opened
      if (targetTab === 'tickets') {
        loadTickets();
      }
    });
  });
}

function setupEventListeners() {
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
  
  document.getElementById('emailSupport').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Focufy Support Request`;
  });

  document.getElementById('ticketForm').addEventListener('submit', submitTicket);
}

function addWelcomeMessage() {
  addBotMessage("Hi! I'm Focufy's AI assistant. How can I help you today? Ask me anything about using Focufy, troubleshooting, or features!");
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  // Add user message
  addUserMessage(message);
  conversationHistory.push({ role: 'user', content: message });
  input.value = '';
  
  // Show typing indicator
  const typingId = addTypingIndicator();
  
  try {
    // Get user auth token (optional - we'll use direct API if not available)
    const result = await chrome.storage.local.get(['authToken', 'user', 'settings']);

    // Try backend first, fallback to direct API
    let aiResponse = null;
    let needsHumanHelp = false;

    // Try backend API if user is signed in
    if (result.authToken && result.user) {
      try {
        const response = await fetch(`${backendUrl}/api/support/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${result.authToken}`
          },
          body: JSON.stringify({
            message,
            conversationHistory: conversationHistory.slice(-10) // Last 10 messages
          })
        });

        if (response.ok) {
          const data = await response.json();
          aiResponse = data.response;
          needsHumanHelp = data.needsHumanHelp || false;
        } else {
          console.warn('Backend API failed, trying direct API...');
          throw new Error('Backend unavailable');
        }
      } catch (backendError) {
        console.warn('Backend error, using direct API fallback:', backendError);
        // Fall through to direct API
      }
    }

    // Fallback to direct Gemini API
    if (!aiResponse) {
      const apiKey = result.settings?.apiKey || 'AIzaSyDtmZYEgp9XwqIO4VgCE8J2QH7IIE_gJt4';
      
      if (!apiKey) {
        throw new Error('No API key available');
      }

      const historyContext = conversationHistory
        .slice(-5)
        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n');

      const prompt = `You are Focufy's customer support AI assistant. Focufy is a Chrome extension that helps users stay focused by blocking distracting elements on websites using AI.

${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}User Question: "${message}"

Answer the question helpfully and concisely. If the question is too complex or requires human assistance, suggest creating a support ticket.

Common topics:
- How to use Focufy
- Setting up focus sessions
- YouTube blocking
- Premium features
- Troubleshooting
- Trial and subscriptions
- API key issues
- Backend configuration

Keep responses under 200 words. Be friendly and helpful.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 
        "I'm having trouble right now. Please create a support ticket for assistance.";
      
      needsHumanHelp = aiResponse.toLowerCase().includes('support ticket') ||
                      aiResponse.toLowerCase().includes('create a ticket') ||
                      aiResponse.toLowerCase().includes('contact support');
    }
    
    // Remove typing indicator
    removeTypingIndicator(typingId);
    
    // Add bot response
    addBotMessage(aiResponse.trim());
    conversationHistory.push({ role: 'assistant', content: aiResponse.trim() });
    
    // If AI suggests creating a ticket, show ticket tab
    if (needsHumanHelp) {
      setTimeout(() => {
        addBotMessage("💡 You can create a support ticket using the 'Create Ticket' tab above for faster assistance!");
      }, 2000);
    }
  } catch (error) {
    removeTypingIndicator(typingId);
    addBotMessage("I'm having trouble right now. Please create a support ticket or email " + SUPPORT_EMAIL + " for immediate assistance.");
    console.error('Chat error:', error);
  }
}

async function submitTicket(e) {
  e.preventDefault();
  
  const category = document.getElementById('ticketCategory').value;
  const subject = document.getElementById('ticketSubject').value.trim();
  const message = document.getElementById('ticketMessage').value.trim();
  const statusDiv = document.getElementById('ticketStatus');

  // Get user auth token
  const result = await chrome.storage.local.get(['authToken', 'user']);
  if (!result.authToken || !result.user) {
    statusDiv.className = 'ticket-status error';
    statusDiv.textContent = 'Please sign in with Google to create a support ticket.';
    statusDiv.classList.remove('hidden');
    return;
  }

  statusDiv.className = 'ticket-status loading';
  statusDiv.textContent = 'Submitting ticket...';
  statusDiv.classList.remove('hidden');

  try {
    const response = await fetch(`${backendUrl}/api/support/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${result.authToken}`
      },
      body: JSON.stringify({
        category,
        subject,
        message
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create ticket');
    }

    const data = await response.json();
    
    statusDiv.className = 'ticket-status success';
    statusDiv.innerHTML = `✅ Ticket created successfully!<br>Ticket ID: <strong>${data.ticket.ticketId}</strong><br>We'll respond within 24 hours.`;
    
    // Reset form
    document.getElementById('ticketForm').reset();
    
    // Switch to tickets tab after 2 seconds
    setTimeout(() => {
      document.querySelector('[data-tab="tickets"]').click();
      loadTickets();
    }, 2000);
  } catch (error) {
    statusDiv.className = 'ticket-status error';
    statusDiv.textContent = 'Failed to create ticket: ' + error.message;
    console.error('Ticket submission error:', error);
  }
}

async function loadTickets() {
  const ticketsList = document.getElementById('ticketsList');
  ticketsList.innerHTML = '<p class="loading-text">Loading your tickets...</p>';

  try {
    const result = await chrome.storage.local.get(['authToken', 'user']);
    if (!result.authToken || !result.user) {
      ticketsList.innerHTML = '<p class="no-tickets">Please sign in with Google to view your support tickets.</p>';
      return;
    }

    const response = await fetch(`${backendUrl}/api/support/tickets`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${result.authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load tickets');
    }

    const data = await response.json();
    
    if (data.tickets.length === 0) {
      ticketsList.innerHTML = '<p class="no-tickets">You don\'t have any support tickets yet. Create one using the "Create Ticket" tab!</p>';
      return;
    }

    ticketsList.innerHTML = data.tickets.map(ticket => `
      <div class="ticket-card" onclick="viewTicketDetails('${ticket.ticketId}')" style="cursor: pointer;">
        <div class="ticket-header">
          <div class="ticket-id">${ticket.ticketId}</div>
          <span class="ticket-status-badge status-${ticket.status}">${ticket.status.toUpperCase()}</span>
        </div>
        <div class="ticket-subject">${ticket.subject}</div>
        <div class="ticket-meta">
          <span class="ticket-category">${ticket.category}</span>
          <span class="ticket-date">${new Date(ticket.createdAt).toLocaleDateString()}</span>
          ${ticket.hasResponse ? '<span class="ticket-response-badge">💬 Has Response</span>' : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    ticketsList.innerHTML = '<p class="error-text">Failed to load tickets. Please try again later.</p>';
    console.error('Load tickets error:', error);
  }
}

function addUserMessage(text) {
  const messages = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user';
  messageDiv.textContent = text;
  messages.appendChild(messageDiv);
  messages.scrollTop = messages.scrollHeight;
}

function addBotMessage(text) {
  const messages = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message bot';
  messageDiv.textContent = text;
  messages.appendChild(messageDiv);
  messages.scrollTop = messages.scrollHeight;
}

function addTypingIndicator() {
  const messages = document.getElementById('chatMessages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message bot typing';
  typingDiv.id = 'typing-indicator';
  typingDiv.textContent = 'Typing...';
  messages.appendChild(typingDiv);
  messages.scrollTop = messages.scrollHeight;
  return 'typing-indicator';
}

function removeTypingIndicator(id) {
  const typing = document.getElementById(id);
  if (typing) typing.remove();
}
