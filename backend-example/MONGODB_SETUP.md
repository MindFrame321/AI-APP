# MongoDB Setup for Focufy Backend

## Quick Setup with MongoDB Atlas (Free Tier)

1. **Create a MongoDB Atlas Account**
   - Go to https://www.mongodb.com/cloud/atlas/register
   - Sign up for a free account

2. **Create a Cluster**
   - Choose "Free" tier (M0)
   - Select a cloud provider and region
   - Click "Create Cluster"

3. **Create Database User**
   - Go to "Database Access" → "Add New Database User"
   - Choose "Password" authentication
   - Username: `focufy-user` (or your choice)
   - Password: Generate a secure password (save it!)
   - Database User Privileges: "Atlas admin" or "Read and write to any database"
   - Click "Add User"

4. **Configure Network Access**
   - Go to "Network Access" → "Add IP Address"
   - Click "Allow Access from Anywhere" (for Render deployment)
   - Or add specific IPs for security
   - Click "Confirm"

5. **Get Connection String**
   - Go to "Database" → "Connect"
   - Choose "Connect your application"
   - Copy the connection string
   - It looks like: `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   - Replace `<username>` and `<password>` with your database user credentials
   - Add database name: `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/focufy?retryWrites=true&w=majority`

6. **Set Environment Variable on Render**
   - Go to your Render service dashboard
   - Navigate to "Environment" tab
   - Add new environment variable:
     - **Key**: `MONGODB_URI`
     - **Value**: Your connection string from step 5
   - Click "Save Changes"
   - Render will automatically redeploy

## Example Connection String Format

```
mongodb+srv://focufy-user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/focufy?retryWrites=true&w=majority
```

## Verification

After deployment, check your Render logs. You should see:
- `✅ MongoDB connected successfully` - MongoDB is working
- `⚠️ MONGODB_URI not set, using in-memory storage` - MongoDB not configured (fallback mode)

## Benefits

- ✅ Tickets persist across server restarts
- ✅ No data loss
- ✅ Scalable for production
- ✅ Free tier available (512MB storage)

## Fallback Mode

If `MONGODB_URI` is not set, the server will use in-memory storage. This works for testing but data will be lost on server restart.

