# EZ-Vendo System - File Inventory

## 📁 Clean Project Structure

```
ez-vendo-ui/
│
├── 📂 orange-pi-scripts/         # 🆕 Orange Pi gateway scripts
│   ├── README.md                 # ✅ Complete setup instructions
│   ├── setup_captive_portal.sh   # ✅ Main firewall configuration
│   ├── grant_trial_access_mac.sh # ✅ Grant 5-min trial (MAC-based)
│   ├── trial_access_api_mac.py   # ✅ HTTP API server (port 8080)
│   ├── captiveportal.service     # ✅ Systemd service for firewall
│   ├── trial-access-api.service  # ✅ Systemd service for API
│   ├── pm2-ecosystem.config.js   # 🆕 PM2 configuration for Next.js
│   ├── ezvendo_portal.nginx      # 🆕 Nginx reverse proxy config
│   └── PM2_NGINX_GUIDE.md        # 🆕 Deployment & management guide
│
├── 📂 esp32-sketches/            # 🆕 ESP32 Arduino code
│   ├── README.md                 # ✅ Upload & wiring instructions
│   └── ESP32_SIMPLE.ino          # ✅ Main ESP32 code (CURRENT)
│
├── 📂 app/                       # Next.js frontend application
│   ├── (home)/
│   │   └── page.jsx              # ✅ Landing page with "Start Scan"
│   ├── register/
│   │   └── page.jsx              # ✅ Registration page
│   ├── dashboard/
│   │   └── page.jsx              # ✅ User dashboard
│   ├── config/
│   │   └── firebase.js           # ✅ Firebase configuration
│   └── hooks/
│       ├── useESP8266Polling.js  # ✅ Polls ESP32 (only when scanning)
│       ├── useAuth.js            # Firebase auth utilities
│       └── useFirestore.js       # Firestore operations
│
├── FILE_INVENTORY.md             # 📄 This file
└── README.md                     # 📄 Main project docs

```

---

## 🎯 Files by Device/Location

### 🖥️ Orange Pi (Gateway - 192.168.1.1)

**Upload from:** `orange-pi-scripts/` folder

| File | Destination | Auto-Start |
|------|-------------|------------|
| `setup_captive_portal.sh` | `/home/sonny/` | ✅ Via captiveportal.service |
| `grant_trial_access_mac.sh` | `/home/sonny/` | No (called by API) |
| `trial_access_api_mac.py` | `/home/sonny/` | ✅ Via trial-access-api.service |
| `captiveportal.service` | `/etc/systemd/system/` | Auto-start on boot |
| `trial-access-api.service` | `/etc/systemd/system/` | Auto-start on boot |
| `pm2-ecosystem.config.js` | `/home/sonny/opt/ezvendo/` | Used by PM2 |
| `ezvendo_portal.nginx` | `/etc/nginx/sites-available/` | Nginx proxy config |

**Additional config:**
- Sudoers: Allow `grant_trial_access_mac.sh` without password
- PM2: `pm2 start pm2-ecosystem.config.js && pm2 save`
- Nginx: Symlink `/etc/nginx/sites-enabled/ezvendo_portal`

---

### 🔌 ESP32 (Hardware - 192.168.1.10)

**Upload from:** `esp32-sketches/` folder

| File | Tool | Purpose |
|------|------|---------|
| `ESP32_SIMPLE.ino` | Arduino IDE | RFID reader + Firestore checker |

**Required libraries:**
- MFRC522 (RFID reader)
- ArduinoJson (JSON parsing)

---

### 🌐 Frontend (Next.js - Runs on user devices)

**No files to upload** - Already in `app/` folder

**Modified files:**
- `app/(home)/page.jsx` - "Start Scan" button, connection check
- `app/hooks/useESP8266Polling.js` - Conditional polling

---

## 🔄 System Workflow

```
┌─────────────────────────────────────┐
│ 1. User connects to WiFi            │
│    Status: NO INTERNET ❌            │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 2. Opens frontend (local network)   │
│    Clicks "Start Scan"               │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│ 3. Taps RFID card                   │
└──────────────┬──────────────────────┘
               ↓
         ┌─────┴──────┐
    REGISTERED?   NOT REGISTERED?
         │              │
         ↓              ↓
   /dashboard    ESP32 → Orange Pi API
                       ↓
                 Grant 5-min trial ✅
                       ↓
                   /register
                 (HAS INTERNET!)
                       ↓
                 User registers
                       ↓
                 After 5 min → Internet stops
```

---

## ✅ Setup Status Checklist

### Orange Pi:
- [ ] All 3 scripts uploaded to `/home/sonny/`
- [ ] Scripts are executable (`chmod +x`)
- [ ] Sudoers configured for grant_trial_access_mac.sh
- [ ] Both systemd services installed
- [ ] Services enabled and started
- [ ] Firewall rules active (default: block all)

### ESP32:
- [ ] ESP32_SIMPLE.ino uploaded
- [ ] WiFi connected (192.168.1.10)
- [ ] RFID reader working
- [ ] HTTP server responding
- [ ] Can query Firestore
- [ ] Can call Orange Pi API

### Frontend:
- [ ] Next.js dev server running
- [ ] "Start Scan" button visible
- [ ] Can poll ESP32
- [ ] Navigation works (register/dashboard)

### Integration:
- [ ] Default blocking works (new devices have no internet)
- [ ] Trial access grant works (after unregistered scan)
- [ ] 5-minute expiry works (internet stops after timer)
- [ ] System survives reboot (services auto-start)

---

## 📖 Documentation

- **Orange Pi setup:** See `orange-pi-scripts/README.md`
- **ESP32 setup:** See `esp32-sketches/README.md`
- **Main docs:** See main `README.md`

---

## 🎉 You're All Set!

All files are now organized in proper folders:
- ✅ `orange-pi-scripts/` - Gateway configuration
- ✅ `esp32-sketches/` - Hardware code
- ✅ `app/` - Frontend application

Everything is documented and ready to deploy! 🚀
