# OAuth Web Application Setup for Multiple Users

## The Problem

When using a **Web application** OAuth client with unpacked Chrome extensions, each user gets a **different extension ID**, which means each user needs their own **redirect URI** added to the OAuth client.

## Current Setup

- **OAuth Client Type**: Web application
- **Client ID**: `42484888880-o3h9svrq1cp5u53hhlrooeohmin89pci.apps.googleusercontent.com`
- **Method**: `chrome.identity.launchWebAuthFlow`

## How to Add Redirect URIs

### For You (First User)

1. Open Chrome DevTools (F12) in the extension popup
2. Go to Console tab
3. Run: `chrome.identity.getRedirectURL()`
4. Copy the URL (e.g., `https://YOUR_EXTENSION_ID.chromiumapp.org/`)
5. Go to: https://console.cloud.google.com/apis/credentials
6. Click on OAuth client: `42484888880-o3h9svrq1cp5u53hhlrooeohmin89pci`
7. Under "Authorized redirect URIs", click "+ ADD URI"
8. Paste your redirect URI
9. Click "SAVE"
10. Wait 2-3 minutes

### For Your Friend (Second User)

1. Your friend loads the extension (unpacked)
2. Your friend opens Chrome DevTools (F12) in the extension popup
3. Your friend goes to Console tab
4. Your friend runs: `chrome.identity.getRedirectURL()`
5. Your friend copies their redirect URI
6. **You** (or your friend with access) go to: https://console.cloud.google.com/apis/credentials
7. Click on OAuth client: `42484888880-o3h9svrq1cp5u53hhlrooeohmin89pci`
8. Under "Authorized redirect URIs", click "+ ADD URI"
9. Paste your friend's redirect URI
10. Click "SAVE"
11. Wait 2-3 minutes

## Alternative Solutions

### Option 1: Publish to Chrome Web Store (Recommended)

If you publish the extension to the Chrome Web Store, **all users get the same extension ID**, so you only need to add **one redirect URI** that works for everyone.

### Option 2: Use Chrome Extension OAuth Client

If you switch to a "Chrome Extension" OAuth client, you can use `chrome.identity.getAuthToken` which doesn't require redirect URIs. However, you mentioned Chrome Extension clients don't work for you.

### Option 3: Backend OAuth Proxy

Create a backend server that handles OAuth and redirects to a single URL. This is more complex but works for all users.

## Current Error

If you see: **"Error 400: invalid_request"**

This means your redirect URI is not in the OAuth client's "Authorized redirect URIs" list.

**Fix**: Add your redirect URI (from `chrome.identity.getRedirectURL()`) to the OAuth client.

