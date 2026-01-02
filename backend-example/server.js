const express = require('express');
const cors = require('cors');
const { OAuth2Client, GoogleAuth } = require('google-auth-library');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();

// CORS configuration - restrict to Chrome extension origins
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or Chrome extensions)
    // Chrome extensions use chrome-extension:// protocol which doesn't send Origin header
    if (!origin || origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
      callback(null, true);
    } else {
      // For other origins, you can add specific domains here
      // For now, we'll allow requests without origin (safer default)
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key']
};

app.use(cors(corsOptions));

// Body size limit to prevent large payload attacks (1MB)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Health check endpoint (add early to ensure it's registered)
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Focufy Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// CONFIGURATION
const GOOGLE_CLIENT_ID = '42484888880-r0rgoel8vrhmk5tsdtfibb0jot3vgksd.apps.googleusercontent.com'; // Same as extension
const GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID; // Your Google Cloud Project ID
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Fallback API key (if auto-generation fails)
const DAILY_LIMIT_PER_USER = 1000; // High limit (effectively unlimited per user)
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'prithivponns@gmail.com'; // Support email to receive tickets

// Initialize Google Auth for Service Account (REQUIRED for automatic key generation)
let serviceAccountAuth = null;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    serviceAccountAuth = new GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    console.log('✅ Service Account initialized for API key generation');
  } catch (error) {
    console.warn('⚠️ Service account auth not configured:', error.message);
  }
} else if (process.env.SERVICE_ACCOUNT_KEY) {
  try {
    const serviceAccountKey = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
    serviceAccountAuth = new GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    console.log('✅ Service Account initialized from environment variable');
  } catch (error) {
    console.warn('⚠️ Failed to parse SERVICE_ACCOUNT_KEY:', error.message);
  }
} else {
  console.warn('⚠️ No Service Account configured. Set GOOGLE_APPLICATION_CREDENTIALS or SERVICE_ACCOUNT_KEY');
}

// In-memory storage for usage limits (Use Redis or Database in production)
const userUsage = new Map(); // userId -> { count: number, date: string }

// In-memory storage for user API keys (Use Database in production)
// userId -> { apiKey: string, createdAt: Date, lastUsed: Date, source: 'auto-generated' | 'user-provided' }
const userApiKeys = new Map();

// MongoDB connection and collections
let mongoClient = null;
let db = null;
let ticketsCollection = null;

// Initialize MongoDB connection
async function initMongoDB() {
  try {
    if (!MONGODB_URI || MONGODB_URI === 'mongodb://localhost:27017/focufy') {
      console.warn('⚠️ MONGODB_URI not set, using in-memory storage (data will be lost on restart)');
      return false;
    }
    
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db();
    ticketsCollection = db.collection('supportTickets');
    
    // Create indexes
    await ticketsCollection.createIndex({ ticketId: 1 }, { unique: true });
    await ticketsCollection.createIndex({ userId: 1 });
    await ticketsCollection.createIndex({ createdAt: -1 });
    
    console.log('✅ MongoDB connected successfully');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.warn('⚠️ Falling back to in-memory storage');
    return false;
  }
}

// Fallback in-memory storage (if MongoDB not available)
const supportTickets = new Map();
let ticketCounter = 1;
let useMongoDB = false;

// Helper functions for ticket operations (MongoDB or in-memory)
// These functions handle both MongoDB and in-memory storage
async function getTicket(ticketId) {
  if (useMongoDB && ticketsCollection) {
    return await ticketsCollection.findOne({ ticketId });
  }
  return supportTickets.get(ticketId) || null;
}

async function setTicket(ticket) {
  try {
    if (useMongoDB && ticketsCollection) {
      console.log('[setTicket] Saving to MongoDB:', ticket.ticketId);
      await ticketsCollection.updateOne(
        { ticketId: ticket.ticketId },
        { $set: ticket },
        { upsert: true }
      );
      console.log('[setTicket] Saved to MongoDB successfully');
    } else {
      console.log('[setTicket] Saving to in-memory storage:', ticket.ticketId);
      supportTickets.set(ticket.ticketId, ticket);
      console.log('[setTicket] Saved to in-memory storage successfully');
    }
  } catch (error) {
    console.error('[setTicket] Error saving ticket:', error);
    throw error;
  }
}

async function getAllTickets() {
  if (useMongoDB && ticketsCollection) {
    return await ticketsCollection.find({}).toArray();
  }
  return Array.from(supportTickets.values());
}

async function getUserTickets(userId) {
  if (useMongoDB && ticketsCollection) {
    return await ticketsCollection.find({ userId }).toArray();
  }
  return Array.from(supportTickets.values()).filter(t => t.userId === userId);
}

// Send email notification for new support ticket
async function sendTicketEmailNotification(ticket) {
  try {
    // Format email content
    const emailSubject = `[Focufy Support] ${ticket.ticketId}: ${ticket.subject}`;
    const emailBody = `
New Support Ticket Received

Ticket ID: ${ticket.ticketId}
Category: ${ticket.category}
Status: ${ticket.status}
Created: ${new Date(ticket.createdAt).toLocaleString()}

User Email: ${ticket.userEmail}
User ID: ${ticket.userId}

Subject: ${ticket.subject}

Message:
${ticket.message}

---
View all tickets in the backend logs or implement a dashboard to manage tickets.
Reply to this email or update the ticket status via the API.
    `.trim();

    // Try to send email via Resend API (if configured)
    if (process.env.RESEND_API_KEY) {
      try {
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'Focufy Support <onboarding@resend.dev>',
            to: [SUPPORT_EMAIL],
            subject: emailSubject,
            text: emailBody,
            reply_to: ticket.userEmail // So you can reply directly
          })
        });

        if (resendResponse.ok) {
          const result = await resendResponse.json();
          console.log(`📧 Ticket email sent successfully via Resend to ${SUPPORT_EMAIL} (ID: ${result.id})`);
          return; // Success, don't log to console
        } else {
          const error = await resendResponse.text();
          console.warn('Resend API error:', error);
          // Fall through to console logging
        }
      } catch (resendError) {
        console.warn('Resend API request failed:', resendError.message);
        // Fall through to console logging
      }
    }

    // Fallback: Log to console (visible in Render logs)
    console.log('\n' + '='.repeat(80));
    console.log('📧 NEW SUPPORT TICKET - EMAIL NOTIFICATION');
    console.log('='.repeat(80));
    console.log(`To: ${SUPPORT_EMAIL}`);
    console.log(`Subject: ${emailSubject}`);
    console.log('\n' + emailBody);
    console.log('='.repeat(80) + '\n');
    console.log('💡 To receive tickets via email, add RESEND_API_KEY to your environment variables.');
    console.log('   Sign up at https://resend.com (free tier available)\n');
    
  } catch (error) {
    console.error('Error sending ticket email notification:', error);
    // Don't throw - email failure shouldn't break ticket creation
  }
}

// Generate API key using Service Account (automatic, no user action needed)
async function generateUserApiKeyWithServiceAccount(userId, userEmail) {
  try {
    if (!serviceAccountAuth) {
      throw new Error('Service Account not configured. Set GOOGLE_APPLICATION_CREDENTIALS or SERVICE_ACCOUNT_KEY');
    }
    
    if (!GOOGLE_CLOUD_PROJECT_ID) {
      throw new Error('GOOGLE_CLOUD_PROJECT_ID not set');
    }
    
    console.log(`🔄 Creating API key for user ${userId} using Service Account...`);
    console.log(`📋 Project ID: ${GOOGLE_CLOUD_PROJECT_ID}`);
    
    // Get Service Account client
    const authClient = await serviceAccountAuth.getClient();
    
    // Verify we have a client
    if (!authClient) {
      throw new Error('Failed to get Service Account client');
    }
    
    // Get access token (handle both string and object responses)
    const tokenResponse = await authClient.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : (tokenResponse?.token || tokenResponse);
    
    if (!token) {
      throw new Error('Failed to get Service Account access token');
    }
    
    console.log('✅ Service Account token obtained (length:', token.length, ')');
    
    // Test token by making a simple API call to verify permissions
    console.log('🔍 Testing Service Account permissions...');
    const testResponse = await fetch(
      `https://apikeys.googleapis.com/v2/projects/${GOOGLE_CLOUD_PROJECT_ID}/locations/global/keys`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (testResponse.status === 401 || testResponse.status === 403) {
      const testError = await testResponse.text();
      console.error('❌ Permission test failed:', testResponse.status, testError);
      throw new Error(`Service Account lacks permissions. Steps to fix:
1. Go to: https://console.cloud.google.com/iam-admin/iam?project=${GOOGLE_CLOUD_PROJECT_ID}
2. Find your Service Account (the email from SERVICE_ACCOUNT_KEY)
3. Click the pencil icon (Edit)
4. Click "Add Another Role"
5. Search for: "API Keys Admin"
6. Select: API Keys Admin (roles/serviceusage.apiKeysAdmin)
7. Click "Save"
8. Wait 1-2 minutes for changes to propagate
9. Also enable "API Keys API" at: https://console.cloud.google.com/apis/library/apikeys.googleapis.com?project=${GOOGLE_CLOUD_PROJECT_ID}`);
    }
    
    console.log('✅ Service Account permissions verified');
    
    // Create API key via Google Cloud API Key Management API
    // This creates a REAL, unique API key for each user in YOUR Google Cloud project
    const apiKeyResponse = await fetch(
      `https://apikeys.googleapis.com/v2/projects/${GOOGLE_CLOUD_PROJECT_ID}/locations/global/keys`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          displayName: `Focufy-${userEmail}-${Date.now()}`,
          restrictions: {
            apiTargets: [{
              service: 'generativelanguage.googleapis.com'
            }]
          }
        })
      }
    );
    
    if (!apiKeyResponse.ok) {
      const errorText = await apiKeyResponse.text();
      console.error('API Key creation failed:', apiKeyResponse.status, errorText);
      
      // Provide helpful error messages
      if (apiKeyResponse.status === 401 || apiKeyResponse.status === 403) {
        throw new Error(`Authentication failed. Make sure:
1. Service Account has "API Keys Admin" role (roles/serviceusage.apiKeysAdmin)
2. "API Keys API" is enabled in Google Cloud Console
3. Service Account JSON is correct`);
      }
      
      if (apiKeyResponse.status === 404) {
        throw new Error(`API Key Management API not found. Make sure:
1. "API Keys API" is enabled in Google Cloud Console
2. Service Account has "API Keys Admin" role
3. Project ID is correct: ${GOOGLE_CLOUD_PROJECT_ID}`);
      }
      
      throw new Error(`Failed to create API key: ${apiKeyResponse.status} - ${errorText}`);
    }
    
    const keyData = await apiKeyResponse.json();
    console.log('📋 API Key creation response:', JSON.stringify(keyData, null, 2));
    
    // Check if keyString is already in the response (some API versions return it directly)
    if (keyData.keyString) {
      console.log(`✅ Created unique API key for user ${userId} (${userEmail}) - key string in response`);
      return keyData.keyString;
    }
    
    // Check if this is an async operation (operation name starts with "operations/")
    let keyName = keyData.name;
    if (keyName && keyName.startsWith('operations/')) {
      console.log(`⏳ API key creation is async, polling operation: ${keyName}`);
      
      // Poll the operation until it's done
      const operationName = keyName;
      let operation = null;
      const maxAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between polls
        
        const operationResponse = await fetch(
          `https://apikeys.googleapis.com/v2/${operationName}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (!operationResponse.ok) {
          const errorText = await operationResponse.text();
          throw new Error(`Failed to poll operation: ${operationResponse.status} - ${errorText}`);
        }
        
        operation = await operationResponse.json();
        console.log(`📊 Operation status (attempt ${attempts}/${maxAttempts}):`, operation.done ? 'DONE' : 'IN_PROGRESS');
        
        if (operation.done) {
          break; // Operation completed
        }
      }
      
      if (!operation || !operation.done) {
        throw new Error(`Operation did not complete within ${maxAttempts * 2} seconds. Operation: ${operationName}`);
      }
      
      // Extract the key name or keyString from the operation response
      console.log('📋 Full operation response:', JSON.stringify(operation, null, 2));
      
      if (operation.response && operation.response.keyString) {
        // The key string is directly in the operation response - this is the preferred method
        console.log(`✅ Operation completed, key string found in operation response`);
        return operation.response.keyString;
      } else if (operation.response && operation.response.name) {
        keyName = operation.response.name;
        console.log(`✅ Operation completed, key name: ${keyName}`);
      } else {
        console.error('❌ Operation completed but no key name or keyString in response:', JSON.stringify(operation, null, 2));
        throw new Error('Operation completed but could not extract key name or keyString from response');
      }
    }
    
    if (!keyName) {
      throw new Error('API key created but no key name returned in response');
    }
    
    console.log(`🔑 Key name: ${keyName}, attempting to retrieve key string...`);
    
    // Wait a moment for the key to be fully propagated (sometimes there's a small delay)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get the actual key string (the secret) using getKeyString method
    // Note: getKeyString is a POST method, not GET
    const keyDetailsResponse = await fetch(
      `https://apikeys.googleapis.com/v2/${keyName}:getKeyString`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({}) // Empty body for POST
      }
    );
    
    if (keyDetailsResponse.ok) {
      const keyDetails = await keyDetailsResponse.json();
      const actualKey = keyDetails.keyString;
      if (actualKey) {
        console.log(`✅ Created unique API key for user ${userId} (${userEmail})`);
        return actualKey;
      } else {
        console.error('❌ getKeyString response missing keyString:', keyDetails);
        throw new Error('getKeyString response missing keyString field');
      }
    }
    
    // If getKeyString failed, log the error and provide helpful message
    const errorText = await keyDetailsResponse.text();
    console.error('❌ getKeyString failed:', keyDetailsResponse.status, errorText);
    
    if (keyDetailsResponse.status === 401 || keyDetailsResponse.status === 403) {
      throw new Error(`Cannot retrieve API key string. Service Account needs additional permissions:
1. Add "API Keys Viewer" role (roles/serviceusage.apiKeysViewer) to your Service Account
2. Go to: https://console.cloud.google.com/iam-admin/iam?project=${GOOGLE_CLOUD_PROJECT_ID}
3. Find your Service Account → Edit → Add Role → "API Keys Viewer"
4. The key was created (name: ${keyName}) but we cannot retrieve the key string without this permission`);
    }
    
    throw new Error(`Created key (name: ${keyName}) but could not retrieve key string. Status: ${keyDetailsResponse.status}, Error: ${errorText}`);
    
  } catch (error) {
    console.error('Error generating API key with Service Account:', error);
    throw error;
  }
}

// Verify Google Token
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyToken(token) {
  try {
    // If using a simple access token from implicit flow, we might need to verify against userinfo endpoint
    // or if it's an ID token, verifyIdToken.
    // Since popup.js gets an 'access_token', we verify it by calling Google userinfo
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Invalid token');
    const userData = await response.json();
    return userData; // Contains sub (id), email, etc.
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

// Middleware to authenticate and check limits
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  const token = authHeader.split(' ')[1];
  const user = await verifyToken(token);

  if (!user) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  // Rate Limiting Logic
  const userId = user.sub; // Unique Google User ID
  const today = new Date().toISOString().split('T')[0];
  
  let usage = userUsage.get(userId);
  if (!usage || usage.date !== today) {
    usage = { count: 0, date: today };
  }

  if (usage.count >= DAILY_LIMIT_PER_USER) {
    return res.status(429).json({ error: 'Daily API limit reached' });
  }

  // Increment usage
  usage.count++;
  userUsage.set(userId, usage);

  // Attach user to request
  req.user = user;
  next();
}

// Test endpoint to verify Service Account setup (no auth required for debugging)
app.get('/api/test-service-account', async (req, res) => {
  try {
    if (!serviceAccountAuth) {
      return res.status(500).json({ 
        error: 'Service Account not configured',
        fix: 'Set GOOGLE_APPLICATION_CREDENTIALS or SERVICE_ACCOUNT_KEY environment variable'
      });
    }
    
    if (!GOOGLE_CLOUD_PROJECT_ID) {
      return res.status(500).json({ 
        error: 'GOOGLE_CLOUD_PROJECT_ID not set',
        fix: 'Set GOOGLE_CLOUD_PROJECT_ID environment variable'
      });
    }
    
    const authClient = await serviceAccountAuth.getClient();
    const tokenResponse = await authClient.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : (tokenResponse?.token || tokenResponse);
    
    if (!token) {
      return res.status(500).json({ 
        error: 'Failed to get access token',
        fix: 'Check Service Account JSON credentials'
      });
    }
    
    // Test API Keys API access
    const testResponse = await fetch(
      `https://apikeys.googleapis.com/v2/projects/${GOOGLE_CLOUD_PROJECT_ID}/locations/global/keys`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (testResponse.status === 401 || testResponse.status === 403) {
      const errorText = await testResponse.text();
      return res.status(testResponse.status).json({
        error: 'Service Account lacks permissions',
        status: testResponse.status,
        details: errorText,
        fix: `1. Go to: https://console.cloud.google.com/iam-admin/iam?project=${GOOGLE_CLOUD_PROJECT_ID}
2. Find your Service Account
3. Click Edit → Add Role → "API Keys Admin"
4. Enable API Keys API: https://console.cloud.google.com/apis/library/apikeys.googleapis.com?project=${GOOGLE_CLOUD_PROJECT_ID}`
      });
    }
    
    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      return res.status(testResponse.status).json({
        error: 'API test failed',
        status: testResponse.status,
        details: errorText
      });
    }
    
    return res.json({
      success: true,
      message: 'Service Account is properly configured',
      projectId: GOOGLE_CLOUD_PROJECT_ID,
      tokenLength: token.length
    });
    
  } catch (error) {
    return res.status(500).json({
      error: 'Test failed',
      message: error.message
    });
  }
});

// Auto-generate API key using user's Google account (called when user gives consent)
app.post('/api/generate-api-key', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const userEmail = req.user.email;
    const accessToken = req.accessToken;
    
    // Check if user already has an API key
    const userKey = userApiKeys.get(userId);
    if (userKey) {
      return res.json({ 
        success: true,
        hasApiKey: true,
        createdAt: userKey.createdAt,
        message: 'API key already exists'
      });
    }
    
    console.log(`🔄 Generating API key for user ${userId} (${userEmail})...`);
    
    // Generate API key using Service Account (automatic, no user action needed)
    // The user's consent is implied by signing in - backend handles key creation
    const apiKey = await generateUserApiKeyWithServiceAccount(userId, userEmail);
    
    // Store the API key for this user
    userApiKeys.set(userId, {
      apiKey: apiKey,
      createdAt: new Date(),
      lastUsed: new Date(),
      source: 'auto-generated',
      userEmail: userEmail
    });
    
    console.log(`✅ Auto-generated API key for user ${userId}`);
    
    return res.json({ 
      success: true,
      hasApiKey: true,
      createdAt: userApiKeys.get(userId).createdAt,
      message: 'API key generated successfully using your Google account'
    });
    
  } catch (error) {
    console.error('API key generation error:', error);
    
    res.status(500).json({ 
      error: 'Failed to generate API key: ' + error.message,
      suggestion: 'Make sure GOOGLE_CLOUD_PROJECT_ID and Service Account are properly configured. See README for setup instructions.'
    });
  }
});

// Get user's API key status
app.get('/api/user-api-key', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const userKey = userApiKeys.get(userId);
    
    if (userKey) {
      return res.json({ 
        hasApiKey: true,
        createdAt: userKey.createdAt,
        lastUsed: userKey.lastUsed,
        assigned: true
      });
    }
    
    // Auto-assign if user doesn't have one
    try {
      const apiKey = generateUserApiKey(userId);
      userApiKeys.set(userId, {
        apiKey: apiKey,
        createdAt: new Date(),
        lastUsed: new Date(),
        assigned: true
      });
      
      return res.json({ 
        hasApiKey: true,
        createdAt: userApiKeys.get(userId).createdAt,
        assigned: true,
        autoAssigned: true
      });
    } catch (assignError) {
      return res.json({ 
        hasApiKey: false,
        error: 'Failed to auto-assign API key'
      });
    }
    
  } catch (error) {
    console.error('API key status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Proxy Endpoint for Gemini
app.post('/api/analyze-page', authMiddleware, async (req, res) => {
  try {
    const { prompt, model = 'gemini-flash-lite-latest' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    // Get user's API key or auto-assign one
    const userId = req.user.sub;
    let userKey = userApiKeys.get(userId);
    
    // Auto-assign API key if user doesn't have one
    if (!userKey) {
      try {
        const apiKey = generateUserApiKey(userId);
        userKey = {
          apiKey: apiKey,
          createdAt: new Date(),
          lastUsed: new Date(),
          assigned: true
        };
        userApiKeys.set(userId, userKey);
        console.log(`✅ Auto-assigned API key to user ${userId} on first API call`);
      } catch (assignError) {
        // If auto-assignment fails, use fallback
        console.warn(`⚠️ Failed to assign API key to user ${userId}, using fallback`);
      }
    }
    
    const apiKeyToUse = userKey ? userKey.apiKey : (GEMINI_API_KEY || API_KEY_POOL[0]);
    
    if (!apiKeyToUse) {
      return res.status(500).json({ 
        error: 'No API key available. Please configure API keys on the server.' 
      });
    }
    
    // Update last used timestamp
    if (userKey) {
      userKey.lastUsed = new Date();
      userApiKeys.set(userId, userKey);
    }

    // Call Gemini API using user's key or fallback
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeyToUse}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${errorText}`);
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Support Ticket Endpoints
// Create a new support ticket
app.post('/api/support/tickets', authMiddleware, async (req, res) => {
  try {
    console.log('[Create Ticket] Request received');
    const { subject, message, category = 'general' } = req.body;
    const userId = req.user.sub;
    const userEmail = req.user.email;

    console.log('[Create Ticket] User:', userId, userEmail);
    console.log('[Create Ticket] Data:', { subject, message, category });

    if (!subject || !message) {
      console.log('[Create Ticket] Missing required fields');
      return res.status(400).json({ error: 'Subject and message are required' });
    }

    const ticketId = `TICKET-${Date.now()}-${ticketCounter++}`;
    const ticket = {
      ticketId,
      userId,
      userEmail,
      subject: sanitizedSubject,
      message: sanitizedMessage,
      category: sanitizedCategory,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      responses: []
    };

    console.log('[Create Ticket] Attempting to save ticket:', ticketId);
    await setTicket(ticket);
    console.log(`✅ Support ticket created: ${ticketId} by ${userEmail}`);

    // Send email notification (async, don't wait for it)
    sendTicketEmailNotification(ticket).catch(err => {
      console.error('Failed to send ticket email notification:', err);
      // Don't fail the request if email fails
    });

    res.status(201).json({
      success: true,
      ticket: {
        ticketId: ticket.ticketId,
        subject: ticket.subject,
        status: ticket.status,
        createdAt: ticket.createdAt
      }
    });
  } catch (error) {
    console.error('[Create Ticket] Error details:', error);
    console.error('[Create Ticket] Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to create support ticket',
      details: error.message 
    });
  }
});

// Get user's support tickets
app.get('/api/support/tickets', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    // Filter out closed tickets - users shouldn't see closed tickets
    const userTickets = (await getUserTickets(userId))
      .filter(ticket => ticket.status !== 'closed') // Hide closed tickets
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(ticket => ({
        ticketId: ticket.ticketId,
        subject: ticket.subject,
        category: ticket.category,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        hasResponse: ticket.responses.length > 0
      }));

    res.json({
      success: true,
      tickets: userTickets
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'Failed to retrieve tickets' });
  }
});

// Get a specific ticket
app.get('/api/support/tickets/:ticketId', authMiddleware, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.sub;

    console.log(`[Get Ticket] Looking for ticket: ${ticketId}, User: ${userId}`);
    const allTickets = await getAllTickets();
    console.log(`[Get Ticket] Total tickets in store: ${allTickets.length}`);
    console.log(`[Get Ticket] Ticket IDs in store:`, allTickets.map(t => t.ticketId));

    const ticket = await getTicket(ticketId);
    if (!ticket) {
      console.log(`[Get Ticket] Ticket ${ticketId} not found in store`);
      return res.status(404).json({ error: 'Ticket not found' });
    }

    console.log(`[Get Ticket] Found ticket, userId: ${ticket.userId}, requesting userId: ${userId}`);
    if (ticket.userId !== userId) {
      console.log(`[Get Ticket] Access denied - userId mismatch`);
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log(`[Get Ticket] Returning ticket ${ticketId} successfully`);
    res.json({
      success: true,
      ticket
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ error: 'Failed to retrieve ticket' });
  }
});

// User endpoint to add reply to their own ticket
app.post('/api/support/tickets/:ticketId/reply', authMiddleware, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;
    const userId = req.user.sub;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ticket = await getTicket(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Verify user owns this ticket
    if (ticket.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized - you can only reply to your own tickets' });
    }

    // Prevent replies to closed tickets
    if (ticket.status === 'closed') {
      return res.status(400).json({ error: 'Cannot reply to a closed ticket' });
    }

    // Add user reply
    if (!ticket.responses) {
      ticket.responses = [];
    }
    ticket.responses.push({
      message: sanitizedMessage,
      respondedBy: 'User',
      respondedAt: new Date().toISOString()
    });

    ticket.updatedAt = new Date().toISOString();
    await setTicket(ticket);

    console.log(`✅ User reply added to ticket ${ticketId}`);

    res.json({
      success: true,
      message: 'Reply added successfully',
      ticket: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        responses: ticket.responses
      }
    });
  } catch (error) {
    console.error('Add reply error:', error);
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

// Admin endpoint to close a ticket (without response)
app.post('/api/admin/tickets/:ticketId/close', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const adminKey = req.query.key || req.headers['x-admin-key'];
    
    if (!isValidAdminKey(adminKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const ticket = await getTicket(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Update status to closed
    ticket.status = 'closed';
    ticket.updatedAt = new Date().toISOString();
    await setTicket(ticket);

    console.log(`✅ Ticket ${ticketId} closed by admin`);

    res.json({
      success: true,
      message: 'Ticket closed successfully',
      ticket: {
        ticketId: ticket.ticketId,
        status: ticket.status
      }
    });
  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({ error: 'Failed to close ticket' });
  }
});

// Admin endpoint to add response to a ticket
app.post('/api/admin/tickets/:ticketId/respond', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { response, status } = req.body;
    const adminKey = req.query.key || req.headers['x-admin-key'];
    
    if (!isValidAdminKey(adminKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!response || !response.trim()) {
      return res.status(400).json({ error: 'Response message is required' });
    }

    const ticket = await getTicket(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Add response
    if (!ticket.responses) {
      ticket.responses = [];
    }
    ticket.responses.push({
      message: sanitizedResponse,
      respondedBy: 'Admin',
      respondedAt: new Date().toISOString()
    });

    // Update status if provided
    if (status && ['open', 'closed', 'pending'].includes(status)) {
      ticket.status = status;
    }

    ticket.updatedAt = new Date().toISOString();
    await setTicket(ticket);

    console.log(`✅ Response added to ticket ${ticketId} by admin`);

    res.json({
      success: true,
      message: 'Response added successfully',
      ticket: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        responses: ticket.responses
      }
    });
  } catch (error) {
    console.error('Add response error:', error);
    res.status(500).json({ error: 'Failed to add response' });
  }
});

// AI Support Chat Endpoint (enhanced)
app.post('/api/support/chat', authMiddleware, async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const userId = req.user.sub;
    const userEmail = req.user.email;

    // Input validation
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required and must be a non-empty string' });
    }
    
    // Sanitize message
    const sanitizedMessage = message.trim().substring(0, 1000); // Max 1000 chars for chat
    
    if (!sanitizedMessage) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Get user's API key
    const userKey = userApiKeys.get(userId);
    const apiKeyToUse = userKey ? userKey.apiKey : GEMINI_API_KEY;

    if (!apiKeyToUse) {
      return res.status(500).json({ error: 'API key not available' });
    }

    // Build context-aware prompt
    const historyContext = conversationHistory
      .slice(-5) // Last 5 messages for context
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const prompt = `You are Focufy's customer support AI assistant. Focufy is a Chrome extension that helps users stay focused by blocking distracting elements on websites using AI.

${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}User Question: "${sanitizedMessage}"

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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKeyToUse}`, {
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
      throw new Error('AI API error');
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 
      "I'm having trouble right now. Please create a support ticket for assistance.";

    const needsHumanHelp = aiResponse.toLowerCase().includes('support ticket') ||
                          aiResponse.toLowerCase().includes('create a ticket') ||
                          aiResponse.toLowerCase().includes('contact support');

    res.json({
      success: true,
      response: aiResponse.trim(),
      needsHumanHelp
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to get AI response',
      message: 'Please create a support ticket for assistance.'
    });
  }
});

// Admin endpoint to view all tickets (for support team)
// In production, add proper authentication/authorization
app.get('/api/admin/tickets', async (req, res) => {
  try {
    // Admin key check - REQUIRED environment variable
    const adminKey = req.query.key || req.headers['x-admin-key'];
    
    if (!isValidAdminKey(adminKey)) {
      return res.status(401).json({ 
        error: 'Unauthorized. Provide ?key=YOUR_ADMIN_KEY or X-Admin-Key header' 
      });
    }

    const allTickets = Array.from(supportTickets.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(ticket => ({
        ticketId: ticket.ticketId,
        userEmail: ticket.userEmail,
        userId: ticket.userId,
        subject: ticket.subject,
        category: ticket.category,
        message: ticket.message,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        hasResponse: ticket.responses.length > 0
      }));

    res.json({
      success: true,
      count: allTickets.length,
      tickets: allTickets
    });
  } catch (error) {
    console.error('Admin tickets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to get current rotating admin key (protected by master key)
app.get('/admin/get-key', async (req, res) => {
  try {
    const masterKey = req.query.masterKey || req.headers['x-master-key'];
    const expectedMasterKey = process.env.ADMIN_KEY;
    
    if (!expectedMasterKey) {
      return res.status(500).json({ 
        error: 'Server configuration error. ADMIN_KEY not set.' 
      });
    }
    
    if (!masterKey || masterKey !== expectedMasterKey) {
      return res.status(401).json({ 
        error: 'Unauthorized. Provide master ADMIN_KEY to get current rotating key.' 
      });
    }
    
    const currentKey = getCurrentAdminKey();
    const nextRotation = new Date((getCurrentTimeSlot() + 1) * ADMIN_KEY_ROTATION_INTERVAL);
    const timeUntilRotation = nextRotation.getTime() - Date.now();
    const minutesUntilRotation = Math.ceil(timeUntilRotation / 60000);
    
    res.json({
      success: true,
      currentKey: currentKey,
      expiresIn: minutesUntilRotation,
      expiresAt: nextRotation.toISOString(),
      note: 'This key rotates every 10 minutes. Use the master ADMIN_KEY to get the current key.'
    });
  } catch (error) {
    console.error('Get key error:', error);
    res.status(500).json({ error: 'Failed to get current key' });
  }
});

// Simple HTML page to view tickets (admin dashboard)
app.get('/admin/tickets', async (req, res) => {
  try {
    const adminKey = req.query.key;
    
    if (!isValidAdminKey(adminKey)) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Focufy Admin - Unauthorized</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #dc2626; }
            code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔒 Unauthorized</h1>
            <p>Please provide the admin key in the URL:</p>
            <p><code>?key=YOUR_ADMIN_KEY</code></p>
            <p style="margin-top: 20px; color: #64748b; font-size: 14px;">
              Use the <code>ADMIN_KEY</code> value you set in Render environment variables.
            </p>
          </div>
        </body>
        </html>
      `);
    }

  const allTickets = (await getAllTickets())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const currentKey = getCurrentAdminKey();
  const nextRotation = new Date((getCurrentTimeSlot() + 1) * ADMIN_KEY_ROTATION_INTERVAL);
  const timeUntilRotation = nextRotation.getTime() - Date.now();
  const minutesUntilRotation = Math.ceil(timeUntilRotation / 60000);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Focufy Support Tickets</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        h1 { color: #667eea; }
        .key-info { background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
        .key-info strong { color: #0369a1; }
        .key-warning { color: #dc2626; font-size: 12px; margin-top: 5px; }
        .stats { display: flex; gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #f8fafc; padding: 20px; border-radius: 8px; flex: 1; }
        .stat-number { font-size: 32px; font-weight: bold; color: #667eea; }
        .key-info { background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
        .key-info strong { color: #0369a1; }
        .key-warning { color: #dc2626; font-size: 12px; margin-top: 5px; }
        .ticket { border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px; background: #f8fafc; }
        .ticket-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .ticket-id { font-family: monospace; color: #64748b; font-size: 12px; }
        .ticket-status { padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; }
        .status-open { background: #dbeafe; color: #1e40af; }
        .ticket-subject { font-size: 18px; font-weight: 600; color: #1e293b; margin: 10px 0; }
        .ticket-meta { display: flex; gap: 15px; font-size: 12px; color: #64748b; margin-bottom: 15px; }
        .ticket-message { background: white; padding: 15px; border-radius: 6px; border-left: 3px solid #667eea; margin-top: 10px; white-space: pre-wrap; margin-bottom: 20px; }
        .responses-section { margin-top: 20px; padding-top: 20px; border-top: 2px solid #e2e8f0; margin-bottom: 20px; }
        .responses-section h3 { font-size: 16px; color: #1e293b; margin-bottom: 15px; }
        .response-item { background: white; padding: 15px; border-radius: 6px; border-left: 3px solid #10b981; margin-bottom: 10px; }
        .response-item.user-response { background: #eff6ff; border-left-color: #3b82f6; }
        .response-item.admin-response { background: #f0fdf4; border-left-color: #10b981; }
        .response-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; }
        .response-header strong { color: #10b981; }
        .user-response .response-header strong { color: #3b82f6; }
        .response-date { color: #64748b; }
        .response-message { color: #1e293b; white-space: pre-wrap; }
        .response-form { margin-top: 30px; padding: 20px; border-top: 3px solid #10b981; background: #f0fdf4; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .response-form h3 { font-size: 18px; color: #1e293b; margin-bottom: 15px; font-weight: 600; }
        .response-textarea { width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 6px; font-family: inherit; font-size: 14px; margin-bottom: 10px; resize: vertical; }
        .response-textarea:focus { outline: none; border-color: #667eea; }
        .response-actions { display: flex; gap: 10px; align-items: center; }
        .status-select { padding: 8px 12px; border: 2px solid #e2e8f0; border-radius: 6px; font-size: 14px; }
        .submit-response-btn { background: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .submit-response-btn:hover { background: #059669; }
        .response-status { margin-top: 10px; padding: 8px; border-radius: 4px; font-size: 14px; }
        .response-status.success { background: #d1fae5; color: #065f46; }
        .response-status.error { background: #fee2e2; color: #991b1b; }
        .refresh-btn { background: #667eea; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin-bottom: 20px; }
        .refresh-btn:hover { background: #5568d3; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📋 Focufy Support Tickets</h1>
        <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
        
        <div class="stats">
          <div class="stat-card">
            <div class="stat-number">${allTickets.length}</div>
            <div>Total Tickets</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${allTickets.filter(t => t.status === 'open').length}</div>
            <div>Open Tickets</div>
          </div>
        </div>

        ${allTickets.length === 0 ? '<p>No tickets yet.</p>' : ''}
        
        ${allTickets.map(ticket => `
          <div class="ticket" id="ticket-${ticket.ticketId}">
            <div class="ticket-header">
              <div>
                <div class="ticket-id">${ticket.ticketId}</div>
                <div class="ticket-subject">${ticket.subject}</div>
              </div>
              <span class="ticket-status status-${ticket.status}">${ticket.status.toUpperCase()}</span>
            </div>
            <div class="ticket-meta">
              <span><strong>Email:</strong> ${ticket.userEmail}</span>
              <span><strong>Category:</strong> ${ticket.category}</span>
              <span><strong>Created:</strong> ${new Date(ticket.createdAt).toLocaleString()}</span>
            </div>
            <div class="ticket-message">${ticket.message}</div>
            
            ${ticket.responses && ticket.responses.length > 0 ? `
              <div class="responses-section">
                <h3>Conversation (${ticket.responses.length})</h3>
                ${ticket.responses.map(response => `
                  <div class="response-item ${response.respondedBy === 'User' ? 'user-response' : 'admin-response'}">
                    <div class="response-header">
                      <strong>${response.respondedBy === 'User' ? '👤 User' : '👨‍💼 Admin'}</strong>
                      <span class="response-date">${new Date(response.respondedAt).toLocaleString()}</span>
                    </div>
                    <div class="response-message">${response.message.replace(/\n/g, '<br>')}</div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            ${ticket.status !== 'closed' ? `
              <div class="ticket-actions-section">
                <button onclick="closeTicket('${ticket.ticketId}')" class="close-ticket-btn">🔒 Close Ticket</button>
                <div id="close-status-${ticket.ticketId}" class="close-status"></div>
              </div>
            ` : `
              <div class="ticket-closed-badge">
                <strong>✅ This ticket is closed</strong>
              </div>
            `}
            
            <div class="response-form">
              <h3>Add Response</h3>
              <textarea id="response-${ticket.ticketId}" class="response-textarea" placeholder="Type your response here..." rows="4"></textarea>
              <div class="response-actions">
                <select id="status-${ticket.ticketId}" class="status-select">
                  <option value="open" ${ticket.status === 'open' ? 'selected' : ''}>Open</option>
                  <option value="pending" ${ticket.status === 'pending' ? 'selected' : ''}>Pending</option>
                  <option value="closed" ${ticket.status === 'closed' ? 'selected' : ''}>Closed</option>
                </select>
                <button onclick="submitResponse('${ticket.ticketId}')" class="submit-response-btn">Send Response</button>
              </div>
              <div id="response-status-${ticket.ticketId}" class="response-status"></div>
            </div>
          </div>
        `).join('')}
      </div>
      
      <script>
        const adminKey = new URLSearchParams(window.location.search).get('key');
        
        async function closeTicket(ticketId) {
          if (!confirm('Are you sure you want to close this ticket? This action cannot be undone.')) {
            return;
          }
          
          const statusDiv = document.getElementById('close-status-' + ticketId);
          statusDiv.className = 'close-status';
          statusDiv.textContent = 'Closing...';
          
          try {
            const response = await fetch(\`/api/admin/tickets/\${encodeURIComponent(ticketId)}/close?key=\${encodeURIComponent(adminKey)}\`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              }
            });
            
            const data = await response.json();
            
            if (response.ok) {
              statusDiv.className = 'close-status success';
              statusDiv.textContent = '✅ Ticket closed successfully!';
              setTimeout(() => {
                location.reload();
              }, 1000);
            } else {
              throw new Error(data.error || 'Failed to close ticket');
            }
          } catch (error) {
            statusDiv.className = 'close-status error';
            statusDiv.textContent = '❌ Error: ' + error.message;
          }
        }
        
        async function submitResponse(ticketId) {
          const responseText = document.getElementById('response-' + ticketId).value.trim();
          const status = document.getElementById('status-' + ticketId).value;
          const statusDiv = document.getElementById('response-status-' + ticketId);
          
          if (!responseText) {
            statusDiv.className = 'response-status error';
            statusDiv.textContent = 'Please enter a response message.';
            return;
          }
          
          statusDiv.className = 'response-status';
          statusDiv.textContent = 'Sending...';
          
          try {
            const response = await fetch(\`/api/admin/tickets/\${encodeURIComponent(ticketId)}/respond?key=\${encodeURIComponent(adminKey)}\`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                response: responseText,
                status: status
              })
            });
            
            const data = await response.json();
            
            if (response.ok) {
              statusDiv.className = 'response-status success';
              statusDiv.textContent = '✅ Response sent successfully!';
              document.getElementById('response-' + ticketId).value = '';
              setTimeout(() => {
                location.reload();
              }, 1000);
            } else {
              throw new Error(data.error || 'Failed to send response');
            }
          } catch (error) {
            statusDiv.className = 'response-status error';
            statusDiv.textContent = '❌ Error: ' + error.message;
          }
        }
      </script>
    </body>
    </html>
  `;

  res.send(html);
  } catch (error) {
    console.error('Admin tickets page error:', error);
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1>❌ Error</h1>
          <p>Failed to load tickets. Please try again later.</p>
        </body>
      </html>
    `);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Backend proxy running on port ${PORT}`);
  console.log(`📋 Admin tickets page: http://localhost:${PORT}/admin/tickets?key=focufy-admin-2024`);
  console.log(`📋 Admin API: http://localhost:${PORT}/api/admin/tickets?key=focufy-admin-2024`);
  console.log(`🌐 Health check: http://localhost:${PORT}/`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});

