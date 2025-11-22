#!/bin/bash

# =====================================================
# Test Script: Revoke Access Endpoint
# =====================================================
# This script helps you test the /revoke-access endpoint
# Usage: ./test_revoke_access.sh

API_URL="http://192.168.1.1:8080"
YOUR_IP=""  # Will be auto-detected
YOUR_MAC=""  # Will be looked up

echo "=== Testing Revoke Access Endpoint ==="
echo ""

# Detect your IP (from Orange Pi perspective)
echo "1. Getting your IP address..."
YOUR_IP=$(ip route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}')
if [ -z "$YOUR_IP" ]; then
    echo "   ⚠️ Could not auto-detect IP. Please set YOUR_IP manually."
    exit 1
fi
echo "   ✅ Your IP: $YOUR_IP"

# Get MAC from ARP table (requires SSH to Orange Pi)
echo ""
echo "2. Getting your MAC address..."
echo "   ℹ️  You need to run this on Orange Pi or SSH to it"
echo "   Run this command on Orange Pi:"
echo "   ip neigh show $YOUR_IP"
echo ""
read -p "   Enter your MAC address (AA:BB:CC:DD:EE:FF): " YOUR_MAC

if [ -z "$YOUR_MAC" ]; then
    echo "   ❌ MAC address required"
    exit 1
fi

echo "   ✅ Your MAC: $YOUR_MAC"
echo ""

# First, grant access
echo "3. Granting internet access..."
GRANT_RESPONSE=$(curl -s "${API_URL}/grant-time?duration=300")
echo "   Response: $GRANT_RESPONSE"

# Check if grant was successful
if echo "$GRANT_RESPONSE" | grep -q "success.*true"; then
    echo "   ✅ Internet access granted"
else
    echo "   ❌ Failed to grant access"
    exit 1
fi

# Test internet connectivity
echo ""
echo "4. Testing internet connectivity..."
if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
    echo "   ✅ Internet is working"
else
    echo "   ⚠️  Internet not working (this might be normal)"
fi

# Wait a moment
sleep 2

# Now test revoke endpoint
echo ""
echo "5. Calling /revoke-access endpoint..."
REVOKE_RESPONSE=$(curl -s "${API_URL}/revoke-access")
echo "   Response: $REVOKE_RESPONSE"

# Check if revoke was successful
if echo "$REVOKE_RESPONSE" | grep -q "success.*true"; then
    echo "   ✅ Revoke request successful"
else
    echo "   ❌ Revoke request failed"
    exit 1
fi

# Wait a moment for iptables rules to be removed
sleep 2

# Test internet connectivity again
echo ""
echo "6. Testing internet connectivity again..."
if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
    echo "   ⚠️  Internet still working (should be blocked)"
else
    echo "   ✅ Internet is blocked (expected)"
fi

echo ""
echo "=== Test Complete ==="
echo ""
echo "To verify on Orange Pi:"
echo "  sudo iptables -L FORWARD -n -v | grep -i $YOUR_MAC"
echo "  sudo iptables -t mangle -L AUTHORIZED_MARK -n -v | grep -i $YOUR_MAC"
echo ""
echo "If rules are still there, the endpoint didn't work."
echo "If no rules are found, the endpoint worked correctly."

