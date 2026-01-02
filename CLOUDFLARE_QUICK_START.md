# Quick Start: Adding Your Site to Cloudflare

## TL;DR - Do You Have a Custom Domain?

### ❌ If you're using `focufy-extension-1.onrender.com` (Render's domain):
**You CANNOT add this to Cloudflare directly.** Cloudflare only works with custom domains you own.

**What to do:**
- Skip Cloudflare for now
- Your backend is already secure with the code improvements
- Get a custom domain later if you want Cloudflare protection

### ✅ If you have a custom domain (e.g., `focufy.com`):
Follow the steps below!

---

## Step-by-Step: Adding Custom Domain to Cloudflare

### Step 1: Sign Up for Cloudflare (Free)
1. Go to: **https://dash.cloudflare.com/sign-up**
2. Enter your email and password
3. Click "Sign up"
4. Verify your email

### Step 2: Add Your Domain
1. After logging in, you'll see the dashboard
2. Look for a big button that says **"Add a Site"** or **"Add Site"**
3. Click it
4. Enter your domain (e.g., `focufy.com` - **without** `https://` or `www`)
5. Click **"Add site"**

### Step 3: Choose Plan
1. You'll see pricing options
2. Select **"Free"** plan (it's on the left, $0/month)
3. Click **"Continue"**

### Step 4: Review DNS Records
1. Cloudflare will scan your domain's DNS records
2. Wait 30-60 seconds for the scan
3. You'll see a list of your existing DNS records
4. Review them - make sure they look correct
5. Make sure the **Proxy status** shows orange clouds ☁️ (this means Cloudflare will protect your site)

### Step 5: Update Nameservers (IMPORTANT!)
This is the key step that connects your domain to Cloudflare:

1. **Cloudflare will show you 2 nameservers**, something like:
   - `alice.ns.cloudflare.com`
   - `bob.ns.cloudflare.com`

2. **Copy both nameservers** (you'll need them)

3. **Go to your domain registrar** (where you bought the domain):
   - GoDaddy: https://www.godaddy.com
   - Namecheap: https://www.namecheap.com
   - Google Domains: https://domains.google
   - Or wherever you bought your domain

4. **Find DNS/Nameserver settings:**
   - Log into your registrar account
   - Find your domain in the list
   - Click on it
   - Look for "DNS" or "Nameservers" or "Name Servers"
   - Click "Change" or "Edit"

5. **Replace the nameservers:**
   - Delete the existing nameservers
   - Add the two Cloudflare nameservers you copied
   - Save the changes

6. **Go back to Cloudflare:**
   - Click **"Continue"** or **"Done"**
   - Cloudflare will start checking if the nameservers are updated
   - This can take 5-30 minutes (sometimes up to 48 hours)

### Step 6: Point Domain to Render

Once Cloudflare is active (you'll see "Active" status):

1. **In Cloudflare Dashboard:**
   - Click on your domain
   - Go to **"DNS"** in the left sidebar
   - Click **"Add record"**

2. **Add CNAME record:**
   - **Type**: Select **"CNAME"** from dropdown
   - **Name**: Enter `api` (or `www` or leave blank for root domain)
   - **Target**: Enter `focufy-extension-1.onrender.com`
   - **Proxy status**: Make sure it's **Proxied** (orange cloud ☁️)
   - Click **"Save"**

3. **In Render Dashboard:**
   - Go to your service settings
   - Add your custom domain
   - Render will verify the domain

### Step 7: Wait for DNS Propagation
- Usually takes 5-30 minutes
- Can take up to 48 hours in rare cases
- You can check status in Cloudflare dashboard

### Step 8: Test
1. Visit your domain: `https://api.yourdomain.com` (or whatever you set up)
2. It should load your Render service
3. Check for the lock icon (SSL certificate)

---

## Visual Guide: Where to Find "Add a Site"

When you log into Cloudflare dashboard:

```
┌─────────────────────────────────────┐
│  Cloudflare Dashboard               │
│                                     │
│  ┌───────────────────────────────┐ │
│  │                               │ │
│  │   [Add a Site]  ← Click here! │ │
│  │                               │ │
│  └───────────────────────────────┘ │
│                                     │
│  Or look in the top right corner:   │
│  [Add Site] button                  │
└─────────────────────────────────────┘
```

---

## Troubleshooting

### "I don't see 'Add a Site' button"
- Make sure you're logged in
- Try refreshing the page
- Look in the top navigation bar

### "Cloudflare says my domain is already added"
- Someone else might have added it
- Check if you have access to the Cloudflare account
- Contact Cloudflare support if needed

### "I can't find where to change nameservers"
- Every registrar is different
- Look for: "DNS Settings", "Name Servers", "Nameservers", or "DNS Management"
- If you can't find it, contact your registrar's support

### "My site isn't loading after changing nameservers"
- Wait longer (can take up to 48 hours)
- Check Cloudflare dashboard for errors
- Make sure you copied the nameservers correctly
- Verify the CNAME record points to your Render service

---

## Don't Have a Custom Domain?

**No problem!** Your backend is already secure with:
- ✅ CORS protection
- ✅ Input validation
- ✅ Admin key security
- ✅ Request size limits
- ✅ Render's built-in DDoS protection

You can add Cloudflare later when you get a domain (usually $10-15/year).

---

## Need Help?

1. Check Cloudflare's docs: https://developers.cloudflare.com/
2. Cloudflare Community: https://community.cloudflare.com/
3. Render Support: https://render.com/docs

---

**Remember**: Cloudflare only works with custom domains you own. If you're using Render's free domain, skip Cloudflare for now and rely on the code-level security we've implemented.

