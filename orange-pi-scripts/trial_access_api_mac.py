#!/usr/bin/env python3

"""
EZ-Vendo Internet Access API (MAC-based)
Runs on Orange Pi to grant timed internet access based on purchased packages:
- Unregistered users: 5-minute trial (for registration)
- Registered users: Time packages (5, 10, 30, 60 minutes) purchased from dashboard
- Auto-expires after specified duration
Uses MAC address for tracking (proper captive portal behavior)
"""

from http.server import BaseHTTPRequestHandler, HTTPServer
import subprocess
import json
import re
import logging
import os

# Configuration
PORT = 8080
TRIAL_SCRIPT = "/home/sonny/grant_trial_access_mac.sh"
REVOKE_SCRIPT = "/home/sonny/revoke_access_mac.sh"

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

def get_mac_from_ip(ip_address):
    """Get MAC address from IP using ARP table"""
    try:
        # Run ip neigh show to get ARP table
        result = subprocess.run(
            ['ip', 'neigh', 'show', ip_address],
            capture_output=True,
            text=True,
            timeout=2
        )
        
        if result.returncode == 0:
            # Parse output: "192.168.1.147 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
            match = re.search(r'lladdr\s+([0-9a-fA-F:]{17})', result.stdout)
            if match:
                mac = match.group(1).upper()
                logger.info(f"🔍 Found MAC for {ip_address}: {mac}")
                return mac
        
        logger.warning(f"⚠️ No MAC found for {ip_address} in ARP table")
        return None
        
    except Exception as e:
        logger.error(f"❌ Error getting MAC: {str(e)}")
        return None

class TrialAccessHandler(BaseHTTPRequestHandler):
    
    def do_GET(self):
        """Handle GET requests"""
        
        # Endpoint: /grant-time?duration=300 (Auto-detect client IP)
        if self.path.startswith('/grant-time'):
            self.handle_grant_time()
        
        # Endpoint: /grant-access?ip=192.168.1.100&duration=300 (Explicit IP)
        elif self.path.startswith('/grant-access'):
            self.handle_grant_access()
        
        # Endpoint: /revoke-access (Auto-detect client IP)
        elif self.path.startswith('/revoke-access'):
            self.handle_revoke_access()
        
        # Endpoint: /status
        elif self.path == '/status':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = json.dumps({"status": "online", "service": "trial-access-api-mac"})
            self.wfile.write(response.encode())
        
        else:
            self.send_error(404, "Endpoint not found")
    
    def handle_grant_time(self):
        """Grant timed access - Auto-detect client IP from request"""
        
        # Extract duration from query string
        duration_match = re.search(r'duration=(\d+)', self.path)
        duration_seconds = int(duration_match.group(1)) if duration_match else 300
        
        # Auto-detect client IP from HTTP request
        client_ip = self.client_address[0]
        
        logger.info(f"📡 Request from {client_ip} for {duration_seconds}s ({duration_seconds//60} min)")
        
        # Convert IP to MAC address
        client_mac = get_mac_from_ip(client_ip)
        
        if not client_mac:
            self.send_error(500, f"Cannot find MAC address for IP {client_ip}. Device may not be in ARP table yet.")
            return
        
        logger.info(f"🎯 Granting {duration_seconds}s to MAC: {client_mac}")
        
        try:
            # Call grant_trial_access_mac.sh with MAC and DURATION
            result = subprocess.run(
                ['sudo', TRIAL_SCRIPT, client_mac, str(duration_seconds)],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                logger.info(f"✅ Granted {duration_seconds}s ({duration_seconds//60} min) to MAC {client_mac}")
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = json.dumps({
                    "success": True,
                    "message": f"{duration_seconds//60}-minute internet access granted",
                    "ip": client_ip,
                    "mac": client_mac,
                    "duration": duration_seconds
                })
                self.wfile.write(response.encode())
            else:
                logger.error(f"❌ Failed to grant access: {result.stderr}")
                self.send_error(500, f"Failed to grant access: {result.stderr}")
        
        except subprocess.TimeoutExpired:
            logger.error("❌ Script timeout")
            self.send_error(500, "Script execution timeout")
        
        except Exception as e:
            logger.error(f"❌ Error: {str(e)}")
            self.send_error(500, str(e))
    
    def handle_grant_access(self):
        """Grant internet access to specified IP (converted to MAC)"""
        
        # Extract IP from query string
        ip_match = re.search(r'ip=([0-9.]+)', self.path)
        
        if not ip_match:
            self.send_error(400, "Missing IP parameter. Use: /grant-access?ip=X.X.X.X&duration=300")
            return
        
        client_ip = ip_match.group(1)
        
        # Extract duration in seconds (defaults to 300 = 5 minutes)
        duration_match = re.search(r'duration=(\d+)', self.path)
        duration_seconds = int(duration_match.group(1)) if duration_match else 300
        
        # Validate IP format
        if not re.match(r'^(\d{1,3}\.){3}\d{1,3}$', client_ip):
            self.send_error(400, f"Invalid IP format: {client_ip}")
            return
        
        logger.info(f"📡 Request to grant {duration_seconds}s ({duration_seconds//60} min) access to IP: {client_ip}")
        
        # Convert IP to MAC address
        client_mac = get_mac_from_ip(client_ip)
        
        if not client_mac:
            self.send_error(500, f"Cannot find MAC address for IP {client_ip}. Device may not be in ARP table yet.")
            return
        
        logger.info(f"🎯 Granting {duration_seconds}s access to MAC: {client_mac}")
        
        try:
            # GRANT TIMED ACCESS (works for both registered and unregistered)
            # Call grant_trial_access_mac.sh with MAC and DURATION
            result = subprocess.run(
                ['sudo', TRIAL_SCRIPT, client_mac, str(duration_seconds)],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                logger.info(f"✅ Granted {duration_seconds}s ({duration_seconds//60} min) to MAC {client_mac}")
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = json.dumps({
                    "success": True,
                    "message": f"{duration_seconds//60}-minute internet access granted",
                    "ip": client_ip,
                    "mac": client_mac,
                    "duration": duration_seconds
                })
                self.wfile.write(response.encode())
            else:
                logger.error(f"❌ Failed to grant access: {result.stderr}")
                self.send_error(500, f"Failed to grant access: {result.stderr}")
        
        except subprocess.TimeoutExpired:
            logger.error("❌ Script timeout")
            self.send_error(500, "Script execution timeout")
        
        except Exception as e:
            logger.error(f"❌ Error: {str(e)}")
            self.send_error(500, str(e))
    
    def handle_revoke_access(self):
        """Revoke internet access immediately - Auto-detect client IP from request"""
        
        # Auto-detect client IP from HTTP request
        client_ip = self.client_address[0]
        
        logger.info(f"📡 Revoke request from {client_ip}")
        
        # Convert IP to MAC address
        client_mac = get_mac_from_ip(client_ip)
        
        if not client_mac:
            self.send_error(500, f"Cannot find MAC address for IP {client_ip}. Device may not be in ARP table yet.")
            return
        
        logger.info(f"🎯 Revoking access for MAC: {client_mac}")
        
        try:
            # Convert to uppercase and use : separator for consistency
            client_mac = client_mac.upper().replace('-', ':')
            
            logger.info(f"🔧 Attempting to revoke access for MAC: {client_mac}")
            
            # Option 1: Try using revoke script (if it exists)
            if os.path.exists(REVOKE_SCRIPT):
                logger.info(f"📜 Using revoke script: {REVOKE_SCRIPT}")
                result = subprocess.run(
                    ['sudo', REVOKE_SCRIPT, client_mac],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    logger.info(f"✅ Revoke script executed successfully")
                    logger.info(f"📝 Output: {result.stdout}")
                else:
                    logger.error(f"❌ Revoke script failed: {result.stderr}")
                    logger.error(f"📝 Output: {result.stdout}")
                    # Continue to manual removal as fallback
            
            # Option 2: Manual iptables removal (fallback or if script doesn't exist)
            logger.info(f"🔧 Manually removing iptables rules...")
            
            # Kill any scheduled removal processes for this MAC
            pkill_result = subprocess.run(
                ['pkill', '-f', f'sleep.*{client_mac}'],
                stderr=subprocess.DEVNULL,
                timeout=2
            )
            if pkill_result.returncode == 0:
                logger.info(f"✅ Killed scheduled removal process")
            
            # Check if FORWARD rule exists before removing
            check_forward = subprocess.run(
                ['sudo', 'iptables', '-C', 'FORWARD', '-m', 'mac', '--mac-source', client_mac, '-j', 'ACCEPT'],
                capture_output=True,
                text=True,
                timeout=2
            )
            
            if check_forward.returncode == 0:
                # Rule exists - remove it
                forward_result = subprocess.run(
                    ['sudo', 'iptables', '-D', 'FORWARD', '-m', 'mac', '--mac-source', client_mac, '-j', 'ACCEPT'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                
                if forward_result.returncode == 0:
                    logger.info(f"✅ Removed FORWARD rule for {client_mac}")
                else:
                    logger.error(f"❌ Failed to remove FORWARD rule: {forward_result.stderr}")
            else:
                logger.info(f"ℹ️ FORWARD rule doesn't exist (already removed) for {client_mac}")
            
            # Check if MANGLE rule exists before removing
            check_mangle = subprocess.run(
                ['sudo', 'iptables', '-t', 'mangle', '-C', 'AUTHORIZED_MARK', '-m', 'mac', '--mac-source', client_mac, '-j', 'MARK', '--set-mark', '1'],
                capture_output=True,
                text=True,
                timeout=2
            )
            
            if check_mangle.returncode == 0:
                # Rule exists - remove it
                mangle_result = subprocess.run(
                    ['sudo', 'iptables', '-t', 'mangle', '-D', 'AUTHORIZED_MARK', '-m', 'mac', '--mac-source', client_mac, '-j', 'MARK', '--set-mark', '1'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                
                if mangle_result.returncode == 0:
                    logger.info(f"✅ Removed MANGLE rule for {client_mac}")
                else:
                    logger.error(f"❌ Failed to remove MANGLE rule: {mangle_result.stderr}")
            else:
                logger.info(f"ℹ️ MANGLE rule doesn't exist (already removed) for {client_mac}")
            
            logger.info(f"✅ Access revocation process completed for MAC {client_mac}")
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            response = json.dumps({
                "success": True,
                "message": "Internet access revoked",
                "ip": client_ip,
                "mac": client_mac
            })
            self.wfile.write(response.encode())
        
        except subprocess.TimeoutExpired:
            logger.error("❌ Script timeout")
            self.send_error(500, "Script execution timeout")
        
        except Exception as e:
            logger.error(f"❌ Error: {str(e)}")
            self.send_error(500, str(e))
    
    def log_message(self, format, *args):
        """Override to use custom logger"""
        logger.info(f"{self.address_string()} - {format % args}")

def run_server():
    """Start the HTTP server"""
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, TrialAccessHandler)
    
    logger.info("=" * 50)
    logger.info("EZ-Vendo Internet Access API (Time Packages)")
    logger.info("=" * 50)
    logger.info(f"Listening on port {PORT}")
    logger.info(f"Endpoints:")
    logger.info(f"  GET /grant-time?duration=SECONDS (Auto-detect client IP)")
    logger.info(f"  GET /grant-access?ip=X.X.X.X&duration=SECONDS (Explicit IP)")
    logger.info(f"    Examples:")
    logger.info(f"      - duration=300  → 5 minutes")
    logger.info(f"      - duration=600  → 10 minutes")
    logger.info(f"      - duration=1800 → 30 minutes")
    logger.info(f"      - duration=3600 → 60 minutes")
    logger.info(f"  GET /revoke-access (Auto-detect client IP - Remove access immediately)")
    logger.info(f"  GET /status - Check API status")
    logger.info("=" * 50)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("\n🛑 Shutting down...")
        httpd.shutdown()

if __name__ == '__main__':
    run_server()

