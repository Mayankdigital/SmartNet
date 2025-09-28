import asyncio
import json
import random
import time
from websockets.server import serve # type: ignore
from ping3 import ping # type: ignore

# Configuration
TARGET_HOST = "8.8.8.8"  # Google Public DNS or any reliable host
PING_COUNT = 5           # Number of pings to perform per measurement cycle
UPDATE_INTERVAL = 1      # How often to send data over WebSocket (in seconds)
WEBSOCKET_PORT = 8765

# Global state to store the last few latency measurements for jitter calculation
latency_history = []
HISTORY_SIZE = 10

def calculate_network_metrics(host, count):
    """
    Pings the target host multiple times and calculates average latency and jitter.
    """
    latencies = []
    
    # Perform a series of pings
    for _ in range(count):
        # The 'ping' function returns latency in seconds, or False on failure
        delay = ping(host, timeout=1, unit='ms') # Get latency in milliseconds

        if delay is not False and delay is not None:
            latencies.append(delay)
        
        # Small delay between pings to avoid overwhelming the network
        time.sleep(0.1)

    if not latencies:
        # If all pings failed
        return {
            "latency_ms": None,
            "jitter_ms": None,
            "loss_percent": 100.0,
            "success": False
        }
    
    # 1. Average Latency
    avg_latency = sum(latencies) / len(latencies)
    
    # Update latency history for jitter calculation
    latency_history.append(avg_latency)
    if len(latency_history) > HISTORY_SIZE:
        latency_history.pop(0)
    
    # 2. Jitter (Variation in Latency)
    if len(latency_history) > 1:
        # Jitter is the average of the absolute differences between consecutive latencies
        diffs = [abs(latency_history[i] - latency_history[i-1]) 
                 for i in range(1, len(latency_history))]
        jitter = sum(diffs) / len(diffs)
    else:
        jitter = 0.0
        
    # 3. Packet Loss
    success_count = len(latencies)
    total_count = count
    loss_percent = ((total_count - success_count) / total_count) * 100
    
    return {
        "latency_ms": round(avg_latency, 2),
        "jitter_ms": round(jitter, 2),
        "loss_percent": round(loss_percent, 1),
        "success": True
    }

def calculate_network_health(latency, jitter, loss):
    """
    Calculates a network health percentage (0-100) based on metrics.
    """
    # Base health starts at 100
    health = 100
    
    # Penalties (Adjust these weights as needed)
    # Latency: -0.5 points per ms above 50ms
    latency_penalty = max(0, latency - 50) * 0.5
    
    # Jitter: -3 points per ms above 5ms
    jitter_penalty = max(0, jitter - 5) * 3
    
    # Loss: -0.5 points per percentage point of loss
    loss_penalty = loss * 0.5
    
    health = health - latency_penalty - jitter_penalty - loss_penalty
    
    return max(0, min(100, round(health)))

async def time_sync_network_data(websocket, path):
    """
    The main server loop to calculate and broadcast network data.
    """
    print(f"Client connected on {path}")
    
    while True:
        try:
            # 1. Measure raw metrics
            metrics = calculate_network_metrics(TARGET_HOST, PING_COUNT)
            
            if metrics["success"]:
                # 2. Calculate composite health
                health_percent = calculate_network_health(
                    metrics["latency_ms"], 
                    metrics["jitter_ms"], 
                    metrics["loss_percent"]
                )
                
                # 3. Compile the final data package
                network_data = {
                    "latency": metrics["latency_ms"],
                    "jitter": metrics["jitter_ms"],
                    "loss": metrics["loss_percent"],
                    "health": health_percent,
                    # Add a random up/down speed for a dynamic feel
                    "download_speed": round(random.uniform(5.5, 95.5), 1), 
                    "upload_speed": round(random.uniform(2.1, 15.1), 1)
                }
                
                # 4. Broadcast the data
                await websocket.send(json.dumps(network_data))
            
            else:
                # Send a fail-state data package
                fail_data = {
                    "latency": 999,
                    "jitter": 999,
                    "loss": 100.0,
                    "health": 0,
                    "download_speed": 0,
                    "upload_speed": 0
                }
                await websocket.send(json.dumps(fail_data))
                print("Warning: All pings failed. Sending emergency data.")

            # Wait for the next update cycle
            await asyncio.sleep(UPDATE_INTERVAL)
            
        except Exception as e:
            print(f"An error occurred or client disconnected: {e}")
            break

async def main():
    """
    Starts the WebSocket server.
    """
    print(f"Starting real-time network monitor server on ws://127.0.0.1:{WEBSOCKET_PORT}...")
    async with serve(time_sync_network_data, "127.0.0.1", WEBSOCKET_PORT):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer shutting down.")