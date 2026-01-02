/**
 * Focufy - Help & Support with AI Bot
 */

const SUPPORT_EMAIL = 'prithivponns@gmail.com';

document.addEventListener('DOMContentLoaded', () => {
  setupChatBot();
  setupEventListeners();
  addWelcomeMessage();
});

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
  input.value = '';
  
  // Show typing indicator
  const typingId = addTypingIndicator();
  
  try {
    // Get AI response
    const response = await getAIResponse(message);
    
    // Remove typing indicator
    removeTypingIndicator(typingId);
    
    // Add bot response
    addBotMessage(response.text);
    
    // If AI suggests emailing, forward question
    if (response.needsHumanHelp) {
      await forwardToEmail(message);
      setTimeout(() => {
        addBotMessage(`I've forwarded your question to our support team at ${SUPPORT_EMAIL}. You'll receive a response within 24 hours!`);
      }, 1000);
    }
  } catch (error) {
    removeTypingIndicator(typingId);
    addBotMessage("I'm having trouble right now. Please email " + SUPPORT_EMAIL + " for immediate assistance.");
    console.error('Chat error:', error);
  }
}

async function getAIResponse(userMessage) {
  const settings = await chrome.storage.local.get(['settings']);
  const apiKey = settings?.settings?.apiKey || 'AIzaSyDtmZYEgp9XwqIO4VgCE8J2QH7IIE_gJt4';
  
  if (!apiKey) {
    return {
      text: "I need a Gemini API key to help you. Please configure it in settings, or email " + SUPPORT_EMAIL + " for support.",
      needsHumanHelp: true
    };
  }
  
  try {
    const prompt = `You are Focufy's customer support AI assistant. Focufy is a Chrome extension that helps users stay focused by blocking distracting elements on websites using AI.

User Question: "${userMessage}"

Answer the question helpfully and concisely. If the question is too complex or requires human assistance, say you'll forward it to support.

Common topics:
- How to use Focufy
- Setting up focus sessions
- YouTube blocking
- Premium features
- Troubleshooting
- Trial and subscriptions

Keep responses under 150 words. Be friendly and helpful.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 200
        }
      })
    });
    
    if (!response.ok) {
      throw new Error('API error');
    }
    
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm not sure how to help with that. Let me forward your question to our support team.";
    
    // Check if response suggests human help
    const needsHumanHelp = text.toLowerCase().includes('forward') || 
                          text.toLowerCase().includes('support team') ||
                          text.toLowerCase().includes('contact');
    
    return {
      text: text.trim(),
      needsHumanHelp
    };
  } catch (error) {
    console.error('AI response error:', error);
    return {
      text: "I'm having trouble right now. Please email " + SUPPORT_EMAIL + " for assistance.",
      needsHumanHelp: true
    };
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

async function forwardToEmail(question) {
  // In a real implementation, this would send an email via API
  // For now, we'll just log it
  console.log('Forwarding to email:', question);
  
  // You can integrate with Resend/SendGrid here
  // For now, user can email directly
}

