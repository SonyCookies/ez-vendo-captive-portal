# Manual Testing Guide: End Session Feature

This guide will help you test the End Session feature step by step.

## Prerequisites

1. **Upload Updated API Script to Orange Pi**
   ```bash
   # From your local machine:
   scp orange-pi-scripts/trial_access_api_mac.py sonny@192.168.1.1:/home/sonny/
   
   # SSH into Orange Pi and restart the service:
   ssh sonny@192.168.1.1
   sudo systemctl restart trial-access-api
   sudo systemctl status trial-access-api  # Verify it's running
   ```

2. **Ensure you have an active internet session** on the dashboard with remaining time.

---

## Test 1: Verify API Endpoint is Working

### Step 1.1: Test `/revoke-access` endpoint directly

**On your device (not Orange Pi):**

1. First, grant yourself internet access:
   ```bash
   curl "http://192.168.1.1:8080/grant-time?duration=300"
   ```

2. Verify you have internet:
   ```bash
   ping 8.8.8.8
   # Should work ✅
   ```

3. Check your current IP and MAC (you'll need this):
   - **Windows**: Run `ipconfig` and note your IP (e.g., 192.168.1.147)
   - **Orange Pi**: Run `ip neigh show <YOUR_IP>` to see your MAC

4. **On Orange Pi**, verify iptables rules exist for your MAC:
   ```bash
   # Replace AA:BB:CC:DD:EE:FF with your actual MAC
   sudo iptables -L FORWARD -n -v | grep -i AA:BB:CC:DD:EE:FF
   sudo iptables -t mangle -L AUTHORIZED_MARK -n -v | grep -i AA:BB:CC:DD:EE:FF
   ```
   You should see rules with your MAC address ✅

5. **From your device**, call the revoke endpoint:
   ```bash
   curl "http://192.8.1.1:8080/revoke-access"
   ```

6. **Check the response** - Should return:
   ```json
   {
     "success": true,
     "message": "Internet access revoked",
     "ip": "192.168.1.147",
     "mac": "AA:BB:CC:DD:EE:FF"
   }
   ```

7. **On Orange Pi**, check the logs:
   ```bash
   sudo journalctl -u trial-access-api -f
   # You should see: "🎯 Revoking access for MAC: ..."
   # And: "✅ Removed FORWARD rule for ..."
   # And: "✅ Removed MANGLE rule for ..."
   ```

8. **Verify iptables rules are gone** (on Orange Pi):
   ```bash
   sudo iptables -L FORWARD -n -v | grep -i AA:BB:CC:DD:EE:FF
   # Should return nothing (no rules)
   ```

9. **Test internet** (from your device):
   ```bash
   ping 8.8.8.8
   # Should FAIL ❌ (timeout or unreachable)
   ```

**✅ If all steps pass, the API endpoint is working correctly!**

---

## Test 2: Test Full End Session Flow in Frontend

### Step 2.1: Setup

1. **Access the dashboard** with an active session:
   - Scan your RFID card at the portal
   - Navigate to dashboard: `http://192.168.1.1/dashboard?rfid=YOUR_RFID`
   - You should have active time showing (e.g., "05:00")

2. **Open browser DevTools** (F12):
   - Go to **Console** tab
   - Go to **Network** tab (to see API calls)

### Step 2.2: Test End Session Button

1. **Verify "End Session & Save Time" button is visible**:
   - Should appear below the time remaining display
   - Only visible when `hasActiveTime === true`

2. **Click the button**:
   - **Expected**: Confirmation modal appears
   - **Check**: Shows remaining time (e.g., "04:32")
   - **Check**: Shows warning about internet disconnection

### Step 2.3: Test Confirmation Flow

1. **Click "Cancel"**:
   - **Expected**: Modal closes, session continues
   - **Expected**: Internet still works
   - **Expected**: Time still counting down

2. **Click "End Session & Save Time" again**

3. **Click "Confirm"**:
   - **Expected**: Button shows "Ending..." with spinner
   - **Expected**: Button is disabled during process

4. **Watch Console** (in DevTools):
   ```
   🔌 Revoking internet access from Orange Pi...
   ✅ Internet access revoked: {success: true, ...}
   ✅ Saved 272 seconds (4 minutes) for next session
   ```

5. **Watch Network tab**:
   - Should see: `GET http://192.168.1.1:8080/revoke-access` ✅
   - Status: 200 OK
   - Response: `{"success": true, "message": "Internet access revoked", ...}`

6. **Expected Results**:
   - **Success modal appears** showing:
     - "Session Ended Successfully!"
     - Amount of time saved (e.g., "4 minutes saved for next visit")
     - Confirmation that internet was disconnected
   
   - **Time remaining disappears** from dashboard
   - **"End Session" button disappears**
   - **Internet connection is cut** (try refreshing page or visiting external site)
   - **Firebase updated** with saved time

### Step 2.4: Verify Firebase Update

1. **Check Firestore** (via Firebase Console or code):
   ```javascript
   // In Firestore, check the user document:
   users/<RFID_ID>:
     - savedRemainingTimeSeconds: 272 (or whatever was remaining)
     - savedTimeDate: "2024-01-15" (today's date)
     - sessionEndTime: null
   ```

2. **Verify time was saved correctly**:
   - `savedRemainingTimeSeconds` should match the time that was remaining
   - `savedTimeDate` should be today's date in YYYY-MM-DD format

---

## Test 3: Test Time Restoration on Next Scan

### Step 3.1: Scan RFID Card Again

1. **Scan the same RFID card** at the portal

2. **Expected Behavior**:
   - Dashboard loads
   - If it's **same day**: Saved time is restored directly
   - If it's **next day**: Saved time is added to new grace period (5 min + saved time)
   - **Time Restored modal appears** showing:
     - Amount of time restored
     - Information about how it was added

3. **Verify Time**:
   - Check that `activeTimeRemaining` includes the saved time
   - If same day: Should show exactly the saved time
   - If next day: Should show saved time + 300 seconds (grace period)

4. **Check Console**:
   ```
   💾 Saved time: 272 seconds
   📅 Saved time date: 2024-01-15
   🔄 Is new day: false (or true if next day)
   🔄 Same day: Restoring 272s saved time
   ✅ Saved time restored: {success: true, ...}
   ```

---

## Test 4: Error Handling

### Step 4.1: Test API Failure

**Simulate API failure** by temporarily stopping the service:

1. **On Orange Pi**:
   ```bash
   sudo systemctl stop trial-access-api
   ```

2. **Try End Session** from frontend:
   - **Expected**: Process still completes
   - **Expected**: Time is still saved to Firebase
   - **Expected**: Console shows warning: "⚠️ Error calling revoke API"
   - **Expected**: Success modal still appears (with note about internet)

3. **Restart service**:
   ```bash
   sudo systemctl start trial-access-api
   ```

### Step 4.2: Test with No Active Session

1. **Try clicking "End Session" when no session is active**:
   - **Expected**: Alert/error message (or nothing happens)
   - **Expected**: No modal appears

---

## Troubleshooting

### Issue: `/revoke-access` returns 404

**Solution**: 
- Verify the API script was uploaded correctly
- Restart the service: `sudo systemctl restart trial-access-api`
- Check service status: `sudo systemctl status trial-access-api`

### Issue: API returns 500 error

**Check Orange Pi logs**:
```bash
sudo journalctl -u trial-access-api -n 50
```

**Common causes**:
- MAC address not in ARP table (device needs to have sent traffic)
- Sudo permissions issue (check `/etc/sudoers`)
- iptables rules don't exist (already removed or never added)

### Issue: iptables rules not removed

**Manual check** (on Orange Pi):
```bash
# List all FORWARD rules
sudo iptables -L FORWARD -n -v --line-numbers

# List all MANGLE rules
sudo iptables -t mangle -L AUTHORIZED_MARK -n -v --line-numbers

# If rules still exist, remove manually:
sudo iptables -D FORWARD <line-number>
sudo iptables -t mangle -D AUTHORIZED_MARK <line-number>
```

### Issue: Frontend not calling API

**Check**:
1. Browser console for errors
2. Network tab for failed requests
3. CORS errors (should not happen, API has `Access-Control-Allow-Origin: *`)
4. Firewall blocking port 8080

---

## Quick Verification Checklist

- [ ] API endpoint `/revoke-access` returns 200 OK
- [ ] iptables rules are removed after calling API
- [ ] Internet connection is cut after revoking access
- [ ] Frontend shows confirmation modal
- [ ] Frontend shows success modal
- [ ] Time is saved to Firebase correctly
- [ ] Saved time is restored on next scan
- [ ] Console shows correct logs
- [ ] Network tab shows API call succeeded

---

## Expected Console Logs (Full Flow)

```
// When clicking "End Session & Save Time"
🔌 Revoking internet access from Orange Pi...
✅ Internet access revoked: {success: true, message: "Internet access revoked", ip: "192.168.1.147", mac: "AA:BB:CC:DD:EE:FF"}

// When saving to Firebase
✅ Saved 272 seconds (4 minutes) for next session

// When scanning next time (if same day)
💾 Saved time: 272 seconds
📅 Saved time date: 2024-01-15
🔄 Same day: Restoring 272s saved time
✅ Saved time restored: {success: true, ...}

// When scanning next time (if new day)
💾 Saved time: 272 seconds
📅 Saved time date: 2024-01-14 (yesterday)
🔄 New day: Adding 272s saved time to 5-min grace period = 572s total
✅ Saved time restored: {success: true, ...}
```

