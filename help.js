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
      <div class="ticket-card" data-ticket-id="${ticket.ticketId}" style="cursor: pointer;">
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
    
    // Add click event listeners to all ticket cards
    ticketsList.querySelectorAll('.ticket-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const ticketId = card.getAttribute('data-ticket-id');
        if (ticketId) {
          viewTicketDetails(ticketId);
        }
      });
    });
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

// View full ticket details including responses
async function viewTicketDetails(ticketId) {
  console.log('Viewing ticket details for:', ticketId);
  try {
    const result = await chrome.storage.local.get(['authToken', 'user']);
    if (!result.authToken || !result.user) {
      alert('Please sign in with Google to view ticket details.');
      return;
    }

    console.log('Fetching ticket from:', `${backendUrl}/api/support/tickets/${ticketId}`);
    const response = await fetch(`${backendUrl}/api/support/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${result.authToken}`
      }
    });

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('Failed to parse response:', parseError);
      const text = await response.text();
      console.error('Response text:', text);
      throw new Error('Invalid response from server. The server may have restarted and lost ticket data.');
    }
    
    if (!response.ok) {
      const errorMessage = data.error || 'Failed to load ticket details';
      console.error('Ticket fetch error:', response.status, errorMessage);
      
      if (response.status === 404) {
        throw new Error('Ticket not found. The server may have restarted. Please create a new ticket if needed.');
      }
      
      throw new Error(errorMessage);
    }

    if (!data.ticket) {
      console.error('Response data:', data);
      throw new Error('Ticket data not found in response');
    }

    const ticket = data.ticket;
    console.log('Ticket loaded successfully:', ticket.ticketId);

    // Create modal to show ticket details
    showTicketModal(ticket);
  } catch (error) {
    console.error('View ticket error:', error);
    alert('Failed to load ticket details: ' + error.message);
  }
}

// Show ticket details in a modal
function showTicketModal(ticket) {
  console.log('Showing ticket modal for:', ticket.ticketId);
  // Remove existing modal if any
  const existingModal = document.getElementById('ticketModal');
  if (existingModal) {
    existingModal.remove();
  }

  // Escape HTML to prevent XSS
  const escapeHtml = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };
  
  const modal = document.createElement('div');
  modal.id = 'ticketModal';
  modal.className = 'ticket-modal';
  modal.innerHTML = `
    <div class="ticket-modal-content">
      <div class="ticket-modal-header">
        <h2>Ticket Details</h2>
        <button class="ticket-modal-close" id="modalCloseBtn">×</button>
      </div>
      <div class="ticket-modal-body">
        <div class="ticket-detail-section">
          <div class="ticket-detail-row">
            <strong>Ticket ID:</strong> <span class="ticket-id-text">${escapeHtml(ticket.ticketId)}</span>
          </div>
          <div class="ticket-detail-row">
            <strong>Status:</strong> <span class="ticket-status-badge status-${ticket.status}">${ticket.status.toUpperCase()}</span>
          </div>
          <div class="ticket-detail-row">
            <strong>Category:</strong> ${escapeHtml(ticket.category)}
          </div>
          <div class="ticket-detail-row">
            <strong>Created:</strong> ${new Date(ticket.createdAt).toLocaleString()}
          </div>
          <div class="ticket-detail-row">
            <strong>Last Updated:</strong> ${new Date(ticket.updatedAt).toLocaleString()}
          </div>
        </div>

        <div class="ticket-detail-section">
          <h3>Your Message</h3>
          <div class="ticket-message-box">${escapeHtml(ticket.message).replace(/\n/g, '<br>')}</div>
        </div>

        ${ticket.responses && ticket.responses.length > 0 ? `
          <div class="ticket-detail-section">
            <h3>Conversation (${ticket.responses.length})</h3>
            ${ticket.responses.map((response, idx) => `
              <div class="ticket-response-box ${response.respondedBy === 'User' ? 'user-response' : 'admin-response'}">
                <div class="response-header">
                  <strong>${response.respondedBy === 'User' ? 'You' : 'Admin'} ${response.respondedBy === 'Admin' ? `Response #${idx + 1}` : ''}</strong>
                  <span class="response-date">${new Date(response.respondedAt).toLocaleString()}</span>
                </div>
                <div class="response-message">${escapeHtml(response.message).replace(/\n/g, '<br>')}</div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="ticket-detail-section">
            <p class="no-response-text">No responses yet. We'll get back to you soon!</p>
          </div>
        `}
        
        <div class="ticket-detail-section">
          <h3>Add Reply</h3>
          <textarea id="userReplyText" class="user-reply-textarea" placeholder="Type your reply here..." rows="4"></textarea>
          <div class="user-reply-actions">
            <button class="btn-primary" id="submitReplyBtn">Send Reply</button>
            <div id="replyStatus" class="reply-status"></div>
          </div>
        </div>
      </div>
      <div class="ticket-modal-footer">
        <button class="btn-primary" id="modalCloseBtnFooter">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  // Add event listeners for close buttons
  const closeBtn = modal.querySelector('#modalCloseBtn');
  const closeBtnFooter = modal.querySelector('#modalCloseBtnFooter');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTicketModal();
    });
  }
  
  if (closeBtnFooter) {
    closeBtnFooter.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTicketModal();
    });
  }
  
  // Prevent modal content clicks from closing the modal
  const modalContent = modal.querySelector('.ticket-modal-content');
  if (modalContent) {
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
  
  // Close on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeTicketModal();
    }
  });
  
  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeTicketModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
  
  // Add reply functionality
  const submitReplyBtn = modal.querySelector('#submitReplyBtn');
  const replyTextarea = modal.querySelector('#userReplyText');
  const replyStatus = modal.querySelector('#replyStatus');
  
  if (submitReplyBtn && replyTextarea) {
    submitReplyBtn.addEventListener('click', async () => {
      const message = replyTextarea.value.trim();
      if (!message) {
        replyStatus.className = 'reply-status error';
        replyStatus.textContent = 'Please enter a reply message.';
        return;
      }
      
      replyStatus.className = 'reply-status';
      replyStatus.textContent = 'Sending...';
      submitReplyBtn.disabled = true;
      
      try {
        const result = await chrome.storage.local.get(['authToken', 'user']);
        if (!result.authToken || !result.user) {
          throw new Error('Please sign in with Google to reply to tickets.');
        }
        
        const response = await fetch(`${backendUrl}/api/support/tickets/${ticket.ticketId}/reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${result.authToken}`
          },
          body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          replyStatus.className = 'reply-status success';
          replyStatus.textContent = '✅ Reply sent successfully!';
          replyTextarea.value = '';
          
          // Reload ticket to show new reply
          setTimeout(() => {
            viewTicketDetails(ticket.ticketId);
          }, 1000);
        } else {
          throw new Error(data.error || 'Failed to send reply');
        }
      } catch (error) {
        replyStatus.className = 'reply-status error';
        replyStatus.textContent = '❌ Error: ' + error.message;
        console.error('Reply error:', error);
      } finally {
        submitReplyBtn.disabled = false;
      }
    });
  }
}

// Close ticket modal
function closeTicketModal() {
  console.log('Closing ticket modal');
  const modal = document.getElementById('ticketModal');
  if (modal) {
    modal.remove();
    console.log('Modal removed');
  } else {
    console.warn('Modal not found');
  }
}

// Make functions global
window.viewTicketDetails = viewTicketDetails;
window.closeTicketModal = closeTicketModal;
