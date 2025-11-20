# EZ-Vendo System - Functional Requirements (FR)

**Version:** 2.0 - Updated November 11, 2025  
**Status:** Current Implementation

---

## Overview

The Functional Requirements specify the detailed behaviors, operations, and services the EZ-Vendo system must perform. They are grouped by the main system components and user-facing interfaces.

---

## FR 1.0: Captive Portal Module (Access Gateway)

This module manages network traffic and enforces the "tap-to-connect" policy via the Orange Pi.

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 1.1** | The system must intercept all incoming unauthenticated HTTP traffic and redirect the user's device to the Next.js Captive Portal webpage. | iptables, nodogsplash, Next.js |
| **FR 1.2** | The system must block all outgoing traffic (HTTP/HTTPS/other protocols) for unauthenticated devices by default. | iptables, Orange Pi |
| **FR 1.3** | Upon successful RFID verification by ESP32, the system must authorize the device's MAC address to bypass the iptables firewall for the granted duration (trial or purchased time). | iptables, Orange Pi API, ESP32 |
| **FR 1.4** | The system must support MAC-based firewall rules to reliably identify and control devices in a captive portal environment. | iptables, Orange Pi |
| **FR 1.5** | The system must automatically terminate network access (revoke firewall permission) when the granted time duration expires. | iptables, Orange Pi bash scripts |
| **FR 1.6** | The system must provide a REST API endpoint (`/grant-time?duration=X`) for programmatic internet access grants, auto-detecting client IP from HTTP requests. | Python Flask API, Orange Pi |
| **FR 1.7** | The system must support stacking/extending time by killing old timer processes and starting new ones with cumulative duration. | Orange Pi bash scripts |
| **FR 1.8** | The system must whitelist the ESP32's MAC address to ensure it always has internet access for Firestore queries. | nodogsplash.conf, Orange Pi |

---

## FR 2.0: ESP32 RFID Reader Module (Hardware Interface)

This module handles RFID card reading, Firestore verification, and frontend communication.

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 2.1** | The ESP32 must reliably read the Unique Identifier (UID) from the MFRC522 RFID module upon card presentation. | ESP32 Firmware, MFRC522 |
| **FR 2.2** | The ESP32 must query Firebase Firestore REST API to check if the scanned RFID is registered (`isRegistered: true/false`). | ESP32 Firmware, Firestore |
| **FR 2.3** | For registered users, the ESP32 must extract and return: balance, lastGracePeriodDate. | ESP32 Firmware, Firestore |
| **FR 2.4** | For unregistered users, the ESP32 must extract and check the `attempts` count. If attempts >= 3, the ESP32 must block internet access. | ESP32 Firmware, Firestore |
| **FR 2.5** | The ESP32 must call the Orange Pi API (`/grant-access?ip=X&duration=300`) to grant 5-minute trial internet access for unregistered users with valid attempts (< 3). | ESP32 Firmware, Orange Pi API |
| **FR 2.6** | The ESP32 must serve HTTP endpoints for frontend polling: `/rfid/latest`, `/status`, `/access-granted`, `/rfid/clear`. | ESP32 Web Server |
| **FR 2.7** | The ESP32 must provide CORS-enabled JSON responses to allow frontend requests from the captive portal. | ESP32 Web Server |
| **FR 2.8** | The ESP32 must auto-clear scan data after sending to frontend to prevent duplicate reads. | ESP32 Firmware |
| **FR 2.9** | The ESP32 must use static IP (`192.168.1.10`) for reliable frontend communication. | ESP32 WiFi Config |
| **FR 2.10** | The ESP32 must provide audio feedback: 1 beep on card detection, 2 beeps after Firestore check, 3 beeps on success, 1 long beep on failure. | ESP32 Firmware, Buzzer |
| **FR 2.11** | The ESP32 must provide visual feedback via LEDs: Green for successful access grant, Red for failed access grant. | ESP32 Firmware, LEDs |

---

## FR 3.0: Captive Portal Frontend (User Interface)

This Next.js application provides the user-facing interface accessible without prior internet access.

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 3.1** | The portal must be accessible via any standard web browser and be fully responsive (mobile-friendly). | Next.js, Tailwind CSS |
| **FR 3.2** | The portal home page must display a "Start Scan" button that initiates a 30-second RFID scan window by polling the ESP32. | Next.js, React Hooks |
| **FR 3.3** | The portal must poll the ESP32's `/access-granted` endpoint for up to 10 seconds to confirm internet access was granted before redirecting. If not confirmed, display error and prevent redirect. | Next.js, React |
| **FR 3.4** | For unregistered users (attempts < 3), the portal must redirect to `/register` page with pre-filled RFID and attempt count. | Next.js Router |
| **FR 3.5** | For registered users with balance = 0 and grace period already used, the portal must display "Grace Period Already Used" modal with top-up instructions and block access. | Next.js, React |
| **FR 3.6** | For registered users with valid balance or unused grace period, the portal must redirect to `/dashboard` page. | Next.js Router |
| **FR 3.7** | The system must track unregistered user attempts in Firestore, incrementing on each scan, and display "Maximum Attempts Reached" modal when attempts >= 3. | Next.js, Firestore |

---

## FR 4.0: Registration Flow (New User Onboarding)

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 4.1** | The registration page must pre-fill the RFID field with the scanned card ID from URL parameters. | Next.js, React |
| **FR 4.2** | The registration page must enforce a 5-minute time limit per attempt, stored persistently in Firestore to prevent refresh bypassing. | Next.js, Firestore |
| **FR 4.3** | The registration page must reset the timer to full 5 minutes for each new registration attempt (not carry over expired timers). | Next.js, Firestore |
| **FR 4.4** | The system must display an informational modal on registration page load, explaining: (1) 5 minutes free internet for registration, (2) 3 attempts maximum. | Next.js, React |
| **FR 4.5** | The registration form must collect: First Name, Last Name, Email, Password, and auto-filled RFID. | Next.js, React Forms |
| **FR 4.6** | The system must hash passwords using SHA-256 before storing in Firestore. | Next.js, Web Crypto API |
| **FR 4.7** | Upon successful registration, the system must create/update user document in Firestore with `isRegistered: true`, reset attempts to 0, and redirect to dashboard (not home). | Next.js, Firestore |
| **FR 4.8** | The system must prevent timer-based redirect to home during successful registration by using React useRef for immediate state updates. | Next.js, React |

---

## FR 5.0: User Dashboard (Registered User Interface)

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 5.1** | The dashboard must display user information: Full Name, RFID Card ID, and Current Balance. | Next.js, Firestore |
| **FR 5.2** | The dashboard must display a large, prominent countdown timer showing remaining internet time when session is active. | Next.js, React |
| **FR 5.3** | The dashboard must use timestamp-based countdown calculation (not setInterval) to maintain accuracy when browser tab is backgrounded/throttled. | Next.js, React |
| **FR 5.4** | The dashboard must grant a 5-minute free grace period upon first login of the day, tracked via `lastGracePeriodDate` field in Firestore. | Next.js, Firestore, Orange Pi API |
| **FR 5.5** | If user balance is zero upon dashboard load, the system must display an informational modal explaining the grace period and "once per day" limitation. | Next.js, React |
| **FR 5.6** | The dashboard must display time purchase buttons for packages: 5, 10, 30, and 60 minutes, with costs calculated from `system_config` collection's `billingRatePerMinute`. | Next.js, Firestore |
| **FR 5.7** | When purchasing time, the system must: (1) Deduct cost from balance, (2) Save transaction to Firestore, (3) Call Orange Pi API with total cumulative time (existing + new purchase). | Next.js, Firestore, Orange Pi API |
| **FR 5.8** | Purchased time must be additive (stack), not replace existing time. | Next.js |
| **FR 5.9** | The dashboard must display recent transactions (top 3) with visual indicators for transaction type and amount. | Next.js, Firestore |
| **FR 5.10** | The dashboard must fetch and display top-up requests from `topup_requests` collection with status badges (Pending/Approved/Rejected). | Next.js, Firestore |
| **FR 5.11** | Transaction cards must be color-coded: Green (approved top-up), Orange (pending top-up), Red (rejected top-up or deduction). | Next.js, Tailwind CSS |
| **FR 5.12** | Clicking a transaction must open a detail modal showing: Amount, Date, Transaction ID, and for top-up requests: Reference ID, Receipt viewing link. | Next.js, React |
| **FR 5.13** | The dashboard must provide a "Back to Portal" button for users to return to the home page. | Next.js Router |

---

## FR 6.0: Top-Up Request System (Balance Management)

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 6.1** | Clicking the "+" button in dashboard must open a top-up request form modal. | Next.js, React |
| **FR 6.2** | The top-up form must display GCash payment instructions: Number (09266301717), Name (Sonny S.), and "GCash only" warning. | Next.js |
| **FR 6.3** | The top-up form must require three inputs: Amount (₱), GCash Reference ID, and Payment Receipt (image upload). | Next.js, React Forms |
| **FR 6.4** | The system must validate all fields before submission: amount > 0, reference ID not empty, receipt image attached. | Next.js, React |
| **FR 6.5** | The system must upload receipt images to Firebase Storage at path: `receipts/{userId}/{timestamp}_{filename}`. | Next.js, Firebase Storage |
| **FR 6.6** | The system must save top-up requests to Firestore `topup_requests` collection with: userId, userName, userEmail, amount, referenceId, receiptURL, receiptFileName, receiptStoragePath, status (pending), requestedAt, paymentMethod. | Next.js, Firestore, Firebase Storage |
| **FR 6.7** | The system must immediately add submitted top-up requests to the transaction history with "Pending" status for user visibility. | Next.js, React State |
| **FR 6.8** | The submit button must show upload progress: "Uploading..." with spinner during receipt upload. | Next.js, React |
| **FR 6.9** | Upon successful submission, the system must show "Request Submitted!" message and auto-close modal after 2 seconds. | Next.js, React |
| **FR 6.10** | The system must handle Firebase Storage errors gracefully with specific messages: unauthorized, quota exceeded, or generic errors. | Next.js, Error Handling |

---

## FR 7.0: System Configuration & Data Management

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 7.1** | The system must store global settings in Firestore `system_config` collection (single document: `global_settings`). | Firestore |
| **FR 7.2** | The `system_config` document must contain: `billingRatePerMinute` (default: ₱0.50), `lastUpdatedBy`, `lastUpdatedAt`. | Firestore |
| **FR 7.3** | The system must store user data in Firestore `users` collection with RFID as document ID. | Firestore |
| **FR 7.4** | User documents must contain: rfidCardId, isRegistered, attempts, balance, firstName, lastName, fullName, email, passwordHash, accountType, status, registeredAt, lastLogin, lastGracePeriodDate, registrationTimerStart, updatedAt, firstScan, lastAttempt. | Firestore |
| **FR 7.5** | The system must store all time purchases in Firestore `transactions` collection with: userId, type, amount, minutesPurchased, timestamp, description. | Firestore |
| **FR 7.6** | The system must support three transaction types: "Deducted" (time purchase), "Top-up" (approved), "Top-up Request" (pending/approved/rejected). | Firestore |
| **FR 7.7** | The system must create default `system_config` if it doesn't exist on first dashboard load. | Next.js, Firestore |

---

## FR 8.0: Authentication & Security

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 8.1** | The system must use RFID cards as the primary authentication method for captive portal access. | ESP32, MFRC522 |
| **FR 8.2** | User passwords must be hashed using SHA-256 before storage (for future web portal login). | Next.js, Web Crypto API |
| **FR 8.3** | The ESP32 must use HTTPS (TLS) for all Firestore API calls with `setInsecure()` for development. | ESP32, WiFiClientSecure |
| **FR 8.4** | The system must validate unregistered users' attempts before granting trial internet access (block if attempts >= 3). | ESP32, Firestore |
| **FR 8.5** | The system must validate registered users' balance and grace period status before granting access (block if balance = 0 and grace period used). | ESP32, Firestore |

---

## FR 9.0: Trial & Grace Period Management

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 9.1** | Unregistered users must be granted 5 minutes of free internet access for registration purposes (maximum 3 attempts). | ESP32, Orange Pi API |
| **FR 9.2** | The system must track registration attempts in Firestore, incrementing on each unregistered scan. | ESP32, Next.js, Firestore |
| **FR 9.3** | Registered users with balance = 0 must be granted a 5-minute grace period on first dashboard login of the day. | Next.js, Orange Pi API, Firestore |
| **FR 9.4** | Grace period eligibility must be determined by comparing `lastGracePeriodDate` (YYYY-MM-DD string) with current date. | Next.js, Firestore |
| **FR 9.5** | When grace period is granted, the system must update `lastGracePeriodDate` in Firestore to today's date. | Next.js, Firestore |
| **FR 9.6** | The ESP32 must extract `lastGracePeriodDate` from Firestore and send `gracePeriodUsed: true/false` to frontend for offline decision-making. | ESP32, Firestore |

---

## FR 10.0: User Flow & Navigation

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 10.1** | The home page (captive portal) must only initiate RFID scanning when user clicks "Start Scan" button (30-second timeout). | Next.js, React |
| **FR 10.2** | The system must check ESP32 connectivity via `/status` endpoint and only enable "Start Scan" when ESP32 is online. | Next.js, ESP32 |
| **FR 10.3** | Upon card detection, the system must display modal states in sequence: Checking → Registered/Unregistered → Granting Access → Redirect. | Next.js, React |
| **FR 10.4** | Unregistered users must be redirected to `/register?rfid=X&attempt=N` after trial access is confirmed granted. | Next.js Router |
| **FR 10.5** | Registered users must be redirected to `/dashboard?rfid=X` after access is confirmed granted. | Next.js Router |
| **FR 10.6** | If ESP32 fails to confirm internet access within 10 seconds, the system must show error modal and prevent redirect. | Next.js, React |
| **FR 10.7** | The system must only perform RFID listening/polling on the home page (`app/(home)/page.jsx`), not on other pages. | Next.js Architecture |

---

## FR 11.0: User Interface & Experience

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 11.1** | The home page must display clear, readable instructions in card format with numbered steps and icons. | Next.js, Tailwind CSS |
| **FR 11.2** | The "Start Scan" button must be visually prominent with gradient background, large size (44-48), WiFi icon, hover animations, and shadow effects. | Next.js, Tailwind CSS |
| **FR 11.3** | The system must display quick info cards distinguishing new users (blue, 5 min free) from registered users (green, dashboard access). | Next.js, Tailwind CSS |
| **FR 11.4** | Time displays (dashboard and register page) must be large and prominent: text-4xl/5xl in dashboard, text-3xl/4xl in register. | Next.js, Tailwind CSS |
| **FR 11.5** | The system must use gradient backgrounds (`from-green-50 via-white to-gray-50`) for visual appeal. | Next.js, Tailwind CSS |
| **FR 11.6** | All modals must include appropriate icons, color-coded by purpose: Green (success), Orange (warning/pending), Red (error/blocked), Blue (processing). | Next.js, Lucide Icons |
| **FR 11.7** | Transaction cards must display status badges inline with transaction title for top-up requests. | Next.js, Tailwind CSS |

---

## FR 12.0: Time Package System (Internet Access Purchase)

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 12.1** | The dashboard must offer four time package options: 5, 10, 30, and 60 minutes. | Next.js |
| **FR 12.2** | Each package button must display: minutes, cost (calculated from billing rate), and be disabled if insufficient balance. | Next.js, React |
| **FR 12.3** | When purchasing a package, the system must: (1) Validate sufficient balance, (2) Deduct cost from Firestore, (3) Save transaction with `minutesPurchased` field. | Next.js, Firestore |
| **FR 12.4** | The system must call Orange Pi API with total cumulative time: existing session time + newly purchased time. | Next.js, Orange Pi API |
| **FR 12.5** | The system must update `sessionEndTime` timestamp to calculate remaining time accurately. | Next.js, React |
| **FR 12.6** | Time packages must stack/add to existing time, not replace it. | Next.js Logic |
| **FR 12.7** | When purchased time expires, the system must display "Session Expired" modal and redirect to home after 3 seconds. | Next.js, React |

---

## FR 13.0: Admin Approval Workflow (Future/Manual)

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 13.1** | Admin must manually review top-up requests in `topup_requests` collection (via Firebase Console or future admin panel). | Firestore, Manual/Future Admin App |
| **FR 13.2** | Admin must verify GCash payment by viewing `receiptURL` and checking `referenceId`. | Firebase Storage, Manual |
| **FR 13.3** | Upon approval, admin must: (1) Update request `status` to "approved", (2) Manually add amount to user's `balance` in `users` collection. | Firestore, Manual |
| **FR 13.4** | Upon rejection, admin must update request `status` to "rejected". User can resubmit a new request. | Firestore, Manual |
| **FR 13.5** | The user's transaction history must automatically reflect status changes when admin updates `topup_requests` documents. | Next.js, Firestore Real-time |

---

## FR 14.0: Error Handling & Edge Cases

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 14.1** | The system must handle ESP32 offline scenarios by displaying "Scanner Offline" status and disabling "Start Scan" button. | Next.js, React |
| **FR 14.2** | The system must handle Firestore query failures gracefully with user-friendly error messages. | ESP32, Next.js |
| **FR 14.3** | The system must handle Orange Pi API failures (timeout, connection error) and display appropriate error modals without redirecting. | ESP32, Next.js |
| **FR 14.4** | The system must prevent old/duplicate RFID scans by auto-clearing scan data after frontend retrieval. | ESP32 |
| **FR 14.5** | The system must use connection timeouts (30 seconds for Firestore, 10 seconds for ESP32, 5 seconds for Orange Pi) to prevent hanging. | Next.js, ESP32 |
| **FR 14.6** | The system must handle Firebase Storage upload errors with specific messages: unauthorized, quota exceeded, generic error. | Next.js, Firebase Storage |

---

## FR 15.0: Deployment & Persistence

| ID | Requirement Description | Component |
|----|------------------------|-----------|
| **FR 15.1** | The captive portal firewall rules must persist across Orange Pi reboots via systemd service (`captiveportal.service`). | Orange Pi, systemd |
| **FR 15.2** | The trial access API must auto-start on Orange Pi boot via systemd service (`trial-access-api.service`). | Orange Pi, systemd, Python |
| **FR 15.3** | The Next.js application must run as a PM2 process on Orange Pi with auto-restart on failure or reboot. | Orange Pi, PM2 |
| **FR 15.4** | Nginx must serve as reverse proxy for the Next.js app on port 3000. | Orange Pi, Nginx |
| **FR 15.5** | The system must support rsync deployment from development machine to Orange Pi at `/home/sonny/opt/ezvendo/`. | Development, Orange Pi |

---

## Summary Statistics

- **Total Functional Requirements:** 72
- **Component Breakdown:**
  - ESP32 Firmware: 11 requirements
  - Next.js Frontend: 35 requirements
  - Orange Pi Backend: 10 requirements
  - Firestore Database: 12 requirements
  - Firebase Storage: 4 requirements

---

**Notes:**
- All requirements reflect the current implemented features as of November 11, 2025
- Admin interface is currently manual (via Firebase Console) - separate admin app planned
- System supports offline captive portal operation (ESP32 provides all data)
- Focus on RFID-based authentication and pay-per-minute billing model

