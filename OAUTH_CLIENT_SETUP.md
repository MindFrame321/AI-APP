# Fix OAuth Client Setup for Automatic Sign-In

## The Problem

Your OAuth client is set as a **"Web application"** type, which requires manual redirect URI configuration for each extension instance. This doesn't work well for distributed extensions.

## The Solution

Create a **"Chrome App"** OAuth client instead. This works automatically with `chrome.identity.getAuthToken` and doesn't require any redirect URI configuration.

## Step-by-Step Setup

### Step 1: Create a New Chrome App OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **APIs & Services** → **Credentials**
4. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
5. If prompted, configure the OAuth consent screen first:
   - User Type: **External** (or Internal if you have Google Workspace)
   - App name: **Focufy**
   - User support email: Your email
   - Developer contact: Your email
   - Click **Save and Continue**
   - Scopes: Click **Add or Remove Scopes**
     - Add: `.../auth/userinfo.email`
     - Add: `.../auth/userinfo.profile`
   - Click **Save and Continue**
   - Test users: Add your email (if using External)
   - Click **Save and Continue**

6. **Application type**: Select **"Chrome App"**
7. **Application ID**: This is your extension ID
   - To find it: Go to `chrome://extensions/` → Enable Developer mode → Find your extension → Copy the ID
   - Or leave it blank for now (you can add it later)

8. Click **Create**
9. **Copy the Client ID** (it will look like: `123456789-abcdefg.apps.googleusercontent.com`)

### Step 2: Update manifest.json

1. Open `manifest.json`
2. Update the `oauth2.client_id` with your new Chrome App client ID:

```json
"oauth2": {
  "client_id": "YOUR_NEW_CHROME_APP_CLIENT_ID",
  "scopes": [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]
}
```

### Step 3: Test

1. Reload your extension in `chrome://extensions/`
2. Try signing in with Google
3. It should work automatically! ✅

## Why This Works

- **Chrome App OAuth clients** are designed for Chrome extensions
- `chrome.identity.getAuthToken` works automatically with Chrome App clients
- **No redirect URI configuration needed** - Chrome handles it
- Works for everyone who downloads your extension

## Alternative: Keep Web Application Client

If you want to keep using the Web application client, you need to:

1. Get each user's extension ID
2. Add their redirect URI: `https://THEIR_EXTENSION_ID.chromiumapp.org/`
3. This is not scalable for distributed extensions

**Recommendation**: Use Chrome App OAuth client for automatic sign-in.

## Troubleshooting

### "Invalid client" error
- Make sure you're using the Chrome App client ID (not the Web application one)
- Verify the client ID in `manifest.json` matches the one in Google Cloud Console

### "Access denied" error
- Make sure the OAuth consent screen is configured
- Add test users if using External user type
- Wait a few minutes for changes to propagate

### Still not working?
- Check browser console for exact error messages
- Verify the extension ID matches in Google Cloud Console (if you added it)
- Try removing and re-adding the extension

