# EZ-Vendo Deployment Guide

Simple deployment: Build locally, then rsync entire project to Orange Pi.

## 📍 Project Locations

- **Local:** `D:\INTEGRATIVE PROJECTS\ez-vendo-ui`
- **Orange Pi:** `sonny@192.168.1.1:~/opt/ezvendo` (which is `/home/sonny/opt/ezvendo`)

## 🚀 Quick Deployment

### Option 1: Windows Batch Script

Simply double-click `deploy.bat` or run:
```batch
deploy.bat
```

### Option 2: Manual Commands (Git Bash / WSL)

```bash
# 1. Build the project
npm run build

# 2. Rsync to Orange Pi
rsync -avz --progress --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.next/cache' \
  --exclude '*.log' \
  --exclude '.env.local' \
  --exclude '.env*.local' \
  "D:/INTEGRATIVE PROJECTS/ez-vendo-ui/" \
  sonny@192.168.1.1:~/opt/ezvendo/
```

### Option 3: Linux/Mac/WSL Script

```bash
bash deploy.sh
```

## 📋 After Deployment - Setup on Orange Pi

Once files are synced, SSH into Orange Pi and complete the setup:

```bash
# SSH to Orange Pi
ssh sonny@192.168.1.1

# Navigate to app directory
cd ~/opt/ezvendo

# Install/update production dependencies
npm install --production

# Restart PM2 app (zero downtime reload)
pm2 reload ezvendo_app

# Or if app doesn't exist yet:
pm2 start pm2-ecosystem.config.js
pm2 save

# Check status and logs
pm2 status ezvendo_app
pm2 logs ezvendo_app --lines 50
```

## 🔧 What Gets Deployed

**Included:**
- ✅ `.next/` (build output)
- ✅ `app/` (all source files)
- ✅ `public/` (static assets)
- ✅ `package.json` & `package-lock.json`
- ✅ All config files (next.config.mjs, jsconfig.json, etc.)
- ✅ Everything else in the project

**Excluded (to save bandwidth):**
- ❌ `node_modules/` (installed on Orange Pi)
- ❌ `.git/` (version control)
- ❌ `.next/cache/` (build cache)
- ❌ `*.log` (log files)
- ❌ `.env.local` (local env files)
- ❌ System files (`.DS_Store`, `Thumbs.db`)

## 🔄 Complete Deployment Workflow

```bash
# On Windows (from project root):

# 1. Build locally
npm run build

# 2. Deploy via rsync (Git Bash / WSL)
rsync -avz --progress --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.next/cache' \
  --exclude '*.log' \
  --exclude '.env.local' \
  --exclude '.env*.local' \
  "D:/INTEGRATIVE PROJECTS/ez-vendo-ui/" \
  sonny@192.168.1.1:~/opt/ezvendo/

# 3. Setup on Orange Pi
ssh sonny@192.168.1.1
cd ~/opt/ezvendo
npm install --production
pm2 reload ezvendo_app
pm2 logs ezvendo_app --lines 50
```

## 🧪 Verify Deployment

```bash
# On Orange Pi:
pm2 list
curl http://localhost:3000
sudo systemctl status nginx

# From another device on network:
curl http://192.168.1.1
# Or open browser: http://192.168.1.1
```

## 🐛 Troubleshooting

### Rsync Not Found (Windows)
**Solution:** Install Git Bash, WSL, or Cygwin with rsync

### SSH Connection Issues
```bash
# Test connection
ssh sonny@192.168.1.1

# Set up SSH keys for passwordless access:
ssh-keygen -t rsa -b 4096
ssh-copy-id sonny@192.168.1.1
```

### PM2 App Not Starting
```bash
# Check logs
pm2 logs ezvendo_app --lines 100

# Check if port 3000 is in use
sudo ss -tlnp | grep 3000

# Restart PM2
cd ~/opt/ezvendo
pm2 delete ezvendo_app
pm2 start pm2-ecosystem.config.js
pm2 save
```

### Build Fails Locally
```bash
# Clear cache and rebuild
rm -rf .next node_modules
npm install
npm run build
```

## ✅ Quick Checklist

After deployment:
- [ ] Build successful locally
- [ ] Files synced to Orange Pi
- [ ] Dependencies installed: `npm install --production`
- [ ] PM2 app restarted: `pm2 reload ezvendo_app`
- [ ] App accessible: `curl http://localhost:3000`
- [ ] Nginx working: `curl http://192.168.1.1`
- [ ] PM2 saved: `pm2 save`
