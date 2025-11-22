#!/bin/bash

# =====================================================
# Revoke Internet Access (BY MAC ADDRESS)
# =====================================================
# Usage: ./revoke_access_mac.sh <MAC_ADDRESS>
# Example: ./revoke_access_mac.sh AA:BB:CC:DD:EE:FF

CLIENT_MAC=$1

if [ -z "$CLIENT_MAC" ]; then
  echo "Error: No MAC address provided"
  echo "Usage: $0 <MAC_ADDRESS>"
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

echo "=== Revoking Internet Access ==="
echo "MAC: $CLIENT_MAC"

# Kill any scheduled removal processes for this MAC
pkill -f "sleep.*$CLIENT_MAC" 2>/dev/null
if [ $? -eq 0 ]; then
  echo "✅ Killed scheduled removal process"
fi

# Remove FORWARD rule (check if exists first, then remove)
iptables -C FORWARD -m mac --mac-source "$CLIENT_MAC" -j ACCEPT 2>/dev/null
if [ $? -eq 0 ]; then
  # Rule exists - remove it
  iptables -D FORWARD -m mac --mac-source "$CLIENT_MAC" -j ACCEPT
  if [ $? -eq 0 ]; then
    echo "✅ Removed FORWARD rule"
  else
    echo "❌ Failed to remove FORWARD rule"
    exit 1
  fi
else
  echo "ℹ️ FORWARD rule doesn't exist (already removed)"
fi

# Remove MANGLE rule (check if exists first, then remove)
iptables -t mangle -C AUTHORIZED_MARK -m mac --mac-source "$CLIENT_MAC" -j MARK --set-mark 1 2>/dev/null
if [ $? -eq 0 ]; then
  # Rule exists - remove it
  iptables -t mangle -D AUTHORIZED_MARK -m mac --mac-source "$CLIENT_MAC" -j MARK --set-mark 1
  if [ $? -eq 0 ]; then
    echo "✅ Removed MANGLE rule"
  else
    echo "❌ Failed to remove MANGLE rule"
    exit 1
  fi
else
  echo "ℹ️ MANGLE rule doesn't exist (already removed)"
fi

echo "✅ Access revoked for MAC $CLIENT_MAC"

