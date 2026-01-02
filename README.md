# Focufy Backend - Automatic API Key Generation

This backend server automatically generates API keys for each user using their Google account, with just one-click consent.

## Features

- ✅ **Automatic API key generation** using user's Google account
- ✅ **One-click consent** - user just grants permission
- ✅ **Per-user API keys** - each user gets their own key (10 req/sec each)
- ✅ **Infinite scaling** - supports unlimited users
- ✅ **Google OAuth authentication**
- ✅ **No rate limit issues** - each user has their own quota

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Set up Google Cloud Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project (or use existing)
   - Enable "API Keys API" and "Generative Language API"
   - Note your Project ID

3. **Set environment variables:**
```bash
# Required: Your Google Cloud Project ID
export GOOGLE_CLOUD_PROJECT_ID="your-project-id"

# Required: A service account key or fallback API key
export GEMINI_API_KEY="your-fallback-api-key"

# Optional: Service Account JSON (for automatic key generation)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
# OR
export SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'

# Optional: Server port
export PORT=3000
```

4. **Run the server:**
```bash
node server.js
```

## How It Works

1. **User signs in** with Google (simple OAuth, no special scopes needed)
2. **User clicks "Generate API Key"** button (one-time consent)
3. **Backend automatically generates key** using Service Account
4. **Key is created in YOUR Google Cloud project** (tied to user's email)
5. **Key is stored** securely on backend
6. **User gets unlimited requests** (10 req/sec per key, their own quota)

## Key Points

- ✅ **No special OAuth scopes needed** - regular Google sign-in works
- ✅ **Service Account handles key creation** - fully automatic
- ✅ **Each user gets their own key** - scales infinitely
- ✅ **Keys created in YOUR project** - you manage them
- ✅ **10 req/sec per user** - no shared limits

## API Endpoints

### POST `/api/user-api-key`
Save or update a user's API key.

**Headers:**
```
Authorization: Bearer <google-oauth-token>
```

**Body:**
```json
{
  "apiKey": "AIza..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "API key saved successfully",
  "hasApiKey": true
}
```

### GET `/api/user-api-key`
Get user's API key status.

**Headers:**
```
Authorization: Bearer <google-oauth-token>
```

**Response:**
```json
{
  "hasApiKey": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "lastUsed": "2024-01-01T12:00:00.000Z"
}
```

### POST `/api/analyze-page`
Proxy endpoint for Gemini API (uses user's API key or fallback).

**Headers:**
```
Authorization: Bearer <google-oauth-token>
```

**Body:**
```json
{
  "prompt": "Analyze this page...",
  "model": "gemini-flash-lite-latest"
}
```

## Production Considerations

⚠️ **Important:** This example uses in-memory storage. For production:

1. **Use a Database:**
   - Store `userApiKeys` in PostgreSQL, MongoDB, or similar
   - Store `userUsage` in Redis for fast lookups

2. **Add Security:**
   - Encrypt API keys at rest
   - Use HTTPS only
   - Add rate limiting middleware
   - Add request validation

3. **Add Monitoring:**
   - Log API usage
   - Track errors
   - Monitor rate limits

## Example Database Schema

```sql
CREATE TABLE user_api_keys (
  user_id VARCHAR(255) PRIMARY KEY,
  api_key_encrypted TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used TIMESTAMP,
  usage_count INTEGER DEFAULT 0
);

CREATE TABLE user_usage (
  user_id VARCHAR(255),
  date DATE,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
```

## Deployment

Deploy to:
- **Heroku:** `git push heroku main`
- **Railway:** Connect GitHub repo
- **Render:** Create Web Service
- **Vercel/Netlify:** For serverless functions

Make sure to set `GEMINI_API_KEY` environment variable in your hosting platform.

