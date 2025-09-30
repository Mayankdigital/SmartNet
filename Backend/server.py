import asyncio
import json
import psutil
import websockets
from ping3 import ping

# --- Configuration ---
# The address and port for the WebSocket server to run on.
# 'localhost' means it will only be accessible from your own computer.
SERVER_ADDRESS = "localhost"
SERVER_PORT = 8765
# The host to ping to measure latency. A reliable server is best.
PING_HOST = "8.8.8.8" # Google's public DNS

# Store the last known network I/O stats to calculate the speed.
last_net_io = psutil.net_io_counters()

async def get_network_stats():
    """
    Calculates network download/upload speed, latency, and efficiency.
    """
    global last_net_io

    # --- Calculate Download/Upload Speed ---
    current_net_io = psutil.net_io_counters()

    # Bytes sent and received since the last check
    bytes_sent = current_net_io.bytes_sent - last_net_io.bytes_sent
    bytes_recv = current_net_io.bytes_recv - last_net_io.bytes_recv

    # Update the last known stats for the next calculation
    last_net_io = current_net_io

    # Convert bytes per second to Megabytes per second (MB/s)
    # We assume the check runs every 2 seconds, so we divide by 2.
    download_speed_mbs = (bytes_recv / 1024 / 1024) / 2
    upload_speed_mbs = (bytes_sent / 1024 / 1024) / 2

    # --- Measure Latency (Ping) ---
    latency = ping(PING_HOST, unit='ms')

    if latency is None or latency is False:
        # Handle cases where the ping fails
        latency_ms = 999
        efficiency = 0
    else:
        latency_ms = round(latency)
        # Define a simple efficiency metric based on latency
        if latency_ms < 50:
            efficiency = 99.0 + (50 - latency_ms) / 50.0
        elif latency_ms < 150:
            efficiency = 95.0 - (latency_ms - 50) / 100.0 * 5.0
        else:
            efficiency = 90.0 - (latency_ms - 150) / 100.0 * 10.0
        efficiency = max(85.0, min(99.9, efficiency)) # Clamp the value

    return {
        "downloadSpeed": round(download_speed_mbs, 1),
        "uploadSpeed": round(upload_speed_mbs, 1),
        "latency": latency_ms,
        "efficiency": round(efficiency, 1)
    }

async def handler(websocket):
    """
    The main WebSocket handler. It sends stats every 2 seconds.
    """
    print(f"✅ Client connected from {websocket.remote_address}")
    try:
        while True:
            stats = await get_network_stats()
            await websocket.send(json.dumps(stats))
            await asyncio.sleep(2) # Send updates every 2 seconds
    except websockets.exceptions.ConnectionClosed:
        print(f"❌ Client disconnected from {websocket.remote_address}")
    except Exception as e:
        print(f"An error occurred: {e}")

async def main():
    """
    Starts the WebSocket server.
    """
    print(f"🚀 Starting WebSocket server on ws://{SERVER_ADDRESS}:{SERVER_PORT}")
    async with websockets.serve(handler, SERVER_ADDRESS, SERVER_PORT):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Server shutting down.")