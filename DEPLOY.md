# SagarSoft Online — Render Deployment Guide

## Prerequisites
1. GitHub repository: `aleemsagarsamad/SagarSoft-Online` (private)
2. Render account: https://dashboard.render.com
3. Supabase project with `SUPABASE_DB_URL`
4. Superadmin credentials (PBKDF2 hash)

## Step 1: Create Web Service on Render
1. Go to **Dashboard → New → Web Service**
2. Connect GitHub repo: `aleemsagarsamad/SagarSoft-Online`
3. Configure:
   - **Name**: `sagarsoftonline`
   - **Region**: Oregon (US West)
   - **Branch**: `main`
   - **Root Directory**: `sagarsoft`
   - **Runtime**: Node
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `cd server && node server.js`
   - **Instance Type**: Free

## Step 2: Set Environment Variables
In Render Dashboard → Service → Environment tab, add:

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `10000` | Required by Render |
| `SUPABASE_DB_URL` | `postgresql://...` | Your Supabase connection string |
| `SUPERADMIN_EMAIL` | `aleemsagarsamad@gmail.com` | Superadmin login |
| `SUPERADMIN_PASSWORD_HASH` | `<PBKDF2 hash>` | Generate with script below |
| `ALLOWED_ORIGINS` | `https://sagarsoftonline.onrender.com` | Comma-separated |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Optional: for edge functions |
| `SUPABASE_ANON_KEY` | `eyJ...` | Optional: for edge functions |

## Step 3: Generate Superadmin Password Hash
Run locally:
```bash
node -e "
const crypto = require('crypto');
const pw = 'YOUR_PASSWORD_HERE';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512').toString('hex');
console.log(JSON.stringify({ hash: hash, salt: salt }));
"
```
Set `SUPERADMIN_PASSWORD_HASH` to the JSON string output.

## Step 4: Configure Build
Render auto-detects `render.yaml` at repo root. If not found, manually set:
- **Build Command**: `cd server && npm install`
- **Start Command**: `cd server && node server.js`

## Step 5: First Deploy
1. Click **Create Web Service**
2. Render will auto-deploy from `main` branch
3. Wait for build to complete (~2-3 min)
4. Service URL: `https://sagarsoftonline.onrender.com`

## Step 6: Verify Deployment
```bash
# Health check
curl https://sagarsoftonline.onrender.com/health

# Expected response:
{
  "success": true,
  "status": "healthy",
  "version": "5.0.0",
  "database": "connected",
  "pool": { "total": 2, "idle": 2, "waiting": 0 },
  "memory": { "rss": "XXMB", "heapUsed": "XXMB" },
  "requests": { "total": 0, "errors": 0 }
}
```

## Step 7: Configure Static Site (Optional)
For serving frontend separately:
1. Create **Static Site** on Render
2. Root Directory: `sagarsoft`
3. Publish Directory: `.`
4. Redirect rules: `/* → /index.html` (for SPA)

## Step 8: Auto-Deploy
Render auto-deploys on push to `main`. To disable:
- Settings → Auto Deploy → Off

## Troubleshooting

### Cold Start (30-60s delay)
Render free tier spins down after 15 min inactivity. First request triggers cold start.
Solution: Upgrade to paid instance or use a cron ping.

### Database Connection Error
- Verify `SUPABASE_DB_URL` is correct
- Check Supabase project is active
- Check IP allowlist (Render IPs: see https://render.com/docs/ip-addresses)

### 502 Bad Gateway
- Check start command: `cd server && node server.js`
- Check PORT env var is `10000`
- Check server logs in Render Dashboard

### Health Endpoint Returns 503
- Database is unreachable
- Check `SUPABASE_DB_URL` env var
- Check Supabase project status

## Environment Variables Checklist
```
NODE_ENV=production
PORT=10000
SUPABASE_DB_URL=postgresql://...
SUPERADMIN_EMAIL=aleemsagarsamad@gmail.com
SUPERADMIN_PASSWORD_HASH={"hash":"...","salt":"..."}
ALLOWED_ORIGINS=https://sagarsoftonline.onrender.com
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check + metrics |
| GET | `/api/version` | None | App version |
| POST | `/api/auth/login` | None | Admin login |
| GET | `/api/database/:schoolId` | JWT | Full database |
| GET | `/api/data/:schoolId/:table` | JWT | Table data |
| POST | `/api/data/:schoolId/:table` | JWT | Create record |
| PUT | `/api/data/:schoolId/:table/:id` | JWT | Update record (conflict detection) |
| DELETE | `/api/data/:schoolId/:table/:id` | JWT | Delete record |
| GET | `/api/search/:schoolId/:table?q=...` | JWT | Server-side search |
| GET | `/api/backup/:schoolId` | JWT | List backups |
| POST | `/api/backup` | API Key | Create backup |
| POST | `/api/school/register` | None | Register school |
