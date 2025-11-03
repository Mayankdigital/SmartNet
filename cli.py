from hotspot_manager_core import BandwidthTracker, HotspotManager
import subprocess
import re
import sys


def main():
    print("\n" + "=" * 100)
    print("    🔥 WiFi Hotspot Manager with HYBRID Bandwidth Limiting, Priority & Quotas") # QUOTA: Updated title
    print("=" * 100)

    default_interface = "wlo1"
    result = subprocess.run(['ip', 'link', 'show', default_interface], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"❌ Default interface '{default_interface}' not found!")
        interfaces_result = subprocess.run(['ip', 'link'], capture_output=True, text=True)
        if interfaces_result.returncode == 0:
            interfaces = re.findall(r'\d+: (\w+):', interfaces_result.stdout)
            wifi = [i for i in interfaces if i.startswith('wl')]
            print(f"💡 Maybe you meant: {', '.join(wifi)}?" if wifi else f"💡 Available: {', '.join(i for i in interfaces if i != 'lo')}")
        else: print("⚠️ Could not list interfaces.")
        sys.exit(1)

    manager = HotspotManager(interface=default_interface, ssid="MyBandwidthManager", password="12345678")
    manager.check_sudo(); manager.check_dependencies()

    try:
        while True:
            print("\nMain Menu:")
            print("  1. Turn ON hotspot")
            print("  2. Turn OFF hotspot")
            print("  3. Show status (Snapshot)")
            print("  4. 🔴 Start REAL-TIME MONITOR")
            print("  5. 🚦 Manage Bandwidth LIMITS & Priority")
            # QUOTA: New menu option
            print("  6. 📈 Manage Data QUOTAS")
            # --- NEW OPTION ADDED ---
            print("  7. ⚙️  Change Hotspot Settings (SSID/Password)")
            # --- OPTIONS RENUMBERED ---
            print("  8. Setup internet sharing (NAT)")
            print("  9. Show network interfaces")
            print(" 10. Reset session bandwidth stats")
            print(" 11. Show TC statistics")
            print(" 12. Exit")

            choice = input("\nEnter choice (1-12): ").strip()

            if choice == '1': manager.turn_on_hotspot()
            elif choice == '2': manager.turn_off_hotspot()
            elif choice == '3': manager.show_status()
            elif choice == '4': manager.start_realtime_monitor()
            elif choice == '5': manager.manage_bandwidth_limits()
            # QUOTA: Handle new option
            elif choice == '6': manager.manage_quotas()
            # --- HANDLE NEW CHOICE 7 ---
            elif choice == '7': manager.change_hotspot_settings()
            # --- RENUMBERED SUBSEQUENT CHOICES ---
            elif choice == '8':
                manager.show_interface_info()
                inet_iface = input("\nEnter internet source interface (e.g., eth0, usb0): ").strip()
                if inet_iface: manager.setup_internet_sharing(inet_iface)
            elif choice == '9': manager.show_interface_info()
            elif choice == '10':
                print("Resetting session bandwidth statistics...")
                manager.tc_tracker = BandwidthTracker(); manager.iptables_tracker = BandwidthTracker()
                manager.last_raw_bytes.clear() # QUOTA: Clear raw counts too
                print("✅ Session stats reset")
            elif choice == '11': manager.bandwidth_limiter.show_tc_stats(); input("\nPress Enter...")
            elif choice == '12': print("\n👋 Goodbye!"); break
            else: print("❌ Invalid choice!")

    except KeyboardInterrupt: print("\n\n👋 Interrupted. Cleaning up...")
    finally:
        print("🧹 Cleaning up all rules...")
        manager._stop_speedtest_worker_thread() # Use renamed method
        manager.cleanup_iptables_monitoring()
        manager.bandwidth_limiter.cleanup_tc()
        print("✅ Cleanup complete.")
        sys.exit(0)

if __name__ == "__main__":
    main()