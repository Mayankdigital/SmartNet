import asyncio
import json
import psutil
import websockets
import time
from ping3 import ping
from collections import defaultdict

# --- Configuration ---
SERVER_ADDRESS = "localhost"
SERVER_PORT = 8765
PING_HOST = "8.8.8.8"

# --- State Tracking ---
last_global_net_io = psutil.net_io_counters()
last_global_time = time.time()
process_io_cache = {}

async def get_aggregated_network_stats():
    """
    Calculates global stats and aggregates per-process stats by application name.
    """
    global last_global_net_io, last_global_time, process_io_cache

    current_time = time.time()
    duration = current_time - last_global_time

    # --- 1. Calculate Global Stats (Same as before) ---
    current_global_net_io = psutil.net_io_counters()
    bytes_sent = current_global_net_io.bytes_sent - last_global_net_io.bytes_sent
    bytes_recv = current_global_net_io.bytes_recv - last_global_net_io.bytes_recv
    download_speed_mbs = (bytes_recv / duration) / (1024 * 1024) if duration > 0 else 0
    upload_speed_mbs = (bytes_sent / duration) / (1024 * 1024) if duration > 0 else 0
    
    last_global_net_io = current_global_net_io
    last_global_time = current_time

    latency = ping(PING_HOST, unit='ms')
    latency_ms = round(latency) if latency is not None and latency is not False else 999
    efficiency = max(85.0, min(99.9, 99 - (latency_ms / 10)))

    global_stats = {
        "downloadSpeed": round(download_speed_mbs, 1),
        "uploadSpeed": round(upload_speed_mbs, 1),
        "latency": latency_ms,
        "efficiency": round(efficiency, 1)
    }

    # --- 2. NEW: Aggregate Per-Process Stats ---
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

            # Aggregate by process name
            app_name = proc_info['name']
            aggregated_processes[app_name]['downloadSpeed'] += download_speed_kbs
            aggregated_processes[app_name]['uploadSpeed'] += upload_speed_kbs
            aggregated_processes[app_name]['count'] += 1

        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # Clean up cache
    for pid in list(process_io_cache.keys()):
        if pid not in current_pids:
            del process_io_cache[pid]

    # --- 3. Format the final list for the frontend ---
    processes_list = []
    for name, data in aggregated_processes.items():
        processes_list.append({
            # The frontend will now use 'name' as the unique key
            "name": name,
            "downloadSpeed": round(data['downloadSpeed'], 1),
            "uploadSpeed": round(data['uploadSpeed'], 1),
            "pid": f"{data['count']} instance(s)" # Use PID field to show instance count
        })

    # Sort by name for a consistent order
    processes_list.sort(key=lambda x: x['name'].lower())

    return {
        "globalStats": global_stats,
        "processes": processes_list
    }


async def handler(websocket):
    """
    Handles WebSocket connections, running two tasks concurrently for each client:
    1. send_periodic_updates: Pushes data automatically every 2 seconds.
    2. handle_incoming_messages: Listens for on-demand requests like 'rescan'.
    """
    print(f"✅ Frontend connected from {websocket.remote_address}")

    # Task to send updates every 2 seconds
    async def send_periodic_updates():
        try:
            while True:
                stats = await get_aggregated_network_stats()
                await websocket.send(json.dumps(stats))
                await asyncio.sleep(2)
        except websockets.exceptions.ConnectionClosed:
            # Silently exit when connection is closed
            pass
        finally:
            print("Periodic update task stopped.")

    # Task to handle incoming messages (e.g., rescan requests)
    async def handle_incoming_messages():
        try:
            async for message in websocket:
                if message == 'rescan':
                    print(f"Received 'rescan' request from {websocket.remote_address}. Sending fresh data.")
                    # Immediately get and send the latest stats
                    stats = await get_aggregated_network_stats()
                    await websocket.send(json.dumps(stats))
        except websockets.exceptions.ConnectionClosed:
            pass # Connection closed, exit gracefully
        finally:
            print("Incoming message handler stopped.")

    # Run both tasks concurrently
    sender_task = asyncio.create_task(send_periodic_updates())
    receiver_task = asyncio.create_task(handle_incoming_messages())

    # Keep the connection alive until one of the tasks finishes (e.g., due to disconnect)
    done, pending = await asyncio.wait(
        [sender_task, receiver_task],
        return_when=asyncio.FIRST_COMPLETED,
    )

    for task in pending:
        task.cancel()
    
    print(f"❌ Frontend disconnected from {websocket.remote_address}")

async def main():
    print(f"🚀 Starting Aggregated Process Monitor server on ws://{SERVER_ADDRESS}:{SERVER_PORT}")
    async with websockets.serve(handler, SERVER_ADDRESS, SERVER_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    print("To run this script, you need to install psutil, websockets, and ping3:")
    print("pip install psutil websockets ping3")
    print("---------------------------------------------------------")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer shutting down.")
    except OSError as e:
        print(f"\nError starting server: {e}. Is port {SERVER_PORT} already in use?")