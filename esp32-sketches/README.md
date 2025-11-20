# ESP32 Arduino Sketches

## 📁 Files in This Folder

### **ESP32_SIMPLE.ino** ✅ CURRENT VERSION

**Purpose:** Main ESP32 code for EZ-Vendo RFID system

**Features:**
- ✅ Connects to WiFi (EZ-Vendo-WIFI)
- ✅ Reads RFID cards (MFRC522)
- ✅ Queries Firestore for registration status
- ✅ Serves HTTP endpoints for frontend polling
- ✅ Grants 5-minute trial access via Orange Pi API
- ✅ Auto-clears after frontend reads (prevents duplicates)
- ✅ Audio & Visual Feedback:
  - **1 beep** on startup (system ready)
  - **1 beep** when card detected
  - **2 short beeps** after registration check
  - **3 short beeps + Green LED** when internet access granted ✅
  - **1 long beep + Red LED** when internet access fails ❌

**Endpoints:**
- `GET /rfid/latest` - Returns latest RFID scan result
- `GET /status` - Returns ESP32 status
- `GET /rfid/clear` - Clears latest scan (for testing)

**Configuration:**
```cpp
// WiFi
#define WIFI_SSID "EZ-Vendo-WIFI"
#define OPEN_NETWORK  // No password

// Network
#define STATIC_IP "192.168.1.10"
#define GATEWAY "192.168.1.1"

// Firebase
#define FIREBASE_PROJECT_ID "ez-vendo"

// Orange Pi API
#define ORANGE_PI_IP "192.168.1.1"
#define TRIAL_ACCESS_PORT 8080

// Hardware Pins
#define BUZZER_PIN 4  // Change to your buzzer pin
```

---

## 🔌 Hardware Wiring

### ESP32 to MFRC522 RFID Reader:

| MFRC522 Pin | ESP32 Pin | Description |
|-------------|-----------|-------------|
| SDA (SS) | GPIO 5 | Chip Select |
| SCK | GPIO 18 | Serial Clock |
| MOSI | GPIO 23 | Master Out Slave In |
| MISO | GPIO 19 | Master In Slave Out |
| IRQ | Not connected | (Optional) |
| GND | GND | Ground |
| RST | GPIO 21 | Reset |
| 3.3V | 3.3V | Power (⚠️ NOT 5V!) |

### Buzzer & Status LEDs:

| Component | ESP32 Pin | Description |
|-----------|-----------|-------------|
| Buzzer (+) | GPIO 4 | Signal pin |
| Buzzer (-) | GND | Ground |
| Green LED (+) | GPIO 2 | Success indicator |
| Green LED (-) | GND → 220Ω resistor | Via current-limiting resistor |
| Red LED (+) | GPIO 15 | Error indicator |
| Red LED (-) | GND → 220Ω resistor | Via current-limiting resistor |

**Note:** 
- If using an active buzzer, connect directly. 
- LEDs require 220Ω resistor to limit current
- You can change pins in code if needed

---

## 📦 Required Arduino Libraries

Install via **Tools → Manage Libraries**:

1. **MFRC522** (by GithubCommunity)
2. **ArduinoJson** (by Benoit Blanchon) - Version 6.x

### ESP32 Board Support

**Tools → Board → Boards Manager:**
- Install: **ESP32 by Espressif Systems**

---

## 📤 Upload Instructions

### 1. Open Sketch
**Arduino IDE:**
- Open `ESP32_SIMPLE.ino`

### 2. Configure Board
- **Board:** Tools → Board → ESP32 Dev Module
- **Port:** Tools → Port → COM# (your ESP32)
- **Upload Speed:** 921600

### 3. Update Configuration (if needed)
Edit these lines:
```cpp
#define WIFI_SSID "EZ-Vendo-WIFI"  // Your WiFi name
#define STATIC_IP "192.168.1.10"   // ESP32 IP
#define GATEWAY "192.168.1.1"      // Orange Pi IP
```

### 4. Upload
- Click **Upload** button (→)
- Wait for "Done uploading"

### 5. Verify in Serial Monitor
**Tools → Serial Monitor (115200 baud)**

**Expected output:**
```
=================================
EZ-Vendo RFID System (SIMPLE)
=================================

Connecting to WiFi...
✅ WiFi Connected!
IP: 192.168.1.10
MAC: FC:E8:C0:7A:EF:74

Initializing RFID...
✅ RFID Ready

Starting HTTP Server...
✅ HTTP Server Ready on port 80

=================================
✅ System Ready!
🎯 Waiting for RFID cards...
=================================
```

---

## 🧪 Testing

### Test 1: RFID Detection
**Tap a card on the reader**

**Serial Monitor:**
```
📇 Card Detected!
UID: 8A3D43D5
Checking Firestore...
⚠️ NOT REGISTERED
8A3D43D5 - NOT REGISTERED
```

### Test 2: Frontend Connection
**Open browser:** `http://192.168.1.10/status`

**Expected:**
```json
{"status":"online","uptime":123,"freeHeap":280000}
```

### Test 3: Trial Access Grant
**Scan unregistered card**

**Serial Monitor:**
```
📱 Frontend client IP: 192.168.1.147
🔓 Granting 5-min trial access to: 192.168.1.147
[DEBUG] API URL: http://192.168.1.1:8080/grant-access?ip=192.168.1.147
✅ Trial access granted!
```

---

## 🐛 Troubleshooting

**WiFi connection failed:**
- Check SSID name (case-sensitive!)
- Verify `#define OPEN_NETWORK` is uncommented

**RFID reader not working:**
- Check wiring (especially 3.3V, NOT 5V!)
- Check SPI pins match code

**Firestore queries fail:**
- Check Orange Pi whitelisted ESP32 (192.168.1.10)
- Check DNS forwarding rules in firewall
- Verify Firebase Project ID is correct

**Trial access grant fails:**
- Check Orange Pi API is running (port 8080)
- Check firewall allows ESP32 → Orange Pi:8080
- Check sudoers configuration

**Buzzer not working:**
- Check wiring (GPIO 4 → Buzzer +, GND → Buzzer -)
- Try different GPIO pin (update `BUZZER_PIN` in code)
- Check buzzer polarity (swap + and - if needed)
- Test with `digitalWrite(BUZZER_PIN, HIGH)` in setup()

---

## 📝 Notes

- **Simplified version:** No attempt tracking, no user data extraction on ESP32
- **Frontend handles:** Attempt tracking, user data, navigation
- **Auto-clear:** ESP32 clears scan after frontend reads it (prevents duplicates)
- **MAC-based access:** Orange Pi uses MAC addresses for trial access (proper captive portal)

