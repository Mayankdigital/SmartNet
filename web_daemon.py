#!/usr/bin/env python3

import asyncio
import json
import sys
import time
import re # <-- NEW: For IP/CIDR validation
import sqlite3 # For database
from datetime import datetime, timedelta, time as dt_time
from channels_redis.core import RedisChannelLayer
import traceback # For detailed error logging

# Import the manager class and helpers from your core file
from hotspot_manager_core import HotspotManager, parse_time_string, format_seconds # Import helpers

# --- CHANNEL LAYER CONFIG ---
CHANNEL_LAYER_CONFIG = {
    "hosts": [("localhost", 6379)],
}

# --- Database Configuration ---
DB_FILE = 'hotspot_usage.db' # The database file
DEFAULT_SSID = "MyBandwidthManager"
DEFAULT_PASS = "12345678"

# --- Scheduler Configuration ---
SCHEDULE_CHECK_INTERVAL = 60 # Check schedules every 60 seconds

# --- Global State for Scheduler ---
pre_schedule_states = {} # { "device_ip": {"type": "limit"/"quota"/"none", "value": {...limit/quota details...} / None } }
active_schedules_by_device = {} # { "device_ip": schedule_id }
# *** NEW: Global state for our adaptive limiter ***
adaptive_limits_active = set() # Stores { "ip_address", "ip_address" }

# --- Database Initialization ---
def init_db():
    """Initializes the SQLite database and tables."""
    print(f"Initializing database at {DB_FILE}...")
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # --- Existing Tables ---
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS data_log ( timestamp TEXT, ip_address TEXT, rx_bytes INTEGER, tx_bytes INTEGER )''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON data_log (timestamp)')
        cursor.execute(''' CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT ) ''')
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('ssid', ?)", (DEFAULT_SSID,))
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('password', ?)", (DEFAULT_PASS,))
        cursor.execute(''' CREATE TABLE IF NOT EXISTS device_limits ( ip_address TEXT PRIMARY KEY, download_kbps INTEGER, upload_kbps INTEGER, priority INTEGER )''')
        cursor.execute(''' CREATE TABLE IF NOT EXISTS device_quotas ( ip_address TEXT PRIMARY KEY, limit_dl_bytes INTEGER NOT NULL, limit_ul_bytes INTEGER NOT NULL, period_seconds INTEGER NOT NULL, start_time REAL NOT NULL, used_dl_bytes INTEGER DEFAULT 0, used_ul_bytes INTEGER DEFAULT 0, is_throttled INTEGER DEFAULT 0 )''')
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, rule_type TEXT NOT NULL CHECK(rule_type IN ('limit', 'quota')),
            device_ip TEXT NOT NULL, start_date TEXT, end_date TEXT, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
            repeat_mode TEXT NOT NULL CHECK(repeat_mode IN ('once', 'daily', 'weekdays', 'weekends', 'custom')),
            custom_days TEXT, limit_dl_kbps INTEGER, limit_ul_kbps INTEGER, priority INTEGER,
            quota_dl_bytes INTEGER, quota_ul_bytes INTEGER, is_enabled INTEGER DEFAULT 1
        )''')
        
        # --- NEW: Security Tables & Settings ---
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS mac_access_list (
            mac_address TEXT PRIMARY KEY,
            list_type TEXT NOT NULL CHECK(list_type IN ('block', 'allow'))
        )''')
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('client_isolation', '0')") # 0 = false, 1 = true
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('access_control_mode', 'allow_all')") # allow_all, block_list, allow_list

        # --- *** NEW: IP Block List Table *** ---
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS ip_block_list (
            ip_range TEXT PRIMARY KEY
        )''')
        # --- *** End of NEW *** ---

        # --- *** NEW: ML Analyzer Tables *** ---
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS usage_summary (
            timestamp TEXT PRIMARY KEY,
            total_rx_bytes INTEGER,
            total_tx_bytes INTEGER
        )''')
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS usage_forecast (
            timestamp TEXT PRIMARY KEY,
            predicted_bytes REAL,
            predicted_lower REAL,
            predicted_upper REAL
        )''')
        # --- *** End of NEW *** ---

        conn.commit()
    except Exception as e:
        print(f"DB Init Error: {e}")
        traceback.print_exc()
    finally:
        if conn: conn.close()
    print("Database initialized.")

# --- (DB functions: load_settings, save_settings, load_limits, save_limit, delete_limit, load_quotas, save_quota, delete_quota, log_usage, get_historical) ---
def load_settings_from_db():
    settings = {
        'ssid': DEFAULT_SSID,
        'password': DEFAULT_PASS,
        'client_isolation': False,
        'access_control_mode': 'allow_all'
    }
    conn=None
    try:
        conn=sqlite3.connect(DB_FILE)
        c=conn.cursor()
        c.execute("SELECT key, value FROM settings")
        rows = c.fetchall()
        db_settings = {row[0]: row[1] for row in rows}
        
        settings['ssid'] = db_settings.get('ssid', DEFAULT_SSID)
        settings['password'] = db_settings.get('password', DEFAULT_PASS)
        settings['client_isolation'] = db_settings.get('client_isolation', '0') == '1'
        settings['access_control_mode'] = db_settings.get('access_control_mode', 'allow_all')
        
    except Exception as e:print(f"Err load settings:{e}")
    finally:
        if conn:conn.close()
    return settings

def save_setting_to_db(key, value):
    """Saves a single key-value pair to the settings table."""
    conn=None
    try:
        conn=sqlite3.connect(DB_FILE)
        conn.execute("REPLACE INTO settings(key,value) VALUES (?,?)",(key, value))
        conn.commit()
        print(f"Saved setting: {key} = {value}")
    except Exception as e:print(f"Err save setting:{key}:{e}")
    finally:
        if conn:conn.close()

def save_settings_to_db(ssid,password):
    conn=None
    try:
        conn=sqlite3.connect(DB_FILE)
        conn.execute("REPLACE INTO settings(key,value) VALUES ('ssid',?)",(ssid,));
        conn.execute("REPLACE INTO settings(key,value) VALUES ('password',?)",(password,));
        conn.commit();print(f"Saved settings:{ssid}")
    except Exception as e:print(f"Err save settings:{e}")
    finally:
        if conn:conn.close()
def load_limits_from_db():
    limits={};conn=None
    try:conn=sqlite3.connect(DB_FILE);c=conn.cursor();c.execute("SELECT ip_address, download_kbps, upload_kbps, priority FROM device_limits");rows=c.fetchall();limits={r[0]:{'download':r[1],'upload':r[2],'priority':r[3]} for r in rows};print(f"Loaded {len(limits)} limits")
    except Exception as e:print(f"Err load limits:{e}")
    finally:
        if conn:conn.close()
    return limits
def save_limit_to_db(ip,dl,ul,prio):
    conn=None
    try:conn=sqlite3.connect(DB_FILE);conn.execute("REPLACE INTO device_limits(ip_address,download_kbps,upload_kbps,priority) VALUES (?,?,?,?)",(ip,dl,ul,prio));conn.commit();print(f"Saved limit:{ip}")
    except Exception as e:print(f"Err save limit:{ip}:{e}")
    finally:
        if conn:conn.close()
def delete_limit_from_db(ip):
    conn=None
    try:conn=sqlite3.connect(DB_FILE);conn.execute("DELETE FROM device_limits WHERE ip_address = ?",(ip,));conn.commit();print(f"Deleted limit:{ip}")
    except Exception as e:print(f"Err delete limit:{ip}:{e}")
    finally:
        if conn:conn.close()
def load_quotas_from_db():
    quotas={};conn=None;rows_up=[]
    try:
        conn=sqlite3.connect(DB_FILE);c=conn.cursor();c.execute("SELECT ip_address, limit_dl_bytes, limit_ul_bytes, period_seconds, start_time, used_dl_bytes, used_ul_bytes, is_throttled FROM device_quotas");rows=c.fetchall();now=time.time()
        for ip,dl_l,ul_l,p,s,dl_u,ul_u,thr_db in rows:
            thr=bool(thr_db)
            if now>=(s+p):print(f"Quota expired offline:{ip}");s=now;dl_u=0;ul_u=0;thr=False;rows_up.append((ip,dl_l,ul_l,p,s,dl_u,ul_u,int(thr)))
            quotas[ip]={'limit_dl_bytes':dl_l,'limit_ul_bytes':ul_l,'period_seconds':p,'start_time':s,'used_dl_bytes':dl_u,'used_ul_bytes':ul_u,'is_throttled':thr}
        print(f"Loaded {len(quotas)} quotas")
        if rows_up:print(f"Updating {len(rows_up)} quotas");c.executemany("REPLACE INTO device_quotas VALUES (?,?,?,?,?,?,?,?)",rows_up);conn.commit()
    except Exception as e:print(f"Err load quotas:{e}");traceback.print_exc()
    finally:
        if conn:conn.close()
    return quotas
def save_quota_to_db(ip,dl_l,ul_l,p,s,dl_u,ul_u,thr):
    conn=None
    try:conn=sqlite3.connect(DB_FILE);conn.execute("REPLACE INTO device_quotas VALUES (?,?,?,?,?,?,?,?)",(ip,dl_l,ul_l,p,s,dl_u,ul_u,int(thr)));conn.commit()
    except Exception as e:print(f"Err save quota:{ip}:{e}")
    finally:
        if conn:conn.close()
def delete_quota_from_db(ip):
    conn=None
    try:conn=sqlite3.connect(DB_FILE);conn.execute("DELETE FROM device_quotas WHERE ip_address = ?",(ip,));conn.commit();print(f"Deleted quota:{ip}")
    except Exception as e:print(f"Err delete quota:{ip}:{e}")
    finally:
        if conn:conn.close()
def log_usage_to_db(ip,rx,tx):
    conn=None
    try:conn=sqlite3.connect(DB_FILE);now_s=datetime.now().strftime('%Y-%m-%d %H:%M:%S');conn.execute("INSERT INTO data_log VALUES (?,?,?,?)",(now_s,ip,rx,tx));conn.commit()
    except Exception as e:print(f"DB Log Err:{e}")
    finally:
        if conn:conn.close()
def get_historical_data(p):
    conn=None;rx=0;tx=0
    try:
        conn=sqlite3.connect(DB_FILE);et=datetime.now();st=(et-timedelta(hours=1)) if p=='1h' else (et-timedelta(days=7)) if p=='7d' else (et-timedelta(days=31)) if p=='31d' else (et-timedelta(days=1));st_s=st.strftime('%Y-%m-%d %H:%M:%S');et_s=et.strftime('%Y-%m-%d %H:%M:%S');c=conn.cursor();c.execute("SELECT SUM(rx_bytes),SUM(tx_bytes) FROM data_log WHERE timestamp BETWEEN ? AND ?",(st_s,et_s));r=c.fetchone();rx=r[0] or 0;tx=r[1] or 0
    except Exception as e:print(f"DB Query Err:{e}")
    finally:
        if conn:conn.close()
    return rx,tx

# --- (DB functions for Schedules: load, save, delete, update_enabled, get_for_frontend) ---
def load_schedules_from_db():
    schedules = []
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row # Return rows as dict-like objects
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM schedules")
        rows = cursor.fetchall()
        for row in rows:
            schedule = dict(row)
            schedule['is_enabled'] = bool(schedule['is_enabled'])
            try:
                schedule['custom_days'] = json.loads(schedule['custom_days']) if schedule['custom_days'] else []
            except json.JSONDecodeError:
                print(f"Warning: Could not parse custom_days for schedule ID {schedule['id']}. Setting to empty list.")
                schedule['custom_days'] = []
            schedules.append(schedule)
        print(f"Loaded {len(schedules)} schedules from DB.")
    except Exception as e:
        print(f"Error loading schedules from DB: {e}")
        traceback.print_exc()
    finally:
        if conn: conn.close()
    return schedules

def save_schedule_to_db(schedule):
    conn = None
    schedule_id = schedule.get('id')
    try:
        conn = sqlite3.connect(DB_FILE)
        custom_days_json = json.dumps(schedule.get('custom_days', []))
        columns = [
            'name', 'rule_type', 'device_ip', 'start_date', 'end_date',
            'start_time', 'end_time', 'repeat_mode', 'custom_days',
            'limit_dl_kbps', 'limit_ul_kbps', 'priority', 'quota_dl_bytes',
            'quota_ul_bytes', 'is_enabled'
        ]
        values = [
            schedule.get('name'), schedule.get('rule_type'), schedule.get('device_ip'),
            schedule.get('start_date'), schedule.get('end_date') or None,
            schedule.get('start_time'), schedule.get('end_time'), schedule.get('repeat_mode'),
            custom_days_json, schedule.get('limit_dl_kbps'), schedule.get('limit_ul_kbps'),
            schedule.get('priority'), schedule.get('quota_dl_bytes'), schedule.get('quota_ul_bytes'),
            int(schedule.get('is_enabled', True))
        ]
        if schedule_id: # Update
            set_clause = ", ".join([f"{col} = ?" for col in columns])
            sql = f"UPDATE schedules SET {set_clause} WHERE id = ?"
            values.append(schedule_id)
            cursor = conn.execute(sql, values)
            print(f"Updated schedule ID {schedule_id} in DB.")
        else: # Insert
            placeholders = ", ".join(["?"] * len(columns))
            sql = f"INSERT INTO schedules ({', '.join(columns)}) VALUES ({placeholders})"
            cursor = conn.execute(sql, values)
            schedule_id = cursor.lastrowid
            print(f"Saved new schedule ID {schedule_id} to DB.")
        conn.commit()
        return schedule_id
    except Exception as e:
        print(f"Error saving schedule to DB: {e}"); traceback.print_exc(); return None
    finally:
        if conn: conn.close()

def delete_schedule_from_db(schedule_id):
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE); conn.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,)); conn.commit()
        print(f"Deleted schedule ID {schedule_id} from DB.")
        return True
    except Exception as e:
        print(f"Error deleting schedule ID {schedule_id} from DB: {e}"); return False
    finally:
        if conn: conn.close()

def update_schedule_enabled_in_db(schedule_id, is_enabled):
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE); conn.execute("UPDATE schedules SET is_enabled = ? WHERE id = ?", (int(is_enabled), schedule_id)); conn.commit()
        print(f"Updated schedule ID {schedule_id} enabled status to {is_enabled} in DB.")
        return True
    except Exception as e:
        print(f"Error updating schedule ID {schedule_id} enabled status: {e}"); return False
    finally:
        if conn: conn.close()

def get_schedules_for_frontend(schedules_list):
    schedules_for_frontend = []
    for sch in schedules_list:
        sch_copy = sch.copy()
        if sch_copy.get('rule_type') == 'quota':
            sch_copy['quotaDownload'] = sch_copy.get('quota_dl_bytes', 0) / (1024*1024) if sch_copy.get('quota_dl_bytes') else None
            sch_copy['quotaUpload'] = sch_copy.get('quota_ul_bytes', 0) / (1024*1024) if sch_copy.get('quota_ul_bytes') else None
        schedules_for_frontend.append(sch_copy)
    return schedules_for_frontend

# --- NEW: Database Functions for Security ---
def load_mac_lists_from_db():
    """Loads the MAC access lists from the database."""
    blocked_macs = set()
    allowed_macs = set()
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT mac_address, list_type FROM mac_access_list")
        rows = cursor.fetchall()
        for mac, list_type in rows:
            if list_type == 'block':
                blocked_macs.add(mac)
            elif list_type == 'allow':
                allowed_macs.add(mac)
        print(f"Loaded {len(blocked_macs)} blocked MACs and {len(allowed_macs)} allowed MACs.")
    except Exception as e:
        print(f"Error loading MAC lists from DB: {e}")
        traceback.print_exc()
    finally:
        if conn: conn.close()
    return blocked_macs, allowed_macs

def save_mac_to_db(mac, list_type):
    """Saves a single MAC address to the access list."""
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.execute("REPLACE INTO mac_access_list (mac_address, list_type) VALUES (?, ?)", (mac, list_type))
        conn.commit()
        print(f"Saved MAC {mac} to {list_type} list.")
    except Exception as e:
        print(f"Error saving MAC to DB: {e}")
    finally:
        if conn: conn.close()

def delete_mac_from_db(mac):
    """Deletes a single MAC address from the access list."""
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.execute("DELETE FROM mac_access_list WHERE mac_address = ?", (mac,))
        conn.commit()
        print(f"Deleted MAC {mac} from list.")
    except Exception as e:
        print(f"Error deleting MAC from DB: {e}")
    finally:
        if conn: conn.close()
        
# --- *** NEW: Database Functions for IP Block List *** ---
def load_ip_block_list_from_db():
    """Loads the IP block list from the database."""
    blocked_ips = set()
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT ip_range FROM ip_block_list")
        rows = cursor.fetchall()
        for row in rows:
            blocked_ips.add(row[0])
        print(f"Loaded {len(blocked_ips)} blocked IPs/ranges from DB.")
    except Exception as e:
        print(f"Error loading IP block list from DB: {e}")
        traceback.print_exc()
    finally:
        if conn: conn.close()
    return blocked_ips

def save_ip_block_to_db(ip_range):
    """Saves a single IP/CIDR to the block list."""
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.execute("REPLACE INTO ip_block_list (ip_range) VALUES (?)", (ip_range,))
        conn.commit()
        print(f"Saved IP block {ip_range} to DB.")
    except Exception as e:
        print(f"Error saving IP block to DB: {e}")
    finally:
        if conn: conn.close()

def delete_ip_block_from_db(ip_range):
    """Deletes a single IP/CIDR from the block list."""
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.execute("DELETE FROM ip_block_list WHERE ip_range = ?", (ip_range,))
        conn.commit()
        print(f"Deleted IP block {ip_range} from DB.")
    except Exception as e:
        print(f"Error deleting IP block from DB: {e}")
    finally:
        if conn: conn.close()
# --- *** End of NEW *** ---
        
# --- End of DB Functions ---


# --- Log Monitor Task (Removed) ---


# --- Broadcast Analysis Data (Removed) ---


# --- Command Listener Task ---
async def command_listener(channel_layer, manager, shared_state):
    # --- (Message handlers: toggle, set_period, set_settings, set_limit, set_quota, remove_limit, remove_quota) ---
    channel_name = await channel_layer.new_channel()
    await channel_layer.group_add("hotspot_commands", channel_name)
    print("🎧 Command listener started.")
    try:
        while True:
            message = await channel_layer.receive(channel_name)
            msg_type = message.get("type")

            if msg_type == "command.toggle":
                desired_state=message.get("state",False)
                print(f"🔥 Cmd: Toggle {'ON' if desired_state else 'OFF'}")
                try:
                    if desired_state:
                        settings = await asyncio.to_thread(load_settings_from_db)
                        manager.ssid=settings['ssid']
                        manager.password=settings['password']
                        print(f"Turning ON with SSID: {manager.ssid}")
                        success=await asyncio.to_thread(manager.turn_on_hotspot)
                        if success:
                            print("Re-applying stored limits & quotas after ON...")
                            cl=await asyncio.to_thread(load_limits_from_db);manager.manual_device_limits=cl.copy();manager.bandwidth_limiter.limits=cl.copy()
                            cq=await asyncio.to_thread(load_quotas_from_db);manager.device_quotas=cq
                            cs=await asyncio.to_thread(load_schedules_from_db);manager.schedules=cs
                            
                            # --- *** NEW: Load forecast data *** ---
                            print("Loading forecast data into memory...")
                            try:
                                conn = sqlite3.connect(DB_FILE)
                                c = conn.cursor()
                                # Load all *future* forecast points
                                c.execute("SELECT timestamp, predicted_bytes FROM usage_forecast WHERE timestamp > datetime('now')")
                                manager.forecast_data = c.fetchall() # Store as list of (timestamp, value)
                                conn.close()
                                print(f"Loaded {len(manager.forecast_data)} forecast points.")
                            except Exception as e:
                                print(f"Error loading forecast: {e}")
                            # --- *** END NEW *** ---

                            # Security settings are now loaded on init, and applied in turn_on_hotspot
                            for ip,l_info in list(cl.items()): print(f"  Applying limit for {ip}");await asyncio.to_thread(manager.bandwidth_limiter.add_device_limit,ip,l_info['download'],l_info['upload'],l_info['priority'])
                            await schedule_checker(manager) # Initial schedule check
                    else:
                        await asyncio.to_thread(manager.turn_off_hotspot);manager.device_quotas={};manager.last_raw_bytes={};manager.manual_device_limits={};manager.schedules=[]
                        pre_schedule_states.clear(); active_schedules_by_device.clear()
                        manager.forecast_data = [] # *** NEW: Clear forecast on OFF ***
                        adaptive_limits_active.clear() # *** NEW: Clear adaptive limits ***
                    print("✅ Toggle command executed.")
                except Exception as e:print(f"❌ Toggle Err: {e}");traceback.print_exc();await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Err toggle: {e}"})
            elif msg_type == "command.set_period":
                p=message.get('period','24h');shared_state['period']=p;print(f"📊 Period set: {p}")
            elif msg_type == "command.set_settings":
                print("🔥 Cmd: Set Settings")
                if await asyncio.to_thread(manager.is_hotspot_active): print("❌ Hotspot active.");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":"Turn OFF hotspot first!"})
                else:
                    try:ns=message.get('ssid');np=message.get('password');cs=manager.ssid;cp=manager.password;ss=ns if ns else cs;ps=np if np else cp;await asyncio.to_thread(save_settings_to_db,ss,ps);manager.ssid=ss;manager.password=ps;print("✅ Settings saved.");await channel_layer.group_send("network_data",{"type":"notification.message","status":"success","message":"Settings saved!"})
                    except Exception as e:print(f"❌ Settings Err: {e}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Err save settings: {e}"})
            elif msg_type == "command.set_limit":
                ip=message.get('ip');dl=message.get('download');ul=message.get('upload');prio=message.get('priority')
                if not ip or dl is None or ul is None or prio is None: print(f"❌ Invalid set_limit:{message}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":"Invalid limit data."});continue
                print(f"🔥 Cmd: Set Limit {ip} -> DL={dl}k, UL={ul}k, P={prio}")
                try:
                    ar=await asyncio.to_thread(manager.bandwidth_limiter.add_device_limit,ip,dl,ul,prio)
                    if ar:await asyncio.to_thread(save_limit_to_db,ip,dl,ul,prio);manager.manual_device_limits[ip]={'download':dl,'upload':ul,'priority':prio};print(f"✅ Limit set:{ip}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"success","message":f"Limit {ar} for {ip}"})
                    else: print(f"❌ Failed limit:{ip}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Failed limit:{ip}"})
                except Exception as e:print(f"❌ Limit Err:{e}");traceback.print_exc();await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Err limit:{e}"})
            elif msg_type == "command.set_quota":
                ip=message.get('ip');dl_mb=message.get('download_mb');ul_mb=message.get('upload_mb');p_str=message.get('period')
                if not ip or dl_mb is None or ul_mb is None or not p_str: print(f"❌ Invalid set_quota:{message}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":"Invalid quota data."});continue
                print(f"🔥 Cmd: Set Quota {ip} -> DL={dl_mb}MB, UL={ul_mb}MB, P={p_str}")
                try:
                    dl_b=int(dl_mb)*1048576;ul_b=int(ul_mb)*1048576;p_s=parse_time_string(p_str)
                    if dl_b<=0 or ul_b<=0 or p_s<=0: raise ValueError("Positive values required.")
                    act='updated' if ip in manager.device_quotas else 'added';st=time.time();dl_u=0;ul_u=0;thr=False
                    ml=manager.manual_device_limits.get(ip)
                    if ml: print(f"Quota set/reset:{ip}. Re-applying manual limit.");await asyncio.to_thread(manager.bandwidth_limiter.add_device_limit,ip,ml['download'],ml['upload'],ml['priority'])
                    else: print(f"Quota set/reset:{ip}. Removing any throttle.");await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit,ip)
                    manager.device_quotas[ip]={'limit_dl_bytes':dl_b,'limit_ul_bytes':ul_b,'period_seconds':p_s,'start_time':st,'used_dl_bytes':dl_u,'used_ul_bytes':ul_u,'is_throttled':thr};manager.last_raw_bytes.pop(ip,None)
                    await asyncio.to_thread(save_quota_to_db,ip,dl_b,ul_b,p_s,st,dl_u,ul_u,thr);print(f"✅ Quota {act}:{ip}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"success","message":f"Quota {act} for {ip}"})
                except ValueError as e:print(f"❌ Quota Val Err:{ip}:{e}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Invalid quota vals:{e}"})
                except Exception as e:print(f"❌ Quota Err:{e}");traceback.print_exc();await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Err quota:{e}"})
            elif msg_type == "command.remove_limit":
                ip=message.get('ip');
                if not ip: continue
                print(f"🔥 Cmd: Remove Limit {ip}")
                try:
                    tr=await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit,ip);await asyncio.to_thread(delete_limit_from_db,ip);manager.manual_device_limits.pop(ip,None)
                    if tr: print(f"✅ Limit removed:{ip}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"success","message":f"Limit removed:{ip}"})
                except Exception as e:print(f"❌ Remove Limit Err:{e}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Err remove limit:{e}"})
            elif msg_type == "command.remove_quota":
                ip=message.get('ip')
                if not ip: continue
                print(f"🔥 Cmd: Remove Quota {ip}")
                try:
                    ml=manager.manual_device_limits.get(ip)
                    if ml: print(f"Quota removed:{ip}. Restoring manual limit.");await asyncio.to_thread(manager.bandwidth_limiter.add_device_limit,ip,ml['download'],ml['upload'],ml['priority'])
                    else: print(f"Quota removed:{ip}. Removing any throttle.");await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit,ip)
                    rq=manager.device_quotas.pop(ip,None);manager.last_raw_bytes.pop(ip,None);await asyncio.to_thread(delete_quota_from_db,ip)
                    if rq: print(f"✅ Quota removed:{ip}")
                    else: print(f"ℹ️ No quota found:{ip}")
                    await channel_layer.group_send("network_data",{"type":"notification.message","status":"success","message":f"Quota removed:{ip}"})
                except Exception as e:print(f"❌ Remove Quota Err:{e}");await channel_layer.group_send("network_data",{"type":"notification.message","status":"error","message":f"Err remove quota:{e}"})

            # --- (Schedule Handlers: save, delete, toggle, request_schedules, request_devices) ---
            elif msg_type == "command.save_schedule":
                schedule_data = message.get('schedule')
                if not schedule_data: continue
                print(f"🔥 Cmd: Save Schedule (ID: {schedule_data.get('id', 'New')})")
                try:
                    if schedule_data.get('rule_type') == 'quota':
                        schedule_data['quota_dl_bytes'] = int(schedule_data.get('quotaDownload', 0)) * 1024 * 1024
                        schedule_data['quota_ul_bytes'] = int(schedule_data.get('quotaUpload', 0)) * 1024 * 1024
                    else: 
                        schedule_data['quota_dl_bytes'] = None; schedule_data['quota_ul_bytes'] = None
                        schedule_data.setdefault('limit_dl_kbps', None); schedule_data.setdefault('limit_ul_kbps', None); schedule_data.setdefault('priority', None)
                    new_id = await asyncio.to_thread(save_schedule_to_db, schedule_data)
                    if new_id is not None:
                        schedule_data['id'] = new_id
                        found = False
                        for i, sch in enumerate(manager.schedules):
                            if sch['id'] == new_id: manager.schedules[i] = schedule_data; found = True; break
                        if not found: manager.schedules.append(schedule_data)
                        await schedule_checker(manager)
                        await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"Schedule '{schedule_data['name']}' saved."})
                        schedules_for_frontend = get_schedules_for_frontend(manager.schedules)
                        await channel_layer.group_send("network_data", {"type": "schedules.update", "schedules": schedules_for_frontend})
                    else:
                        await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": "Failed to save schedule to database."})
                except Exception as e:
                    print(f"❌ Save Schedule Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error saving schedule: {e}"})
            
            elif msg_type == "command.delete_schedule":
                schedule_id = message.get('id');
                if schedule_id is None: continue
                print(f"🔥 Cmd: Delete Schedule ID {schedule_id}")
                try:
                    schedule_to_delete = next((s for s in manager.schedules if s['id'] == schedule_id), None)
                    device_ip_to_restore = None
                    if schedule_to_delete:
                        device_ip_to_restore = schedule_to_delete['device_ip']
                        if active_schedules_by_device.get(device_ip_to_restore) == schedule_id:
                            print(f"  Deactivating schedule {schedule_id} before deletion.")
                            await deactivate_schedule(manager, schedule_id, device_ip_to_restore)
                    deleted = await asyncio.to_thread(delete_schedule_from_db, schedule_id)
                    if deleted:
                        # --- START FIX 1 ---
                        # Remove the schedule from the in-memory list FIRST
                        manager.schedules = [s for s in manager.schedules if s['id'] != schedule_id]
                        
                        # Now that the list is updated, re-run the checker to apply any fallback rules
                        # (like the adaptive policy, if the device is now unmanaged)
                        await schedule_checker(manager)
                        # --- END FIX 1 ---

                        await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": "Schedule deleted."})
                        # Send the updated (shorter) list to all clients
                        schedules_for_frontend = get_schedules_for_frontend(manager.schedules)
                        await channel_layer.group_send("network_data", {"type": "schedules.update", "schedules": schedules_for_frontend})
                    else:
                        await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": "Failed to delete schedule from database."})
                except Exception as e:
                    print(f"❌ Delete Schedule Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error deleting schedule: {e}"})
            
            elif msg_type == "command.toggle_schedule":
                schedule_id = message.get('id'); is_enabled = message.get('enabled')
                if schedule_id is None or is_enabled is None: continue
                print(f"🔥 Cmd: Toggle Schedule ID {schedule_id} -> {is_enabled}")
                try:
                    updated_db = await asyncio.to_thread(update_schedule_enabled_in_db, schedule_id, is_enabled)
                    if updated_db:
                        schedule_to_update = next((s for s in manager.schedules if s['id'] == schedule_id), None)
                        if schedule_to_update:
                            schedule_to_update['is_enabled'] = is_enabled
                            if not is_enabled and active_schedules_by_device.get(schedule_to_update['device_ip']) == schedule_id:
                                await deactivate_schedule(manager, schedule_id, schedule_to_update['device_ip'])
                            await schedule_checker(manager)
                            await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"Schedule toggled."})
                            schedules_for_frontend = get_schedules_for_frontend(manager.schedules)
                            await channel_layer.group_send("network_data", {"type": "schedules.update", "schedules": schedules_for_frontend})
                        else:
                            await channel_layer.group_send("network_data", {"type": "notification.message", "status": "warning", "message": "Schedule not found in memory after DB update."})
                    else:
                        await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": "Failed to toggle schedule in database."})
                except Exception as e:
                    print(f"❌ Toggle Schedule Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error toggling schedule: {e}"})
            elif msg_type == "command.request_schedules":
                print(f"🔥 Cmd: Request Schedules")
                schedules_for_frontend = get_schedules_for_frontend(manager.schedules)
                await channel_layer.group_send("network_data", {"type": "schedules.update", "schedules": schedules_for_frontend})
            
            # --- START FIX 3 ---
            # This handler sends stale data and causes a race condition.
            # The main loop's 1-second broadcast is the only source of truth.
            # Commenting this block out forces the frontend to rely on the broadcast.
            #
            # elif msg_type == "command.request_devices":
            #     print(f"🔥 Cmd: Request Devices")
            #     # --- FIX: Get the requester's channel name from the message ---
            #     requester_channel = message.get("channel_name")
            #     if not requester_channel:
            #         print("❌ ERROR: request_devices received no channel_name.")
            #         continue
            #     # --- End FIX ---
            #     device_list = manager.last_device_list_sent or [] # <-- THIS IS STALE DATA
            #     print(f"  Sending device list back to {requester_channel}")
            #     await channel_layer.send(requester_channel, {"type": "devices.list", "devices": device_list})
            # --- END FIX 3 ---

            # --- *** NEW: Forecast Handler *** ---
            elif msg_type == "command.request_forecast":
                requester_channel = message.get("channel_name")
                if not requester_channel: continue
                
                print("🔥 Cmd: Request Forecast")
                forecast_data = []
                try:
                    conn = sqlite3.connect(DB_FILE)
                    conn.row_factory = sqlite3.Row
                    c = conn.cursor()
                    # Get all predictions for the next 24 hours
                    c.execute("SELECT * FROM usage_forecast WHERE timestamp BETWEEN datetime('now') AND datetime('now', '+1 day') ORDER BY timestamp")
                    rows = c.fetchall()
                    # Convert to dicts for JSON
                    forecast_data = [dict(row) for row in rows]
                    conn.close()
                except Exception as e:
                    print(f"❌ Error fetching forecast: {e}")
                    
                await channel_layer.send(requester_channel, {
                    "type": "forecast.data", 
                    "forecast": forecast_data
                })
            # --- *** END NEW *** ---

            # --- NEW: Security Handlers ---
            elif msg_type == "command.request_security_state":
                print(f"🔥 Cmd: Request Security State")
                # --- FIX: Get the requester's channel name from the message ---
                requester_channel = message.get("channel_name")
                if not requester_channel:
                    print("❌ ERROR: request_security_state received no channel_name.")
                    continue
                # --- End FIX ---
                
                state_payload = {
                    "type": "security.state.update",
                    "isolation": manager.client_isolation_enabled,
                    "acMode": manager.access_control_mode,
                    "blockList": list(manager.blocked_macs),
                    "allowList": list(manager.allowed_macs),
                    "ipBlockList": list(manager.ip_block_list) # *** NEW ***
                }
                # Send directly back to the requester
                print(f"  Sending security state back to {requester_channel}")
                await channel_layer.send(requester_channel, state_payload)
                
            elif msg_type == "command.set_client_isolation":
                enabled = message.get('enabled', False)
                print(f"🔥 Cmd: Set Client Isolation -> {enabled}")
                try:
                    await asyncio.to_thread(manager.set_client_isolation, enabled)
                    await asyncio.to_thread(save_setting_to_db, 'client_isolation', '1' if enabled else '0')
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"Client Isolation {'Enabled' if enabled else 'Disabled'}."})
                    # Broadcast the new state to all clients
                    await channel_layer.group_send("network_data", {"type": "security.state.update", "isolation": enabled, "acMode": manager.access_control_mode, "blockList": list(manager.blocked_macs), "allowList": list(manager.allowed_macs), "ipBlockList": list(manager.ip_block_list)})
                except Exception as e:
                    print(f"❌ Client Isolation Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error setting isolation: {e}"})
            
            elif msg_type == "command.set_ac_mode":
                mode = message.get('mode', 'allow_all')
                print(f"🔥 Cmd: Set AC Mode -> {mode}")
                try:
                    await asyncio.to_thread(manager.set_access_control_mode, mode)
                    await asyncio.to_thread(save_setting_to_db, 'access_control_mode', mode)
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"Access control mode set to: {mode}"})
                    await channel_layer.group_send("network_data", {"type": "security.state.update", "isolation": manager.client_isolation_enabled, "acMode": mode, "blockList": list(manager.blocked_macs), "allowList": list(manager.allowed_macs), "ipBlockList": list(manager.ip_block_list)})
                except Exception as e:
                    print(f"❌ AC Mode Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error setting AC mode: {e}"})

            elif msg_type == "command.add_mac":
                mac = message.get('mac')
                list_type = message.get('list_type')
                if not mac or not list_type: continue
                print(f"🔥 Cmd: Add MAC {mac} to {list_type} list")
                try:
                    await asyncio.to_thread(manager.add_mac_to_list, mac, list_type)
                    await asyncio.to_thread(save_mac_to_db, mac, list_type)
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"MAC {mac} added to {list_type} list."})
                    await channel_layer.group_send("network_data", {"type": "security.state.update", "isolation": manager.client_isolation_enabled, "acMode": manager.access_control_mode, "blockList": list(manager.blocked_macs), "allowList": list(manager.allowed_macs), "ipBlockList": list(manager.ip_block_list)})
                except Exception as e:
                    print(f"❌ Add MAC Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error adding MAC: {e}"})

            elif msg_type == "command.remove_mac":
                mac = message.get('mac')
                if not mac: continue
                print(f"🔥 Cmd: Remove MAC {mac}")
                try:
                    await asyncio.to_thread(manager.remove_mac_from_list, mac)
                    await asyncio.to_thread(delete_mac_from_db, mac)
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"MAC {mac} removed from list."})
                    await channel_layer.group_send("network_data", {"type": "security.state.update", "isolation": manager.client_isolation_enabled, "acMode": manager.access_control_mode, "blockList": list(manager.blocked_macs), "allowList": list(manager.allowed_macs), "ipBlockList": list(manager.ip_block_list)})
                except Exception as e:
                    print(f"❌ Remove MAC Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error removing MAC: {e}"})
            
            # --- *** NEW: IP Block Handlers *** ---
            elif msg_type == "command.add_ip_block":
                ip_range = message.get('ip_range')
                if not ip_range: continue
                print(f"🔥 Cmd: Add IP Block {ip_range}")
                try:
                    # --- *** MODIFIED: Basic validation for IPv4 or IPv6 *** ---
                    # A simple check for '.' or ':' is good enough here.
                    if not ('.' in ip_range or ':' in ip_range):
                        raise ValueError("Invalid IP/CIDR format. Must contain '.' or ':'.")
                    # --- *** END MODIFIED *** ---
                    
                    await asyncio.to_thread(manager.add_ip_to_block_list, ip_range)
                    await asyncio.to_thread(save_ip_block_to_db, ip_range)
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"IP range {ip_range} blocked."})
                    await channel_layer.group_send("network_data", {"type": "security.state.update", "isolation": manager.client_isolation_enabled, "acMode": manager.access_control_mode, "blockList": list(manager.blocked_macs), "allowList": list(manager.allowed_macs), "ipBlockList": list(manager.ip_block_list)})
                except Exception as e:
                    print(f"❌ Add IP Block Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error blocking IP: {e}"})

            elif msg_type == "command.remove_ip_block":
                ip_range = message.get('ip_range')
                if not ip_range: continue
                print(f"🔥 Cmd: Remove IP Block {ip_range}")
                try:
                    await asyncio.to_thread(manager.remove_ip_from_block_list, ip_range)
                    await asyncio.to_thread(delete_ip_block_from_db, ip_range)
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "success", "message": f"IP range {ip_range} unblocked."})
                    await channel_layer.group_send("network_data", {"type": "security.state.update", "isolation": manager.client_isolation_enabled, "acMode": manager.access_control_mode, "blockList": list(manager.blocked_macs), "allowList": list(manager.allowed_macs), "ipBlockList": list(manager.ip_block_list)})
                except Exception as e:
                    print(f"❌ Remove IP Block Err: {e}"); traceback.print_exc()
                    await channel_layer.group_send("network_data", {"type": "notification.message", "status": "error", "message": f"Error unblocking IP: {e}"})
            # --- *** End of NEW *** ---
            
            # --- End of NEW Handlers ---

            # --- Analysis Handlers (Removed) ---
            # --- End of Handlers ---

    except asyncio.CancelledError:
        print("🎧 Command listener stopping.")
    except Exception as e:
        print(f"🛑 Command listener error: {e}"); traceback.print_exc()
    finally:
        await channel_layer.group_discard("hotspot_commands", channel_name)

# --- *** NEW: Helper for Adaptive Scheduling *** ---
async def apply_adaptive_policy(manager, policy_type):
    """
    Applies or clears the "Adaptive" policy based on predicted congestion.
    This policy is a "low priority" limit that should not override
    manual limits or active schedules.
    """
    global adaptive_limits_active
    
    # This is our "fair use" policy for when congestion is high
    # A low-priority limit (prio=7)
    ADAPTIVE_DL_KBPS = 1024 
    ADAPTIVE_UL_KBPS = 256
    ADAPTIVE_PRIORITY = 7

    # --- THIS IS THE NEW, FIXED LINE ---
    active_device_ips = {dev.get('ip') for dev in manager.last_device_list_sent if dev.get('ip')}

    if policy_type == "congested":
        # Apply the policy
        devices_to_limit = set()
        for ip in active_device_ips:
            # ONLY limit devices that are not already managed
            is_manually_limited = ip in manager.manual_device_limits
            is_quota_throttled = manager.device_quotas.get(ip, {}).get('is_throttled', False)
            is_scheduled = ip in active_schedules_by_device
            
            if not is_manually_limited and not is_quota_throttled and not is_scheduled:
                devices_to_limit.add(ip)

        for ip in devices_to_limit:
            if ip not in adaptive_limits_active:
                print(f"  ADAPTIVE: Applying 'Fair Use' limit to {ip}")
                await asyncio.to_thread(
                    manager.bandwidth_limiter.add_device_limit,
                    ip, ADAPTIVE_DL_KBPS, ADAPTIVE_UL_KBPS, ADAPTIVE_PRIORITY
                )
                adaptive_limits_active.add(ip)

    elif policy_type == "clear":
        # Remove the policy from any device that still has it
        if not adaptive_limits_active:
            return # Nothing to do
            
        print("  ADAPTIVE: Predicted congestion cleared. Removing 'Fair Use' limits.")
        # We must iterate over a copy, as we are modifying the set
        for ip in list(adaptive_limits_active):
            # Check if it's *still* un-managed. A schedule might have started.
            is_manually_limited = ip in manager.manual_device_limits
            is_scheduled = ip in active_schedules_by_device
            
            if not is_manually_limited and not is_scheduled:
                print(f"  ADAPTIVE: Removing 'Fair Use' limit from {ip}")
                await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit, ip)
            
            adaptive_limits_active.discard(ip)

# --- (Schedule Checker Tasks: schedule_checker, schedule_checker_for_devices, activate_schedule, deactivate_schedule) ---
async def schedule_checker(manager):
    print("⏰ Running schedule check...")
    
    # --- *** NEW: Adaptive Logic *** ---
    try:
        # We need at least one forecast point and our ISP speed
        if manager.forecast_data and manager.available_download_kbps > 0:
            now = datetime.now()
            # Look 1 hour into the future
            in_one_hour = (now + timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')
            
            # Get forecast points for the next hour from our in-memory list
            # manager.forecast_data is a list of (timestamp, predicted_bytes)
            next_hour_points = [
                val for ts, val in manager.forecast_data 
                if ts > now.strftime('%Y-%m-%d %H:%M:%S') and ts <= in_one_hour
            ]
            
            if next_hour_points:
                # Find the *peak* predicted usage in the next hour
                peak_predicted_bytes = max(next_hour_points)
                
                # Convert this to Kbps. 
                # This assumes your aggregation interval is 15-minutes (900 seconds)
                # (bytes * 8 bits/byte) / (15 min * 60 sec/min) = bits/sec
                # (bits/sec) / 1000 = Kbps
                AGGREGATION_SECONDS = 15 * 60 # Must match your trainer script
                predicted_peak_kbps = (peak_predicted_bytes * 8) / AGGREGATION_SECONDS / 1000 
                
                # Calculate predicted network congestion
                congestion_level = predicted_peak_kbps / manager.available_download_kbps
                
                print(f"  ADAPTIVE: Peak usage in next hour: {predicted_peak_kbps:.0f} Kbps. Congestion: {congestion_level*100:.1f}%")

                # --- THE ACTION ---
                if congestion_level > 0.85: # If we predict > 85% congestion
                    print("  🚨 ADAPTIVE: High congestion predicted! Applying 'Fair Use' policy.")
                    await apply_adaptive_policy(manager, "congested")
                elif congestion_level < 0.5: # If prediction is low, remove policy
                    await apply_adaptive_policy(manager, "clear")

    except Exception as e:
        print(f"❌ Error in Adaptive Scheduler logic: {e}")
        traceback.print_exc()
    # --- *** END: Adaptive Logic *** ---
    
    now = datetime.now(); current_date = now.date(); current_time = now.time(); current_weekday = now.weekday(); js_weekday = (current_weekday + 1) % 7
    active_schedule_ids_this_cycle = set()
    for schedule in manager.schedules:
        if not schedule.get('is_enabled'): continue
        schedule_id = schedule['id']; device_ip = schedule['device_ip']
        try:
            start_time = dt_time.fromisoformat(schedule['start_time']); end_time = dt_time.fromisoformat(schedule['end_time'])
            time_active = (start_time <= current_time <= end_time) if start_time <= end_time else (current_time >= start_time or current_time <= end_time)
            start_date = datetime.strptime(schedule['start_date'], '%Y-%m-%d').date() if schedule.get('start_date') else None
            end_date = datetime.strptime(schedule['end_date'], '%Y-%m-%d').date() if schedule.get('end_date') else None
            date_active = (not start_date or current_date >= start_date) and (not end_date or current_date <= end_date)
            repeat_active = False; repeat_mode = schedule['repeat_mode']
            if not date_active: repeat_active = False
            elif repeat_mode == 'once': repeat_active = (current_date == start_date)
            elif repeat_mode == 'daily': repeat_active = True
            elif repeat_mode == 'weekdays': repeat_active = 0 <= current_weekday <= 4
            elif repeat_mode == 'weekends': repeat_active = 5 <= current_weekday <= 6
            elif repeat_mode == 'custom': custom_days = schedule.get('custom_days', []); repeat_active = js_weekday in custom_days
            should_be_active = date_active and time_active and repeat_active
        except (ValueError, TypeError): print(f"⚠️ Invalid time/date format for schedule ID {schedule_id}. Skipping."); continue
        currently_active_schedule_id = active_schedules_by_device.get(device_ip)
        if should_be_active:
            active_schedule_ids_this_cycle.add(schedule_id)
            if currently_active_schedule_id != schedule_id:
                await activate_schedule(manager, schedule)
        elif currently_active_schedule_id == schedule_id:
            await deactivate_schedule(manager, schedule_id, device_ip)
    devices_to_recheck = set()
    for dev_ip, active_id in list(active_schedules_by_device.items()):
        if active_id not in active_schedule_ids_this_cycle:
            print(f"  Schedule {active_id} for {dev_ip} ended naturally.")
            await deactivate_schedule(manager, active_id, dev_ip)
            devices_to_recheck.add(dev_ip)
    if devices_to_recheck:
         print(f"  Re-checking devices affected by deactivation: {devices_to_recheck}")
         await schedule_checker_for_devices(manager, devices_to_recheck)

async def schedule_checker_for_devices(manager, device_ips):
    now = datetime.now(); current_date = now.date(); current_time = now.time(); current_weekday = now.weekday(); js_weekday = (current_weekday + 1) % 7
    for schedule in manager.schedules:
        if not schedule.get('is_enabled') or schedule['device_ip'] not in device_ips: continue
        schedule_id = schedule['id']; device_ip = schedule['device_ip']
        if active_schedules_by_device.get(device_ip) is not None: continue
        try:
            start_time = dt_time.fromisoformat(schedule['start_time']); end_time = dt_time.fromisoformat(schedule['end_time'])
            time_active = (start_time <= current_time <= end_time) if start_time <= end_time else (current_time >= start_time or current_time <= end_time)
            start_date = datetime.strptime(schedule['start_date'], '%Y-%m-%d').date() if schedule.get('start_date') else None
            end_date = datetime.strptime(schedule['end_date'], '%Y-%m-%d').date() if schedule.get('end_date') else None
            date_active = (not start_date or current_date >= start_date) and (not end_date or current_date <= end_date)
            repeat_active = False; repeat_mode = schedule['repeat_mode']
            if not date_active: repeat_active = False
            elif repeat_mode == 'once': repeat_active = (current_date == start_date)
            elif repeat_mode == 'daily': repeat_active = True
            elif repeat_mode == 'weekdays': repeat_active = 0 <= current_weekday <= 4
            elif repeat_mode == 'weekends': repeat_active = 5 <= current_weekday <= 6
            elif repeat_mode == 'custom': custom_days = schedule.get('custom_days', []); repeat_active = js_weekday in custom_days
            should_be_active = date_active and time_active and repeat_active
        except: continue
        if should_be_active:
            print(f"  Applying fallback schedule {schedule_id} for {device_ip}.")
            await activate_schedule(manager, schedule)
            if device_ip in device_ips: device_ips.remove(device_ip)
            if not device_ips: break

async def activate_schedule(manager, schedule):
    schedule_id = schedule['id']; device_ip = schedule['device_ip']; rule_type = schedule['rule_type']
    print(f"  Activating schedule ID {schedule_id} ('{schedule['name']}') for {device_ip}")
    if device_ip not in pre_schedule_states:
        current_manual_limit = manager.manual_device_limits.get(device_ip); current_quota = manager.device_quotas.get(device_ip)
        if current_manual_limit:
            pre_schedule_states[device_ip] = {"type": "limit", "value": current_manual_limit.copy()}; print(f"    Saved pre-schedule limit state for {device_ip}")
        elif current_quota:
            pre_schedule_states[device_ip] = {"type": "quota", "value": current_quota.copy()}; print(f"    Saved pre-schedule quota state for {device_ip}")
        else:
            pre_schedule_states[device_ip] = {"type": "none", "value": None}; print(f"    No pre-schedule state found for {device_ip}")
    
    # *** NEW: Deactivate adaptive limit if it's on ***
    if device_ip in adaptive_limits_active:
        print(f"    Schedule overriding adaptive limit for {device_ip}.")
        adaptive_limits_active.discard(device_ip)
        # The new rule will be applied below, overwriting the adaptive one
        
    if rule_type == 'limit':
        dl = schedule.get('limit_dl_kbps'); ul = schedule.get('limit_ul_kbps'); prio = schedule.get('priority', 5)
        if dl is not None and ul is not None:
            print(f"    Applying scheduled limit: DL={dl}k, UL={ul}k, P={prio}")
            await asyncio.to_thread(manager.bandwidth_limiter.add_device_limit, device_ip, dl, ul, prio)
        else:
            print(f"    ⚠️ Schedule {schedule_id} is limit type but has invalid values. Removing limits.")
            await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit, device_ip)
    elif rule_type == 'quota':
        dl_b = schedule.get('quota_dl_bytes'); ul_b = schedule.get('quota_ul_bytes'); period_s = 3600 #TODO: Make this configurable?
        if dl_b is not None and ul_b is not None:
            print(f"    Applying scheduled quota definition: DL={dl_b}B, UL={ul_b}B")
            start_time = time.time(); used_dl = 0; used_ul = 0; is_throttled = False
            manager.device_quotas[device_ip] = {'limit_dl_bytes': dl_b, 'limit_ul_bytes': ul_b, 'period_seconds': period_s, 'start_time': start_time, 'used_dl_bytes': used_dl, 'used_ul_bytes': used_ul, 'is_throttled': is_throttled}
            manager.last_raw_bytes.pop(device_ip, None)
            await asyncio.to_thread(save_quota_to_db, device_ip, dl_b, ul_b, period_s, start_time, used_dl, used_ul, is_throttled)
        else:
            print(f"    ⚠️ Schedule {schedule_id} is quota type but has invalid values. Removing quota.")
            if device_ip in manager.device_quotas: manager.device_quotas.pop(device_ip, None)
            await asyncio.to_thread(delete_quota_from_db, device_ip)
    active_schedules_by_device[device_ip] = schedule_id

async def deactivate_schedule(manager, schedule_id, device_ip):
    print(f"  Deactivating schedule ID {schedule_id} for {device_ip}")
    if device_ip in pre_schedule_states:
        saved_state = pre_schedule_states.pop(device_ip); state_type = saved_state['type']; value = saved_state['value']
        print(f"    Restoring pre-schedule state ({state_type}) for {device_ip}")
        if state_type == 'limit':
            await asyncio.to_thread(manager.bandwidth_limiter.add_device_limit, device_ip, value['download'], value['upload'], value['priority'])
            if device_ip in manager.device_quotas: manager.device_quotas.pop(device_ip, None)
            await asyncio.to_thread(delete_quota_from_db, device_ip)
        elif state_type == 'quota':
            manager.device_quotas[device_ip] = value; manager.last_raw_bytes.pop(device_ip, None)
            await asyncio.to_thread(save_quota_to_db, device_ip, value['limit_dl_bytes'], value['limit_ul_bytes'], value['period_seconds'], value['start_time'], value['used_dl_bytes'], value.get('is_throttled', False))
            await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit, device_ip)
        elif state_type == 'none':
            await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit, device_ip)
            if device_ip in manager.device_quotas: manager.device_quotas.pop(device_ip, None)
            await asyncio.to_thread(delete_quota_from_db, device_ip)
    else:
        print(f"    ⚠️ No pre-schedule state found for {device_ip}. Removing current limits/quotas.")
        await asyncio.to_thread(manager.bandwidth_limiter.remove_device_limit, device_ip)
        if device_ip in manager.device_quotas: manager.device_quotas.pop(device_ip, None)
        await asyncio.to_thread(delete_quota_from_db, device_ip)
    if active_schedules_by_device.get(device_ip) == schedule_id:
        active_schedules_by_device.pop(device_ip, None)
        
    # --- START FIX 2: Remove these lines ---
    # These lines were causing the "apply/remove" log spam.
    # The main schedule_checker loop is responsible for this.
    # await apply_adaptive_policy(manager, "congested") # <-- REMOVED
    # await apply_adaptive_policy(manager, "clear") # <-- REMOVED
    # --- END FIX 2 ---


# --- Main Daemon Loop ---
async def run_web_daemon():
    print("Starting Web Daemon...")
    init_db() # Ensure all tables exist

    settings = await asyncio.to_thread(load_settings_from_db)
    print(f"Loaded settings. SSID: {settings['ssid']}")
    initial_limits = await asyncio.to_thread(load_limits_from_db)
    initial_quotas = await asyncio.to_thread(load_quotas_from_db)
    initial_schedules = await asyncio.to_thread(load_schedules_from_db)
    blocked_macs, allowed_macs = await asyncio.to_thread(load_mac_lists_from_db)
    blocked_ips = await asyncio.to_thread(load_ip_block_list_from_db) # *** NEW ***

    manager = HotspotManager(interface="wlo1", ssid=settings['ssid'], password=settings['password'])
    manager.manual_device_limits = initial_limits.copy()
    manager.bandwidth_limiter.limits = initial_limits.copy()
    manager.device_quotas = initial_quotas
    manager.schedules = initial_schedules
    manager.last_device_list_sent = []
    manager.forecast_data = [] # *** NEW: Initialize property ***
    
    # --- NEW: Set initial security state ---
    manager.client_isolation_enabled = settings['client_isolation']
    manager.access_control_mode = settings['access_control_mode']
    manager.blocked_macs = blocked_macs
    manager.allowed_macs = allowed_macs
    manager.ip_block_list = blocked_ips # *** NEW ***
    # --- End NEW ---

    manager.check_sudo()
    manager.check_dependencies()
    shared_state = {'period': '24h'}
    listener_task = None
    scheduler_task = None 
    
    channel_layer = None
    listener_task_exception = None
    scheduler_task_exception = None 

    try:
        if await asyncio.to_thread(manager.is_hotspot_active):
            print("✅ Hotspot is already active.")
            _,_,network=await asyncio.to_thread(manager.get_hotspot_ip_range)
            if network:
                await asyncio.to_thread(manager.setup_iptables_monitoring,network)
                await asyncio.to_thread(manager.setup_security_rules) # --- NEW ---
                if not manager.bandwidth_limiter.tc_initialized: await asyncio.to_thread(manager.bandwidth_limiter.setup_tc_qdisc,manager.available_download_kbps,manager.available_upload_kbps)
                if not manager.bandwidth_limiter.tc_initialized: print("🚨 CRITICAL: Failed TC init.");return
                print("Re-applying stored limits...")
                for ip,l_info in list(initial_limits.items()):print(f"  Applying limit:{ip}");await asyncio.to_thread(manager.bandwidth_limiter.add_device_limit,ip,l_info['download'],l_info['upload'],l_info['priority'])
                
                # --- *** NEW: Load forecast data *** ---
                print("Loading forecast data into memory...")
                try:
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute("SELECT timestamp, predicted_bytes FROM usage_forecast WHERE timestamp > datetime('now')")
                    manager.forecast_data = c.fetchall()
                    conn.close()
                    print(f"Loaded {len(manager.forecast_data)} forecast points.")
                except Exception as e:
                    print(f"Error loading forecast: {e}")
                # --- *** END NEW --- ---
                
                print("Finished re-applying rules.")
                await schedule_checker(manager) # Initial schedule check
            print("✅ Monitoring rules and TC active.")
        else:
            print("ℹ️ Hotspot OFF. Rules loaded, will apply when ON.")

        print("🚀 Connecting to Redis channel layer...")
        channel_layer = RedisChannelLayer(**CHANNEL_LAYER_CONFIG)
        listener_task = asyncio.create_task(command_listener(channel_layer, manager, shared_state))
        
        # --- Start scheduler loop task ---
        async def scheduler_loop():
            while True:
                await asyncio.sleep(SCHEDULE_CHECK_INTERVAL)
                if await asyncio.to_thread(manager.is_hotspot_active):
                    try:
                        await schedule_checker(manager)
                    except Exception as e:
                        print(f"🚨 ERROR in scheduler loop: {e}"); traceback.print_exc()
        scheduler_task = asyncio.create_task(scheduler_loop())
        
        print("🔥 Data daemon running..."); print("Press Ctrl+C to stop.")

        while True:
            # --- Check tasks ---
            if listener_task.done():
                listener_task_exception = listener_task.exception(); break
            if scheduler_task.done():
                scheduler_task_exception = scheduler_task.exception(); break
            
            is_active = await asyncio.to_thread(manager.is_hotspot_active)
            devices, _, _ = await asyncio.to_thread(manager.get_connected_devices_with_bandwidth) if is_active else ([], None, None)

            # --- Main loop data processing ---
            total_dl_speed_bytes=0;total_ul_speed_bytes=0;active_devices=0;device_list_for_frontend=[]
            if is_active and devices:
                active_ips_current_cycle=set();now=time.time()
                for dev in devices:
                    ip=dev.get('ip');
                    if not ip: continue
                    active_ips_current_cycle.add(ip);rx_delta=dev.get('rx_delta_bytes',0);tx_delta=dev.get('tx_delta_bytes',0)
                    if rx_delta>0 or tx_delta>0: await asyncio.to_thread(log_usage_to_db,ip,rx_delta,tx_delta)
                    if dev['active']: active_devices+=1;total_dl_speed_bytes+=dev.get('download_speed',0);total_ul_speed_bytes+=dev.get('upload_speed',0)
                    manual_limit_details=manager.manual_device_limits.get(ip);quota_details=manager.device_quotas.get(ip);current_limit_details=manager.bandwidth_limiter.limits.get(ip)
                    quota_status="N/A";quota_time_left=None
                    if quota_details: quota_status=dev.get('quota_status',"N/A");quota_time_left=dev.get('quota_time_left_seconds')
                    limit_dl=manual_limit_details['download'] if manual_limit_details else None;limit_ul=manual_limit_details['upload'] if manual_limit_details else None;priority=manual_limit_details.get('priority',7) if manual_limit_details else 7
                    
                    # --- *** START MODIFICATION (from previous step) *** ---
                    # Check if this IP is in our global active schedule list
                    active_schedule_id = active_schedules_by_device.get(ip)
                    # --- *** END MODIFICATION *** ---

                    device_list_for_frontend.append({
                        "id":ip,
                        "ip":ip,
                        "hostname":dev.get('hostname'),
                        "mac":dev.get('mac'),
                        "status":'online' if dev.get('active') else 'offline',
                        "downloadSpeed_Bps":dev.get('download_speed',0),
                        "uploadSpeed_Bps":dev.get('upload_speed',0),
                        "sessionData_Bytes":dev.get('total_download',0),
                        "priority":priority,
                        "hasLimit":manual_limit_details is not None,
                        "hasQuota":quota_details is not None,
                        "blocked":False,
                        "limit_dl_kbps":limit_dl,
                        "limit_ul_kbps":limit_ul,
                        "quota_dl_limit_bytes":dev.get('quota_dl_limit_bytes'),
                        "quota_ul_limit_bytes":dev.get('quota_ul_limit_bytes'),
                        "quota_period_seconds":dev.get('quota_period_seconds'),
                        "quota_dl_used_bytes":dev.get('quota_dl_used_bytes'),
                        "quota_ul_used_bytes":dev.get('quota_ul_used_bytes'),
                        "quota_time_left_seconds":quota_time_left,
                        "quota_status_str":quota_status,
                        "active_schedule_id": active_schedule_id # <-- *** ADDED KEY ***
                    })
                manager.last_device_list_sent = device_list_for_frontend

            # --- Main loop data formatting and sending ---
            current_period=shared_state['period'];hist_rx,hist_tx=await asyncio.to_thread(get_historical_data,current_period);total_data_bytes=hist_rx+hist_tx
            total_dl_kbps=(total_dl_speed_bytes*8)/1000;total_ul_kbps=(total_ul_speed_bytes*8)/1000;dl_speed_str=f"{total_dl_kbps:.0f} Kbps" if total_dl_kbps<1000 else f"{(total_dl_kbps/1000):.1f} Mbps";ul_speed_str=f"{total_ul_kbps:.0f} Kbps" if total_ul_kbps<1000 else f"{(total_ul_kbps/1000):.1f} Mbps";total_data_mb=total_data_bytes/1048576;data_usage_str=f"{total_data_mb:.1f} MB" if total_data_mb<1024 else f"{(total_data_mb/1024):.2f} GB"
            data_payload={"hotspot_status":"ON" if is_active else "OFF","hotspot_ssid":manager.ssid if is_active else "","total_download_speed":dl_speed_str,"total_upload_speed":ul_speed_str,"device_count":str(active_devices),"total_data_usage":data_usage_str,"timestamp":datetime.now().strftime('%H:%M:%S'),"total_download_mbps":total_dl_kbps/1000,"total_upload_mbps":total_ul_kbps/1000,"devices":device_list_for_frontend}
            if channel_layer: await channel_layer.group_send("network_data",{"type":"network.data.message","data":data_payload})

            # --- Persist quota state ---
            if is_active:
                for ip,q_data in manager.device_quotas.items(): await asyncio.to_thread(save_quota_to_db,ip,q_data['limit_dl_bytes'],q_data['limit_ul_bytes'],q_data['period_seconds'],q_data['start_time'],q_data['used_dl_bytes'],q_data['used_ul_bytes'],q_data.get('is_throttled',False))

            await asyncio.sleep(1)

    except asyncio.CancelledError: print("\n🛑 Main loop cancelled.")
    except KeyboardInterrupt: print("\n🛑 Stopping daemon...")
    except Exception as e: print(f"🚨 CRITICAL ERROR in main loop: {e}"); traceback.print_exc()
    finally:
        # --- Cancel tasks ---
        if listener_task and not listener_task.done(): listener_task.cancel()
        if scheduler_task and not scheduler_task.done(): scheduler_task.cancel()
        
        try:
            await asyncio.gather(listener_task, scheduler_task, return_exceptions=True)
        except asyncio.CancelledError: pass

        # --- Revert scheduled states ---
        print("🧹 Reverting any active schedule states...")
        for dev_ip, active_id in list(active_schedules_by_device.items()):
            await deactivate_schedule(manager, active_id, dev_ip)   
        
        # --- *** NEW: Revert adaptive limits *** ---
        print("🧹 Reverting any adaptive limits...")
        await apply_adaptive_policy(manager, "clear")

        print("🧹 Cleaning up rules...")
        if not await asyncio.to_thread(manager.is_hotspot_active):
             cleanup_tasks=[
                 asyncio.to_thread(manager.cleanup_iptables_monitoring),
                 asyncio.to_thread(manager.cleanup_security_rules), # --- NEW ---
                 asyncio.to_thread(manager.bandwidth_limiter.cleanup_tc)
             ]
             await asyncio.gather(*cleanup_tasks)
        else:
            await asyncio.to_thread(manager.turn_off_hotspot)

        print("✅ Cleanup complete.")
        
        # --- Print exceptions ---
        if listener_task_exception: print("\n--- Listener Exception ---"); traceback.print_exception(type(listener_task_exception), listener_task_exception, listener_task_exception.__traceback__); print("---")
        if scheduler_task_exception: print("\n--- Scheduler Exception ---"); traceback.print_exception(type(scheduler_task_exception), scheduler_task_exception, scheduler_task_exception.__traceback__); print("---")

if __name__ == "__main__":
    asyncio.run(run_web_daemon())

