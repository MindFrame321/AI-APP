# OAuth Troubleshooting - Still Getting "invalid_request" Error

If you've configured the OAuth consent screen but still get "invalid_request", try these steps:

## Step 1: Verify Extension ID in OAuth Client

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Find your extension and **copy the Extension ID** (long string like `abcdefghijklmnop...`)

4. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
5. Find your Chrome Extension OAuth client: `42484888880-lpmdq3tm3btgsb793d1qj3hi62r1ffo0`
6. Click **Edit** (pencil icon)
7. In **Application ID** field:
   - **Option A**: Add your extension ID
   - **Option B**: Leave it blank (works for all extensions)
8. Click **Save**

## Step 2: Verify Scopes Match Exactly

### In manifest.json:
```json
"scopes": [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
]
```

### In OAuth Consent Screen:
The scopes should be:
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

**Make sure they match exactly!**

## Step 3: Check OAuth Consent Screen Status

1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Check the status:
   - Should show "Published" or "Testing"
   - If it shows "Not configured", you need to complete the setup

## Step 4: Verify Test Users (If External)

1. Go to OAuth consent screen
2. Click **Test users** tab
3. Make sure `prithivponns@gmail.com` is listed
4. If not, add it

## Step 5: Wait for Propagation

- OAuth changes can take **5-10 minutes** to propagate
- Try again after waiting

## Step 6: Clear Cached Tokens

1. Go to `chrome://extensions/`
2. Find your extension
3. Click **Details**
4. Click **Inspect views: service worker**
5. In the console, run:
```javascript
chrome.identity.getAuthToken({ interactive: false }, (token) => {
  if (token) chrome.identity.removeCachedAuthToken({ token });
});
```

## Step 7: Check Browser Console for Errors

1. Open extension popup
2. Press **F12** to open Developer Tools
3. Go to **Console** tab
4. Try signing in
5. Look for any error messages
6. Share the exact error message

## Step 8: Verify OAuth Client Type

1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Find your OAuth client
3. Check the **Type** column
4. Should say **"Chrome Extension"** (NOT "Web application")

## Step 9: Try Creating a New OAuth Client

If nothing works, create a fresh Chrome Extension OAuth client:

1. Go to Credentials
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Application type: **Chrome Extension**
4. Application ID: Leave blank
5. Click **Create**
6. Copy the new Client ID
7. Update `manifest.json` with the new Client ID
8. Reload extension

## Common Issues

### Issue: "App not verified" warning
**Solution**: This is normal for External apps. Users can click "Advanced" → "Go to Focufy (unsafe)" to proceed.

### Issue: Scopes don't match
**Solution**: Make sure scopes in `manifest.json` exactly match what's in OAuth consent screen.

### Issue: Extension ID mismatch
**Solution**: Either add your extension ID to the OAuth client, or leave it blank to work for all extensions.

### Issue: Still getting errors after all steps
**Solution**: 
1. Check browser console for exact error
2. Verify OAuth consent screen is fully published (not just saved)
3. Try incognito mode to rule out cache issues
4. Wait 10-15 minutes for Google's systems to update

## Need More Help?

Share:
1. Exact error message from browser console
2. Screenshot of OAuth consent screen status
3. Screenshot of OAuth client configuration
4. Your extension ID

