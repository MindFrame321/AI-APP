# Security Setup Guide for Focufy Backend

This guide covers setting up Cloudflare protection and implementing security best practices for your Focufy backend.

## Table of Contents
1. [Cloudflare Setup (Free Tier)](#cloudflare-setup-free-tier)
2. [Security Improvements](#security-improvements)
3. [Environment Variables](#environment-variables)
4. [Testing Security](#testing-security)

---

## Cloudflare Setup (Free Tier)

### Step 1: Create Cloudflare Account
1. Go to https://dash.cloudflare.com/sign-up
2. Sign up for a free account (no credit card required)
3. Verify your email

### Step 2: Add Your Domain
1. In Cloudflare dashboard, click "Add a Site"
2. Enter your Render domain: `focufy-extension-1.onrender.com`
3. Select the **Free** plan
4. Click "Continue"

### Step 3: Configure DNS
1. Cloudflare will scan your DNS records
2. For Render, you'll need to add a CNAME record:
   - **Type**: CNAME
   - **Name**: @ (or your subdomain)
   - **Target**: `focufy-extension-1.onrender.com`
   - **Proxy status**: Proxied (orange cloud) ✅
3. Click "Continue"

### Step 4: Update Nameservers (If Using Custom Domain)
If you're using a custom domain (not just Render's domain):
1. Copy the nameservers Cloudflare provides
2. Go to your domain registrar
3. Update nameservers to Cloudflare's
4. Wait for DNS propagation (usually 5-30 minutes)

### Step 5: Enable Security Features
1. Go to **Security** → **WAF** (Web Application Firewall)
2. Enable **Managed Rules**:
   - ✅ Cloudflare Managed Ruleset
   - ✅ OWASP Core Ruleset (free tier includes basic rules)
3. Go to **Security** → **Rate Limiting**
4. Create a rate limit rule:
   - **Rule name**: API Rate Limit
   - **Match**: URI Path contains `/api/`
   - **Requests**: 100 per minute per IP
   - **Action**: Block
   - Click "Deploy"

### Step 6: SSL/TLS Settings
1. Go to **SSL/TLS** → **Overview**
2. Set encryption mode to **Full (strict)**
3. Enable **Always Use HTTPS**
4. Enable **Automatic HTTPS Rewrites**

### Step 7: Firewall Rules (Optional but Recommended)
1. Go to **Security** → **WAF** → **Custom Rules**
2. Create a rule to block suspicious requests:
   - **Rule name**: Block SQL Injection Attempts
   - **Expression**: `(http.request.uri.query contains "union") or (http.request.uri.query contains "select")`
   - **Action**: Block
   - Click "Deploy"

### Step 8: Get Your Cloudflare IP Ranges (For Backend Whitelist)
1. Go to https://www.cloudflare.com/ips/
2. Note the IPv4 and IPv6 ranges
3. You can use these to verify requests are coming from Cloudflare (optional)

---

## Security Improvements

The following security improvements have been implemented in the code:

### 1. CORS Restrictions
- CORS is now restricted to your extension's origin
- Only requests from Chrome extensions are allowed
- Prevents unauthorized websites from calling your API

### 2. Admin Key Security
- Removed default admin key from code
- Admin key must be set via `ADMIN_KEY` environment variable
- No fallback default value

### 3. Input Validation
- Added validation for all user inputs
- Sanitizes ticket messages and responses
- Prevents injection attacks

### 4. Request Size Limits
- Added body size limit (1MB) to prevent large payload attacks
- Protects against memory exhaustion

### 5. Health Check Security
- Removed sensitive endpoint information from health check
- Only shows basic status

---

## Environment Variables

Make sure these are set in your Render dashboard:

### Required Variables:
```
ADMIN_KEY=your-secure-random-key-here
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GEMINI_API_KEY=your-fallback-api-key
SERVICE_ACCOUNT_KEY=your-service-account-json
MONGODB_URI=your-mongodb-connection-string
```

### Optional Variables:
```
RESEND_API_KEY=your-resend-api-key (for email notifications)
RESEND_FROM_EMAIL=noreply@yourdomain.com
SUPPORT_EMAIL=your-support-email
PORT=10000 (default)
```

### Generating a Secure Admin Key:
```bash
# Generate a random 32-character key
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Or use an online generator: https://randomkeygen.com/

---

## Testing Security

### Test 1: CORS Protection
```bash
# This should fail (not from extension origin)
curl -X POST https://focufy-extension-1.onrender.com/api/support/tickets \
  -H "Origin: https://evil-site.com" \
  -H "Content-Type: application/json"
```

### Test 2: Admin Key Protection
```bash
# This should fail (wrong key)
curl https://focufy-extension-1.onrender.com/api/admin/tickets?key=wrong-key
```

### Test 3: Authentication Required
```bash
# This should fail (no token)
curl -X POST https://focufy-extension-1.onrender.com/api/support/tickets \
  -H "Content-Type: application/json" \
  -d '{"subject":"test","message":"test"}'
```

---

## Cloudflare Dashboard Monitoring

### Key Metrics to Monitor:
1. **Security** → **Events**: View blocked requests
2. **Analytics** → **Web Traffic**: Monitor traffic patterns
3. **Security** → **WAF**: Check firewall rule triggers
4. **Security** → **Rate Limiting**: Monitor rate limit hits

### Alerts Setup:
1. Go to **Notifications**
2. Set up email alerts for:
   - High number of blocked requests
   - DDoS attacks detected
   - Rate limit violations

---

## Additional Security Recommendations

### 1. Regular Updates
- Keep dependencies updated: `npm audit` and `npm update`
- Monitor security advisories for Express, MongoDB, etc.

### 2. Logging
- Monitor backend logs on Render
- Set up log aggregation (optional, paid services)

### 3. Database Security
- Use MongoDB Atlas with IP whitelisting
- Enable MongoDB authentication
- Regular backups

### 4. API Key Rotation
- Rotate admin keys periodically
- Rotate service account keys if compromised

### 5. Monitoring
- Set up uptime monitoring (UptimeRobot, Pingdom - both have free tiers)
- Monitor error rates
- Set up alerts for unusual activity

---

## Troubleshooting

### Issue: Cloudflare blocking legitimate requests
**Solution**: 
1. Go to Cloudflare Dashboard → Security → WAF
2. Check "Recent Events" to see what's being blocked
3. Create an exception rule if needed

### Issue: CORS errors in extension
**Solution**: 
1. Check that extension origin is in allowed list
2. Verify Chrome extension ID hasn't changed
3. Check browser console for exact error

### Issue: Admin dashboard not accessible
**Solution**:
1. Verify `ADMIN_KEY` environment variable is set in Render
2. Check that you're using the correct key in URL
3. Verify key matches exactly (no extra spaces)

---

## Cost Summary

### Free Tier (What You're Using):
- ✅ Cloudflare: $0/month
- ✅ Render: $0/month (free tier)
- ✅ MongoDB Atlas: $0/month (free tier M0)
- ✅ Total: **$0/month**

### If You Scale Up:
- Render: $7/month (Starter) for better performance
- MongoDB Atlas: Free tier is usually enough
- Cloudflare: Still free for most use cases

---

## Support

If you encounter issues:
1. Check Cloudflare dashboard for blocked requests
2. Check Render logs for backend errors
3. Review this guide for common issues
4. Contact support if needed

---

**Last Updated**: 2024
**Version**: 1.0

