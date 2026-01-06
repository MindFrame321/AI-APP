const express = require('express');
const cors = require('cors');
const { OAuth2Client, GoogleAuth } = require('google-auth-library');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const MODEL_LOCK = 'nvidia/nemotron-3-nano-30b-a3b:free';
console.log('MODEL_LOCKED_TO=', MODEL_LOCK);
const HAS_OR_KEY = Boolean(process.env.OPENROUTER_API_KEY);
console.log('OpenRouter API key configured:', HAS_OR_KEY);

const app = express();
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json());

// Basic health + debug routes (kept public for debugging Render routing)
app.get('/__whoami', (req, res) => {
  res.json({
    ok: true,
    entryFile: __filename,
    cwd: process.cwd(),
    ts: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, hasOpenRouterKey: HAS_OR_KEY });
});

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'Focufy Backend API', hasOpenRouterKey: HAS_OR_KEY });
});

app.get('/debug/model', (req, res) => {
  res.json({
    model: MODEL_LOCK,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY)
  });
});

app.get('/api/chat', (req, res) => {
  res.json({ ok: true, hint: 'Use POST with {prompt}', model: MODEL_LOCK });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt required', model: MODEL_LOCK, status: 400 });
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY not set', model: MODEL_LOCK, status: 500 });
    }
    console.log('[/api/chat] prompt length:', prompt.length, 'using model:', MODEL_LOCK);
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://focufy-extension-1.onrender.com',
        'X-Title': 'Focufy Extension'
      },
      body: JSON.stringify({
        model: MODEL_LOCK,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const text = await r.text();
    if (!r.ok) {
      console.error('[OpenRouter] status', r.status, 'body:', text);
      return res.status(r.status).json({ error: text || 'OpenRouter error', status: r.status, model: MODEL_LOCK });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('[OpenRouter] JSON parse error:', text);
      return res.status(500).json({ error: 'Invalid JSON from OpenRouter', status: 500, model: MODEL_LOCK });
    }
    const content = data?.choices?.[0]?.message?.content || '';
    return res.json({ content, model: MODEL_LOCK });
  } catch (e) {
    console.error('[OpenRouter] unexpected error:', e);
    return res.status(500).json({ error: 'Server error', status: 500, model: MODEL_LOCK });
  }
});

// CONFIGURATION
const GOOGLE_CLIENT_ID = '42484888880-r0rgoel8vrhmk5tsdtfibb0jot3vgksd.apps.googleusercontent.com'; // Same as extension
const GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID; // Your Google Cloud Project ID
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Fallback API key (if auto-generation fails)

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
    
    // Get Service Account token
    const authClient = await serviceAccountAuth.getClient();
    const token = await authClient.getAccessToken();
    
    if (!token) {
      throw new Error('Failed to get Service Account access token');
    }
    
    // Create API key via Google Cloud API Key Management API
    const apiKeyResponse = await fetch(
      `https://apikeys.googleapis.com/v2/projects/${GOOGLE_CLOUD_PROJECT_ID}/keys`,
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
      console.error('API Key creation failed:', errorText);
      throw new Error(`Failed to create API key: ${apiKeyResponse.status} - ${errorText}`);
    }
    
    const keyData = await apiKeyResponse.json();
    
    // The response contains the key name, but we need to get the actual key string
    // We need to make another call to get the key string
    const keyName = keyData.name;
    
    // Get the actual key string
    const keyDetailsResponse = await fetch(
      `https://apikeys.googleapis.com/v2/${keyName}/keyString`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (keyDetailsResponse.ok) {
      const keyDetails = await keyDetailsResponse.json();
      return keyDetails.keyString;
    }
    
    // If we can't get the key string, return the key name (some APIs return it directly)
    return keyData.keyString || keyName;
    
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend proxy running on port ${PORT}`);
});
