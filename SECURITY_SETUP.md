# Security Setup Guide for Focufy Backend

This guide covers the security measures implemented in your Focufy backend and how to configure them.

## Table of Contents
1. [Security Improvements](#security-improvements)
2. [Environment Variables](#environment-variables)
3. [Testing Security](#testing-security)
4. [Additional Recommendations](#additional-recommendations)

---

## Security Improvements

The following security improvements have been implemented in the code:

### 1. CORS Restrictions
- CORS is now restricted to Chrome extension origins
- Only requests from Chrome extensions are allowed
- Prevents unauthorized websites from calling your API

### 2. Admin Key Security
- Removed default admin key from code
- Admin key must be set via `ADMIN_KEY` environment variable
- No fallback default value - server will error if not configured

### 3. Input Validation
- Added validation for all user inputs
- Sanitizes ticket messages and responses
- Prevents injection attacks
- Maximum length limits:
  - Subject: 200 characters
  - Messages: 5,000 characters
  - Chat messages: 1,000 characters

### 4. Request Size Limits
- Added body size limit (1MB) to prevent large payload attacks
- Protects against memory exhaustion

### 5. Health Check Security
- Removed sensitive endpoint information from health check
- Only shows basic status

### 6. Built-in Protection
- Render provides DDoS protection automatically
- SSL/HTTPS is enabled by default
- Your service is behind Render's infrastructure

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

**Important**: Set `ADMIN_KEY` in Render dashboard. The server will not work without it.

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

### Test 4: Input Validation
```bash
# This should fail (message too long)
curl -X POST https://focufy-extension-1.onrender.com/api/support/tickets \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"test","message":"'$(python3 -c "print('x'*6000)")'"}'
```

---

## Additional Recommendations

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

### 6. Rate Limiting
- Your code already includes rate limiting via `authMiddleware`
- Monitor usage patterns in Render logs
- Adjust limits if needed

---

## Troubleshooting

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

### Issue: "ADMIN_KEY not configured" error
**Solution**:
1. Go to Render dashboard → Environment Variables
2. Add `ADMIN_KEY` with a secure random value
3. Redeploy your service

---

## Cost Summary

### Current Setup (Free Tier):
- ✅ Render: $0/month (free tier)
- ✅ MongoDB Atlas: $0/month (free tier M0)
- ✅ Total: **$0/month**

### If You Scale Up:
- Render: $7/month (Starter) for better performance
- MongoDB Atlas: Free tier is usually enough
- Optional: Custom domain ($10-15/year) if you want a branded URL

---

## Support

If you encounter issues:
1. Check Render logs for backend errors
2. Review this guide for common issues
3. Verify all environment variables are set correctly
4. Contact support if needed

---

**Last Updated**: 2024
**Version**: 1.0
