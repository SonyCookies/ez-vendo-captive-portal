# Fix: Revoke Access Not Working

## Problem
The `/revoke-access` endpoint returns success, but internet still works. This means iptables rules aren't being removed.

## Root Cause
The API might not have proper permissions or the iptables commands aren't matching the rules correctly.

## Solution

### Step 1: Create Revoke Script

1. **Upload the new revoke script to Orange Pi:**
   ```bash
   scp orange-pi-scripts/revoke_access_mac.sh sonny@192.168.1.1:/home/sonny/
   ```

2. **SSH into Orange Pi and make it executable:**
   ```bash
   ssh sonny@192.168.1.1
   cd /home/sonny
   chmod +x revoke_access_mac.sh
   ```

3. **Test the script manually first:**
   ```bash
   # Get your MAC (from your earlier test, it's F8:5E:A0:BE:19:AF)
   sudo ./revoke_access_mac.sh F8:5E:A0:BE:19:AF
   ```

   **Expected output:**
   ```
   === Revoking Internet Access ===
   MAC: F8:5E:A0:BE:19:AF
   ✅ Killed scheduled removal process (if any)
   ✅ Removed FORWARD rule
   ✅ Removed MANGLE rule
   ✅ Access revoked for MAC F8:5E:A0:BE:19:AF
   ```

### Step 2: Update Sudoers (Important!)

The API needs to run the revoke script with sudo. Add this to sudoers:

```bash
ssh sonny@192.168.1.1
sudo visudo
```

Add these lines:
```
sonny ALL=(ALL) NOPASSWD: /home/sonny/grant_trial_access_mac.sh
sonny ALL=(ALL) NOPASSWD: /home/sonny/revoke_access_mac.sh
sonny ALL=(ALL) NOPASSWD: /usr/sbin/iptables
```

Save and exit (Ctrl+X, Y, Enter)

### Step 3: Upload Updated API Script

```bash
# From your local machine:
scp orange-pi-scripts/trial_access_api_mac.py sonny@192.168.1.1:/home/sonny/
```

### Step 4: Restart API Service

```bash
ssh sonny@192.168.1.1
sudo systemctl restart trial-access-api
sudo systemctl status trial-access-api  # Verify it's running
```

### Step 5: Test Again

**From your device:**

1. **Grant access:**
   ```bash
   curl "http://192.168.1.1:8080/grant-time?duration=300"
   ```

2. **Verify internet works:**
   ```bash
   ping 8.8.8.8
   # Should work ✅
   ```

3. **Check iptables rules exist (on Orange Pi):**
   ```bash
   ssh sonny@192.168.1.1
   sudo iptables -L FORWARD -n -v | grep -i F8:5E:A0:BE:19:AF
   sudo iptables -t mangle -L AUTHORIZED_MARK -n -v | grep -i F8:5E:A0:BE:19:AF
   ```
   You should see rules with your MAC ✅

4. **Revoke access:**
   ```bash
   curl "http://192.168.1.1:8080/revoke-access"
   ```

5. **Check Orange Pi logs:**
   ```bash
   sudo journalctl -u trial-access-api -n 30
   ```
   
   You should see:
   ```
   🔧 Attempting to revoke access for MAC: F8:5E:A0:BE:19:AF
   📜 Using revoke script: /home/sonny/revoke_access_mac.sh
   ✅ Revoke script executed successfully
   ✅ Removed FORWARD rule for F8:5E:A0:BE:19:AF
   ✅ Removed MANGLE rule for F8:5E:A0:BE:19:AF
   ```

6. **Verify iptables rules are gone (on Orange Pi):**
   ```bash
   sudo iptables -L FORWARD -n -v | grep -i F8:5E:A0:BE:19:AF
   sudo iptables -t mangle -L AUTHORIZED_MARK -n -v | grep -i F8:5E:A0:BE:19:AF
   ```
   Should return nothing (no rules) ✅

7. **Test internet again (from your device):**
   ```bash
   ping 8.8.8.8
   # Should FAIL ❌ (timeout or unreachable)
   ```

## Alternative: Direct iptables Debug

If the script doesn't work, let's debug directly:

**On Orange Pi:**

1. **List all FORWARD rules:**
   ```bash
   sudo iptables -L FORWARD -n -v --line-numbers
   ```

2. **Find your rule:**
   Look for a line with your MAC (F8:5E:A0:BE:19:AF)

3. **Try removing manually:**
   ```bash
   # Replace <line-number> with actual line number
   sudo iptables -D FORWARD <line-number>
   ```

4. **List MANGLE rules:**
   ```bash
   sudo iptables -t mangle -L AUTHORIZED_MARK -n -v --line-numbers
   ```

5. **Remove MANGLE rule:**
   ```bash
   sudo iptables -t mangle -D AUTHORIZED_MARK <line-number>
   ```

6. **Test internet:**
   ```bash
   ping 8.8.8.8
   # Should fail now
   ```

If manual removal works but API doesn't, the issue is permissions or the MAC format matching.

## Troubleshooting

### Issue: Script returns "Permission denied"
**Solution:** Check sudoers file has the revoke script path

### Issue: "iptables: No chain/target/match by that name"
**Solution:** The rule might be in a different chain or doesn't exist

### Issue: Script works manually but API doesn't
**Solution:** Check API logs for errors. Might be sudo permissions issue.

### Issue: Rules exist but internet still works
**Solution:** Check if there are other rules allowing traffic:
```bash
sudo iptables -L FORWARD -n -v
sudo iptables -t mangle -L -n -v
```

## Quick Test Script

Save this to test revoke manually:

```bash
#!/bin/bash
MAC="F8:5E:A0:BE:19:AF"  # Replace with your MAC

echo "Testing revoke for MAC: $MAC"
sudo ./revoke_access_mac.sh $MAC

echo ""
echo "Checking if rules exist:"
echo "FORWARD rules:"
sudo iptables -L FORWARD -n -v | grep -i $MAC || echo "None found ✅"
echo ""
echo "MANGLE rules:"
sudo iptables -t mangle -L AUTHORIZED_MARK -n -v | grep -i $MAC || echo "None found ✅"
```

