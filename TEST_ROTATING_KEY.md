# How to Test the Rotating Admin Key System

## Quick Test Steps

### Step 1: Get Your Current Key

**Option A: Via API Endpoint (Recommended)**
```
https://focufy-extension-1.onrender.com/admin/get-key?masterKey=YOUR_MASTER_KEY
```

Replace `YOUR_MASTER_KEY` with the `ADMIN_KEY` value you set in Render.

**Expected Response:**
```json
{
  "success": true,
  "currentKey": "a1b2c3d4e5f6...",
  "expiresIn": 8,
  "expiresAt": "2024-01-15T10:10:00.000Z",
  "note": "This key rotates every 10 minutes..."
}
```

**Option B: Via Admin Dashboard**
1. Go to: `https://focufy-extension-1.onrender.com/admin/tickets?key=YOUR_MASTER_KEY`
2. You'll see the current rotating key displayed at the top of the page

### Step 2: Test Access with Rotating Key

1. Copy the `currentKey` from Step 1
2. Access the admin dashboard:
   ```
   https://focufy-extension-1.onrender.com/admin/tickets?key=CURRENT_ROTATING_KEY
   ```
3. ✅ **Should work** - You should see the tickets dashboard

### Step 3: Test Master Key Still Works

Try accessing with your master key directly:
```
https://focufy-extension-1.onrender.com/admin/tickets?key=YOUR_MASTER_KEY
```

✅ **Should work** - Master key always works for emergency access

### Step 4: Test Invalid Key

Try with a wrong key:
```
https://focufy-extension-1.onrender.com/admin/tickets?key=wrong-key-12345
```

❌ **Should fail** - You should see "Unauthorized" error

### Step 5: Verify Key Rotation (Wait 10+ Minutes)

1. Get the current key (Step 1)
2. Wait 10+ minutes
3. Get the key again
4. Compare the two keys - they should be **different**

### Step 6: Test Old Key After Rotation

1. Get a key at time T
2. Wait 10+ minutes (key rotates)
3. Try using the old key from time T
4. ❌ **Should fail** - Old keys stop working after rotation

---

## Quick Test Script

You can test programmatically using curl:

```bash
# 1. Get current key
curl "https://focufy-extension-1.onrender.com/admin/get-key?masterKey=YOUR_MASTER_KEY"

# 2. Extract the currentKey from response and test it
curl "https://focufy-extension-1.onrender.com/admin/tickets?key=CURRENT_ROTATING_KEY"

# 3. Test master key
curl "https://focufy-extension-1.onrender.com/admin/tickets?key=YOUR_MASTER_KEY"

# 4. Test invalid key (should fail)
curl "https://focufy-extension-1.onrender.com/admin/tickets?key=invalid-key"
```

---

## What to Look For

### ✅ Working Correctly:
- `/admin/get-key` returns a key that changes every 10 minutes
- Current rotating key works for accessing dashboard
- Master key always works
- Invalid keys are rejected
- Old keys stop working after 10 minutes

### ❌ Not Working:
- `/admin/get-key` returns 401 (check master key)
- `/admin/get-key` returns 500 (check ADMIN_KEY env variable)
- Rotating key doesn't work (check key format)
- Keys don't change after 10 minutes (check server time)

---

## Troubleshooting

### Error: "Unauthorized"
- Make sure you're using the correct master key
- Check that `ADMIN_KEY` is set in Render environment variables
- Verify the key matches exactly (no extra spaces)

### Error: "Server configuration error"
- `ADMIN_KEY` environment variable is not set in Render
- Go to Render dashboard → Environment → Add `ADMIN_KEY`

### Keys Not Rotating
- Wait at least 10 minutes and check again
- Keys rotate at 10-minute intervals (e.g., 10:00, 10:10, 10:20)
- Check server logs for errors

### Dashboard Shows Wrong Key
- Refresh the page - it shows the current key
- The key displayed is always the current valid key

---

## Expected Behavior

1. **Key Generation**: Deterministic - same time = same key
2. **Key Rotation**: Every 10 minutes automatically
3. **Key Validity**: Current + previous key both work (for smooth transitions)
4. **Master Key**: Always works (emergency access)
5. **Security**: Old keys expire after rotation

---

**Note**: The rotating key system is designed to enhance security while maintaining usability. The master key always works for emergency access, but using rotating keys is more secure.

