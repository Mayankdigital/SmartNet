# monitor/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer # type: ignore
import traceback 

class NetworkConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.group_name = 'network_data'
        await self.channel_layer.group_add( self.group_name, self.channel_name )
        print(f"WS connected: {self.channel_name}, joined {self.group_name}")
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard( self.group_name, self.channel_name )
        print(f"WS disconnected: {self.channel_name}, left {self.group_name}. Code: {close_code}")

    async def receive(self, text_data):
        print(f"\n>>> Consumer RX from client: {text_data}\n")
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'hotspot_toggle':
                print(f"Consumer fwd hotspot_toggle: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.toggle", "state": data.get('state', False)} )
            elif message_type == 'set_usage_period':
                print(f"Consumer fwd set_usage_period: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.set_period", "period": data.get('period', '24h')} )
            elif message_type == 'set_hotspot_settings':
                print(f"Consumer fwd set_hotspot_settings: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.set_settings", "ssid": data.get('ssid'), "password": data.get('password')} )
            elif message_type == 'set_limit':
                print(f"Consumer fwd set_limit: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.set_limit", "ip": data.get('ip'), "download": data.get('download'), "upload": data.get('upload'), "priority": data.get('priority')} )
            elif message_type == 'set_quota':
                print(f"Consumer fwd set_quota: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.set_quota", "ip": data.get('ip'), "download_mb": data.get('download_mb'), "upload_mb": data.get('upload_mb'), "period": data.get('period')} )
            elif message_type == 'remove_limit':
                print(f"Consumer fwd remove_limit: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.remove_limit", "ip": data.get('ip')} )
            elif message_type == 'remove_quota':
                print(f"Consumer fwd remove_quota: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.remove_quota", "ip": data.get('ip')} )

            # --- Schedule Messages ---
            elif message_type == 'save_schedule':
                 print(f"Consumer fwd save_schedule") # Don't log full data potentially
                 await self.channel_layer.group_send( "hotspot_commands", {"type": "command.save_schedule", "schedule": data.get('schedule')} )
            elif message_type == 'delete_schedule':
                 print(f"Consumer fwd delete_schedule: {data}")
                 await self.channel_layer.group_send( "hotspot_commands", {"type": "command.delete_schedule", "id": data.get('id')} )
            elif message_type == 'toggle_schedule':
                 print(f"Consumer fwd toggle_schedule: {data}")
                 await self.channel_layer.group_send( "hotspot_commands", {"type": "command.toggle_schedule", "id": data.get('id'), "enabled": data.get('enabled')} )

            # --- Request Messages (Modified) ---
            elif message_type == 'request_schedules':
                 print(f"Consumer fwd request_schedules")
                 await self.channel_layer.group_send( "hotspot_commands", {"type": "command.request_schedules"} )
            elif message_type == 'request_devices':
                 print(f"Consumer fwd request_devices")
                 # Send to daemon, which will reply directly to our channel_name
                 await self.channel_layer.group_send( "hotspot_commands", {"type": "command.request_devices", "channel_name": self.channel_name} )
            
            # --- *** NEW: Forecast Handler *** ---
            elif message_type == 'request_forecast':
                 print(f"Consumer fwd request_forecast")
                 await self.channel_layer.group_send( 
                    "hotspot_commands", 
                    {"type": "command.request_forecast", "channel_name": self.channel_name} 
                 )

            # --- NEW: Security Messages ---
            elif message_type == 'request_security_state':
                print(f"Consumer fwd request_security_state")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.request_security_state", "channel_name": self.channel_name} )
            
            elif message_type == 'set_client_isolation':
                print(f"Consumer fwd set_client_isolation: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.set_client_isolation", "enabled": data.get('enabled')} )

            elif message_type == 'set_ac_mode':
                print(f"Consumer fwd set_ac_mode: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.set_ac_mode", "mode": data.get('mode')} )
            
            elif message_type == 'add_mac':
                print(f"Consumer fwd add_mac: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.add_mac", "mac": data.get('mac'), "list_type": data.get('list_type')} )
            
            elif message_type == 'remove_mac':
                print(f"Consumer fwd remove_mac: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.remove_mac", "mac": data.get('mac')} )
            
            # --- *** NEW: IP Block Handlers *** ---
            elif message_type == 'add_ip_block':
                print(f"Consumer fwd add_ip_block: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.add_ip_block", "ip_range": data.get('ip_range')} )
            
            elif message_type == 'remove_ip_block':
                print(f"Consumer fwd remove_ip_block: {data}")
                await self.channel_layer.group_send( "hotspot_commands", {"type": "command.remove_ip_block", "ip_range": data.get('ip_range')} )
            # --- *** End of NEW *** ---

            else:
                 print(f"Warning: Consumer RX unknown type: {message_type}")

        except json.JSONDecodeError: print(f"Error: RX invalid JSON: {text_data}")
        except Exception as e: print(f"Error processing RX message: {e}"); traceback.print_exc()

    # --- Standard Handlers (from daemon to frontend) ---
    async def network_data_message(self, event):
        try: await self.send(text_data=json.dumps(event['data']))
        except Exception as e: print(f"Error sending network_data_message: {e}")

    async def notification_message(self, event):
        print(f"Consumer sending notification: {event}")
        try: await self.send(text_data=json.dumps({"type": "notification", "status": event.get('status'), "message": event.get('message')}))
        except Exception as e: print(f"Error sending notification_message: {e}")

    # --- Handlers for Schedule/Device Lists ---
    async def schedules_list(self, event):
        """ Sends the list of schedules directly back to the requesting client. (Likely unused, but kept for compatibility) """
        print(f"Consumer sending schedules.list ({len(event.get('schedules', []))} items)")
        try: await self.send(text_data=json.dumps({"type": "schedules_list", "schedules": event.get('schedules', [])}))
        except Exception as e: print(f"Error sending schedules.list: {e}")
    
    async def schedules_update(self, event):
        """ Sends updated schedules list to ALL clients (broadcast). """
        print(f"Consumer broadcasting schedules.update ({len(event.get('schedules', []))} items)")
        try: 
            # Note: The JS client expects 'schedules_list' as the type
            await self.send(text_data=json.dumps({"type": "schedules_list", "schedules": event.get('schedules', [])}))
        except Exception as e: 
            print(f"Error sending schedules.update: {e}")

    async def devices_list(self, event):
        """ Sends the list of devices directly back to the requesting client. """
        print(f"Consumer sending devices.list ({len(event.get('devices', []))} items)")
        try: await self.send(text_data=json.dumps({"type": "devices_list", "devices": event.get('devices', [])}))
        except Exception as e: print(f"Error sending devices.list: {e}")
    
    # --- *** NEW: Forecast Data Handler *** ---
    async def forecast_data(self, event):
        """ Sends the forecast data directly back to the requesting client. """
        print(f"Consumer sending forecast.data ({len(event.get('forecast', []))} items)")
        try: 
            await self.send(text_data=json.dumps({
                "type": "forecast_data", 
                "forecast": event.get('forecast', [])
            }))
        except Exception as e: 
            print(f"Error sending forecast.data: {e}")
    
    # --- NEW: Security State Handler ---
    async def security_state_update(self, event):
        """ Sends the full security state (broadcast or direct reply). """
        print(f"Consumer sending security.state.update")
        # Remove 'type' from event before sending, as the JS client expects the type to be the key
        event_data = event.copy()
        event_data['type'] = 'security_state_update'
        try:
            await self.send(text_data=json.dumps(event_data))
        except Exception as e:
            print(f"Error sending security.state.update: {e}")