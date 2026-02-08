#!/usr/bin/env python3
"""
Remote File Manager Server
Central server that Android devices connect to
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Set

import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(title="Remote File Manager")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store connected devices
connected_devices: Dict[str, WebSocket] = {}
device_info: Dict[str, dict] = {}
admin_connections: Set[WebSocket] = set()


class ConnectionManager:
    """Manages WebSocket connections for devices and admin"""

    def __init__(self):
        self.active_devices: Dict[str, WebSocket] = {}
        self.device_info: Dict[str, dict] = {}
        self.admin_connections: Set[WebSocket] = set()

    async def connect_device(self, device_id: str, websocket: WebSocket, info: dict):
        """Connect a new Android device"""
        self.active_devices[device_id] = websocket
        self.device_info[device_id] = {
            **info,
            'connected_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'status': 'online'
        }
        logger.info(f"Device {device_id} connected from {info.get('ip', 'unknown')}")
        await self.broadcast_to_admins()

    async def disconnect_device(self, device_id: str):
        """Disconnect a device"""
        if device_id in self.active_devices:
            del self.active_devices[device_id]
            if device_id in self.device_info:
                self.device_info[device_id]['status'] = 'offline'
            logger.info(f"Device {device_id} disconnected")
            await self.broadcast_to_admins()

    async def connect_admin(self, websocket: WebSocket):
        """Connect an admin web panel"""
        self.admin_connections.add(websocket)
        await self.send_device_list(websocket)

    async def disconnect_admin(self, websocket: WebSocket):
        """Disconnect an admin"""
        self.admin_connections.discard(websocket)

    async def send_to_device(self, device_id: str, message: dict) -> bool:
        """Send message to specific device"""
        if device_id in self.active_devices:
            try:
                await self.active_devices[device_id].send_text(json.dumps(message))
                return True
            except Exception as e:
                logger.error(f"Error sending to device {device_id}: {e}")
                await self.disconnect_device(device_id)
        return False

    async def broadcast_to_admins(self):
        """Send device list to all connected admins"""
        devices_list = []
        for device_id, info in self.device_info.items():
            devices_list.append({
                'id': device_id,
                'ip': info.get('ip', 'unknown'),
                'device_name': info.get('device_name', 'Unknown'),
                'android_version': info.get('android_version', 'unknown'),
                'connected_at': info.get('connected_at', 'unknown'),
                'status': info.get('status', 'offline')
            })

        message = {
            'type': 'connections_update',
            'connections': devices_list
        }

        # Send to all admin connections
        disconnected_admins = set()
        for admin_ws in self.admin_connections:
            try:
                await admin_ws.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Error sending to admin: {e}")
                disconnected_admins.add(admin_ws)

        # Remove disconnected admins
        for admin_ws in disconnected_admins:
            self.admin_connections.discard(admin_ws)

    async def send_device_list(self, websocket: WebSocket):
        """Send current device list to a newly connected admin"""
        devices_list = []
        for device_id, info in self.device_info.items():
            devices_list.append({
                'id': device_id,
                'ip': info.get('ip', 'unknown'),
                'device_name': info.get('device_name', 'Unknown'),
                'android_version': info.get('android_version', 'unknown'),
                'connected_at': info.get('connected_at', 'unknown'),
                'status': info.get('status', 'offline')
            })

        message = {
            'type': 'connections_update',
            'connections': devices_list
        }
        await websocket.send_text(json.dumps(message))

    async def forward_to_admin(self, device_id: str, message: dict):
        """Forward message from device to admins"""
        message['device_id'] = device_id
        for admin_ws in self.admin_connections:
            try:
                await admin_ws.send_text(json.dumps(message))
            except Exception:
                pass


manager = ConnectionManager()


@app.get("/")
async def get_web_panel():
    """Serve the web panel"""
    web_path = Path(__file__).parent / "web"
    index_file = web_path / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(encoding='utf-8'))
    return HTMLResponse(content="<h1>Remote File Manager</h1><p>Web panel not found. Create web/index.html</p>")


@app.websocket("/ws/admin")
async def websocket_admin_endpoint(websocket: WebSocket):
    """WebSocket endpoint for admin web panel"""
    await websocket.accept()
    await manager.connect_admin(websocket)
    logger.info("Admin connected")

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            # Handle different message types from admin
            if message.get('type') == 'list_files':
                # Forward to device
                device_id = message.get('device_id')
                success = await manager.send_to_device(device_id, message)
                if not success:
                    await websocket.send_text(json.dumps({
                        'type': 'error',
                        'message': f'Device {device_id} not connected'
                    }))

            elif message.get('type') == 'download_file':
                await manager.send_to_device(message.get('device_id'), message)

            elif message.get('type') == 'upload_file':
                await manager.send_to_device(message.get('device_id'), message)

            elif message.get('type') == 'delete':
                await manager.send_to_device(message.get('device_id'), message)

            elif message.get('type') == 'create_dir':
                await manager.send_to_device(message.get('device_id'), message)

            elif message.get('type') == 'move':
                await manager.send_to_device(message.get('device_id'), message)

            elif message.get('type') == 'compress':
                await manager.send_to_device(message.get('device_id'), message)

            elif message.get('type') == 'get_device_info':
                await manager.send_to_device(message.get('device_id'), message)

    except WebSocketDisconnect:
        manager.disconnect_admin(websocket)
        logger.info("Admin disconnected")
    except Exception as e:
        logger.error(f"Error in admin websocket: {e}")
        manager.disconnect_admin(websocket)


@app.websocket("/ws/device")
async def websocket_device_endpoint(websocket: WebSocket):
    """WebSocket endpoint for Android devices"""
    await websocket.accept()

    # Get client info
    client_host = websocket.client.host if websocket.client else "unknown"

    # Wait for device registration
    try:
        data = await websocket.receive_text()
        register_msg = json.loads(data)

        if register_msg.get('type') == 'device_register':
            device_id = register_msg.get('device_id', str(uuid.uuid4()))
            device_info = {
                'device_name': register_msg.get('device_name', 'Unknown Device'),
                'android_version': register_msg.get('android_version', 'unknown'),
                'sdk_version': register_msg.get('sdk_version', 'unknown'),
                'ip': client_host,
                'api_key': register_msg.get('api_key', '')
            }

            await manager.connect_device(device_id, websocket, device_info)

            # Send registration confirmation
            await websocket.send_text(json.dumps({
                'type': 'registered',
                'device_id': device_id
            }))

            # Handle messages from device
            try:
                while True:
                    data = await websocket.receive_text()
                    message = json.loads(data)

                    # Forward responses to admin
                    await manager.forward_to_admin(device_id, message)

            except WebSocketDisconnect:
                await manager.disconnect_device(device_id)
            except Exception as e:
                logger.error(f"Error handling device messages: {e}")
                await manager.disconnect_device(device_id)

    except Exception as e:
        logger.error(f"Error in device websocket: {e}")
        await websocket.close()


@app.get("/api/devices")
async def get_devices():
    """REST API endpoint to get list of devices"""
    devices_list = []
    for device_id, info in manager.device_info.items():
        devices_list.append({
            'id': device_id,
            'ip': info.get('ip', 'unknown'),
            'device_name': info.get('device_name', 'Unknown'),
            'android_version': info.get('android_version', 'unknown'),
            'connected_at': info.get('connected_at', 'unknown'),
            'status': info.get('status', 'offline')
        })
    return {'devices': devices_list}


def main():
    import uvicorn

    print("""
    ╔══════════════════════════════════════════════════════════════╗
    ║          Remote File Manager Server                         ║
    ║                                                              ║
    ║  Web Panel:  http://localhost:8000                          ║
    ║  Device WS:  ws://localhost:8000/ws/device                  ║
    ║  Admin WS:   ws://localhost:8000/ws/admin                   ║
    ╚══════════════════════════════════════════════════════════════╝
    """)

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )


if __name__ == "__main__":
    main()
