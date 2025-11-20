#!/bin/bash

# =====================================================
# Grant Timed Internet Access (BY MAC ADDRESS)
# =====================================================
# Usage: ./grant_trial_access_mac.sh <MAC_ADDRESS> [DURATION_SECONDS]
# Example: ./grant_trial_access_mac.sh aa:bb:cc:dd:ee:ff 300
# Default duration: 300 seconds (5 minutes)

CLIENT_MAC=$1
DURATION=${2:-300}  # Second parameter or default to 5 minutes

if [ -z "$CLIENT_MAC" ]; then
  echo "Error: No MAC address provided"
  echo "Usage: $0 <MAC_ADDRESS> [DURATION_SECONDS]"
  exit 1
fi

# Validate MAC format (accept both : and - separators)
if ! echo "$CLIENT_MAC" | grep -qiE '^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$'; then
  echo "Error: Invalid MAC address format"
  echo "Expected: aa:bb:cc:dd:ee:ff or aa-bb-cc-dd-ee-ff"
  exit 1
fi

# Convert to uppercase and use : separator for consistency
CLIENT_MAC=$(echo "$CLIENT_MAC" | tr 'a-f' 'A-F' | tr '-' ':')

echo "=== Granting Timed Internet Access ==="
echo "MAC: $CLIENT_MAC"
echo "Duration: $DURATION seconds ($((DURATION / 60)) minutes)"

# Check if FORWARD rule already exists
iptables -C FORWARD -m mac --mac-source "$CLIENT_MAC" -j ACCEPT 2>/dev/null
if [ $? -ne 0 ]; then
  # Rule doesn't exist - add it
  iptables -I FORWARD 1 -m mac --mac-source "$CLIENT_MAC" -j ACCEPT
  echo "➕ Added FORWARD rule"
else
  # Rule exists - just refresh timer by removing old background job
  echo "ℹ️ FORWARD rule exists - extending duration"
  pkill -f "sleep.*$CLIENT_MAC" 2>/dev/null
fi

# Check if MANGLE rule already exists
iptables -t mangle -C AUTHORIZED_MARK -m mac --mac-source "$CLIENT_MAC" -j MARK --set-mark 1 2>/dev/null
if [ $? -ne 0 ]; then
  # Rule doesn't exist - add it
  iptables -t mangle -I AUTHORIZED_MARK 1 -m mac --mac-source "$CLIENT_MAC" -j MARK --set-mark 1
  echo "➕ Added MANGLE rule (HTTPS bypass)"
else
  echo "ℹ️ MANGLE rule exists"
fi

  echo "✅ Access granted to MAC $CLIENT_MAC"
echo "⏱️ Access will expire in $((DURATION / 60)) minutes"
  
# Schedule removal after specified duration (remove BOTH rules)
nohup bash -c "sleep $DURATION && iptables -D FORWARD -m mac --mac-source '$CLIENT_MAC' -j ACCEPT 2>/dev/null && iptables -t mangle -D AUTHORIZED_MARK -m mac --mac-source '$CLIENT_MAC' -j MARK --set-mark 1 2>/dev/null && logger -t ez-vendo 'Access expired: $CLIENT_MAC ($((DURATION/60)) min)'" > /dev/null 2>&1 &

