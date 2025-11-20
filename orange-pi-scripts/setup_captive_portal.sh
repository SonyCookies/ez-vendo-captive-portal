#!/bin/bash

# ----------------------------------------------------------------------
# EZ-VENDO CAPTIVE PORTAL SETUP SCRIPT (CORRECT VERSION)
# ----------------------------------------------------------------------

# CONFIGURATION
LAN_INTERFACE="eth0"
WAN_INTERFACE="end0"
PORTAL_IP="192.168.1.1"
PORTAL_PORT="80"
ESP32_IP="192.168.1.10"

echo "--- Clearing existing firewall rules ---"
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

# Create custom chain
iptables -N ACCEPTED_USERS

# Set default policies
iptables -P FORWARD DROP
iptables -P INPUT ACCEPT
iptables -P OUTPUT ACCEPT

echo "--- 1. Allow API Port (8080) for ESP32 and Frontend ---"
# Allow connections to trial access API on port 8080
iptables -A INPUT -p tcp --dport 8080 -j ACCEPT
echo "✅ Port 8080 opened for API access"

echo "--- 2. Enabling IP Forwarding and NAT ---"
sysctl net.ipv4.ip_forward=1 > /dev/null
iptables -t nat -A POSTROUTING -o $WAN_INTERFACE -j MASQUERADE

echo "--- 3. Whitelist ESP32 (Permanent Internet) ---"
# ESP32 gets full internet access (NEW connections + established)
iptables -A FORWARD -s $ESP32_IP -j ACCEPT
iptables -A FORWARD -d $ESP32_IP -j ACCEPT

echo "--- 4. Walled Garden (Access to Portal) ---"
# Allow all devices to reach the portal (for captive page)
iptables -A FORWARD -i $LAN_INTERFACE -d $PORTAL_IP -p udp --dport 53 -j ACCEPT
iptables -A FORWARD -i $LAN_INTERFACE -d $PORTAL_IP -p tcp --dport 80 -j ACCEPT
iptables -A FORWARD -i $LAN_INTERFACE -d $PORTAL_IP -p tcp --dport 443 -j ACCEPT

echo "--- 5. Authorized Users (Trial/Registered) ---"
# Traffic from LAN goes through ACCEPTED_USERS chain
iptables -A FORWARD -i $LAN_INTERFACE -j ACCEPTED_USERS

# ACCEPTED_USERS chain only has final ACCEPT (devices added to this chain get access)
# Note: Do NOT add a catch-all ACCEPT here!

echo "--- 6. Allow ALL DNS Traffic (Port 53) ---"
# Allow DNS queries to ANY DNS server (not just Google DNS)
# This helps with sites that need specific DNS resolution
iptables -A FORWARD -p udp --dport 53 -j ACCEPT
iptables -A FORWARD -p udp --sport 53 -j ACCEPT
iptables -A FORWARD -p tcp --dport 53 -j ACCEPT
iptables -A FORWARD -p tcp --sport 53 -j ACCEPT

echo "--- 7. Allow Return Traffic (ESTABLISHED/RELATED) ---"
# Allow return traffic for OUTBOUND connections (LAN → WAN)
# This must be AFTER authorization check
iptables -A FORWARD -i $LAN_INTERFACE -o $WAN_INTERFACE -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -i $WAN_INTERFACE -o $LAN_INTERFACE -m state --state ESTABLISHED,RELATED -j ACCEPT

echo "--- 8. Mark Authorized Traffic (Skip Redirect) ---"
# Mark packets from authorized devices to skip redirect
iptables -t mangle -N AUTHORIZED_MARK
iptables -t mangle -A PREROUTING -i $LAN_INTERFACE -j AUTHORIZED_MARK

# Mark ESP32 traffic
iptables -t mangle -A AUTHORIZED_MARK -s $ESP32_IP -j MARK --set-mark 1

# Portal itself (don't redirect portal traffic)
iptables -t mangle -A AUTHORIZED_MARK -d $PORTAL_IP -j MARK --set-mark 1

echo "--- 9. Redirection Rules (Only for Unauthorized Devices) ---"
# Only redirect unmarked (unauthorized) traffic
iptables -t nat -A PREROUTING -i $LAN_INTERFACE -p tcp --dport 80 -m mark ! --mark 1 -j REDIRECT --to-port $PORTAL_PORT
iptables -t nat -A PREROUTING -i $LAN_INTERFACE -p tcp --dport 443 -m mark ! --mark 1 -j REDIRECT --to-port $PORTAL_PORT

echo ""
echo "==================================="
echo "✅ Firewall Setup Complete"
echo "==================================="
echo "Default: ALL DEVICES BLOCKED"
echo "Whitelisted: ESP32 ($ESP32_IP) - permanent access"
echo ""
echo "To grant 5-min trial (by MAC):"
echo "  sudo /home/sonny/grant_trial_access_mac.sh AA:BB:CC:DD:EE:FF"
echo ""
echo "To grant access by IP:"
echo "  sudo iptables -I ACCEPTED_USERS -s 192.168.1.100 -j ACCEPT"
echo "==================================="

