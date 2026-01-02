# Fix Chrome Extension OAuth "invalid_request" Error

## Error: "invalid_request" with Chrome Extension OAuth Client

This error usually means the OAuth consent screen or Chrome Extension OAuth client isn't fully configured.

## Step-by-Step Fix

### Step 1: Configure OAuth Consent Screen

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **APIs & Services** → **OAuth consent screen**
4. Configure the consent screen:
   - **User Type**: Select **External** (or Internal if you have Google Workspace)
   - Click **Create**
   - **App name**: `Focufy` (or your app name)
   - **User support email**: Your email
   - **Developer contact information**: Your email
   - Click **Save and Continue**

5. **Scopes**:
   - Click **Add or Remove Scopes**
   - Click **Add Scopes** button
   - Search for and add:
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
   - Click **Update** → **Save and Continue**

6. **Test users** (if using External):
   - Click **Add Users**
   - Add your email: `prithivponns@gmail.com`
   - Click **Add** → **Save and Continue**

7. **Summary**: Review and click **Back to Dashboard**

### Step 2: Verify Chrome Extension OAuth Client

1. Go to **APIs & Services** → **Credentials**
2. Find your Chrome Extension OAuth client: `42484888880-lpmdq3tm3btgsb793d1qj3hi62r1ffo0`
3. Click **Edit** (pencil icon)
4. **Application ID**: 
   - Get your extension ID from `chrome://extensions/` (enable Developer mode)
   - Add it to the "Application ID" field
   - Or leave it blank (works for all extensions)
5. Click **Save**

### Step 3: Verify manifest.json

Make sure your `manifest.json` has:

```json
"oauth2": {
  "client_id": "42484888880-lpmdq3tm3btgsb793d1qj3hi62r1ffo0.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]
}
```

### Step 4: Reload Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Find your extension
4. Click the **Reload** icon (circular arrow)
5. Try signing in again

## Common Issues

### Issue 1: OAuth Consent Screen Not Configured
**Solution**: Complete Step 1 above - the consent screen must be configured before OAuth clients work.

### Issue 2: Test User Not Added
**Solution**: If using External user type, add your email as a test user in Step 1.

### Issue 3: Scopes Not Added
**Solution**: Make sure the scopes are added in the OAuth consent screen (Step 1).

### Issue 4: Extension ID Mismatch
**Solution**: Either add your extension ID to the OAuth client, or leave it blank to work for all extensions.

## Still Not Working?

1. **Wait 5-10 minutes**: OAuth changes can take time to propagate
2. **Clear browser cache**: Sometimes cached OAuth errors persist
3. **Check browser console**: Open Developer Tools (F12) → Console tab for detailed errors
4. **Try incognito mode**: To rule out extension conflicts

## Verification

After setup, you should be able to:
1. Click "Sign in with Google" in the extension
2. See Google's consent screen
3. Sign in successfully
4. See your profile in the extension

---

**Note**: The OAuth consent screen must be configured before any OAuth clients will work. This is a Google requirement.

