/*
 * =====================================================
 * EZ-Vendo RFID System - ESP32 SIMPLIFIED VERSION
 * =====================================================
 * 
 * This version ONLY checks if RFID is REGISTERED or NOT.
 * No attempt tracking, no user data extraction - just a simple boolean check.
 * 
 * ENDPOINTS:
 * - GET /rfid/latest  → Returns {cardId, isRegistered}
 * - GET /status       → Returns system status
 * - GET /rfid/clear   → Clears latest scan
 * 
 * =====================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

// =====================================================
// CONFIGURATION
// =====================================================

// WiFi Configuration
#define WIFI_SSID "EZ-Vendo-WIFI"
#define WIFI_PASSWORD "your-password-here"
#define OPEN_NETWORK  // Uncomment if WiFi has no password

// Static IP Configuration
#define STATIC_IP "192.168.1.10"
#define GATEWAY "192.168.1.1"
#define SUBNET "255.255.255.0"

// Orange Pi Configuration (for granting trial access)
#define ORANGE_PI_IP "192.168.1.1"
#define TRIAL_ACCESS_PORT 8080

// Firebase Configuration
#define FIREBASE_PROJECT_ID "ez-vendo"

// =====================================================
// ESP32 SPI Pin Definitions for MFRC522
// =====================================================
#define RST_PIN 21
#define SS_PIN  5
#define SCK_PIN  18
#define MOSI_PIN 23
#define MISO_PIN 19

  // =====================================================
  // Buzzer & LED Pins
  // =====================================================
  #define BUZZER_PIN 4  // Change this to your buzzer pin
  #define LED_SUCCESS_PIN 2  // Green LED - Access granted
  #define LED_ERROR_PIN 15   // Red LED - Access failed

// =====================================================
// GLOBALS
// =====================================================

MFRC522 mfrc522(SS_PIN, RST_PIN);
WebServer server(80);

// SUPER SIMPLE scan result
struct {
  String cardId;
  bool hasData;
  bool isRegistered;
    int attempts; // For unregistered users
    bool attemptsExceeded; // If attempts >= 3
    float balance; // For registered users
    String lastGracePeriodDate; // Date string (YYYY-MM-DD) - frontend will compare
    float savedRemainingTimeSeconds; // Saved time from previous session
    String savedTimeDate; // Date when time was saved (YYYY-MM-DD) - frontend will compare
    String status; // Card status: "active" or "blacklisted"
    bool isBlacklisted; // True if card is blacklisted
  unsigned long timestamp;
} latestScan;

unsigned long lastScanTime = 0;
const unsigned long SCAN_COOLDOWN = 2000;

// Track last client IP (for granting trial access)
String lastClientIP = "";
  bool lastAccessGranted = false; // Track if last access grant was successful
  unsigned long lastAccessTimestamp = 0;

  // Buzzer flag (to avoid crashes from delay() during HTTP operations)
  bool shouldBuzzResult = false;
  bool shouldBuzzSuccess = false; // Internet access granted
  bool shouldBuzzFail = false; // Internet access failed

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println(F("\n================================="));
  Serial.println(F("EZ-Vendo RFID System (SIMPLE)"));
  Serial.println(F("=================================\n"));
  
  latestScan.hasData = false;
    
    // Initialize Buzzer & LEDs
    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(LED_SUCCESS_PIN, OUTPUT);
    pinMode(LED_ERROR_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_SUCCESS_PIN, LOW);
    digitalWrite(LED_ERROR_PIN, LOW);
    Serial.println(F("✅ Buzzer & LEDs Ready"));
  
  // Connect to WiFi
  connectWiFi();
  
  // Initialize RFID
  initRFID();
  
  // Start HTTP Server
  startHTTPServer();
  
  Serial.println(F("\n================================="));
  Serial.println(F("✅ System Ready!"));
  Serial.println(F("🎯 Waiting for RFID cards..."));
  Serial.println(F("=================================\n"));
    
    // Startup beep
    buzz(100);
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  server.handleClient();
  checkForRFIDCard();
    
    // Handle buzzer (non-blocking way to avoid crashes)
    if (shouldBuzzResult) {
      doubleBuzz();
      shouldBuzzResult = false;
    }
    
    if (shouldBuzzSuccess) {
      // 3 short beeps + Green LED = Access granted!
      digitalWrite(LED_SUCCESS_PIN, HIGH);
      buzz(80);
      delay(100);
      buzz(80);
      delay(100);
      buzz(80);
      delay(2000); // Keep LED on for 2 seconds
      digitalWrite(LED_SUCCESS_PIN, LOW);
      shouldBuzzSuccess = false;
    }
    
    if (shouldBuzzFail) {
      // 1 long beep + Red LED = Failed
      digitalWrite(LED_ERROR_PIN, HIGH);
      buzz(500);
      delay(2000); // Keep LED on for 2 seconds
      digitalWrite(LED_ERROR_PIN, LOW);
      shouldBuzzFail = false;
    }
    
  delay(10);
}

  // =====================================================
  // BUZZER FUNCTIONS
  // =====================================================

  void buzz(int duration) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(duration);
    digitalWrite(BUZZER_PIN, LOW);
  }

  void doubleBuzz() {
    buzz(100);
    delay(100);
    buzz(100);
  }

// =====================================================
// WiFi CONNECTION
// =====================================================

void connectWiFi() {
  Serial.println(F("Connecting to WiFi..."));
  
  IPAddress local_IP, gateway, subnet, dns1(8,8,8,8), dns2(8,8,4,4);
  local_IP.fromString(STATIC_IP);
  gateway.fromString(GATEWAY);
  subnet.fromString(SUBNET);
  
  WiFi.config(local_IP, gateway, subnet, dns1, dns2);
  
  #ifdef OPEN_NETWORK
    WiFi.begin(WIFI_SSID);
  #else
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  #endif
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(F("."));
    attempts++;
  }
  
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("\n❌ WiFi Failed!"));
    while (true) { delay(1000); }
  }
  
  Serial.println(F("\n✅ WiFi Connected!"));
  Serial.print(F("IP: "));
  Serial.println(WiFi.localIP());
  Serial.print(F("MAC: "));
  Serial.println(WiFi.macAddress());
}

// =====================================================
// RFID INITIALIZATION
// =====================================================

void initRFID() {
  Serial.println(F("\nInitializing RFID..."));
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, -1);
  mfrc522.PCD_Init();
  Serial.println(F("✅ RFID Ready"));
}

// =====================================================
// HTTP SERVER
// =====================================================

void startHTTPServer() {
  Serial.println(F("\nStarting HTTP Server..."));
  
  server.on("/rfid/latest", HTTP_GET, handleGetLatest);
  server.on("/status", HTTP_GET, handleGetStatus);
  server.on("/access-granted", HTTP_GET, handleAccessGranted);
  server.on("/notify-success", HTTP_GET, handleNotifySuccess);
  server.on("/rfid/clear", HTTP_GET, handleClear);
  server.onNotFound(handleNotFound);
  
  server.begin();
  
  Serial.println(F("✅ HTTP Server Ready on port 80"));
  Serial.flush(); // Ensure message is sent
}

// =====================================================
// RFID CARD DETECTION
// =====================================================

void checkForRFIDCard() {
  if (millis() - lastScanTime < SCAN_COOLDOWN) return;
  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial()) return;
  
  String cardId = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) cardId += "0";
    cardId += String(mfrc522.uid.uidByte[i], HEX);
  }
  cardId.toUpperCase();
    
    // BEEP when card detected!
    buzz(150);
  
  Serial.println(F("\n📇 Card Detected!"));
  Serial.print(F("UID: "));
  Serial.println(cardId);
  
  checkRegistrationStatus(cardId);
  
  lastScanTime = millis();
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
}

// =====================================================
// CHECK REGISTRATION STATUS (SIMPLIFIED!)
// =====================================================

void checkRegistrationStatus(String cardId) {
  Serial.println(F("Checking Firestore..."));
  
    latestScan.cardId = cardId;
    latestScan.timestamp = millis();
    latestScan.hasData = false;
    latestScan.isRegistered = false;
    latestScan.attempts = 0;
    latestScan.attemptsExceeded = false;
    latestScan.balance = 0.0;
    latestScan.lastGracePeriodDate = "";
    latestScan.savedRemainingTimeSeconds = 0.0;
    latestScan.savedTimeDate = "";
    latestScan.status = "active"; // Default to active
    latestScan.isBlacklisted = false;
  
  WiFiClientSecure *client = new WiFiClientSecure;
  if (!client) {
    Serial.println(F("❌ Memory error"));
    latestScan.hasData = true;
    return;
  }
  
  client->setInsecure();
  HTTPClient http;
  
  String url = "https://firestore.googleapis.com/v1/projects/" + 
               String(FIREBASE_PROJECT_ID) + 
               "/databases/(default)/documents:runQuery";
  
  http.begin(*client, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);
  
    // First, check if user is registered (isRegistered == true)
    String queryRegistered = "{\"structuredQuery\":{\"from\":[{\"collectionId\":\"users\"}],\"where\":{\"compositeFilter\":{\"op\":\"AND\",\"filters\":[{\"fieldFilter\":{\"field\":{\"fieldPath\":\"rfidCardId\"},\"op\":\"EQUAL\",\"value\":{\"stringValue\":\"" + cardId + "\"}}},{\"fieldFilter\":{\"field\":{\"fieldPath\":\"isRegistered\"},\"op\":\"EQUAL\",\"value\":{\"booleanValue\":true}}}]}}}}";
  
    int code = http.POST(queryRegistered);
  
  if (code != 200) {
    Serial.print(F("❌ Query failed: "));
    Serial.println(code);
    latestScan.hasData = true;
    http.end();
    delete client;
    return;
  }
  
  String response = http.getString();
  http.end();
    
    // Check if user is registered
    if (response.indexOf("\"document\"") > 0) {
      // USER IS REGISTERED - Extract balance, grace period info, and status!
      latestScan.isRegistered = true;
      
      // Extract status (active or blacklisted) - check this FIRST
      int statusIndex = response.indexOf("\"status\"");
      if (statusIndex > 0) {
        int valueIndex = response.indexOf("\"stringValue\"", statusIndex);
        if (valueIndex > 0) {
          int startQuote = response.indexOf("\"", valueIndex + 14);
          int endQuote = response.indexOf("\"", startQuote + 1);
          String statusStr = response.substring(startQuote + 1, endQuote);
          latestScan.status = statusStr;
          latestScan.isBlacklisted = (statusStr == "blacklisted");
          
          Serial.print(F("Card status: "));
          Serial.println(statusStr);
        }
      } else {
        // If status field doesn't exist, default to active
        latestScan.status = "active";
        latestScan.isBlacklisted = false;
      }
      
      // Extract balance
      int balanceIndex = response.indexOf("\"balance\"");
      if (balanceIndex > 0) {
        Serial.print(F("Found balance field at index: "));
        Serial.println(balanceIndex);
        
        // Look for doubleValue or integerValue within next 200 characters after "balance"
        int searchEnd = (balanceIndex + 200 < response.length()) ? balanceIndex + 200 : response.length();
        String balanceSection = response.substring(balanceIndex, searchEnd);
        
        // Try doubleValue first (format: "doubleValue": 116.25 or "doubleValue":116.25)
        int doubleValueIndex = balanceSection.indexOf("\"doubleValue\"");
        if (doubleValueIndex > 0) {
          // Find the colon after "doubleValue"
          int colonIndex = balanceSection.indexOf(":", doubleValueIndex + 14);
          if (colonIndex > 0) {
            // Skip whitespace after colon
            int startIndex = colonIndex + 1;
            while (startIndex < balanceSection.length() && (balanceSection[startIndex] == ' ' || balanceSection[startIndex] == '\t')) {
              startIndex++;
            }
            // Find the end (comma, closing brace, or newline)
            int endComma = balanceSection.indexOf(",", startIndex);
            int endBrace = balanceSection.indexOf("}", startIndex);
            int endNewline = balanceSection.indexOf("\n", startIndex);
            int endPos = balanceSection.length();
            if (endComma > startIndex) endPos = endComma;
            if (endBrace > startIndex && endBrace < endPos) endPos = endBrace;
            if (endNewline > startIndex && endNewline < endPos) endPos = endNewline;
            
            if (endPos > startIndex) {
              String balanceStr = balanceSection.substring(startIndex, endPos);
              balanceStr.trim();
              latestScan.balance = balanceStr.toFloat();
              Serial.print(F("Balance extracted (doubleValue): "));
              Serial.println(latestScan.balance, 2);
            } else {
              Serial.println(F("⚠️ Could not find end of balance doubleValue"));
            }
          } else {
            Serial.println(F("⚠️ Could not find colon after doubleValue"));
          }
        } else {
          // Try integerValue (format: "integerValue": "123")
          int intValueIndex = balanceSection.indexOf("\"integerValue\"");
          if (intValueIndex > 0) {
            int startQuote = balanceSection.indexOf("\"", intValueIndex + 15);
            int endQuote = balanceSection.indexOf("\"", startQuote + 1);
            if (startQuote > 0 && endQuote > startQuote) {
              String balanceStr = balanceSection.substring(startQuote + 1, endQuote);
              latestScan.balance = balanceStr.toFloat();
              Serial.print(F("Balance extracted (integerValue): "));
              Serial.println(latestScan.balance, 2);
            } else {
              Serial.println(F("⚠️ Could not parse integerValue quotes"));
            }
          } else {
            Serial.println(F("⚠️ Warning: Could not find doubleValue or integerValue for balance"));
            latestScan.balance = 0.0;
          }
        }
      } else {
        Serial.println(F("⚠️ Warning: balance field not found in response"));
        latestScan.balance = 0.0;
      }
      
      // Extract lastGracePeriodDate (send to frontend for comparison)
      int graceDateIndex = response.indexOf("\"lastGracePeriodDate\"");
      if (graceDateIndex > 0) {
        int valueIndex = response.indexOf("\"stringValue\"", graceDateIndex);
        if (valueIndex > 0) {
          int startQuote = response.indexOf("\"", valueIndex + 14);
          int endQuote = response.indexOf("\"", startQuote + 1);
          String lastGraceDate = response.substring(startQuote + 1, endQuote);
          
          // Store the date string (don't interpret it - ESP32 has no RTC!)
          // Frontend will compare this with today's date
          latestScan.lastGracePeriodDate = lastGraceDate;
          
          Serial.print(F("Last grace period date: "));
          Serial.println(lastGraceDate);
        }
      }
      
      // Extract savedRemainingTimeSeconds (saved time from previous session)
      int savedTimeIndex = response.indexOf("\"savedRemainingTimeSeconds\"");
      if (savedTimeIndex > 0) {
        Serial.print(F("Found savedRemainingTimeSeconds field at index: "));
        Serial.println(savedTimeIndex);
        
        // Look for doubleValue or integerValue within next 200 characters after "savedRemainingTimeSeconds"
        int searchEnd = (savedTimeIndex + 200 < response.length()) ? savedTimeIndex + 200 : response.length();
        String savedTimeSection = response.substring(savedTimeIndex, searchEnd);
        
        // Try doubleValue first (format: "doubleValue": 1586.0 or "doubleValue":1586)
        int doubleValueIndex = savedTimeSection.indexOf("\"doubleValue\"");
        if (doubleValueIndex > 0) {
          int colonIndex = savedTimeSection.indexOf(":", doubleValueIndex + 14);
          if (colonIndex > 0) {
            // Skip whitespace after colon
            int startIndex = colonIndex + 1;
            while (startIndex < savedTimeSection.length() && (savedTimeSection[startIndex] == ' ' || savedTimeSection[startIndex] == '\t')) {
              startIndex++;
            }
            // Find the end (comma, closing brace, or newline)
            int endComma = savedTimeSection.indexOf(",", startIndex);
            int endBrace = savedTimeSection.indexOf("}", startIndex);
            int endNewline = savedTimeSection.indexOf("\n", startIndex);
            int endPos = savedTimeSection.length();
            if (endComma > startIndex) endPos = endComma;
            if (endBrace > startIndex && endBrace < endPos) endPos = endBrace;
            if (endNewline > startIndex && endNewline < endPos) endPos = endNewline;
            
            if (endPos > startIndex) {
              String savedTimeStr = savedTimeSection.substring(startIndex, endPos);
              savedTimeStr.trim();
              latestScan.savedRemainingTimeSeconds = savedTimeStr.toFloat();
              Serial.print(F("Saved time extracted (doubleValue): "));
              Serial.println(latestScan.savedRemainingTimeSeconds, 2);
            } else {
              Serial.println(F("⚠️ Could not find end of savedTime doubleValue"));
            }
          } else {
            Serial.println(F("⚠️ Could not find colon after savedTime doubleValue"));
          }
        } else {
          // Try integerValue (format: "integerValue": "1586")
          int intValueIndex = savedTimeSection.indexOf("\"integerValue\"");
          if (intValueIndex > 0) {
            int startQuote = savedTimeSection.indexOf("\"", intValueIndex + 15);
            int endQuote = savedTimeSection.indexOf("\"", startQuote + 1);
            if (startQuote > 0 && endQuote > startQuote) {
              String savedTimeStr = savedTimeSection.substring(startQuote + 1, endQuote);
              latestScan.savedRemainingTimeSeconds = savedTimeStr.toFloat();
              Serial.print(F("Saved time extracted (integerValue): "));
              Serial.println(latestScan.savedRemainingTimeSeconds, 2);
            } else {
              Serial.println(F("⚠️ Could not parse savedTime integerValue quotes"));
            }
          } else {
            Serial.println(F("⚠️ Could not find doubleValue or integerValue for savedRemainingTimeSeconds"));
          }
        }
      }
      
      // Extract savedTimeDate (date when time was saved)
      int savedDateIndex = response.indexOf("\"savedTimeDate\"");
      if (savedDateIndex > 0) {
        int valueIndex = response.indexOf("\"stringValue\"", savedDateIndex);
        if (valueIndex > 0) {
          int startQuote = response.indexOf("\"", valueIndex + 14);
          int endQuote = response.indexOf("\"", startQuote + 1);
          String savedDate = response.substring(startQuote + 1, endQuote);
          
          // Store the date string (don't interpret it - ESP32 has no RTC!)
          // Frontend will compare this with today's date
          latestScan.savedTimeDate = savedDate;
          
          Serial.print(F("Saved time date: "));
          Serial.println(savedDate);
        }
      }
      
      Serial.println(F("✅ REGISTERED"));
      Serial.print(F("Card status: "));
      Serial.println(latestScan.status);
      if (latestScan.isBlacklisted) {
        Serial.println(F("🚫 CARD IS BLACKLISTED - Access will be denied!"));
      }
      Serial.print(F("Balance: ₱"));
      Serial.println(latestScan.balance, 2);
      Serial.print(F("Last grace period: "));
      Serial.println(latestScan.lastGracePeriodDate.length() > 0 ? latestScan.lastGracePeriodDate : "Never");
      if (latestScan.savedRemainingTimeSeconds > 0) {
        Serial.print(F("Saved time: "));
        Serial.print(latestScan.savedRemainingTimeSeconds);
        Serial.println(F(" seconds"));
        Serial.print(F("Saved time date: "));
        Serial.println(latestScan.savedTimeDate.length() > 0 ? latestScan.savedTimeDate : "Unknown");
      }
      
      latestScan.hasData = true;
  delete client;
      shouldBuzzResult = true;
      return;
    }
    
    // User NOT registered - Check attempts and status!
    Serial.println(F("⚠️ NOT REGISTERED - Checking attempts and status..."));
    
    // Query for unregistered user document to get attempts and status
    String queryUnregistered = "{\"structuredQuery\":{\"from\":[{\"collectionId\":\"users\"}],\"where\":{\"fieldFilter\":{\"field\":{\"fieldPath\":\"rfidCardId\"},\"op\":\"EQUAL\",\"value\":{\"stringValue\":\"" + cardId + "\"}}}}}";
    
    http.begin(*client, url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(10000);
    
    code = http.POST(queryUnregistered);
    
    if (code == 200) {
      response = http.getString();
      
      // Check if document exists and extract attempts and status
  if (response.indexOf("\"document\"") > 0) {
        // Extract status (active or blacklisted)
        int statusIndex = response.indexOf("\"status\"");
        if (statusIndex > 0) {
          int valueIndex = response.indexOf("\"stringValue\"", statusIndex);
          if (valueIndex > 0) {
            int startQuote = response.indexOf("\"", valueIndex + 14);
            int endQuote = response.indexOf("\"", startQuote + 1);
            String statusStr = response.substring(startQuote + 1, endQuote);
            latestScan.status = statusStr;
            latestScan.isBlacklisted = (statusStr == "blacklisted");
            
            Serial.print(F("Card status: "));
            Serial.println(statusStr);
          }
        } else {
          // If status field doesn't exist, default to active
          latestScan.status = "active";
          latestScan.isBlacklisted = false;
        }
        
        // Parse attempts from response (simple string search)
        int attemptsIndex = response.indexOf("\"attempts\"");
        if (attemptsIndex > 0) {
          int valueIndex = response.indexOf("\"integerValue\"", attemptsIndex);
          if (valueIndex > 0) {
            int startQuote = response.indexOf("\"", valueIndex + 15);
            int endQuote = response.indexOf("\"", startQuote + 1);
            String attemptsStr = response.substring(startQuote + 1, endQuote);
            latestScan.attempts = attemptsStr.toInt();
            
            Serial.print(F("Current attempts: "));
            Serial.print(latestScan.attempts);
            Serial.println(F("/3"));
            
            if (latestScan.attempts >= 3) {
              latestScan.attemptsExceeded = true;
              Serial.println(F("🔒 ATTEMPTS EXCEEDED - No internet access!"));
  }
          }
        }
      }
    }
    
    http.end();
    delete client;
    
    latestScan.isRegistered = false;
    latestScan.hasData = true;
  
  Serial.print(cardId);
    Serial.print(F(" - NOT REGISTERED ("));
    Serial.print(latestScan.attempts);
    Serial.println(F(" attempts)"));
    if (latestScan.isBlacklisted) {
      Serial.println(F("🚫 CARD IS BLACKLISTED - Access will be denied!"));
    }
    
    // Flag for double beep
    shouldBuzzResult = true;
}

// =====================================================
  // GRANT TRIAL ACCESS (Call Orange Pi API for 5-min trial)
// =====================================================

void grantTrialAccess(String clientIP) {
    Serial.println(F(""));
    Serial.println(F("╔═══════════════════════════════════╗"));
    Serial.println(F("║  GRANTING INTERNET ACCESS         ║"));
    Serial.println(F("╚═══════════════════════════════════╝"));
    Serial.print(F("Client IP: "));
  Serial.println(clientIP);
    Serial.print(F("Duration: 5 minutes (300 seconds)"));
    Serial.println(F(""));
  
    // Build URL with 5-minute duration (300 seconds)
  String url = "http://" + String(ORANGE_PI_IP) + ":" + String(TRIAL_ACCESS_PORT) + 
                "/grant-access?ip=" + clientIP + "&duration=300";
  
    Serial.print(F("→ API URL: "));
  Serial.println(url);
  
  WiFiClient client;
  HTTPClient http;
  
  if (!http.begin(client, url)) {
    Serial.println(F("❌ Failed to initialize HTTP client"));
      Serial.println(F(""));
      lastAccessGranted = false;
      lastAccessTimestamp = millis();
      shouldBuzzFail = true;
    return;
  }
  
    http.setTimeout(10000); // Increased timeout to 10 seconds
    
    Serial.println(F("→ Sending GET request..."));
    Serial.print(F("→ Waiting for response"));
  
  int httpCode = http.GET();
  
    Serial.println(F(""));
    Serial.print(F("← HTTP Response Code: "));
  Serial.println(httpCode);
  
  if (httpCode == 200) {
    String response = http.getString();
      Serial.println(F(""));
      Serial.println(F("═══════════════════════════════════"));
      Serial.println(F("✅ INTERNET ACCESS GRANTED!"));
      Serial.println(F("═══════════════════════════════════"));
      Serial.print(F("[API Response] "));
    Serial.println(response);
      Serial.println(F(""));
      
      // Set access granted flag (for frontend to check!)
      lastAccessGranted = true;
      lastAccessTimestamp = millis();
      
      // Success buzzer (3 short beeps)
      shouldBuzzSuccess = true;
      
  } else if (httpCode > 0) {
      Serial.println(F(""));
      Serial.println(F("═══════════════════════════════════"));
      Serial.print(F("❌ API ERROR - HTTP Code: "));
    Serial.println(httpCode);
      Serial.println(F("═══════════════════════════════════"));
    String response = http.getString();
      Serial.print(F("[Error Response] "));
    Serial.println(response);
      Serial.println(F(""));
      Serial.println(F("Possible causes:"));
      Serial.println(F("  → Device not in ARP table yet"));
      Serial.println(F("  → Firewall rule already exists"));
      Serial.println(F("  → Permission denied on script"));
      Serial.println(F(""));
      
      // Set access NOT granted
      lastAccessGranted = false;
      lastAccessTimestamp = millis();
      
      // Fail buzzer (long beep)
      shouldBuzzFail = true;
      
  } else {
      Serial.println(F(""));
      Serial.println(F("═══════════════════════════════════"));
      Serial.print(F("❌ CONNECTION FAILED - Error: "));
    Serial.println(httpCode);
      Serial.println(F("═══════════════════════════════════"));
      Serial.println(F("Troubleshooting:"));
      Serial.println(F("  → Is Orange Pi API running on port 8080?"));
      Serial.println(F("  → Can ESP32 reach 192.168.1.1:8080?"));
      Serial.println(F("  → Check Orange Pi firewall"));
      Serial.println(F(""));
      
      // Set access NOT granted
      lastAccessGranted = false;
      lastAccessTimestamp = millis();
      
      // Fail buzzer (long beep)
      shouldBuzzFail = true;
  }
  
  http.end();
}

// =====================================================
// HTTP ENDPOINT: GET /rfid/latest
// =====================================================

void handleGetLatest() {
  // Set CORS headers
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  
  // Get client IP directly from the HTTP request (RELIABLE!)
  String clientIP = server.client().remoteIP().toString();
  
  if (clientIP != lastClientIP && clientIP.length() > 0) {
    Serial.print(F("📱 Frontend client IP: "));
    Serial.println(clientIP);
    lastClientIP = clientIP;
  }
  
  if (!latestScan.hasData) {
    server.send(200, "application/json", "{\"status\":\"waiting\"}");
    return;
  }
  
    // SIMPLE JSON response (now includes attempts, balance, grace period DATE, saved time, and status)
  String json = "{\"status\":\"success\",\"cardId\":\"" + latestScan.cardId + 
                "\",\"isRegistered\":" + (latestScan.isRegistered ? "true" : "false") + 
                  ",\"attempts\":" + String(latestScan.attempts) +
                  ",\"attemptsExceeded\":" + (latestScan.attemptsExceeded ? "true" : "false") +
                  ",\"balance\":" + String(latestScan.balance, 2) +
                  ",\"lastGracePeriodDate\":\"" + latestScan.lastGracePeriodDate + "\"" +
                  ",\"savedRemainingTimeSeconds\":" + String(latestScan.savedRemainingTimeSeconds, 2) +
                  ",\"savedTimeDate\":\"" + latestScan.savedTimeDate + "\"" +
                  ",\"cardStatus\":\"" + latestScan.status + "\"" +
                  ",\"isBlacklisted\":" + (latestScan.isBlacklisted ? "true" : "false") +
                ",\"timestamp\":" + String(latestScan.timestamp) + "}";
  
  server.send(200, "application/json", json);
  
  Serial.println(F("📡 Sent to frontend: "));
  Serial.println(json);
  
    // Grant internet access ONLY for UNREGISTERED users with attempts < 3
    if (!latestScan.isRegistered && !latestScan.attemptsExceeded && clientIP.length() > 0) {
      Serial.println(F("✅ Attempts OK - Granting trial access"));
    grantTrialAccess(clientIP);
    } else if (!latestScan.isRegistered && latestScan.attemptsExceeded) {
      Serial.println(F("🔒 BLOCKED - Max attempts reached, no internet access granted!"));
  }
  
  // AUTO-CLEAR after sending to frontend (prevents duplicates!)
  latestScan.hasData = false;
  Serial.println(F("🗑️ Scan cleared (prevents duplicate reads)"));
}

// =====================================================
// HTTP ENDPOINT: GET /status
// =====================================================

void handleGetStatus() {
  // Set CORS headers
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  
  String json = "{\"status\":\"online\",\"uptime\":" + String(millis()/1000) + 
                ",\"freeHeap\":" + String(ESP.getFreeHeap()) + "}";
  
  server.send(200, "application/json", json);
  
  Serial.println(F("📡 Status endpoint called - ESP32 is online"));
}

  // =====================================================
  // HTTP ENDPOINT: GET /access-granted
  // =====================================================
  void handleAccessGranted() {
    // Set CORS headers
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    
    // Frontend polls this to check if internet access was granted
    String clientIP = server.client().remoteIP().toString();
    
    // Check if this is the same client that was granted access
    bool isGranted = (clientIP == lastClientIP && lastAccessGranted);
    
    String json = "{\"accessGranted\":" + String(isGranted ? "true" : "false") + 
                  ",\"clientIP\":\"" + clientIP + 
                  "\",\"timestamp\":" + String(lastAccessTimestamp) + "}";
    
    server.send(200, "application/json", json);
    
    if (isGranted) {
      Serial.println(F("📡 Frontend confirmed: Access status checked"));
    }
  }

// =====================================================
// HTTP ENDPOINT: GET /rfid/clear
// =====================================================

void handleClear() {
  // Set CORS headers
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  
  latestScan.hasData = false;
    lastAccessGranted = false; // Also clear access flag
  server.send(200, "application/json", "{\"status\":\"cleared\"}");
  Serial.println(F("✅ Scan cleared"));
}

// =====================================================
// HTTP ENDPOINT: 404
// =====================================================

// =====================================================
// HTTP ENDPOINT: GET /notify-success
// =====================================================
void handleNotifySuccess() {
  // Set CORS headers
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  
  // Frontend calls this after successfully granting access to registered user
  Serial.println(F("📡 Frontend notified: Access granted for registered user"));
  
  // Trigger success beep and LED
  shouldBuzzSuccess = true;
  
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void handleNotFound() {
  // Handle OPTIONS preflight requests for CORS
  if (server.method() == HTTP_OPTIONS) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(200, "text/plain", "");
    return;
  }
  
  server.send(404, "application/json", "{\"error\":\"Not found\"}");
}

