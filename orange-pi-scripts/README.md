# Orange Pi Scripts

These scripts run on the Orange Pi gateway to manage the captive portal and trial access.

## 📁 Files in This Folder

### Scripts:

#### 1. **setup_captive_portal.sh**
- **Purpose:** Main firewall configuration script
- **What it does:**
  - Sets up iptables rules for captive portal
  - Whitelists ESP32 (192.168.1.10) for permanent internet
  - Blocks all other devices by default
  - Allows return traffic (ESTABLISHED/RELATED)
  - Redirects HTTP/HTTPS to captive portal

- **Location on Orange Pi:** `/home/sonny/setup_captive_portal.sh`
- **Auto-run:** Yes (via systemd: `captiveportal.service`)

#### 2. **grant_trial_access_mac.sh**
- **Purpose:** Grant 5-minute trial internet access to a device (by MAC address)
- **Usage:** `sudo ./grant_trial_access_mac.sh AA:BB:CC:DD:EE:FF`
- **What it does:**
  - Adds MAC to firewall (allows internet)
  - Sets 5-minute auto-expiry timer
  - Automatically removes access after 5 minutes

- **Location on Orange Pi:** `/home/sonny/grant_trial_access_mac.sh`
- **Called by:** `trial_access_api_mac.py` (via HTTP API)

#### 3. **trial_access_api_mac.py**
- **Purpose:** HTTP API server that ESP32 calls to grant trial access
- **Listens on:** Port 8080
- **Endpoints:**
  - `GET /status` - Check if API is online
  - `GET /grant-access?ip=X.X.X.X` - Grant 5-min trial access
    - Converts IP to MAC using ARP table
    - Calls `grant_trial_access_mac.sh`

- **Location on Orange Pi:** `/home/sonny/trial_access_api_mac.py`
- **Auto-run:** Yes (via systemd: `trial-access-api.service`)

---

### Systemd Service Files:

#### 4. **captiveportal.service**
- **Purpose:** Systemd service to auto-start firewall on boot
- **Location on Orange Pi:** `/etc/systemd/system/captiveportal.service`
- **What it does:** Runs `setup_captive_portal.sh` on system boot

#### 5. **trial-access-api.service**
- **Purpose:** Systemd service to auto-start trial access API on boot
- **Location on Orange Pi:** `/etc/systemd/system/trial-access-api.service`
- **What it does:** Runs `trial_access_api_mac.py` as a background service

---

## 🚀 Installation on Orange Pi

### Step 1: Upload Script Files

Transfer the 3 script files to Orange Pi:

```bash
# Using SCP from Windows (from project root):
scp orange-pi-scripts/setup_captive_portal.sh sonny@192.168.1.1:/home/sonny/
scp orange-pi-scripts/grant_trial_access_mac.sh sonny@192.168.1.1:/home/sonny/
scp orange-pi-scripts/trial_access_api_mac.py sonny@192.168.1.1:/home/sonny/

# Or manually copy-paste each file via SSH
```

### Step 2: Make Executable

```bash
ssh sonny@192.168.1.1

cd /home/sonny
chmod +x setup_captive_portal.sh
chmod +x grant_trial_access_mac.sh
chmod +x trial_access_api_mac.py
```

### Step 3: Configure Sudoers

```bash
sudo visudo
```

Add this line:
```
sonny ALL=(ALL) NOPASSWD: /home/sonny/grant_trial_access_mac.sh
```

Save: Ctrl+X, Y, Enter

### Step 4: Install Systemd Service Files

**Option A: Copy service files from project**

```bash
# Upload service files from Windows (from project root):
scp orange-pi-scripts/captiveportal.service sonny@192.168.1.1:/tmp/
scp orange-pi-scripts/trial-access-api.service sonny@192.168.1.1:/tmp/

# On Orange Pi, move to systemd folder:
ssh sonny@192.168.1.1
sudo mv /tmp/captiveportal.service /etc/systemd/system/
sudo mv /tmp/trial-access-api.service /etc/systemd/system/
```

**Option B: Create service files manually**

```bash
# On Orange Pi:

# Create captiveportal.service
sudo nano /etc/systemd/system/captiveportal.service
# Paste content from captiveportal.service file
# Save: Ctrl+X, Y, Enter

# Create trial-access-api.service
sudo nano /etc/systemd/system/trial-access-api.service
# Paste content from trial-access-api.service file
# Save: Ctrl+X, Y, Enter
```

**Enable and start services:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable captiveportal
sudo systemctl enable trial-access-api
sudo systemctl start captiveportal
sudo systemctl start trial-access-api
```

### Step 5: Verify

```bash
# Check both services are running
sudo systemctl status captiveportal --no-pager
sudo systemctl status trial-access-api --no-pager

# Check firewall rules
sudo iptables -L FORWARD -n -v | head -20

# Test API
curl http://192.168.1.1:8080/status
```

---

## 🧪 Testing

### Test 1: Default Blocking

**From a new device:**
```bash
ping 8.8.8.8
# Should FAIL ❌ (timeout or unreachable)
```

### Test 2: Grant Trial Access

**On Orange Pi:**
```bash
# Get device MAC from ARP table
ip neigh show 192.168.1.147

# Grant access (use the MAC from above)
sudo /home/sonny/grant_trial_access_mac.sh AA:BB:CC:DD:EE:FF
```

**From device:**
```bash
ping 8.8.8.8
# Should WORK ✅
```

### Test 3: Auto-Expiry

**Wait 5 minutes, then:**
```bash
ping 8.8.8.8
# Should FAIL again ❌
```

### Test 4: ESP32 Integration

**Scan an unregistered RFID card**

ESP32 should automatically call the API and grant access!

---

## 📝 Troubleshooting

**API not responding:**
```bash
sudo systemctl status trial-access-api
sudo journalctl -u trial-access-api -f
```

**Firewall rules not applied:**
```bash
sudo systemctl restart captiveportal
sudo iptables -L FORWARD -n -v
```

**Access not expiring:**
```bash
# Check background jobs
ps aux | grep grant_trial
# Check logs
sudo tail -f /var/log/syslog | grep ez-vendo
```

---

## ✅ Success Indicators

- [ ] Both systemd services enabled and running
- [ ] Default device blocking works
- [ ] Manual access grant works
- [ ] 5-minute expiry works
- [ ] ESP32 can call API successfully
- [ ] System survives reboot

