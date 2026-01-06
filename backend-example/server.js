// Minimal backend for Render to serve the extension LLM proxy and health
const express = require('express');
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

// Simple echo for routing proof
app.post('/api/chat', (req, res) => {
  return res.json({ content: 'hello from /api/chat' });
});

const PORT = process.env.PORT || 3000;
console.log(
  'WHOAMI_MARKER_2026_01_06 :: starting backend-example/server.js',
  { cwd: process.cwd(), port: PORT }
);
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
