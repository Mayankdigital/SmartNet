import asyncio
import json
import psutil
import websockets
import time
from ping3 import ping
from collections import defaultdict

# --- Firebase Integration ---
import firebase_admin
from firebase_admin import credentials, firestore

try:
    # This automatically looks for 'serviceAccountKey.json' in the same directory.
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Successfully connected to Firebase Firestore.")
except Exception as e:
    print(f"❌ ERROR: Could not connect to Firebase. Make sure 'serviceAccountKey.json' is in the folder. Error: {e}")
    db = None

def save_policy_to_firebase(policy_data):
    """Saves a single application's policy to Firestore."""
    if not db:
        print("Firestore not connected. Cannot save policy.")
        return
    try:
        app_name = policy_data.get('name')
        if not app_name:
            print("Error: Policy data is missing 'name'.")
            return
        data_to_save = {
            'name': app_name,
            'priority': policy_data.get('priority'),
            'downloadCap': policy_data.get('downloadCap'),
            'uploadCap': policy_data.get('uploadCap'),
            'appliedModes': policy_data.get('appliedModes', [])
        }
        db.collection('policies').document(app_name).set(data_to_save)
        print(f"Policy for '{app_name}' saved to Firebase.")
    except Exception as e:
        print(f"Error saving policy to Firebase: {e}")

# --- State Tracking & Core Logic (Corrected and Complete) ---
last_global_net_io = psutil.net_io_counters()
last_global_time = time.time()
process_io_cache = {}

async def get_aggregated_network_stats():
    """Calculates global stats and aggregates per-process stats by application name."""
    global last_global_net_io, last_global_time, process_io_cache
    
    current_time = time.time()
    duration = current_time - last_global_time
    if duration == 0: # Avoid division by zero on the first run
        duration = 1 

    # --- 1. Calculate Global Stats ---
    current_global_net_io = psutil.net_io_counters()
    bytes_sent = current_global_net_io.bytes_sent - last_global_net_io.bytes_sent
    bytes_recv = current_global_net_io.bytes_recv - last_global_net_io.bytes_recv
    download_speed_mbs = (bytes_recv / duration) / (1024 * 1024)
    upload_speed_mbs = (bytes_sent / duration) / (1024 * 1024)
    
    last_global_net_io = current_global_net_io
    last_global_time = current_time

    latency = ping("8.8.8.8", unit='ms')
    latency_ms = round(latency) if latency is not None and latency is not False else 999
    efficiency = max(85.0, min(99.9, 99 - (latency_ms / 10)))

    global_stats = {
        "downloadSpeed": round(download_speed_mbs, 1),
        "uploadSpeed": round(upload_speed_mbs, 1),
        "latency": latency_ms,
        "efficiency": round(efficiency, 1)
    }

    # --- 2. Aggregate Per-Process Stats ---
    aggregated_processes = defaultdict(lambda: {'downloadSpeed': 0, 'uploadSpeed': 0, 'count': 0})
    current_pids = set()

    for p in psutil.process_iter(['pid', 'name']):
        try:
            proc_info = p.info
            if not proc_info['name'] or proc_info['pid'] == 0:
                continue

            current_pids.add(proc_info['pid'])
            io_counters = p.io_counters()
            read_bytes, write_bytes = io_counters.read_bytes, io_counters.write_bytes
            
            download_speed_kbs, upload_speed_kbs = 0, 0

            if proc_info['pid'] in process_io_cache:
                last_read, last_write, last_time = process_io_cache[proc_info['pid']]
                proc_duration = current_time - last_time
                if proc_duration > 0:
                    download_speed_kbs = ((read_bytes - last_read) / proc_duration) / 1024
                    upload_speed_kbs = ((write_bytes - last_write) / proc_duration) / 1024

            process_io_cache[proc_info['pid']] = (read_bytes, write_bytes, current_time)
            app_name = proc_info['name']
            aggregated_processes[app_name]['downloadSpeed'] += download_speed_kbs
            aggregated_processes[app_name]['uploadSpeed'] += upload_speed_kbs
            aggregated_processes[app_name]['count'] += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    for pid in list(process_io_cache.keys()):
        if pid not in current_pids:
            del process_io_cache[pid]

    processes_list = []
    for name, data in aggregated_processes.items():
        processes_list.append({
            "name": name,
            "downloadSpeed": round(data['downloadSpeed'], 1),
            "uploadSpeed": round(data['uploadSpeed'], 1),
            "pid": f"{data['count']} instance(s)"
        })
    processes_list.sort(key=lambda x: x['name'].lower())

    return {
        "globalStats": global_stats,
        "processes": processes_list
    }

# --- WebSocket Handler (Corrected) ---
async def handler(websocket):
    """Handles connections, running tasks for periodic updates and incoming messages."""
    print(f"✅ Frontend connected from {websocket.remote_address}")

    async def send_periodic_updates():
        """This task sends live process data every 2 seconds."""
        while True:
            try:
                stats = await get_aggregated_network_stats()
                await websocket.send(json.dumps(stats))
                await asyncio.sleep(2)
            except websockets.exceptions.ConnectionClosed:
                break # Exit the loop if connection is closed
            except Exception as e:
                print(f"Error in send_periodic_updates: {e}")

    async def handle_incoming_messages():
        """This task listens for messages from the frontend."""
        async for message in websocket:
            try:
                data = json.loads(message)
                if data.get('action') == 'save_policy':
                    print("Received 'save_policy' request.")
                    save_policy_to_firebase(data.get('payload'))
            except json.JSONDecodeError:
                if message == 'rescan':
                    print("Received 'rescan' request. Sending fresh data.")
                    stats = await get_aggregated_network_stats()
                    await websocket.send(json.dumps(stats))
            except Exception as e:
                print(f"Error in handle_incoming_messages: {e}")

    # Run both tasks concurrently and wait for one to finish
    sender_task = asyncio.create_task(send_periodic_updates())
    receiver_task = asyncio.create_task(handle_incoming_messages())
    done, pending = await asyncio.wait(
        [sender_task, receiver_task], return_when=asyncio.FIRST_COMPLETED
    )
    for task in pending:
        task.cancel()
    print(f"❌ Frontend disconnected from {websocket.remote_address}")

# --- Main Execution ---
async def main():
    """Starts the WebSocket server."""
    print(f"🚀 Starting Aggregated Process Monitor server on ws://localhost:8765")
    async with websockets.serve(handler, "localhost", 8765):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())