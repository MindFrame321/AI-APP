// Minimal backend for Render to serve the extension LLM proxy and health
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
console.log('BOOT_MARKER_2026_01_06 :: backend-example/server.js is running');

const app = express();
app.use(express.json());

// Permissive CORS + OPTIONS for now (for Chrome extension)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Whoami/debug
app.get('/__whoami', (req, res) => {
  res.json({
    ok: true,
    file: 'backend-example/server.js',
    cwd: process.cwd(),
    ts: new Date().toISOString()
  });
});

// Root health/info
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Focufy Backend API', ts: new Date().toISOString() });
});

// Render health check path
app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// Simple GET hint for chat
app.get('/api/chat', (req, res) => {
  res.json({ ok: true, hint: 'Use POST /api/chat with { prompt }' });
});

// OpenRouter proxy
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt required' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    console.log('[/api/chat] hit. OPENROUTER_API_KEY present:', Boolean(apiKey));
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY is not set on the server' });
    }

    console.log('[/api/chat] calling OpenRouter...');
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://focufy-extension-1.onrender.com',
        'X-Title': 'Focufy Extension'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const text = await r.text();
    if (!r.ok) {
      console.error('[OpenRouter] error status:', r.status, 'body:', text);
      return res.status(r.status).json({ error: text || 'OpenRouter error' });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('[OpenRouter] failed to parse JSON:', text);
      return res.status(500).json({ error: 'Invalid JSON from OpenRouter' });
    }

    const content = data?.choices?.[0]?.message?.content;
    return res.json({ content: content || '' });
  } catch (err) {
    console.error('[OpenRouter] unexpected error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
console.log(
  'WHOAMI_MARKER_2026_01_06 :: starting backend-example/server.js',
  { cwd: process.cwd(), port: PORT }
);
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
