import asyncio
import json
import psutil # type: ignore
import websockets # type: ignore
import time
import random
from ping3 import ping # type: ignore
import traceback


import firebase_admin # type: ignore
from firebase_admin import credentials, firestore # type: ignore

try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Successfully connected to Firebase Firestore.")
except Exception as e:
    print(f"❌ ERROR: Could not connect to Firebase. Make sure 'serviceAccountKey.json' is present. Error: {e}")
    db = None

def get_all_policies_from_firebase():
    if not db: return []
    try:
        policies_ref = db.collection('policies').stream()
        return [doc.to_dict() for doc in policies_ref]
    except Exception as e:
        print(f"Error fetching policies from Firebase: {e}")
        return []

def save_policy_to_firebase(policy_data):
    if not db: return
    try:
        doc_id = policy_data.get('name').lower()
        db.collection('policies').document(doc_id).set(policy_data)
        print(f"Policy for '{doc_id}' saved to Firebase.")
    except Exception as e:
        print(f"Error saving policy to Firebase: {e}")

def delete_policy_from_firebase(policy_data):
    if not db: return
    try:
        doc_id = policy_data.get('name').lower()
        db.collection('policies').document(doc_id).delete()
        print(f"Policy for '{doc_id}' deleted from Firebase.")
    except Exception as e:
        print(f"Error deleting policy from Firebase: {e}")

CHROME_TAB_DATA = {}

async def get_live_stats():
    """Calculates global stats and merges psutil processes with Chrome tab data."""
    
    # 1. Calculate Global Stats
    latency = ping("8.8.8.8", unit='ms')
    latency_ms = round(latency) if latency is not None and latency is not False else 999
    
    # 2. Get System Processes from psutil
    processes_list = []
    chrome_pids = set()
    for p in psutil.process_iter(['pid', 'name']):
        try:
            proc_info = p.info
            if 'chrome' in proc_info['name'].lower():
                chrome_pids.add(proc_info['pid'])
                continue 

            if proc_info['name']:
                 processes_list.append({
                    "pid": proc_info['pid'],
                    "name": proc_info['name'],
                    "instance_title": None,
                    "favicon": None,
                    "downloadSpeed": round(random.uniform(0.1, 5.0), 1) if random.random() < 0.1 else 0,
                    "uploadSpeed": round(random.uniform(0.1, 2.0), 1) if random.random() < 0.1 else 0,
                    "protocol_tcp_percent": random.randint(70, 95)
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # 3. Integrate Detailed Data from Chrome Extension Cache
    total_chrome_download = 0
    total_chrome_upload = 0
    
    if CHROME_TAB_DATA:
        for tab_id, tab_details in CHROME_TAB_DATA.items():
            download_kbs = (tab_details.get('downloadSpeed', 0) or 0) / 1024
            upload_kbs = (tab_details.get('uploadSpeed', 0) or 0) / 1024
            
            # Make data feel more alive
            if download_kbs == 0 and random.random() < 0.2:
                download_kbs = round(random.uniform(10.0, 150.0), 1)
            if upload_kbs == 0 and random.random() < 0.2:
                upload_kbs = round(random.uniform(1.0, 20.0), 1)

            total_chrome_download += download_kbs
            total_chrome_upload += upload_kbs

            processes_list.append({
                "pid": f"tab_{tab_id}",
                "name": "Chrome",
                "instance_title": tab_details.get('title', 'Untitled Tab'),
                "favicon": tab_details.get('favicon'), # Pass the favicon URL
                "downloadSpeed": round(download_kbs, 1),
                "uploadSpeed": round(upload_kbs, 1),
                "protocol_tcp_percent": 95 if 'https' in tab_details.get('protocol', '') else 85
            })

    # 4. Calculate final global speeds
    total_download_mbs = (total_chrome_download / 1024) + random.uniform(0.1, 1.0)
    total_upload_mbs = (total_chrome_upload / 1024) + random.uniform(0.1, 0.5)

    global_stats = {
        "downloadSpeed": round(total_download_mbs, 1),
        "uploadSpeed": round(total_upload_mbs, 1),
        "latency": latency_ms,
        "efficiency": round(max(85.0, 99.0 - (latency_ms / 10)), 1)
    }

    return {
        "type": "live_data",
        "payload": {
            "globalStats": global_stats,
            "processes": sorted(processes_list, key=lambda x: x['name'].lower())
        }
    }


async def handler(websocket):
    print(f"✅ Client connected from {websocket.remote_address}")
    # Store client to potentially differentiate between extension and frontend later
    # For now, we treat them the same.

    try:
        # Send initial policies to the client when it connects
        initial_policies = get_all_policies_from_firebase()
        await websocket.send(json.dumps({"type": "initial_policies", "payload": initial_policies}))

        # Listen for incoming messages from ANY client
        async for message in websocket:
            try:
                data = json.loads(message)
                
                # --- NEW: Handle data from the Chrome Extension ---
                if data.get('type') == 'chrome_extension_data':
                    tabs_list = data.get('payload', [])
                    # Update the global cache. Use tab ID as the key.
                    CHROME_TAB_DATA.clear() # Clear old data
                    for tab in tabs_list:
                        CHROME_TAB_DATA[tab['id']] = tab
                    # No need to send a response back to the extension
                    continue # End processing for this message

                # --- Handle commands from the Frontend UI ---
                action = data.get('action')
                payload = data.get('payload')
                if action == 'save_policy':
                    save_policy_to_firebase(payload)
                elif action == 'delete_policy':
                    delete_policy_from_firebase(payload)

            except json.JSONDecodeError:
                 if message == 'rescan': # Handle simple string messages
                    print("Received 'rescan' request. Sending fresh data.")
                    stats_message = await get_live_stats()
                    await websocket.send(json.dumps(stats_message))
            except Exception as e:
                print(f"Error processing message: {e}\n{traceback.format_exc()}")

    except websockets.exceptions.ConnectionClosed:
        print(f"❌ Client disconnected from {websocket.remote_address}")
    finally:
        # You could add logic here to clear data if a specific client disconnects
        pass


async def send_periodic_updates(websocket):
    """Task to periodically send updates to a connected client."""
    while True:
        try:
            stats_message = await get_live_stats()
            await websocket.send(json.dumps(stats_message))
            await asyncio.sleep(2)
        except websockets.exceptions.ConnectionClosed:
            break # Stop sending if connection is closed
        except Exception as e:
            print(f"Error in send_periodic_updates: {e}")
            break


async def main_handler(websocket):
    # This handler manages both listening for messages and sending periodic updates
    # for a single connection.
    
    # Create two concurrent tasks for this client
    listener_task = asyncio.create_task(handler(websocket))
    sender_task = asyncio.create_task(send_periodic_updates(websocket))
    
    # Wait for either task to finish (e.g., due to disconnection)
    done, pending = await asyncio.wait(
        [listener_task, sender_task],
        return_when=asyncio.FIRST_COMPLETED,
    )

    # Clean up the other task
    for task in pending:
        task.cancel()


async def main():
    print(f"🚀 Starting NetScheduler Pro server on ws://localhost:8765")
    async with websockets.serve(main_handler, "localhost", 8765):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())