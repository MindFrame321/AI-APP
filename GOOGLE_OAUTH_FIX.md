# Fix Google Sign-In Redirect URI Error

## Error: `redirect_uri_mismatch`

This error occurs when the redirect URI used by the extension isn't added to your Google Cloud Console OAuth client.

## Quick Fix Steps

### Step 1: Get Your Extension ID

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Find your Focufy extension
4. Copy the **Extension ID** (looks like: `abcdefghijklmnopqrstuvwxyz123456`)

### Step 2: Get Your Redirect URI

Your redirect URI will be:
```
https://YOUR_EXTENSION_ID.chromiumapp.org/
```

For example, if your Extension ID is `abcdefghijklmnopqrstuvwxyz123456`, your redirect URI is:
```
https://abcdefghijklmnopqrstuvwxyz123456.chromiumapp.org/
```

**Or**, you can check the browser console when you try to sign in - it will log the redirect URL.

### Step 3: Add Redirect URI to Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Go to **APIs & Services** → **Credentials**
4. Find your OAuth 2.0 Client ID: `42484888880-r0rgoel8vrhmk5tsdtfibb0jot3vgksd.apps.googleusercontent.com`
5. Click **Edit** (pencil icon)
6. Under **Authorized redirect URIs**, click **+ ADD URI**
7. Add your redirect URI: `https://YOUR_EXTENSION_ID.chromiumapp.org/`
   - **Important**: Include the trailing slash `/`
8. Click **SAVE**

### Step 4: Test Again

1. Reload your extension in `chrome://extensions/`
2. Try signing in with Google again
3. It should work now!

## Alternative: Check Redirect URI in Console

If you're not sure what your Extension ID is:

1. Open the extension popup
2. Open Developer Tools (F12 or right-click → Inspect)
3. Go to Console tab
4. Try to sign in with Google
5. Look for a log message: `Redirect URL: https://...`
6. Copy that exact URL and add it to Google Cloud Console

## Troubleshooting

### Still getting the error?

1. **Double-check the redirect URI**:
   - Must match exactly (including trailing slash)
   - Format: `https://YOUR_EXTENSION_ID.chromiumapp.org/`

2. **Wait a few minutes**:
   - Google Cloud Console changes can take 1-2 minutes to propagate

3. **Check OAuth Client Type**:
   - Make sure your OAuth client is set as **"Web application"** (not "Chrome app" or "Desktop app")

4. **Clear browser cache**:
   - Sometimes cached OAuth errors persist

### Extension ID Changed?

If you reload the extension in developer mode, the Extension ID might change. You'll need to:
1. Get the new Extension ID
2. Add the new redirect URI to Google Cloud Console
3. Or use a stable Extension ID (publish to Chrome Web Store)

## Need Help?

If you're still having issues:
1. Check the browser console for exact error messages
2. Verify the redirect URI matches exactly in Google Cloud Console
3. Make sure the OAuth client is set up as "Web application"

