# PM2 & Nginx Configuration Guide

## 📋 Current Setup

**PM2:**
- App Name: `ezvendo_app`
- Working Directory: `/opt/ezvendo` (OLD) → **Will update to `/home/sonny/opt/ezvendo`**
- Command: `npm start`
- Status: ✅ Running

**Nginx:**
- Config: `/etc/nginx/sites-available/ezvendo_portal`
- Proxy: `localhost:3000` → Next.js app
- Status: ✅ Running

---

## 🔄 Update to New Location

### Step 1: Stop Current PM2 App

```bash
ssh sonny@192.168.1.1

# Stop current app
pm2 stop ezvendo_app

# Delete old process
pm2 delete ezvendo_app
```

### Step 2: Upload PM2 Config

**From Windows:**

```bash
cd "D:\INTEGRATIVE PROJECTS\ez-vendo-ui\orange-pi-scripts"

scp pm2-ecosystem.config.js sonny@192.168.1.1:/home/sonny/opt/ezvendo/
```

### Step 3: Start with New Config

```bash
ssh sonny@192.168.1.1

cd /home/sonny/opt/ezvendo

# Start with ecosystem file
pm2 start pm2-ecosystem.config.js

# Save PM2 process list
pm2 save

# View status
pm2 list

# View logs
pm2 logs ezvendo_app
```

### Step 4: Setup PM2 Startup (Auto-start on Reboot)

```bash
# Generate startup script
pm2 startup systemd

# Copy the command it shows and run it with sudo
# Example:
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u sonny --hp /home/sonny

# Save current process list
pm2 save
```

---

## 🔧 Nginx Configuration

### Current Config Location:
- **Available:** `/etc/nginx/sites-available/ezvendo_portal`
- **Enabled:** `/etc/nginx/sites-enabled/ezvendo_portal` (symlink)

### Update Nginx Config (If Needed)

```bash
ssh sonny@192.168.1.1

# Edit nginx config
sudo nano /etc/nginx/sites-available/ezvendo_portal

# Test config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Or restart nginx
sudo systemctl restart nginx
```

---

## 📝 Common PM2 Commands

```bash
# View running processes
pm2 list

# View logs (live)
pm2 logs ezvendo_app

# View logs (last 100 lines)
pm2 logs ezvendo_app --lines 100

# Restart app
pm2 restart ezvendo_app

# Stop app
pm2 stop ezvendo_app

# Delete app
pm2 delete ezvendo_app

# Reload app (zero downtime)
pm2 reload ezvendo_app

# View app info
pm2 info ezvendo_app

# Monitor CPU/Memory
pm2 monit

# Save current process list
pm2 save

# Resurrect saved processes
pm2 resurrect
```

---

## 🔄 Deploy New Code Workflow

### Option A: Using PM2 Reload (Zero Downtime)

```bash
# 1. Rsync new code from Windows
rsync -avz --progress --delete \
  /cygdrive/d/INTEGRATIVE\ PROJECTS/ez-vendo-ui/ \
  sonny@192.168.1.1:/home/sonny/opt/ezvendo/

# 2. SSH to Orange Pi
ssh sonny@192.168.1.1

# 3. Rebuild Next.js (if needed)
cd /home/sonny/opt/ezvendo
npm run build

# 4. Reload PM2 (zero downtime)
pm2 reload ezvendo_app

# 5. Check logs
pm2 logs ezvendo_app --lines 50
```

### Option B: Full Restart

```bash
# After rsync...
ssh sonny@192.168.1.1

cd /home/sonny/opt/ezvendo

# Stop app
pm2 stop ezvendo_app

# Rebuild
npm run build

# Start app
pm2 start ezvendo_app

# Or restart
pm2 restart ezvendo_app
```

---

## 🧪 Testing

### Test Nginx:
```bash
# Check nginx is running
sudo systemctl status nginx

# Test config syntax
sudo nginx -t

# View nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Test Next.js App:
```bash
# Check PM2 status
pm2 list

# Check if port 3000 is listening
sudo ss -tlnp | grep 3000

# Test locally
curl http://localhost:3000

# Test from Orange Pi IP
curl http://192.168.1.1
```

### Test from External Device:
```
http://192.168.1.1
```

---

## 🐛 Troubleshooting

### PM2 App Not Starting:

```bash
# View detailed logs
pm2 logs ezvendo_app --lines 200

# Check if port 3000 is already in use
sudo ss -tlnp | grep 3000

# Kill process on port 3000
sudo kill -9 $(sudo lsof -t -i:3000)

# Restart PM2
pm2 restart ezvendo_app
```

### Nginx 502 Bad Gateway:

```bash
# Check if Next.js is running
pm2 list

# Check if port 3000 is open
curl http://localhost:3000

# Restart both services
pm2 restart ezvendo_app
sudo systemctl restart nginx
```

### Changes Not Showing:

```bash
# Clear Next.js cache and rebuild
cd /home/sonny/opt/ezvendo
rm -rf .next
npm run build
pm2 restart ezvendo_app

# Clear browser cache (Ctrl+Shift+Delete)
```

---

## 📂 Important File Locations

```
/home/sonny/opt/ezvendo/           # Next.js app directory
/home/sonny/.pm2/                  # PM2 data
/home/sonny/.pm2/logs/             # PM2 logs
/home/sonny/.pm2/dump.pm2          # Saved PM2 processes
/etc/nginx/sites-available/        # Nginx configs
/etc/nginx/sites-enabled/          # Active nginx configs
/var/log/nginx/                    # Nginx logs
```

---

## ✅ Verification Checklist

After deployment:

- [ ] PM2 app is running: `pm2 list`
- [ ] Port 3000 is open: `sudo ss -tlnp | grep 3000`
- [ ] Nginx is running: `sudo systemctl status nginx`
- [ ] App accessible locally: `curl http://localhost:3000`
- [ ] App accessible from network: `curl http://192.168.1.1`
- [ ] PM2 saved: `pm2 save`
- [ ] Startup configured: `pm2 startup systemd`
- [ ] No errors in logs: `pm2 logs ezvendo_app --lines 50`

---

## 🚀 Quick Reference

**Start fresh deployment:**
```bash
pm2 delete ezvendo_app
cd /home/sonny/opt/ezvendo
pm2 start pm2-ecosystem.config.js
pm2 save
```

**Update code:**
```bash
# From Windows: rsync
# On Orange Pi:
cd /home/sonny/opt/ezvendo
npm run build
pm2 reload ezvendo_app
```

**Check everything:**
```bash
pm2 list && sudo systemctl status nginx
```

