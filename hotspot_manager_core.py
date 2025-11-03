#!/usr/bin/env python3

import subprocess
import re
import sys
import time
import os
import json # NEW: For parsing speedtest-cli output
from datetime import datetime, timedelta # QUOTA: Added timedelta
from threading import Thread, Event, Lock # NEW: Added Lock
from collections import defaultdict

# QUOTA: Helper to parse simple time strings like "1h", "30m", "2d"
def parse_time_string(time_str):
    """Parses a time string (e.g., '1h', '30m', '2d') into seconds."""
    time_str = time_str.lower().strip()
    if time_str.endswith('h'):
        return int(time_str[:-1]) * 3600
    elif time_str.endswith('m'):
        return int(time_str[:-1]) * 60
    elif time_str.endswith('d'):
        return int(time_str[:-1]) * 86400
    else:
        # Assume seconds if no unit
        return int(time_str)

# QUOTA: Helper to format seconds into readable string
def format_seconds(seconds):
    """Formats seconds into a human-readable string (Xd Yh Zm)."""
    if seconds < 0: seconds = 0
    delta = timedelta(seconds=int(seconds))
    days = delta.days
    hours, remainder = divmod(delta.seconds, 3600)
    minutes, _ = divmod(remainder, 60)
    
    parts = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0 or (days == 0 and hours == 0): # Show minutes if < 1h
        parts.append(f"{minutes}m")
        
    return " ".join(parts) if parts else "0m"


class BandwidthTracker:
    """Track bandwidth usage for each device"""
    def __init__(self):
        self.device_stats = defaultdict(lambda: {
            'last_rx_bytes': 0,
            'last_tx_bytes': 0,
            'total_rx_bytes': 0, # Session total
            'total_tx_bytes': 0, # Session total
            'rx_speed': 0,
            'tx_speed': 0,
            'last_update': time.time(),
            'first_seen': time.time()
        })
    
    # QUOTA: Modified to return deltas
    def update_device(self, ip, rx_bytes, tx_bytes):
        """Update device statistics with new byte counts. Returns (stats, rx_delta, tx_delta)."""
        current_time = time.time()
        stats = self.device_stats[ip]
        
        time_delta = current_time - stats['last_update']
        rx_delta = 0
        tx_delta = 0
        
        if stats['last_rx_bytes'] > 0 and time_delta > 0:
            # This is a subsequent run
            rx_delta = rx_bytes - stats['last_rx_bytes']
            tx_delta = tx_bytes - stats['last_tx_bytes']
            
            
            
            if rx_delta < 0:
                rx_delta = rx_bytes
            if tx_delta < 0:
                tx_delta = tx_bytes
            
            stats['rx_speed'] = rx_delta / time_delta
            stats['tx_speed'] = tx_delta / time_delta
            
            stats['total_rx_bytes'] += rx_delta
            stats['total_tx_bytes'] += tx_delta
            
        elif stats['last_rx_bytes'] == 0:
        
            stats['total_rx_bytes'] = 0 
            stats['total_tx_bytes'] = 0 # Start session total from 0
            stats['rx_speed'] = 0
            stats['tx_speed'] = 0
            
            if stats['last_update'] == stats['first_seen']: # Check if it's the very first run
                rx_delta = rx_bytes
                tx_delta = tx_bytes


        stats['last_rx_bytes'] = rx_bytes
        stats['last_tx_bytes'] = tx_bytes
        stats['last_update'] = current_time
        
        # QUOTA: Return deltas along with stats
        return stats, rx_delta, tx_delta
    
    def get_device_stats(self, ip):
        """Get statistics for a specific device"""
        return self.device_stats.get(ip) # Use .get() for safety

    def get_last_raw_bytes(self, ip):
        """Get the last raw byte counts seen for delta calculation."""
        stats = self.device_stats.get(ip)
        if stats:
            return stats['last_rx_bytes'], stats['last_tx_bytes']
        return 0, 0

    def reset_device(self, ip):
        """Reset statistics for a device"""
        if ip in self.device_stats:
            # QUOTA: Don't delete, just reset session stats
            stats = self.device_stats[ip]
            stats['last_rx_bytes'] = 0
            stats['last_tx_bytes'] = 0
            stats['total_rx_bytes'] = 0
            stats['total_tx_bytes'] = 0
            stats['rx_speed'] = 0
            stats['tx_speed'] = 0
            stats['last_update'] = time.time()
            # Keep 'first_seen' to track overall connection time

class BandwidthLimiter:
    """Manage per-device bandwidth limits using tc (traffic control)"""
    def __init__(self, interface):
        self.interface = interface
        self.limits = {}  # {ip: {'download': kbps, 'upload': kbps, 'priority': prio}}
        self.ip_to_class = {}  # {ip: class_id}
        self.ifb_device = f'ifb0'  # Use fixed IFB device name
        self.tc_initialized = False

    def setup_tc_qdisc(self, total_bandwidth_down_kbps=100000, total_bandwidth_up_kbps=100000):
        """Setup tc queueing disciplines for bandwidth control - FIXED"""
        print(f"🔧 Setting up traffic control on {self.interface}...")
        self.cleanup_tc()
        print("      Setting up DOWNLOAD (egress) control...")
        stdout, stderr, code = self.run_command([
            'tc', 'qdisc', 'add', 'dev', self.interface,
            'root', 'handle', '1:', 'htb', 'default', '9999'
        ])
        if code != 0: print(f"      ⚠️  Warning: {stderr}")
        print(f"      Setting default root download rate to {total_bandwidth_down_kbps}kbit (will be updated by speedtest)")
        self.run_command(['tc', 'class', 'add', 'dev', self.interface,'parent', '1:', 'classid', '1:1', 'htb','rate', f'{total_bandwidth_down_kbps}kbit', 'burst', '15k'])
        self.run_command(['tc', 'class', 'add', 'dev', self.interface,'parent', '1:1', 'classid', '1:9999', 'htb','rate', '1kbit', 'ceil', f'{total_bandwidth_down_kbps}kbit','burst', '15k', 'prio', '7'])
        self.run_command(['tc', 'qdisc', 'add', 'dev', self.interface,'parent', '1:9999', 'handle', '9999:', 'sfq', 'perturb', '10'])
        print("      Setting up UPLOAD (ingress) control...")
        self.run_command(['modprobe', 'ifb', 'numifbs=1'], check=False)
        self.run_command(['ip', 'link', 'del', self.ifb_device], check=False)
        stdout, stderr, code = self.run_command(['ip', 'link', 'add', self.ifb_device, 'type', 'ifb'])
        if code != 0: print(f"      ℹ️  IFB device already exists or created")
        self.run_command(['ip', 'link', 'set', 'dev', self.ifb_device, 'up'])
        self.run_command(['tc', 'qdisc', 'add', 'dev', self.interface,'handle', 'ffff:', 'ingress'], check=False)
        self.run_command(['tc', 'filter', 'add', 'dev', self.interface,'parent', 'ffff:', 'protocol', 'all', 'u32','match', 'u32', '0', '0','action', 'mirred', 'egress', 'redirect', 'dev', self.ifb_device])
        self.run_command(['tc', 'qdisc', 'add', 'dev', self.ifb_device,'root', 'handle', '2:', 'htb', 'default', '9999'])
        print(f"      Setting default root upload rate to {total_bandwidth_up_kbps}kbit (will be updated by speedtest)")
        self.run_command(['tc', 'class', 'add', 'dev', self.ifb_device,'parent', '2:', 'classid', '2:1', 'htb','rate', f'{total_bandwidth_up_kbps}kbit', 'burst', '15k'])
        self.run_command(['tc', 'class', 'add', 'dev', self.ifb_device,'parent', '2:1', 'classid', '2:9999', 'htb','rate', '1kbit', 'ceil', f'{total_bandwidth_up_kbps}kbit','burst', '15k', 'prio', '7'])
        self.run_command(['tc', 'qdisc', 'add', 'dev', self.ifb_device,'parent', '2:9999', 'handle', '9999:', 'sfq', 'perturb', '10'])
        self.tc_initialized = True
        print(f"✅ Traffic control initialized successfully (IFB: {self.ifb_device})")

        self.verify_tc_setup()

    def verify_tc_setup(self):
        """Verify that TC is set up correctly"""
        print("      🔍 Verifying TC setup...")
        stdout, _, code = self.run_command(['tc', 'qdisc', 'show', 'dev', self.interface])
        if 'htb' in stdout: print(f"      ✓ Egress (download) HTB qdisc on {self.interface}: OK")
        else: print(f"      ✗ Egress (download) HTB qdisc on {self.interface}: FAILED"); return False
        stdout, _, code = self.run_command(['ip', 'link', 'show', self.ifb_device])
        if 'UP' in stdout: print("      ✓ IFB device status: UP")
        else: print("      ✗ IFB device status: DOWN"); return False
        stdout, _, code = self.run_command(['tc', 'filter', 'show', 'dev', self.interface, 'parent', 'ffff:'])
        if 'mirred' in stdout and self.ifb_device in stdout: print("      ✓ Ingress redirection: OK")
        else: print("      ✗ Ingress redirection: FAILED"); return False
        stdout, _, code = self.run_command(['tc', 'qdisc', 'show', 'dev', self.ifb_device])
        if 'htb' in stdout: print(f"      ✓ IFB (upload) HTB qdisc on {self.ifb_device}: OK")
        else: print(f"      ✗ IFB (upload) HTB qdisc on {self.ifb_device}: FAILED"); return False
        return True

    def add_device_limit(self, ip, download_kbps, upload_kbps, priority=5):
        """Add bandwidth limit for a specific device - UNIQUE FILTER PRIO"""
        if not self.tc_initialized:
            print("⚠️  Traffic control not initialized. Initializing now...")
            self.setup_tc_qdisc()
        self.remove_device_limit(ip)
        ip_parts = ip.split('.')
        class_id = int(ip_parts[-1])
        if class_id < 10: class_id = 10 + class_id
        if class_id > 253: class_id = 253
        
        # --- MODIFIED: Check against self.ip_to_class, not self.limits ---
        while class_id in self.ip_to_class.values():
        # --- End of MODIFIED ---
            class_id += 1
            if class_id > 253: class_id = 10
        self.ip_to_class[ip] = class_id
        class_prio = priority
        filter_prio = class_id
        print(f"      🔧 Adding/Updating limit for {ip} (class {class_id}): ↓ {download_kbps} Kbps | ↑ {upload_kbps} Kbps | ClassPrio: {class_prio}")
        download_burst_kb = 15
        cmd_add_dl = ['tc', 'class', 'add', 'dev', self.interface,'parent', '1:1', 'classid', f'1:{class_id}', 'htb','rate', f'{download_kbps}kbit','ceil', f'{download_kbps}kbit','burst', f'{download_burst_kb}k','cburst', f'{download_burst_kb}k','prio', str(class_prio)]
        stdout, stderr, code = self.run_command(cmd_add_dl)
        if code == 2 and ("File exists" in stderr or "RTNETLINK" in stderr):
            print(f"      ℹ️  Class 1:{class_id} exists. Changing...")
            cmd_change_dl = ['tc', 'class', 'change', 'dev', self.interface,'parent', '1:1', 'classid', f'1:{class_id}', 'htb','rate', f'{download_kbps}kbit','ceil', f'{download_kbps}kbit','burst', f'{download_burst_kb}k','cburst', f'{download_burst_kb}k','prio', str(class_prio)]
            stdout, stderr, code = self.run_command(cmd_change_dl)
        if code != 0: print(f"      ❌ Failed to add/change download class: {stderr}"); return False
        self.run_command(['tc', 'qdisc', 'del', 'dev', self.interface, 'parent', f'1:{class_id}'], check=False)
        self.run_command(['tc', 'qdisc', 'add', 'dev', self.interface,'parent', f'1:{class_id}', 'handle', f'{class_id}:', 'sfq', 'perturb', '10'])
        stdout, stderr, code = self.run_command(['tc', 'filter', 'add', 'dev', self.interface,'protocol', 'ip', 'parent', '1:','prio', str(filter_prio), 'u32','match', 'ip', 'dst', f'{ip}/32','flowid', f'1:{class_id}'])
        if code != 0: print(f"      ❌ Failed to add download filter: {stderr}")
        upload_burst_kb = 15
        cmd_add_ul = ['tc', 'class', 'add', 'dev', self.ifb_device,'parent', '2:1', 'classid', f'2:{class_id}', 'htb','rate', f'{upload_kbps}kbit','ceil', f'{upload_kbps}kbit','burst', f'{upload_burst_kb}k','cburst', f'{upload_burst_kb}k','prio', str(class_prio)]
        stdout, stderr, code = self.run_command(cmd_add_ul)
        if code == 2 and ("File exists" in stderr or "RTNETLINK" in stderr):
            print(f"      ℹ️  Class 2:{class_id} exists. Changing...")
            cmd_change_ul = ['tc', 'class', 'change', 'dev', self.ifb_device,'parent', '2:1', 'classid', f'2:{class_id}', 'htb','rate', f'{upload_kbps}kbit','ceil', f'{upload_kbps}kbit','burst', f'{upload_burst_kb}k','cburst', f'{upload_burst_kb}k','prio', str(class_prio)]
            stdout, stderr, code = self.run_command(cmd_change_ul)
        if code != 0: print(f"      ❌ Failed to add/change upload class: {stderr}"); return False
        self.run_command(['tc', 'qdisc', 'del', 'dev', self.ifb_device, 'parent', f'2:{class_id}'], check=False)
        self.run_command(['tc', 'qdisc', 'add', 'dev', self.ifb_device,'parent', f'2:{class_id}', 'handle', f'{class_id + 1000}:', 'sfq', 'perturb', '10'])
        stdout, stderr, code = self.run_command(['tc', 'filter', 'add', 'dev', self.ifb_device,'protocol', 'ip', 'parent', '2:','prio', str(filter_prio), 'u32','match', 'ip', 'src', f'{ip}/32','flowid', f'2:{class_id}'])
        if code != 0: print(f"      ❌ Failed to add upload filter: {stderr}")
        
        # --- MODIFIED: Update the 'current state' limits dict ---
        self.limits[ip] = {'download': download_kbps,'upload': upload_kbps,'class_id': class_id,'priority': class_prio}
        # --- End of MODIFIED ---
        
        if self.verify_device_limit(ip, class_id): print(f"      ✅ Limit successfully applied for {ip}"); return True
        else: print(f"      ⚠️  Limit applied for {ip}, but filter verification failed (check tc filter show)"); return True

    def verify_device_limit(self, ip, class_id):
        """Verify that the limit is actually applied - BLOCK BASED CHECK"""
        time.sleep(0.5)
        results = {'download_class': False, 'upload_class': False, 'download_filter': False, 'upload_filter': False}
        filter_prio = class_id
        stdout_dl_class, _, code_dl_class = self.run_command(['tc', 'class', 'show', 'dev', self.interface])
        if code_dl_class == 0: results['download_class'] = re.search(fr'(class htb 1:{class_id}\b|classid 1:{class_id})', stdout_dl_class) is not None
        stdout_ul_class, _, code_ul_class = self.run_command(['tc', 'class', 'show', 'dev', self.ifb_device])
        if code_ul_class == 0: results['upload_class'] = re.search(fr'(class htb 2:{class_id}\b|classid 2:{class_id})', stdout_ul_class) is not None
        stdout_dl_filter, stderr_dl_filter, code_dl_filter = self.run_command(['tc', 'filter', 'show', 'dev', self.interface, 'parent', '1:'])
        if code_dl_filter == 0:
            filter_blocks = stdout_dl_filter.split('filter ')[1:]
            for block in filter_blocks:
                if re.search(fr'pref {filter_prio}\b', block) and re.search(fr'flowid 1:{class_id}\b', block):
                    results['download_filter'] = True; break
        stdout_ul_filter, stderr_ul_filter, code_ul_filter = self.run_command(['tc', 'filter', 'show', 'dev', self.ifb_device, 'parent', '2:'])
        if code_ul_filter == 0:
            filter_blocks = stdout_ul_filter.split('filter ')[1:]
            for block in filter_blocks:
                if re.search(fr'pref {filter_prio}\b', block) and re.search(fr'flowid 2:{class_id}\b', block):
                    results['upload_filter'] = True; break
        if not all(results.values()):
            print(f"      📋 Verification details for {ip} (class {class_id}):")
            print(f"                                      Download class (1:{class_id} on {self.interface}): {'✓' if results['download_class'] else '✗'}")
            print(f"                                      Upload class (2:{class_id} on {self.ifb_device}): {'✓' if results['upload_class'] else '✗'}")
            print(f"                                      Download filter (prio {filter_prio} -> 1:{class_id}): {'✓' if results['download_filter'] else '✗'}")
            print(f"                                      Upload filter (prio {filter_prio} -> 2:{class_id}): {'✓' if results['upload_filter'] else '✗'}")
            if not results['download_filter']: print(f"                                      Output for 'tc filter show dev {self.interface} parent 1:':\n---\n{stdout_dl_filter}\n---");
            if stderr_dl_filter: print(f"                                      Stderr: {stderr_dl_filter}")
            if not results['upload_filter']: print(f"                                      Output for 'tc filter show dev {self.ifb_device} parent 2:':\n---\n{stdout_ul_filter}\n---");
            if stderr_ul_filter: print(f"                                      Stderr: {stderr_ul_filter}")
        return all(results.values())

    def remove_device_limit(self, ip):
        """Remove bandwidth limit for a device - DELETE BY UNIQUE PRIO"""
        class_id = None
        filter_prio = None
        
        # --- MODIFIED: Check ip_to_class for class_id ---
        if ip in self.ip_to_class:
            class_id = self.ip_to_class[ip]
            filter_prio = class_id # Filter prio IS the class_id
            print(f"      🗑️  Removing limit for {ip} (class {class_id}, filter prio {filter_prio})")
        # --- End of MODIFIED ---
        else:
             print(f"      ℹ️  No limit found for {ip} in internal state. Attempting removal of potential stale filters...")

        # Attempt filter removal regardless of internal state, using prio if known, otherwise by IP match
        if filter_prio:
            self.run_command(['tc', 'filter', 'del', 'dev', self.interface,'parent', '1:', 'prio', str(filter_prio), 'protocol', 'ip', 'u32'], check=False)
            self.run_command(['tc', 'filter', 'del', 'dev', self.ifb_device,'parent', '2:', 'prio', str(filter_prio), 'protocol', 'ip', 'u32'], check=False)
        else: # Fallback: try removing filters by matching IP directly if prio wasn't found
             self.run_command([ 'tc', 'filter', 'del', 'dev', self.interface, 'parent', '1:', 'protocol', 'ip', 'u32', 'match', 'ip', 'dst', f'{ip}/32'], check=False)
             self.run_command([ 'tc', 'filter', 'del', 'dev', self.ifb_device, 'parent', '2:', 'protocol', 'ip', 'u32', 'match', 'ip', 'src', f'{ip}/32'], check=False)

        # Clean up the class and qdisc only if we knew the class_id
        if class_id:
            print(f"      ... and removing class {class_id}")
            self.run_command(['tc', 'qdisc', 'del', 'dev', self.interface, 'parent', f'1:{class_id}'], check=False)
            self.run_command(['tc', 'class', 'del', 'dev', self.interface, 'parent', '1:1', 'classid', f'1:{class_id}'], check=False)
            self.run_command(['tc', 'qdisc', 'del', 'dev', self.ifb_device, 'parent', f'2:{class_id}'], check=False)
            self.run_command(['tc', 'class', 'del', 'dev', self.ifb_device, 'parent', '2:1', 'classid', f'2:{class_id}'], check=False)

        # Clean up internal state
        if ip in self.limits: del self.limits[ip]
        if ip in self.ip_to_class: del self.ip_to_class[ip]

        print(f"      ✅ Limit removal commands executed for {ip}")
        return True

    def update_device_limit(self, ip, download_kbps, upload_kbps, priority=5):
        """Update bandwidth limit for a device - Uses robust add_device_limit"""
        print(f"      🔄  Updating limit for {ip}...")
        return self.add_device_limit(ip, download_kbps, upload_kbps, priority)

    def get_device_limit(self, ip):
        """Get current limit for a device"""
        return self.limits.get(ip, None)

    def list_all_limits(self):
        """List all active limits"""
        return self.limits.copy()

    # --- MAC Blocking Functions Removed ---

    def cleanup_tc(self):
        """Remove all tc rules - IMPROVED"""
        print("🧹 Cleaning up traffic control...")
        self.run_command(['tc', 'qdisc', 'del', 'dev', self.interface, 'root'], check=False)
        self.run_command(['tc', 'qdisc', 'del', 'dev', self.interface, 'ingress'], check=False)
        self.run_command(['tc', 'qdisc', 'del', 'dev', self.ifb_device, 'root'], check=False)
        self.run_command(['ip', 'link', 'set', 'dev', self.ifb_device, 'down'], check=False)
        self.run_command(['ip', 'link', 'del', self.ifb_device], check=False)
        
        self.tc_initialized = False
        self.limits = {}
        self.ip_to_class = {}
        print("✅ Traffic control cleaned up")

    def run_command(self, command, shell=False, check=True, timeout=10):
        """Execute shell command"""
        try:
            if shell: result = subprocess.run(command, shell=True, capture_output=True, text=True, check=check, timeout=timeout)
            else: result = subprocess.run(command, capture_output=True, text=True, check=check, timeout=timeout)
            return result.stdout.strip(), result.stderr.strip(), result.returncode
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            stderr = str(e)
            if hasattr(e, 'stderr'): stderr = e.stderr.strip() if e.stderr else str(e)
            return "", stderr, e.returncode if hasattr(e, 'returncode') else 1

    def get_tc_stats(self):
        """Get traffic statistics directly from tc - Robust line-by-line parsing"""
        stats = {}
        # --- MODIFIED: Use ip_to_class for mapping ---
        class_to_ip = {v: k for k, v in self.ip_to_class.items()}
        # --- End of MODIFIED ---
        if not class_to_ip: return stats
        
        stdout_dl, _, code_dl = self.run_command(['tc', '-s', 'class', 'show', 'dev', self.interface])
        if code_dl == 0:
            lines = stdout_dl.splitlines(); i = 0
            while i < len(lines):
                line = lines[i].strip(); match_class = re.match(r'class htb 1:(\d+)', line)
                if match_class:
                    try:
                        class_id = int(match_class.group(1))
                        if i + 1 < len(lines):
                            next_line = lines[i+1].strip(); match_sent = re.match(r'Sent (\d+) bytes', next_line)
                            if match_sent:
                                bytes_count = int(match_sent.group(1))
                                if class_id in class_to_ip:
                                    ip = class_to_ip[class_id]
                                    if ip not in stats: stats[ip] = {'rx': 0, 'tx': 0}
                                    stats[ip]['rx'] = bytes_count
                                i += 1
                    except (ValueError, IndexError): pass
                i += 1
        stdout_ul, _, code_ul = self.run_command(['tc', '-s', 'class', 'show', 'dev', self.ifb_device])
        if code_ul == 0:
            lines = stdout_ul.splitlines(); i = 0
            while i < len(lines):
                line = lines[i].strip(); match_class = re.match(r'class htb 2:(\d+)', line)
                if match_class:
                    try:
                        class_id = int(match_class.group(1))
                        if i + 1 < len(lines):
                            next_line = lines[i+1].strip(); match_sent = re.match(r'Sent (\d+) bytes', next_line)
                            if match_sent:
                                bytes_count = int(match_sent.group(1))
                                if class_id in class_to_ip:
                                    ip = class_to_ip[class_id]
                                    if ip not in stats: stats[ip] = {'rx': 0, 'tx': 0}
                                    stats[ip]['tx'] = bytes_count
                                i += 1
                    except (ValueError, IndexError): pass
                i += 1
        return stats

    def show_tc_stats(self):
        """Show current tc statistics with better formatting"""
        print(f"\n{'='*120}\n📊 Traffic Control Statistics\n{'='*120}")
        print(f"\n📥 DOWNLOAD CONTROL ({self.interface} egress):\n" + "-" * 120)
        stdout, _, _ = self.run_command(['tc', '-s', '-d', 'class', 'show', 'dev', self.interface])
        print(stdout if stdout else "No classes configured")
        print(f"\n📤 UPLOAD CONTROL ({self.ifb_device} egress):\n" + "-" * 120)
        stdout, _, _ = self.run_command(['tc', '-s', '-d', 'class', 'show', 'dev', self.ifb_device])
        print(stdout if stdout else "No classes configured")
        print(f"\n🔍 ACTIVE FILTERS:\n" + "-" * 120)
        print(f"\nDownload filters ({self.interface}):")
        stdout, _, _ = self.run_command(['tc', 'filter', 'show', 'dev', self.interface, 'parent', '1:'])
        print(stdout if stdout else "No filters")
        print(f"\nUpload filters ({self.ifb_device}):")
        stdout, _, _ = self.run_command(['tc', 'filter', 'show', 'dev', self.ifb_device, 'parent', '2:'])
        print(stdout if stdout else "No filters")
        print(f"\n{'='*120}\n")

class HotspotManager:
    def __init__(self, interface="wlo1", ssid="MyBandwidthManager", password="12345678"):
        self.interface = interface
        self.ssid = ssid
        self.password = password
        self.hotspot_name = "Hotspot"
        self.monitoring = False
        self.stop_monitor = Event()
        self.tc_tracker = BandwidthTracker()    
        self.iptables_tracker = BandwidthTracker()    
        self.iptables_chain = "HOTSPOT_MONITOR"
        self.bandwidth_limiter = BandwidthLimiter(interface)
        self.available_download_kbps = 10000.0    
        self.available_upload_kbps = 10000.0      
        self.last_speedtest_time = 0
        self.speedtest_interval = 10 * 60  
        self.speedtest_thread = None
        self.stop_speedtest_worker = Event()    
        self.speedtest_lock = Lock()
        
        self.device_quotas = {}
        # --- "Source of Truth" for manual limits ---
        self.manual_device_limits = {}
        
        self.last_raw_bytes = {} # {ip: {'rx': R, 'tx': T}}
        
        # --- NEW: Security State ---
        self.client_isolation_enabled = False
        self.access_control_mode = "allow_all" # "allow_all", "block_list", "allow_list"
        self.blocked_macs = set()
        self.allowed_macs = set()
        self.ip_block_list = set() # *** NEW ***
        self.acl_chain = "HOTSPOT_ACL"
        self.isolation_chain = "HOTSPOT_ISOLATION"
        self.ip_block_chain = "HOTSPOT_IP_BLOCK" # *** NEW ***
        
        # --- *** NEW IPV6 CHAINS *** ---
        self.acl_chain_v6 = "HOTSPOT_ACL_V6"
        self.isolation_chain_v6 = "HOTSPOT_ISOLATION_V6"
        self.ip_block_chain_v6 = "HOTSPOT_IP_BLOCK_V6"
        # --- *** END NEW *** ---

        # --- *** NEW: Property to hold forecast data *** ---
        self.forecast_data = []
        # --- *** END NEW *** ---


    def run_command(self, command, shell=False, check=True, timeout=10):
        """Execute shell command and return output"""
        try:
            if shell: result = subprocess.run(command, shell=True, capture_output=True, text=True, check=check, timeout=timeout)
            else: result = subprocess.run(command, capture_output=True, text=True, check=check, timeout=timeout)
            return result.stdout.strip(), result.stderr.strip(), result.returncode
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            stderr = str(e)
            if hasattr(e, 'stderr'): stderr = e.stderr.strip() if e.stderr else str(e)
            return "", stderr, e.returncode if hasattr(e, 'returncode') else 1

    def check_dependencies(self):
        """Check for required external binaries"""
        print("Checking dependencies...")
        try:
            stdout, stderr, code = self.run_command(['speedtest-cli', '--version'], check=False)
            if code != 0: raise FileNotFoundError
            print("      ✓ speedtest-cli found")
        except FileNotFoundError:
            print("❌ FATAL: 'speedtest-cli' is not installed or not in your PATH.")
            print("Please install it: sudo apt install speedtest-cli OR pip install speedtest-cli")
            sys.exit(1)

    def check_sudo(self):
        """Check if running with sudo privileges"""
        if subprocess.run(['id', '-u'], capture_output=True, text=True).stdout.strip() != '0':
            print("❌ This script requires sudo privileges!")
            print(f"Run with: sudo {sys.argv[0]}")
            sys.exit(1)

    def clear_screen(self):
        """Clear terminal screen"""
        os.system('clear' if os.name == 'posix' else 'cls')

    def format_bytes(self, bytes_val):
        """Format bytes to human readable format (MB, GB etc.)"""
        if bytes_val is None: return "N/A"
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if abs(bytes_val) < 1024.0:
                return f"{bytes_val:.1f}{unit}" # Reduced precision for cleaner look
            bytes_val /= 1024.0
        return f"{bytes_val:.1f}PB"

    def format_speed(self, bytes_per_sec):
        """Format speed to human readable format (Kbps, Mbps etc.)"""
        bits_per_sec = bytes_per_sec * 8
        for unit in ['bps', 'Kbps', 'Mbps', 'Gbps']:
            if abs(bits_per_sec) < 1000.0:
                return f"{bits_per_sec:.1f}{unit}" # Reduced precision
            bits_per_sec /= 1000.0
        return f"{bits_per_sec:.1f}Tbps"

    def is_hotspot_active(self):
        """Check if hotspot is currently active"""
        stdout, _, _ = self.run_command(['nmcli', 'connection', 'show', '--active'])
        return self.hotspot_name in stdout or "Hotspot" in stdout or self.ssid in stdout

    def setup_iptables_monitoring(self, network):
        """Setup iptables rules for traffic monitoring - FORWARD ONLY"""
        print(f"🔧 Setting up (unlimited) traffic monitoring for {network}.0/24...")
        self.run_command(['iptables', '-N', self.iptables_chain], check=False)
        self.run_command(['iptables', '-F', self.iptables_chain], check=False)
        # --- REVERTED: Insert at top (position 1) ---
        self.run_command(f"iptables -D FORWARD -j {self.iptables_chain} 2>/dev/null",shell=True, check=False)
        self.run_command(['iptables', '-I', 'FORWARD', '1', '-j', self.iptables_chain]) # Insert at 1st position
        # --- End of REVERTED ---
        print("✅ iptables monitoring rules created (FORWARD only)")
        
    # --- NEW: Security Rules Setup ---
    def setup_security_rules(self):
        """Creates and links the iptables & ip6tables chains for security features."""
        print(f"🔧 Setting up security chains (IPv4 & IPv6)...")
        
        # --- First, completely clean up any existing setup ---
        print("  Cleaning up any existing security chains...")
        self.cleanup_security_rules()
        
        # --- IPv4 Chains ---
        print("  Creating IPv4 chains...")
        self.run_command(['iptables', '-N', self.acl_chain], check=False)
        self.run_command(['iptables', '-N', self.ip_block_chain], check=False)
        self.run_command(['iptables', '-N', self.isolation_chain], check=False)
        
        # --- IPv6 Chains ---
        print("  Creating IPv6 chains...")
        self.run_command(['ip6tables', '-N', self.acl_chain_v6], check=False)
        self.run_command(['ip6tables', '-N', self.ip_block_chain_v6], check=False)
        self.run_command(['ip6tables', '-N', self.isolation_chain_v6], check=False)

        # --- Link IPv4 Chains (CORRECT ORDER) ---
        print("  Linking IPv4 chains to FORWARD...")
        # Position 2: IP Block first (checks all traffic from hotspot)
        self.run_command(['iptables', '-I', 'FORWARD', '2', '-i', self.interface, 
                        '-j', self.ip_block_chain])
        # Position 3: Client Isolation (only for client-to-client traffic)
        self.run_command(['iptables', '-I', 'FORWARD', '3', '-i', self.interface, 
                        '-o', self.interface, '-j', self.isolation_chain])
        # Position 4: ACL (checks remaining traffic)
        self.run_command(['iptables', '-I', 'FORWARD', '4', '-i', self.interface, 
                        '-j', self.acl_chain])

        # --- Link IPv6 Chains ---
        print("  Linking IPv6 chains to FORWARD...")
        self.run_command(['ip6tables', '-I', 'FORWARD', '1', '-i', self.interface, 
                        '-j', self.ip_block_chain_v6])
        self.run_command(['ip6tables', '-I', 'FORWARD', '2', '-i', self.interface, 
                        '-o', self.interface, '-j', self.isolation_chain_v6])
        self.run_command(['ip6tables', '-I', 'FORWARD', '3', '-i', self.interface, 
                        '-j', self.acl_chain_v6])

        # Apply rules to all chains
        print("  Applying security policies...")
        self.apply_client_isolation_rule()
        self.apply_access_control_rules()
        self.apply_ip_block_rules() 
        print("✅ Security chains linked and rules applied.")



    def cleanup_iptables_monitoring(self):
        """Remove iptables monitoring rules"""
        print("🧹 Cleaning up iptables monitoring rules...")
        self.run_command(f"iptables -D FORWARD -j {self.iptables_chain} 2>/dev/null", shell=True, check=False)
        self.run_command(['iptables', '-F', self.iptables_chain], check=False)
        self.run_command(['iptables', '-X', self.iptables_chain], check=False)

    # --- NEW: Security Rules Cleanup ---
    def cleanup_security_rules(self):
        """Removes all iptables & ip6tables security rules and chains."""
        print("🧹 Cleaning up security rules (IPv4 & IPv6)...")
        
        # --- IPv4 Cleanup ---
        # Remove all references from FORWARD (use while loop to handle multiple references)
        while True:
            stdout, _, code = self.run_command(
                f"iptables -D FORWARD -j {self.acl_chain} 2>&1", 
                shell=True, check=False
            )
            if code != 0:
                break
                
        while True:
            stdout, _, code = self.run_command(
                f"iptables -D FORWARD -j {self.ip_block_chain} 2>&1", 
                shell=True, check=False
            )
            if code != 0:
                break
                
        while True:
            stdout, _, code = self.run_command(
                f"iptables -D FORWARD -i {self.interface} -o {self.interface} -j {self.isolation_chain} 2>&1",
                shell=True, check=False
            )
            if code != 0:
                break
        
        # Flush and delete chains
        self.run_command(['iptables', '-F', self.acl_chain], check=False)
        self.run_command(['iptables', '-F', self.ip_block_chain], check=False)
        self.run_command(['iptables', '-F', self.isolation_chain], check=False)
        self.run_command(['iptables', '-X', self.acl_chain], check=False)
        self.run_command(['iptables', '-X', self.ip_block_chain], check=False)
        self.run_command(['iptables', '-X', self.isolation_chain], check=False)
        
        # --- IPv6 Cleanup ---
        while True:
            stdout, _, code = self.run_command(
                f"ip6tables -D FORWARD -j {self.acl_chain_v6} 2>&1",
                shell=True, check=False
            )
            if code != 0:
                break
                
        while True:
            stdout, _, code = self.run_command(
                f"ip6tables -D FORWARD -j {self.ip_block_chain_v6} 2>&1",
                shell=True, check=False
            )
            if code != 0:
                break
                
        while True:
            stdout, _, code = self.run_command(
                f"ip6tables -D FORWARD -i {self.interface} -o {self.interface} -j {self.isolation_chain_v6} 2>&1",
                shell=True, check=False
            )
            if code != 0:
                break
        
        self.run_command(['ip6tables', '-F', self.acl_chain_v6], check=False)
        self.run_command(['ip6tables', '-F', self.ip_block_chain_v6], check=False)
        self.run_command(['ip6tables', '-F', self.isolation_chain_v6], check=False)
        self.run_command(['ip6tables', '-X', self.acl_chain_v6], check=False)
        self.run_command(['ip6tables', '-X', self.ip_block_chain_v6], check=False)
        self.run_command(['ip6tables', '-X', self.isolation_chain_v6], check=False)
        
        print("✅ Security rules cleaned up.")

    # --- NEW: Apply Client Isolation Rule ---
    def apply_client_isolation_rule(self):
        """Applies the iptables rule for client isolation based on state."""
        print(f"Applying client isolation (IPv4 & IPv6): {'ENABLED' if self.client_isolation_enabled else 'DISABLED'}")
        
        # --- IPv4 ---
        self.run_command(['iptables', '-F', self.isolation_chain], check=False)
        if self.client_isolation_enabled:
            # Only add DROP rule when enabled
            self.run_command(['iptables', '-A', self.isolation_chain, '-j', 'DROP'])
        # When disabled, leave chain empty (traffic falls through)
        
        # --- IPv6 ---
        self.run_command(['ip6tables', '-F', self.isolation_chain_v6], check=False)
        if self.client_isolation_enabled:
            self.run_command(['ip6tables', '-A', self.isolation_chain_v6, '-j', 'DROP'])
        # --- *** END NEW *** ---

    # --- NEW: Apply Access Control Rules ---
    def apply_access_control_rules(self):
        """Applies the iptables rules for MAC block/allow lists."""
        print(f"Applying Access Control Mode (IPv4 & IPv6): {self.access_control_mode}")
        
        # --- IPv4 ---
        self.run_command(['iptables', '-F', self.acl_chain], check=False)
        if self.access_control_mode == 'allow_all':
            pass  # Empty chain
        elif self.access_control_mode == 'block_list':
            for mac in self.blocked_macs:
                self.run_command(['iptables', '-A', self.acl_chain, '-m', 'mac', 
                                '--mac-source', mac, '-j', 'DROP'])
        elif self.access_control_mode == 'allow_list':
            for mac in self.allowed_macs:
                self.run_command(['iptables', '-A', self.acl_chain, '-m', 'mac', 
                                '--mac-source', mac, '-j', 'ACCEPT'])
            self.run_command(['iptables', '-A', self.acl_chain, '-j', 'DROP'])

        # --- IPv6 ---
        self.run_command(['ip6tables', '-F', self.acl_chain_v6], check=False)
        if self.access_control_mode == 'allow_all':
            pass
        elif self.access_control_mode == 'block_list':
            for mac in self.blocked_macs:
                self.run_command(['ip6tables', '-A', self.acl_chain_v6, '-m', 'mac', 
                                '--mac-source', mac, '-j', 'DROP'])
        elif self.access_control_mode == 'allow_list':
            for mac in self.allowed_macs:
                self.run_command(['ip6tables', '-A', self.acl_chain_v6, '-m', 'mac', 
                                '--mac-source', mac, '-j', 'ACCEPT'])
            self.run_command(['ip6tables', '-A', self.acl_chain_v6, '-j', 'DROP'])
 # --- *** NEW: Apply IP Block Rules *** ---
    def apply_ip_block_rules(self): 
        """Applies the iptables & ip6tables rules for the IP block list."""
        print(f"Applying IP Block List (IPv4 & IPv6): {self.ip_block_list}")
        
        # --- IPv4 ---
        self.run_command(['iptables', '-F', self.ip_block_chain], check=False)
        
        # --- *** NEW: IPv6 ---
        self.run_command(['ip6tables', '-F', self.ip_block_chain_v6], check=False)

        for ip_range in self.ip_block_list:
            # Simple check: if it has a colon, it's IPv6.
            if ':' in ip_range:
                # --- NEW: IPv6 Rule ---
                self.run_command(['ip6tables', '-A', self.ip_block_chain_v6, '-d', ip_range, '-j', 'DROP'])
                self.run_command(['ip6tables', '-A', self.ip_block_chain_v6, '-s', ip_range, '-j', 'DROP'])
            elif '.' in ip_range:
                # --- Existing IPv4 Rule ---
                self.run_command(['iptables', '-A', self.ip_block_chain, '-d', ip_range, '-j', 'DROP'])
                self.run_command(['iptables', '-A', self.ip_block_chain, '-s', ip_range, '-j', 'DROP'])
        
        # --- FIX: We intentionally do NOT add an 'ACCEPT' rule here. ---
        # Traffic that is not dropped will "fall through" to be processed
        # by the next chain in the FORWARD list (e.g., isolation_chain).
        
        # --- FIX: REMOVED the final ACCEPT rules ---
        # The lines below were the bug. By removing them, packets that are
        # not dropped will fall through to the next chain (HOTSPOT_ACL).
        # self.run_command(['iptables', '-A', self.ip_block_chain, '-j', 'ACCEPT'])
        # self.run_command(['ip6tables', '-A', self.ip_block_chain_v6, '-j', 'ACCEPT'])

    # --- NEW: Helper functions to be called by daemon ---
    def set_client_isolation(self, enabled: bool):
        self.client_isolation_enabled = enabled
        self.apply_client_isolation_rule()

    def set_access_control_mode(self, mode: str):
        if mode not in ['allow_all', 'block_list', 'allow_list']:
            print(f"Warning: Invalid AC mode '{mode}'. Defaulting to 'allow_all'.")
            self.access_control_mode = 'allow_all'
        else:
            self.access_control_mode = mode
        self.apply_access_control_rules()

    def add_mac_to_list(self, mac: str, list_type: str):
        if list_type == 'block':
            self.blocked_macs.add(mac)
        elif list_type == 'allow':
            self.allowed_macs.add(mac)
        self.apply_access_control_rules() # Re-apply rules

    def remove_mac_from_list(self, mac: str):
        self.blocked_macs.discard(mac)
        self.allowed_macs.discard(mac)
        self.apply_access_control_rules() # Re-apply rules
        
    # --- *** NEW: IP Block List Helpers *** ---
    def add_ip_to_block_list(self, ip_range: str):
        """Adds an IP/CIDR to the block list and applies rules."""
        if ip_range not in self.ip_block_list:
            self.ip_block_list.add(ip_range)
            self.apply_ip_block_rules()
            print(f"Added {ip_range} to block list. Rules applied.")
            return True
        return False

    def remove_ip_from_block_list(self, ip_range: str):
        """Removes an IP/CIDR from the block list and applies rules."""
        if ip_range in self.ip_block_list:
            self.ip_block_list.discard(ip_range)
            self.apply_ip_block_rules()
            print(f"Removed {ip_range} from block list. Rules applied.")
            return True
        return False
    # --- *** End of NEW *** ---
        
    # --- End of NEW security functions ---

    def add_device_to_monitoring(self, ip):
        """Add iptables rules for a specific device"""
        # This function is IPv4 only, as IPv6 monitoring is much more complex
        # and not required for bandwidth limiting (which uses TC).
        if ':' in ip: # Don't try to monitor IPv6 with this method
            return
            
        stdout, _, _ = self.run_command(['iptables', '-L', self.iptables_chain, '-n'], check=False)
        if ip not in stdout:
            self.run_command(['iptables', '-A', self.iptables_chain,'-d', ip, '-j', 'RETURN'], check=False)
            self.run_command(['iptables', '-A', self.iptables_chain,'-s', ip, '-j', 'RETURN'], check=False)

    def get_iptables_stats(self, network_prefix):
        """Get traffic statistics from iptables - ROBUST PARSER"""
        stdout, _, _ = self.run_command(['iptables', '-L', self.iptables_chain, '-v', '-n', '-x'])
        stats = {}
        if not network_prefix: return stats
        for line in stdout.split('\n'):
            parts = line.split()
            if len(parts) >= 9 and parts[0].isdigit():
                try:
                    bytes_count = int(parts[1]); source = parts[7]; dest = parts[8]
                    if source.startswith(network_prefix):
                        ip = source.split('/')[0]
                        if ip not in stats: stats[ip] = {'rx': 0, 'tx': 0}
                        stats[ip]['tx'] += bytes_count
                    elif dest.startswith(network_prefix):
                        ip = dest.split('/')[0]
                        if ip not in stats: stats[ip] = {'rx': 0, 'tx': 0}
                        stats[ip]['rx'] += bytes_count
                except (ValueError, IndexError): continue
        return stats

    def detect_internet_interface(self):
        """Detect which network interface has internet connectivity"""
        print("      🔍 Detecting internet interface...")
        # Get default route
        stdout, _, code = self.run_command(['ip', 'route', 'show', 'default'], check=False)
        if code == 0 and stdout:
            # Parse: default via 192.168.1.1 dev eth0 ...
            match = re.search(r'dev\s+(\S+)', stdout)
            if match:
                internet_if = match.group(1)
                # Don't use the hotspot interface itself
                if internet_if != self.interface:
                    print(f"      ✓ Found internet interface: {internet_if}")
                    return internet_if
        
        # Fallback: check all active interfaces
        stdout, _, _ = self.run_command(['ip', 'link', 'show'], check=False)
        interfaces = re.findall(r'\d+:\s+(\S+):', stdout)
        for iface in interfaces:
            if iface in ['lo', self.interface] or iface.startswith('ifb'):
                continue
            # Check if interface is UP and has an IP
            stdout, _, code = self.run_command(['ip', 'addr', 'show', iface], check=False)
            if 'state UP' in stdout and 'inet ' in stdout:
                print(f"      ✓ Found active interface: {iface}")
                return iface
        
        print("      ⚠️ No internet interface found")
        return None

    def turn_on_hotspot(self):
        """Enable WiFi hotspot"""
        print(f"🔄 Turning ON hotspot '{self.ssid}'...")
        print(f"    Disconnecting {self.interface}...")
        self.run_command(['nmcli', 'device', 'disconnect', self.interface], check=False)
        self.run_command(['nmcli', 'connection', 'delete', self.hotspot_name], check=False)
        self.run_command(['nmcli', 'connection', 'delete', self.ssid], check=False)
        stdout, stderr, code = self.run_command(['nmcli', 'device', 'wifi', 'hotspot','ifname', self.interface,'ssid', self.ssid,'password', self.password])
        if code == 0:
            print(f"✅ Hotspot '{self.ssid}' is now ACTIVE!")
            print(f"    Password: {self.password}")
            self.run_command(['sysctl', '-w', 'net.ipv4.ip_forward=1'])
            print("✅ IP forwarding enabled")
            time.sleep(2)
            _, _, network = self.get_hotspot_ip_range()
            if network:
                self.setup_iptables_monitoring(network)
                self.setup_security_rules()
                self.bandwidth_limiter.setup_tc_qdisc(self.available_download_kbps, self.available_upload_kbps)
            print("    Running initial speedtest... (please wait, this can take a minute)")
            self.run_speed_test()
            print("    Initial speedtest complete.")
            self.start_speedtest_worker()
            return True
        else:
            print(f"❌ Failed to start hotspot: {stderr}")
            return False
        
    def turn_off_hotspot(self):
        """Disable WiFi hotspot"""
        print("🔄 Turning OFF hotspot...")
        self._stop_speedtest_worker_thread() # Use renamed method
        self.cleanup_iptables_monitoring()
        self.cleanup_security_rules() # --- NEW ---
        self.bandwidth_limiter.cleanup_tc()
        self.run_command(['nmcli', 'connection', 'down', self.hotspot_name], check=False)
        self.run_command(['nmcli', 'connection', 'down', self.ssid], check=False)
        # QUOTA: Clear last raw bytes on hotspot off
        self.last_raw_bytes.clear()
        self.manual_device_limits.clear() # Clear truth dict
        print("✅ Hotspot is now OFF")
        return True

    def run_speed_test(self):
        """Runs speedtest-cli and updates the total bandwidth"""
        print("\n🚀 [Speedtest] Starting internet speed test... (this may take a minute)")
        try:
            stdout, stderr, code = self.run_command(['speedtest-cli', '--json'], timeout=90)
            if code != 0: print(f"      ❌ [Speedtest] Failed. Error: {stderr}"); return
            results = json.loads(stdout)
            download_kbps = results.get('download', 0) / 1000.0
            upload_kbps = results.get('upload', 0) / 1000.0
            if download_kbps == 0: print("      ⚠️ [Speedtest] Got 0 download speed. Will retry."); return
            with self.speedtest_lock:
                self.available_download_kbps = download_kbps
                self.available_upload_kbps = upload_kbps
                self.last_speedtest_time = time.time()
            print(f"      ✅ [Speedtest] Complete. New capacity: ↓ {self.available_download_kbps:.0f} Kbps | ↑ {self.available_upload_kbps:.0f} Kbps")
            self.update_root_tc_limits()
        except subprocess.TimeoutExpired: print("      ❌ [Speedtest] Timed out.")
        except json.JSONDecodeError: print("      ❌ [Speedtest] Failed to parse JSON.")
        except Exception as e: print(f"      ❌ [Speedtest] An error occurred: {e}")

    def update_root_tc_limits(self):
        """Updates the root TC classes with new speedtest values"""
        if not self.bandwidth_limiter.tc_initialized: return
        print("      🔄 [TC Update] Applying new speedtest results to root qdisc...")
        with self.speedtest_lock: dl_kbps = int(self.available_download_kbps); ul_kbps = int(self.available_upload_kbps)
        self.bandwidth_limiter.run_command(['tc', 'class', 'change', 'dev', self.interface,'parent', '1:', 'classid', '1:1', 'htb','rate', f'{dl_kbps}kbit', 'burst', '15k'])
        self.bandwidth_limiter.run_command(['tc', 'class', 'change', 'dev', self.bandwidth_limiter.ifb_device,'parent', '2:', 'classid', '2:1', 'htb','rate', f'{ul_kbps}kbit', 'burst', '15k'])
        print("      ✅ [TC Update] Root qdisc capacity updated.")

    def _speedtest_worker(self):
        """Background thread worker to run speedtests periodically"""
        while not self.stop_speedtest_worker.is_set():
            now = time.time()
            if now - self.last_speedtest_time > self.speedtest_interval:
                Thread(target=self.run_speed_test, daemon=True).start()
            self.stop_speedtest_worker.wait(30)

    def start_speedtest_worker(self):
        """Starts the background speedtest worker thread"""
        print("Starting background speedtest worker...")
        self.stop_speedtest_worker.clear()
        # --- *** THIS IS THE FIX *** ---
        self.speedtest_thread = Thread(target=self._speedtest_worker, daemon=True)
        # --- *** END OF FIX *** ---
        self.speedtest_thread.start()

    # --- MODIFIED: Renamed method ---
    def _stop_speedtest_worker_thread(self): # Renamed this method
        """Stops the background speedtest thread"""
        print("Stopping background speedtest worker...")
        self.stop_speedtest_worker.set() # Set the Event flag
        if self.speedtest_thread and self.speedtest_thread.is_alive():
            self.speedtest_thread.join(timeout=2)
        print("      Stopped.")

    def get_hotspot_ip_range(self):
        """Get the IP address range of the hotspot interface"""
        stdout, _, _ = self.run_command(['ip', 'addr', 'show', self.interface])
        match = re.search(r'inet (\d+\.\d+\.\d+\.\d+)/(\d+)', stdout)
        if match:
            ip = match.group(1); cidr = match.group(2); ip_parts = ip.split('.')
            network = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}"
            return ip, cidr, network
        return None, None, None

    def get_dhcp_leases(self):
        """Get DHCP leases from dnsmasq or NetworkManager"""
        devices = {}
        lease_files = ['/var/lib/misc/dnsmasq.leases', '/var/lib/NetworkManager/dnsmasq*.leases', '/tmp/dnsmasq.leases']
        for lease_file in lease_files:
            stdout, _, code = self.run_command(f'cat {lease_file} 2>/dev/null', shell=True, check=False)
            if code == 0 and stdout:
                for line in stdout.split('\n'):
                    parts = line.split()
                    if len(parts) >= 5:
                        ip = parts[2]; devices[ip] = {'ip': ip, 'mac': parts[1], 'hostname': parts[3] if parts[3] != '*' else 'Unknown', 'lease_time': parts[0]}
        return devices

    def check_device_active(self, ip):
        """Check if device is actively connected using ping"""
        # This will only ping IPv4 addresses from the DHCP lease list
        if ':' in ip:
            return False # We are not currently tracking IPv6 clients actively
        return subprocess.run(['ping', '-c', '1', '-W', '1', ip],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0

    # QUOTA: Heavily modified to calculate deltas and update quotas
    def get_connected_devices_with_bandwidth(self):
        """Get connected devices with bandwidth information - HYBRID + QUOTA"""
        hotspot_ip, cidr, network = self.get_hotspot_ip_range()
        if not hotspot_ip: return [], hotspot_ip, network

        dhcp_devices = self.get_dhcp_leases()
        stdout, _, _ = self.run_command(['ip', 'neigh', 'show', 'dev', self.interface])
        
        current_devices_arp = {}
        for line in stdout.split('\n'):
            if line.strip():
                parts = line.split()
                if len(parts) >= 5:
                    ip = parts[0]; mac = parts[4] if parts[3] == 'lladdr' else 'N/A'
                    status = parts[-1] if len(parts) > 5 else 'UNKNOWN'
                    # Only track IPv4 clients from our network
                    if ip != hotspot_ip and ip.startswith(network) and ':' not in ip:
                        current_devices_arp[ip] = {'ip': ip, 'mac': mac, 'arp_status': status, 'hostname': 'Unknown', 'active': False}

        # Combine ARP and DHCP, prioritizing DHCP for hostname/MAC
        combined_devices = current_devices_arp.copy()
        for ip, dev in dhcp_devices.items():
            if ip != hotspot_ip and ip.startswith(network) and ':' not in ip:
                if ip in combined_devices:
                    combined_devices[ip]['hostname'] = dev['hostname']
                    combined_devices[ip]['mac'] = dev['mac'] # DHCP MAC might be more reliable
                else: # Device in DHCP but not ARP yet? Add it.
                    combined_devices[ip] = {'ip': ip,'mac': dev['mac'],'arp_status': 'DHCP_ONLY','hostname': dev['hostname'],'active': False}

        device_list = list(combined_devices.values())
        
        # Check activity and add to iptables monitoring
        threads = []
        def check_active(device):
            device['active'] = self.check_device_active(device['ip'])
            if device['active']: self.add_device_to_monitoring(device['ip'])
        for device in device_list:
            thread = Thread(target=check_active, args=(device,)); thread.start(); threads.append(thread)
        for thread in threads: thread.join(timeout=1) # Reduced timeout for faster refresh

        # Fetch raw byte counts NOW
        tc_raw_stats = self.bandwidth_limiter.get_tc_stats()
        iptables_raw_stats = self.get_iptables_stats(network)
        
        now = time.time()
        
        # Process each device
        for device in device_list:
            ip = device['ip']
            
            # --- Get Current Raw Bytes ---
            current_raw_rx, current_raw_tx = 0, 0
            
            # --- MODIFIED: Get *current* limit state ---
            current_limit = self.bandwidth_limiter.get_device_limit(ip)
            device['has_current_limit'] = current_limit is not None
            
            if device['has_current_limit']:
            # --- End of MODIFIED ---
                if ip in tc_raw_stats:
                    current_raw_rx = tc_raw_stats[ip].get('rx', 0)
                    current_raw_tx = tc_raw_stats[ip].get('tx', 0)
            else: # Unlimited device
                if ip in iptables_raw_stats:
                    current_raw_rx = iptables_raw_stats[ip].get('rx', 0)
                    current_raw_tx = iptables_raw_stats[ip].get('tx', 0)

            # --- Calculate Deltas for Quota ---
            last_rx, last_tx = self.last_raw_bytes.get(ip, {'rx': 0, 'tx': 0}).values()
            
            rx_delta = current_raw_rx - last_rx
            tx_delta = current_raw_tx - last_tx

            # Handle counter wraps/resets for deltas
            if rx_delta < 0: rx_delta = current_raw_rx
            if tx_delta < 0: tx_delta = current_raw_tx

            # Update last raw bytes for next calculation
            self.last_raw_bytes[ip] = {'rx': current_raw_rx, 'tx': current_raw_tx}

            # --- Update Trackers (for speed/session totals) ---
            tracker = self.tc_tracker if device['has_current_limit'] else self.iptables_tracker
            stats, _, _ = tracker.update_device(ip, current_raw_rx, current_raw_tx)

            # Assign stats from tracker
            device['download_speed'] = stats['rx_speed']
            device['upload_speed'] = stats['tx_speed']
            device['total_download'] = stats['total_rx_bytes'] # Session total
            device['total_upload'] = stats['total_tx_bytes']   # Session total
            device['session_duration'] = now - stats['first_seen']
            device['rx_delta_bytes'] = rx_delta
            device['tx_delta_bytes'] = tx_delta

            # --- Update and Check Quota ---
            device['quota_status'] = "N/A"
            device['quota_dl_used_bytes'] = None
            device['quota_ul_used_bytes'] = None
            device['quota_dl_limit_bytes'] = None
            device['quota_ul_limit_bytes'] = None
            device['quota_time_left_seconds'] = None

            if ip in self.device_quotas:
                quota = self.device_quotas[ip]
                is_throttled = quota.setdefault('is_throttled', False)
                time_elapsed = now - quota['start_time']

                # Check if period expired
                if time_elapsed >= quota['period_seconds']:
                    print(f"🔄 Quota period reset for {ip}")
                    
                    if is_throttled:
                        print(f"      Removing throttle for {ip}.")
                        quota['is_throttled'] = False
                        
                        # --- MODIFIED: Read from "truth" dict ---
                        manual_limit = self.manual_device_limits.get(ip)
                        if manual_limit:
                            print(f"      Restoring manual limit for {ip}.")
                            self.bandwidth_limiter.add_device_limit(
                                ip, manual_limit['download'], manual_limit['upload'], manual_limit['priority']
                            )
                        else:
                            print(f"      No manual limit for {ip}. Removing all limits.")
                            self.bandwidth_limiter.remove_device_limit(ip)
                        # --- End of MODIFIED ---
                        
                    quota['start_time'] = now
                    quota['used_dl_bytes'] = 0
                    quota['used_ul_bytes'] = 0
                    time_elapsed = 0
                    quota['used_dl_bytes'] += rx_delta
                    quota['used_ul_bytes'] += tx_delta
                else:
                    quota['used_dl_bytes'] += rx_delta
                    quota['used_ul_bytes'] += tx_delta

                # Check if exceeded within the current period
                exceeded_dl = quota['used_dl_bytes'] >= quota['limit_dl_bytes']
                exceeded_ul = quota['used_ul_bytes'] >= quota['limit_ul_bytes']
                
                if exceeded_dl or exceeded_ul:
                    device['quota_status'] = "🚫 Throttled"
                    if not is_throttled:
                        print(f"🚨 Quota exceeded for {ip}! Applying 8Kbps throttle.")
                        self.bandwidth_limiter.add_device_limit(ip, 8, 8, 0)
                        quota['is_throttled'] = True
                else:
                    if is_throttled:
                        print(f"✅ Quota no longer exceeded for {ip}. Removing throttle.")
                        quota['is_throttled'] = False
                        
                        # --- MODIFIED: Read from "truth" dict ---
                        manual_limit = self.manual_device_limits.get(ip)
                        if manual_limit:
                            print(f"      Restoring manual limit for {ip}.")
                            self.bandwidth_limiter.add_device_limit(
                                ip, manual_limit['download'], manual_limit['upload'], manual_limit['priority']
                            )
                        else:
                            print(f"      No manual limit for {ip}. Removing all limits.")
                            self.bandwidth_limiter.remove_device_limit(ip)
                        # --- End of MODIFIED ---
                        
                    device['quota_status'] = "✅ OK"
                
                device['quota_dl_used_bytes'] = quota['used_dl_bytes']
                device['quota_ul_used_bytes'] = quota['used_ul_bytes']
                device['quota_dl_limit_bytes'] = quota['limit_dl_bytes']
                device['quota_ul_limit_bytes'] = quota['limit_ul_bytes']
                device['quota_time_left_seconds'] = quota['period_seconds'] - time_elapsed

            # --- MODIFIED: Read from "truth" dict for display ---
            manual_limit = self.manual_device_limits.get(ip)
            device['has_limit'] = manual_limit is not None # This is for the UI
            
            if manual_limit:
                device['limit_download'] = manual_limit.get('download')
                device['limit_upload'] = manual_limit.get('upload')
                device['priority'] = manual_limit.get('priority')
            else:
                device['limit_download'] = None
                device['limit_upload'] = None
                device['priority'] = None
            # --- End of MODIFIED ---

        return device_list, hotspot_ip, network

    # QUOTA: Modified display
    def display_realtime_monitor(self):
        """Display real-time monitoring dashboard with bandwidth and quotas"""
        table_width = 230
        header_format = (
            "{:<12} {:<16} {:<18} {:<5} {:<13} {:<13} {:<11} {:<11} "
            "{:<12} {:<12} {:<25} {:<25} {:<15} {:<15}"
        )
        row_format = (
            "{status:<12} {ip:<16} {hostname:<18} {prio:<5} {dspeed:<13} {uspeed:<13} {tdown:<11} {tup:<11} "
            "{dlim:<12} {ulim:<12} {qdown:<25} {qup:<25} {qtime:<15} {qstat:<15}"
        )


        while not self.stop_monitor.is_set():
            self.clear_screen()
            print("=" * table_width)
            print(f"      🔴 LIVE HOTSPOT BANDWIDTH MONITOR (Hybrid + Quota) - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print("=" * table_width)

            if not self.is_hotspot_active():
                print("\n❌ Hotspot is INACTIVE")
                print("\nPress Ctrl+C to return to menu...")
                time.sleep(2); continue

            print(f"✅ Hotspot: {self.ssid} | Interface: {self.interface}")
            devices, hotspot_ip, network = self.get_connected_devices_with_bandwidth()
            if hotspot_ip: print(f"🌐 Network: {network}.0/24 | Gateway: {hotspot_ip}")
            
            with self.speedtest_lock: dl_kbps = self.available_download_kbps; ul_kbps = self.available_upload_kbps
            print(f"⚡ ISP Capacity: ↓ {dl_kbps:.0f} Kbps | ↑ {ul_kbps:.0f} Kbps")

            print("\n" + "=" * table_width)
            print(header_format.format(
                "Status", "IP Address", "Hostname", "Prio", "↓ Speed", "↑ Speed", "Total ↓", "Total ↑",
                "Limit ↓", "Limit ↑", "Quota ↓ (Used/Limit)", "Quota ↑ (Used/Limit)", "Quota Time", "Quota Status"
            ))
            print("-" * table_width)

            total_download_speed = 0; total_upload_speed = 0
            total_data_download = 0; total_data_upload = 0

            if not devices:
                print("\n       ⚠️  No devices detected")
            else:
                devices_sorted = sorted(devices, key=lambda x: [int(i) for i in x['ip'].split('.')])
                for device in devices_sorted:
                    if device['active']:
                        status = "🟢 ACTIVE"
                        total_download_speed += device['download_speed']
                        total_upload_speed += device['upload_speed']
                        total_data_download += device['total_download']
                        total_data_upload += device['total_upload']
                        dspeed = self.format_speed(device['download_speed'])
                        uspeed = self.format_speed(device['upload_speed'])
                    else:
                        status = "🔴 OFFLINE"
                        dspeed = "-"; uspeed = "-"

                    prio = str(device['priority']) if device['priority'] is not None else "-"
                    tdown = self.format_bytes(device['total_download']) # Session total
                    tup = self.format_bytes(device['total_upload'])     # Session total
                    dlim = f"{device['limit_download']}K" if device['limit_download'] is not None else "None"
                    ulim = f"{device['limit_upload']}K" if device['limit_upload'] is not None else "None"
                    hostname = device['hostname'][:16]

                    # QUOTA: Format quota info
                    if device['quota_dl_limit_bytes'] is not None:
                        qdown = f"{self.format_bytes(device['quota_dl_used_bytes'])}/{self.format_bytes(device['quota_dl_limit_bytes'])}"
                        qup = f"{self.format_bytes(device['quota_ul_used_bytes'])}/{self.format_bytes(device['quota_ul_limit_bytes'])}"
                        qtime = format_seconds(device['quota_time_left_seconds'])
                        qstat = device['quota_status']
                    else:
                        qdown = "-"; qup = "-"; qtime = "-"; qstat = "-"

                    print(row_format.format(
                        status=status, ip=device['ip'], hostname=hostname, prio=prio, dspeed=dspeed, uspeed=uspeed,
                        tdown=tdown, tup=tup, dlim=dlim, ulim=ulim, qdown=qdown, qup=qup, qtime=qtime, qstat=qstat
                    ))

            active_count = sum(1 for d in devices if d['active'])
            limited_count = sum(1 for d in devices if d['has_limit'])
            quota_count = sum(1 for d in devices if d['quota_dl_limit_bytes'] is not None) # QUOTA
            print("\n" + "-" * table_width)
            print(f"📊 Devices: {len(devices)} Total | {active_count} Active 🟢 | {len(devices) - active_count} Offline 🔴 | {limited_count} Limited 🚦 | {quota_count} Quota 📈") # QUOTA
            print(f"🌐 Current Speed: ↓ {self.format_speed(total_download_speed)} | ↑ {self.format_speed(total_upload_speed)}")
            print(f"📈 Session Data: ↓ {self.format_bytes(total_data_download)} | ↑ {self.format_bytes(total_data_upload)}") # Changed label

            total_dl_kbps = (total_download_speed * 8) / 1000
            congestion_threshold_kbps = dl_kbps * 0.9
            congestion_status = "Yes ⚠️" if total_dl_kbps > congestion_threshold_kbps > 0 else "No"
            print(f"🚦 Congestion Status: {congestion_status} (Using {total_dl_kbps:.0f} / {congestion_threshold_kbps:.0f} Kbps of available download)")

            print("=" * table_width)
            print("\n💡 Refreshing every 2 seconds... Press Ctrl+C to stop monitoring")
            time.sleep(2)


    def start_realtime_monitor(self):
        """Start real-time monitoring in terminal"""
        print("\n🚀 Starting real-time bandwidth monitoring...")
        if not self.is_hotspot_active(): print("❌ Cannot start monitoring - hotspot not active"); return
        _, _, network = self.get_hotspot_ip_range()
        if not network: print("❌ Cannot start monitoring - hotspot IP not found"); return
        self.setup_iptables_monitoring(network)
        self.last_raw_bytes.clear()
        print("💡 Press Ctrl+C to stop\n"); time.sleep(2)
        self.monitoring = True; self.stop_monitor.clear()
        try: self.display_realtime_monitor()
        except KeyboardInterrupt:
            print("\n\n⏸️  Monitoring stopped"); self.monitoring = False; self.stop_monitor.set(); time.sleep(1)

    def show_status(self):
        """Show current hotspot status (one-time snapshot)"""
        width = 170 # Adjusted for Quota
        print("\n" + "=" * width)
        print(f"      HOTSPOT STATUS - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * width)

        if self.is_hotspot_active():
            print(f"✅ Hotspot is ACTIVE"); print(f"      SSID: {self.ssid}")
            with self.speedtest_lock: dl_kbps = self.available_download_kbps; ul_kbps = self.available_upload_kbps
            print(f"⚡ ISP Capacity: ↓ {dl_kbps:.0f} Kbps | ↑ {ul_kbps:.0f} Kbps")
            
            self.last_raw_bytes.clear()
            devices, hotspot_ip, network = self.get_connected_devices_with_bandwidth()
            
            if hotspot_ip: print(f"      Gateway IP: {hotspot_ip}"); print(f"      Network: {network}.0/24")
            
            print("\n" + "=" * width)
            header = "{:<12} {:<16} {:<20} {:<6} {:<12} {:<12} {:<15} {:<20} {:<20} {:<10}"
            print(header.format("Status", "IP Address", "Hostname", "Prio", "Session ↓", "Session ↑", "Limit Status", "Quota ↓ (Used/Limit)", "Quota ↑ (Used/Limit)", "Quota Time"))
            print("-" * width)

            if not devices:
                print("\n      No devices connected")
            else:
                for device in sorted(devices, key=lambda x: [int(i) for i in x['ip'].split('.')]):
                    status = "🟢 ACTIVE" if device['active'] else "🔴 OFFLINE"
                    prio = str(device['priority']) if device['priority'] is not None else "-"
                    total_down = self.format_bytes(device['total_download']) # Session
                    total_up = self.format_bytes(device['total_upload'])     # Session
                    hostname = device['hostname'][:18]
                    
                    # --- MODIFIED: Show *manual* limit status ---
                    limit_status = f"↓{device['limit_download']}↑{device['limit_upload']}K" if device['has_limit'] else "Unlimited"
                    # --- End of MODIFIED ---

                    if device['quota_dl_limit_bytes'] is not None:
                        qdown_str = f"{self.format_bytes(device['quota_dl_used_bytes'])}/{self.format_bytes(device['quota_dl_limit_bytes'])}"
                        qup_str = f"{self.format_bytes(device['quota_ul_used_bytes'])}/{self.format_bytes(device['quota_ul_limit_bytes'])}"
                        qtime_str = format_seconds(device['quota_time_left_seconds'])
                        if device['quota_status'] == "⚠️ Exceeded" or device['quota_status'] == "🚫 Throttled":
                            qtime_str += " (X)" # Indicate exceeded
                    else:
                        qdown_str = "-"; qup_str = "-"; qtime_str = "-"

                    row = "{:<12} {:<16} {:<20} {:<6} {:<12} {:<12} {:<15} {:<20} {:<20} {:<10}"
                    print(row.format(status, device['ip'], hostname, prio, total_down, total_up, limit_status, qdown_str, qup_str, qtime_str))

                active_count = sum(1 for d in devices if d['active'])
                limited_count = sum(1 for d in devices if d['has_limit'])
                quota_count = sum(1 for d in devices if d['quota_dl_limit_bytes'] is not None)
                print(f"\n       Total: {len(devices)} | Active: {active_count} | Limited: {limited_count} | Quota: {quota_count}")
        else:
            print("❌ Hotspot is INACTIVE")
        print("=" * width + "\n")


    def manage_bandwidth_limits(self):
        """Interactive bandwidth limit management"""
        while True:
            self.clear_screen()
            print("\n" + "=" * 110); print("      🚦 BANDWIDTH LIMIT MANAGEMENT"); print("=" * 110)
            if not self.is_hotspot_active():
                print("\n❌ Hotspot is INACTIVE."); input("\nPress Enter..."); return
            self.last_raw_bytes.clear()
            devices, _, _ = self.get_connected_devices_with_bandwidth()
            if not devices: print("\n❌ No devices found."); input("\nPress Enter..."); return

            devices_sorted = sorted(devices, key=lambda x: [int(i) for i in x['ip'].split('.')])
            print(f"\n{'#':<5} {'IP Address':<16} {'Hostname':<20} {'Status':<12} {'Priority':<9} {'Current Limit':<30}")
            print("-" * 110)
            for idx, device in enumerate(devices_sorted, 1):
                status = "🟢 ACTIVE" if device['active'] else "🔴 OFFLINE"; hostname = device['hostname'][:18]
                prio = str(device['priority']) if device['priority'] is not None else "-"
                
                # --- MODIFIED: Show *manual* limit status ---
                limit_info = f"↓ {device['limit_download']}K | ↑ {device['limit_upload']}K" if device['has_limit'] else "Unlimited"
                # --- End of MODIFIED ---
                
                print(f"{idx:<5} {device['ip']:<16} {hostname:<20} {status:<12} {prio:<9} {limit_info:<30}")

            print("\n" + "=" * 110 + "\nOptions:\n  1. Set/Update limit & priority\n  2. Remove limit\n  3. Set limit & priority for ALL\n  4. Remove ALL limits\n  5. Show tc statistics\n  6. Verify limits\n  7. Back")
            choice = input("\nEnter choice (1-7): ").strip()

            if choice == '1':
                device_num = input("Enter device number: ").strip()
                try:
                    device_idx = int(device_num) - 1
                    if 0 <= device_idx < len(devices_sorted):
                        device = devices_sorted[device_idx]
                        print(f"\nSetting limit for {device['ip']} ({device['hostname']})")
                        dl = input("Download limit (Kbps, e.g., 1024): ").strip()
                        ul = input("Upload limit (Kbps, e.g., 512): ").strip()
                        p_str = input("Priority (0=High, 7=Low, default=5): ").strip()
                        try:
                            dl_k = int(dl); ul_k = int(ul); prio = int(p_str) if p_str else 5
                            if not 0 <= prio <= 7: raise ValueError("Invalid priority")
                            self.tc_tracker.reset_device(device['ip'])
                            self.iptables_tracker.reset_device(device['ip'])
                            
                            # Apply to TC
                            if self.bandwidth_limiter.add_device_limit(device['ip'], dl_k, ul_k, prio):
                                # --- NEW: Save to "truth" dict ---
                                self.manual_device_limits[device['ip']] = {'download': dl_k, 'upload': ul_k, 'priority': prio}
                                # --- End of NEW ---
                                print(f"\n✅ SUCCESS! Limit: ↓{dl_k}K | ↑{ul_k}K | Prio: {prio}")
                            else: print("❌ Failed to set limit")
                        except ValueError: print("❌ Invalid input (numbers only, prio 0-7).")
                    else: print("❌ Invalid device number")
                except ValueError: print("❌ Invalid input")
                input("\nPress Enter...")
            elif choice == '2':
                device_num = input("Enter device number: ").strip()
                try:
                    device_idx = int(device_num) - 1
                    if 0 <= device_idx < len(devices_sorted):
                        device = devices_sorted[device_idx]
                        self.tc_tracker.reset_device(device['ip'])
                        self.iptables_tracker.reset_device(device['ip'])
                        
                        if self.bandwidth_limiter.remove_device_limit(device['ip']):
                            # --- NEW: Remove from "truth" dict ---
                            self.manual_device_limits.pop(device['ip'], None)
                            # --- End of NEW ---
                            print(f"✅ Limit removed from {device['ip']}")
                        else: print(f"ℹ️ Limit removal command sent for {device['ip']} (may not have existed)")
                    else: print("❌ Invalid device number")
                except ValueError: print("❌ Invalid input")
                input("\nPress Enter...")
            elif choice == '3':
                print("\nSet same limit & priority for ALL devices:")
                dl = input("Download limit (Kbps): ").strip()
                ul = input("Upload limit (Kbps): ").strip()
                p_str = input("Priority (0-7, default=5): ").strip()
                try:
                    dl_k=int(dl); ul_k=int(ul); prio=int(p_str) if p_str else 5
                    if not 0 <= prio <= 7: raise ValueError("Invalid priority")
                    count = 0
                    for dev in devices_sorted:
                        self.tc_tracker.reset_device(dev['ip']); self.iptables_tracker.reset_device(dev['ip'])
                        if self.bandwidth_limiter.add_device_limit(dev['ip'], dl_k, ul_k, prio):
                            # --- NEW: Save to "truth" dict ---
                            self.manual_device_limits[dev['ip']] = {'download': dl_k, 'upload': ul_k, 'priority': prio}
                            # --- End of NEW ---
                            count += 1
                    print(f"✅ Limit applied to {count}/{len(devices_sorted)} devices")
                except ValueError: print("❌ Invalid input.")
                input("\nPress Enter...")
            elif choice == '4':
                if input("Remove ALL limits? (yes/no): ").strip().lower() == 'yes':
                    count = 0; 
                    # --- MODIFIED: Iterate over "truth" dict ---
                    all_lims = list(self.manual_device_limits.keys())
                    for ip in all_lims:
                    # --- End of MODIFIED ---
                        self.tc_tracker.reset_device(ip); self.iptables_tracker.reset_device(ip)
                        if self.bandwidth_limiter.remove_device_limit(ip):
                            # --- NEW: Remove from "truth" dict ---
                            self.manual_device_limits.pop(ip, None)
                            # --- End of NEW ---
                            count += 1
                    print(f"✅ Removed limits for {count} devices")
                else: print("❌ Cancelled")
                input("\nPress Enter...")
            elif choice == '5': self.bandwidth_limiter.show_tc_stats(); input("\nPress Enter...")
            elif choice == '6':
                print("\n🔍 Verifying all limits...")
                # --- MODIFIED: Verify against "truth" dict ---
                all_lims = self.manual_device_limits.copy()
                # --- End of MODIFIED ---
                if not all_lims: print("❌ No limits configured")
                else:
                    for ip, limit in all_lims.items():
                        # --- MODIFIED: Get class_id from *current* state ---
                        current_limit_state = self.bandwidth_limiter.limits.get(ip)
                        cid = current_limit_state.get('class_id') if current_limit_state else None
                        # --- End of MODIFIED ---
                        
                        if cid:
                            if self.bandwidth_limiter.verify_device_limit(ip, cid): print(f"✅ {ip}: Verified (↓{limit['download']}K ↑{limit['upload']}K Prio:{limit['priority']})")
                            else: print(f"❌ {ip}: Verification FAILED")
                        else: print(f"❓ {ip}: Cannot verify, missing class_id in state.")
                input("\nPress Enter...")
            elif choice == '7': return
            else: print("❌ Invalid choice"); time.sleep(1)

    # QUOTA: New function to manage quotas
    def manage_quotas(self):
        """Interactive data quota management"""
        while True:
            self.clear_screen()
            print("\n" + "=" * 140); print("      📈 DATA USAGE QUOTA MANAGEMENT"); print("=" * 140)
            if not self.is_hotspot_active():
                print("\n❌ Hotspot is INACTIVE."); input("\nPress Enter..."); return
            self.last_raw_bytes.clear()
            devices, _, _ = self.get_connected_devices_with_bandwidth()
            if not devices: print("\n❌ No devices found."); input("\nPress Enter..."); return

            devices_sorted = sorted(devices, key=lambda x: [int(i) for i in x['ip'].split('.')])
            print(f"\n{'#':<4} {'IP Address':<16} {'Hostname':<18} {'Status':<12} {'Quota ↓ (Used/Limit)':<22} {'Quota ↑ (Used/Limit)':<22} {'Time Left':<10} {'Status':<12}")
            print("-" * 140)
            
            active_device_map = {idx: dev for idx, dev in enumerate(devices_sorted, 1) if dev['active']}

            for idx, device in enumerate(devices_sorted, 1):
                status = "🟢 ACTIVE" if device['active'] else "🔴 OFFLINE"
                hostname = device['hostname'][:16]
                
                if device['quota_dl_limit_bytes'] is not None:
                    qdown_str = f"{self.format_bytes(device['quota_dl_used_bytes'])}/{self.format_bytes(device['quota_dl_limit_bytes'])}"
                    qup_str = f"{self.format_bytes(device['quota_ul_used_bytes'])}/{self.format_bytes(device['quota_ul_limit_bytes'])}"
                    qtime_str = format_seconds(device['quota_time_left_seconds'])
                    qstat_str = device['quota_status']
                else:
                    qdown_str = "None"; qup_str = "None"; qtime_str = "-"; qstat_str = "-"

                print(f"{idx:<4} {device['ip']:<16} {hostname:<18} {status:<12} {qdown_str:<22} {qup_str:<22} {qtime_str:<10} {qstat_str:<12}")

            print("\n" + "=" * 140 + "\nOptions:\n  1. Set/Update Quota for ACTIVE device\n  2. Remove Quota\n  3. Back")
            choice = input("\nEnter choice (1-3): ").strip()

            if choice == '1':
                if not active_device_map:
                    print("❌ No ACTIVE devices to set quota for.")
                    input("\nPress Enter..."); continue

                dev_num_str = input(f"Enter ACTIVE device number ({', '.join(map(str, active_device_map.keys()))}): ").strip()
                try:
                    dev_idx = int(dev_num_str)
                    if dev_idx in active_device_map:
                        device = active_device_map[dev_idx]
                        ip = device['ip']
                        print(f"\nSetting Quota for {ip} ({device['hostname']})")
                        dl_mb_str = input("Download Quota (MB, e.g., 1000): ").strip()
                        ul_mb_str = input("Upload Quota (MB, e.g., 500): ").strip()
                        time_str = input("Time Period (e.g., 24h, 30m, 7d): ").strip()

                        try:
                            dl_limit_bytes = int(dl_mb_str) * 1024 * 1024
                            ul_limit_bytes = int(ul_mb_str) * 1024 * 1024
                            period_seconds = parse_time_string(time_str)

                            if dl_limit_bytes <= 0 or ul_limit_bytes <=0 or period_seconds <= 0:
                                raise ValueError("Limits and time must be positive.")

                            # --- MODIFIED: Restore from "truth" dict ---
                            manual_limit = self.manual_device_limits.get(ip)
                            if manual_limit:
                                print(f"      Restoring manual limit for {ip} before applying quota.")
                                self.bandwidth_limiter.add_device_limit(
                                    ip, manual_limit['download'], manual_limit['upload'], manual_limit['priority']
                                )
                            else:
                                print(f"      No manual limit for {ip}. Removing any existing (throttle) limits.")
                                self.bandwidth_limiter.remove_device_limit(ip)
                            # --- End of MODIFIED ---

                            self.device_quotas[ip] = {
                                'limit_dl_bytes': dl_limit_bytes,
                                'limit_ul_bytes': ul_limit_bytes,
                                'period_seconds': period_seconds,
                                'start_time': time.time(),
                                'used_dl_bytes': 0,
                                'used_ul_bytes': 0,
                                'is_throttled': False
                            }
                            self.last_raw_bytes.pop(ip, None)

                            print(f"\n✅ Quota set for {ip}: ↓{self.format_bytes(dl_limit_bytes)} | ↑{self.format_bytes(ul_limit_bytes)} | Period: {format_seconds(period_seconds)}")

                        except ValueError as e:
                            print(f"❌ Invalid input: {e}. Please enter positive numbers and valid time (e.g., 1000, 500, 24h).")
                    else:
                        print("❌ Invalid ACTIVE device number.")
                except ValueError:
                    print("❌ Invalid input. Please enter a number.")
                input("\nPress Enter...")

            elif choice == '2':
                if not self.device_quotas:
                    print("ℹ️ No quotas currently set.")
                    input("\nPress Enter..."); continue

                dev_num_str = input(f"Enter device number to remove quota from (1-{len(devices_sorted)}): ").strip()
                try:
                    dev_idx = int(dev_num_str) - 1
                    if 0 <= dev_idx < len(devices_sorted):
                        device = devices_sorted[dev_idx]
                        ip = device['ip']
                        
                        # --- MODIFIED: Restore from "truth" dict ---
                        manual_limit = self.manual_device_limits.get(ip)
                        if manual_limit:
                            print(f"      Restoring manual limit for {ip} after removing quota.")
                            self.bandwidth_limiter.add_device_limit(
                                ip, manual_limit['download'], manual_limit['upload'], manual_limit['priority']
                            )
                        else:
                            print(f"      No manual limit for {ip}. Removing any existing (throttle) limits.")
                            self.bandwidth_limiter.remove_device_limit(ip)
                        # --- End of MODIFIED ---
                        
                        if ip in self.device_quotas:
                            del self.device_quotas[ip]
                            self.last_raw_bytes.pop(ip, None)
                            print(f"✅ Quota removed for {ip}.")
                        else:
                            print(f"ℹ️ No quota was set for {ip}.")
                    else:
                        print("❌ Invalid device number.")
                except ValueError:
                    print("❌ Invalid input. Please enter a number.")
                input("\nPress Enter...")

            elif choice == '3': return
            else: print("❌ Invalid choice"); time.sleep(1)

    def change_hotspot_settings(self):
        """Allow user to change the SSID and password"""
        self.clear_screen()
        print("\n" + "=" * 60)
        print("                              ⚙️  Change Hotspot SSID & Password")
        print("=" * 60)

        if self.is_hotspot_active():
            print("\n❌ ERROR: Please turn OFF the hotspot first.")
            print("          (Main Menu -> Option 2)")
            input("\nPress Enter to return...")
            return

        print(f"\nCurrent SSID: {self.ssid}")
        new_ssid = input("Enter new SSID (or press Enter to keep current): ").strip()
        
        print(f"\nCurrent Password: {'*' * len(self.password)}")
        new_password = input("Enter new Password (8-63 chars, or Enter to keep current): ").strip()

        print("-" * 60)

        updated = False
        if new_ssid and new_ssid != self.ssid:
            self.ssid = new_ssid
            print(f"✅ SSID updated to: {self.ssid}")
            updated = True
        
        if new_password:
            if 8 <= len(new_password) <= 63:
                self.password = new_password
                print("✅ Password updated.")
                updated = True
            else:
                print("❌ Invalid Password! Must be 8-63 characters. Password not changed.")
        
        if not updated:
            print("ℹ️ No changes made.")
        
        print("\nNew settings will be used the next time you turn ON the hotspot.")
        input("\nPress Enter to return...")

    def show_interface_info(self):
        """Show detailed interface information"""
        print("\n📡 Network Interfaces:"); print("=" * 100)
        stdout, _, _ = self.run_command(['ip', 'addr', 'show'])
        interfaces = re.findall(r'(\d+: [^:]+):.*?(?=\d+:|$)', stdout, re.DOTALL)
        for block in interfaces:
            lines = block.split('\n'); name = lines[0].split()[1]
            if 'lo' in name: continue
            print(f"\n🔌 {name}")
            ip_m = re.search(r'inet (\d+\.\d+\.\d+\.\d+)/(\d+)', block)
            if ip_m: print(f"      IP: {ip_m.group(1)}/{ip_m.group(2)}")
            mac_m = re.search(r'link/ether ([0-9a-f:]+)', block)
            if mac_m: print(f"      MAC: {mac_m.group(1)}")
            status = "🟢 UP" if 'UP' in block and 'LOWER_UP' in block else "🔴 DOWN"
            print(f"      Status: {status}")
        print("\n" + "=" * 100)

    def setup_internet_sharing(self, internet_interface):
        """Setup NAT for internet sharing"""
        print(f"\n🌐 Setting up internet sharing from {internet_interface}...")
        
        # --- IPv4 NAT ---
        self.run_command(['iptables', '-t', 'nat', '-F', 'POSTROUTING'], check=False)
        self.run_command(['iptables', '-F', 'FORWARD'], check=False)
        self.run_command(['sysctl', '-w', 'net.ipv4.ip_forward=1'])
        self.run_command(['iptables', '-t', 'nat', '-A', 'POSTROUTING','-o', internet_interface, '-j', 'MASQUERADE'])
        self.run_command(['iptables', '-A', 'FORWARD','-i', self.interface, '-o', internet_interface, '-j', 'ACCEPT'])
        self.run_command(['iptables', '-A', 'FORWARD','-i', internet_interface, '-o', self.interface,'-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'])

        # --- *** NEW: IPv6 NAT *** ---
        # Note: This enables basic IPv6 forwarding. True "NAT" (NPTv6) is more complex,
        # but MASQUERADE often works for basic use cases if the kernel supports it.
        self.run_command(['ip6tables', '-t', 'nat', '-F', 'POSTROUTING'], check=False)
        self.run_command(['ip6tables', '-F', 'FORWARD'], check=False)
        self.run_command(['sysctl', '-w', 'net.ipv6.conf.all.forwarding=1'])
        self.run_command(['ip6tables', '-t', 'nat', '-A', 'POSTROUTING','-o', internet_interface, '-j', 'MASQUERADE'])
        self.run_command(['ip6tables', '-A', 'FORWARD','-i', self.interface, '-o', internet_interface, '-j', 'ACCEPT'])
        self.run_command(['ip6tables', '-A', 'FORWARD','-i', internet_interface, '-o', self.interface,'-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'])
        # --- *** END NEW *** ---

        print(f"✅ Internet sharing enabled from {internet_interface} to {self.interface} (IPv4 & IPv6)")
        _, _, network = self.get_hotspot_ip_range()
        if network: 
            self.setup_iptables_monitoring(network)
            self.setup_security_rules() # --- NEW ---