import os
import sys
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Add backend directory to sys.path if not present
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import asyncio
from core.config import (
    APP_VERSION,
    NEXUSDESK_HOST,
    NEXUSDESK_PORT,
    NEXUSDESK_EDITION,
    NEXUSDESK_SECRET_KEY,
    NEXUSDESK_AUTH_ENABLED,
    FRONTEND_DIST,
    verify_token,
    discover_instances,
    broadcast_event,
)
from services.storage_cleaner import storage_maintenance_watcher
from services.agent_runner import workflow_cron_watcher
from routers import (
    auth,
    fleet,
    models,
    agents,
    tools_mcp,
    memory_wiki,
    workflows,
    chat,
    war_room,
    tts,
    sessions,
    fs,
    system_storage,
)

# Optional Pro / Cloud modules (absent in OSS builds)
try:
    from services.whatsapp_manager import start_whatsapp_watcher, shutdown_whatsapp_bridge
except ImportError:
    start_whatsapp_watcher = None
    shutdown_whatsapp_bridge = None

try:
    from services.gateways import telegram_inbound_watcher
except ImportError:
    telegram_inbound_watcher = None

try:
    from services.chat_agents import chat_agents_cron_loop
except ImportError:
    chat_agents_cron_loop = None

try:
    from routers import self_evolving
except ImportError:
    self_evolving = None

try:
    from routers import gateways
except ImportError:
    gateways = None

try:
    from routers import chat_agents
except ImportError:
    chat_agents = None

# Background Task for Dynamic VPS User Fleet Discovery (BL-SYS-05)
async def fleet_discovery_watcher():
    known_keys = set(discover_instances().keys())
    while True:
        try:
            await asyncio.sleep(10)
            current_instances = discover_instances()
            current_keys = set(current_instances.keys())
            new_keys = current_keys - known_keys
            if new_keys:
                for k in new_keys:
                    inst_data = current_instances[k]
                    await broadcast_event("fleet_discovered", {
                        "key": k,
                        "label": inst_data.get("label", f"{k.capitalize()} Fleet"),
                        "user": inst_data.get("user", k),
                        "badge": inst_data.get("badge", "ACTIVE"),
                        "color": inst_data.get("color", "purple"),
                        "instances": list(current_instances.values())
                    })
                known_keys = current_keys
        except asyncio.CancelledError:
            break
        except Exception:
            pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(fleet_discovery_watcher()),
        asyncio.create_task(war_room.war_room_reminders_watcher()),
        asyncio.create_task(war_room.war_room_queue_drain_watcher()),  # BL-EVO-11
        asyncio.create_task(storage_maintenance_watcher()),  # BL-SYS-57
        asyncio.create_task(workflow_cron_watcher()),
    ]
    if start_whatsapp_watcher:
        tasks.append(asyncio.create_task(start_whatsapp_watcher()))
    if telegram_inbound_watcher:
        tasks.append(asyncio.create_task(telegram_inbound_watcher()))
    if chat_agents_cron_loop:
        tasks.append(asyncio.create_task(chat_agents_cron_loop()))  # BL-EVO-42 / CA-BL-005
    yield
    for t in tasks:
        t.cancel()
    if shutdown_whatsapp_bridge:
        await shutdown_whatsapp_bridge()
    for t in tasks:
        try:
            await t
        except asyncio.CancelledError:
            pass

app = FastAPI(
    title="NexusDesk Mission Control API",
    description="Multi-Instance Agent Aggregator & Virtual Office Floor by Nexus Vantage Labs",
    version=APP_VERSION,
    lifespan=lifespan,
)

# ----------------- Security: CORS & Banner -----------------

print("=" * 76)
print(f"  🚀 NEXUSDESK MISSION CONTROL ({NEXUSDESK_EDITION.upper()} EDITION)")
if NEXUSDESK_AUTH_ENABLED:
    masked_key = f"{NEXUSDESK_SECRET_KEY[:8]}...{NEXUSDESK_SECRET_KEY[-8:]}" if NEXUSDESK_SECRET_KEY else "NONE"
    print(f"  🔐 Master Authentication: ACTIVE")
    print(f"  🔑 Secret Key: {masked_key}")
    print(f"  🌐 1-Click Fast Unlock URL: http://{NEXUSDESK_HOST}:{NEXUSDESK_PORT}/?token={NEXUSDESK_SECRET_KEY}")
else:
    print("  🔓 Master Authentication: INACTIVE (Development Mode - Option in Menu)")
print("=" * 76)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://127.0.0.1:{NEXUSDESK_PORT}",
        f"http://localhost:{NEXUSDESK_PORT}",
        "http://127.0.0.1:9200",
        "http://localhost:9200",
        "http://127.0.0.1",
        "http://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ----------------- Security & Anti-Cache Middleware -----------------

@app.middleware("http")
async def auth_and_cache_middleware(request: Request, call_next):
    path = request.url.path

    # Check auth for protected API routes
    if path.startswith("/api/") and path not in ("/api/auth/status", "/api/auth/verify", "/api/auth/toggle"):
        auth_header = request.headers.get("Authorization")
        token = None
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif request.headers.get("X-NexusDesk-Token"):
            token = request.headers.get("X-NexusDesk-Token").strip()
        elif "token" in request.query_params:
            token = request.query_params.get("token").strip()

        if not verify_token(token):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "detail": "Unauthorized: Invalid or missing NexusDesk secret key",
                    "auth_required": True,
                    "recovery_hint": "cat /home/myvirtualcoder/nexusdesk/.env | grep NEXUSDESK_SECRET_KEY"
                }
            )

    response = await call_next(request)

    # Prevent aggressive mobile browser 304 caching of index.html & API responses
    if path == "/" or path.endswith(".html") or path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response

# ----------------- Routers Registration -----------------

app.include_router(auth.router)
app.include_router(fleet.router)
app.include_router(models.router)
app.include_router(agents.router)
app.include_router(tools_mcp.router)
app.include_router(memory_wiki.router)
app.include_router(workflows.router)
app.include_router(chat.router)
app.include_router(war_room.router)
app.include_router(tts.router)
app.include_router(sessions.router)
app.include_router(fs.router)
app.include_router(system_storage.router)
if self_evolving:
    app.include_router(self_evolving.router)
if gateways:
    app.include_router(gateways.router)
if chat_agents:
    app.include_router(chat_agents.router)

# Extension / Plugin Hook for external Pro/Cloud routers
_plugins_dir = BACKEND_DIR / "plugins"
if _plugins_dir.is_dir():
    import importlib
    for _pf in sorted(_plugins_dir.glob("*.py")):
        if _pf.name.startswith("_"):
            continue
        try:
            _mod = importlib.import_module(f"plugins.{_pf.stem}")
            if hasattr(_mod, "register"):
                _mod.register(app)
        except Exception as _pe:
            print(f"[PLUGINS] Failed to load plugin {_pf.name}: {_pe}")

# ----------------- Static Frontend Mount -----------------

if FRONTEND_DIST.exists():
    @app.get("/")
    def serve_index():
        return FileResponse(
            FRONTEND_DIST / "index.html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    @app.get("/")
    def index():
        return {"message": f"NexusDesk API running on port {NEXUSDESK_PORT}."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=NEXUSDESK_HOST, port=NEXUSDESK_PORT)
