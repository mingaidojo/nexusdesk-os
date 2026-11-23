import os
import time
import json
import re
import uuid
import asyncio
import subprocess
import shutil
from pathlib import Path
from typing import Optional, List, Dict, Any
import yaml
from fastapi import APIRouter, Request, Query, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from core.config import (
    resolve_instance_key,
    get_instance_user_context,
    safe_path_exists,
    broadcast_event,
    chat_history,
    connected_websockets,
    verify_token,
    set_instance_perms,
    NEXUSDESK_AUTH_ENABLED,
    resolve_fleet_primary_engine,
    get_engine_active_model,
    get_agent_override_model,
    normalize_agy_model_slug,
    AGENT_SUBPROCESS_TIMEOUT
)
from services.war_room.reminders import parse_natural_timeout_directive
from services.cli_executor import run_agent_cli, find_engine_binary, kill_room_agent_proc
from schemas.models import ChatRequest, ChatClearRequest, AgentShoutRequest

router = APIRouter(tags=["chat_simulation"])
ACTIVE_DIRECT_CHAT_TASKS: Dict[str, set] = {}

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
SHARED_UPLOADS_DIR = Path("/home/nexus_shared/uploads")
SANDBOX_BASE_DIR = Path("/home/nexus_shared/sandboxes")
try:
    SHARED_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(SHARED_UPLOADS_DIR, 0o777)
except Exception:
    pass

# BL-CHAT-31 & BL-WAR-10: Multi-File Batch Upload & Storage Quota Guardrails
MAX_BATCH_FILES = 5                    # Max 5 files per message batch
MAX_UPLOAD_SIZE = 100 * 1024 * 1024    # 100 MB max per individual file
MAX_BATCH_TOTAL_SIZE = 250 * 1024 * 1024  # 250 MB max total batch payload per message
UPLOAD_TTL_SECONDS = 14 * 86400        # 14 days retention window

# Any file extension is allowed in chat and warroom (no whitelist restriction)
BLOCKED_UPLOAD_EXTS = set()

def cleanup_stale_uploads():
    """Purge files older than 14 days from uploads storage."""
    now = time.time()
    for d in (UPLOADS_DIR, SHARED_UPLOADS_DIR):
        if not d.exists():
            continue
        try:
            for f in d.iterdir():
                if f.is_file() and (now - f.stat().st_mtime > UPLOAD_TTL_SECONDS):
                    try:
                        f.unlink()
                    except Exception:
                        pass
        except Exception as e:
            print(f"[CHAT_UPLOAD] Error running cleanup in {d}: {e}")

@router.post("/api/chat/upload")
async def upload_chat_file(
    file: Optional[UploadFile] = File(None),
    files: Optional[List[UploadFile]] = File(None),
    room_id: Optional[str] = Form(None)
):
    cleanup_stale_uploads()

    incoming: List[UploadFile] = []
    if files:
        incoming.extend([f for f in files if f and f.filename])
    if file and file.filename and file not in incoming:
        incoming.append(file)

    if not incoming:
        raise HTTPException(status_code=400, detail="No file(s) provided for upload.")

    if len(incoming) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Batch upload limit exceeded: maximum {MAX_BATCH_FILES} files per message (received {len(incoming)})."
        )

    total_batch_bytes = 0
    validated_payloads: List[Dict[str, Any]] = []

    for up in incoming:
        original_name = Path(up.filename).name
        ext = Path(original_name).suffix.lower()

        # Any file type allowed without restriction
        if BLOCKED_UPLOAD_EXTS and ext in BLOCKED_UPLOAD_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"File '{original_name}' extension {ext} is blocked."
            )

        contents = await up.read()
        f_size = len(contents)
        if f_size > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File '{original_name}' ({round(f_size / (1024 * 1024), 2)} MB) exceeds maximum per-file limit ({round(MAX_UPLOAD_SIZE / (1024 * 1024))} MB)."
            )

        total_batch_bytes += f_size
        if total_batch_bytes > MAX_BATCH_TOTAL_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Total batch payload ({round(total_batch_bytes / (1024 * 1024), 2)} MB) exceeds maximum batch limit ({round(MAX_BATCH_TOTAL_SIZE / (1024 * 1024))} MB)."
            )

        validated_payloads.append({
            "original_name": original_name,
            "ext": ext,
            "contents": contents,
            "size": f_size
        })

    # Determine shared destination directory so all multi-user CLI/Hermes agents have read access
    safe_rid = re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "").strip()) if room_id else ""
    if safe_rid:
        shared_dest_dir = SANDBOX_BASE_DIR / safe_rid / "scratch"
    else:
        shared_dest_dir = SHARED_UPLOADS_DIR
    try:
        shared_dest_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(shared_dest_dir, 0o777)
    except Exception:
        pass

    uploaded_records: List[Dict[str, Any]] = []
    ts_prefix = int(time.time())

    for idx, item in enumerate(validated_payloads):
        original_name = item["original_name"]
        ext = item["ext"]
        contents = item["contents"]
        clean_fname = re.sub(r'[^a-zA-Z0-9._\-]', '_', original_name)
        stored_name = f"{ts_prefix}_{idx + 1}_{clean_fname}" if len(validated_payloads) > 1 else f"{ts_prefix}_{clean_fname}"

        target_path = UPLOADS_DIR / stored_name
        with open(target_path, "wb") as f:
            f.write(contents)

        # Also mirror into /home/nexus_shared so cross-fleet agents can read it directly AND BL-FILE-12 Quick-View can preview it
        shared_file_path = shared_dest_dir / stored_name
        local_agent_path = str(target_path)
        try:
            with open(shared_file_path, "wb") as sf:
                sf.write(contents)
            os.chmod(shared_file_path, 0o666)
            local_agent_path = str(shared_file_path)
        except Exception:
            pass

        download_url = f"/api/chat/files/{stored_name}"
        is_image = ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}

        uploaded_records.append({
            "filename": original_name,
            "stored_name": stored_name,
            "url": download_url,
            "is_image": is_image,
            "size": item["size"],
            "local_path": local_agent_path
        })

    first = uploaded_records[0]
    return {
        "status": "uploaded",
        "count": len(uploaded_records),
        "total_size": total_batch_bytes,
        "files": uploaded_records,
        # Top-level single-file fields for backward compatibility
        "filename": first["filename"],
        "stored_name": first["stored_name"],
        "url": first["url"],
        "is_image": first["is_image"],
        "size": first["size"],
        "local_path": first["local_path"]
    }

@router.get("/api/chat/files/{filename}")
async def get_uploaded_chat_file(filename: str):
    safe_name = Path(filename).name
    file_path = UPLOADS_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=safe_name)

@router.post("/api/simulation/shout")
async def trigger_agent_shout(req: AgentShoutRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    payload = {
        "agent": req.agent.strip(),
        "message": req.message.strip(),
        "category": req.category or "info",
        "duration": req.duration or 7,
        "announce_tts": req.announce_tts,
        "instance": inst_key,
        "timestamp": time.time()
    }
    
    # Broadcast to all live WebSockets (AgentFloor canvas + Chat Console)
    await broadcast_event("agent_shout", payload)
    
    # Also record in chat history as an activity shout if needed
    hist_key = f"{inst_key}:{req.agent.strip().lower()}"
    if hist_key not in chat_history:
        chat_history[hist_key] = []
    chat_history[hist_key].append({
        "sender": req.agent.strip(),
        "text": f"📢 *[Status Update]* {req.message.strip()}",
        "category": req.category,
        "timestamp": time.time()
    })
    
    return {"status": "shout_broadcasted", "data": payload}

@router.post("/api/simulation/briefing")
async def trigger_simulation_briefing():
    await broadcast_event("briefing_start", {
        "leader": "Solaris",
        "topic": "Mission Briefing: Daily Fleet Operations",
        "timestamp": time.time()
    })
    
    async def _end():
        await asyncio.sleep(8)
        await broadcast_event("briefing_end", {"timestamp": time.time()})
        
    asyncio.create_task(_end())
    return {"status": "briefing_initiated"}

@router.post("/api/simulation/gossip")
async def trigger_simulation_gossip():
    await broadcast_event("gossip_start", {
        "agents": ["Scribe", "Chorusius"],
        "location": "water_cooler",
        "quote": "Did you see the new fallback chain? Nous Ling 3.1 Flash is lightning fast!",
        "timestamp": time.time()
    })
    return {"status": "gossip_initiated"}

_live_activity_cache: Dict[str, Dict[str, Any]] = {}
_LIVE_ACTIVITY_TTL_SEC = 5.0

def get_real_hermes_activity(inst_key: str = "agents_bs"):
    now = time.time()
    cached = _live_activity_cache.get(inst_key)
    if cached and (now - cached.get("timestamp", 0)) < _LIVE_ACTIVITY_TTL_SEC:
        return cached

    active_agents = {}
    recent_events = []
    ctx = get_instance_user_context(inst_key)
    
    # 1. Process scan under instance user
    try:
        ps_out = subprocess.run(['ps', '-u', ctx['user'], '-o', 'pid,args'], capture_output=True, text=True, timeout=2).stdout
        for line in ps_out.strip().split('\n')[1:]:
            parts = line.strip().split(None, 1)
            if len(parts) > 1:
                cmd = parts[1]
                if 'plate_batch' in cmd or 'instagram' in cmd:
                    active_agents['Chroma'] = {'state': 'working', 'action': 'Rendering slide plates (dailydose)', 'last_seen_sec': 0}
                    active_agents['Solaris'] = {'state': 'working', 'action': 'Orchestrating dailydose pipeline', 'last_seen_sec': 0}
                    recent_events.append('plate_batch.py running')
                elif 'fetch_support' in cmd or 'support_tickets' in cmd:
                    active_agents['Scribe'] = {'state': 'working', 'action': 'Checking customer support inbox', 'last_seen_sec': 0}
                    recent_events.append('Support email sync')
                elif 'sys_logs' in cmd or 'docker' in cmd:
                    active_agents['Pylon'] = {'state': 'working', 'action': 'Auditing VPS logs & container health', 'last_seen_sec': 0}
                    recent_events.append('Sysadmin log inspection')
    except Exception:
        pass

    # 2. Targeted Workspace Subdirectory Scan (last 180s) — Never recursively walk entire home/node_modules
    workspace = ctx['workspace']
    watched_subdirs = [
        ("instagram", "Chroma", "Chorusius"),
        ("creative_assets", "Chroma", "Chorusius"),
        ("community_drafts", "Chorusius", None),
        ("theology", "Lore", None),
        ("theology_research", "Lore", None),
        ("support_tickets", "Scribe", None),
        ("sys_logs", "Pylon", None),
    ]
    try:
        for subdir_name, primary_agent, secondary_agent in watched_subdirs:
            sub_path = workspace / subdir_name
            if not sub_path.exists() or not sub_path.is_dir():
                continue
            try:
                for entry in os.scandir(sub_path):
                    if entry.is_file(follow_symlinks=False):
                        diff = now - entry.stat(follow_symlinks=False).st_mtime
                        if diff < 180:
                            if primary_agent not in active_agents or active_agents[primary_agent]['last_seen_sec'] > diff:
                                active_agents[primary_agent] = {'state': 'working', 'action': f'Processing {entry.name}', 'last_seen_sec': round(diff)}
                            if secondary_agent and secondary_agent not in active_agents:
                                active_agents[secondary_agent] = {'state': 'working', 'action': 'Drafting devotional caption', 'last_seen_sec': round(diff)}
            except Exception:
                pass
    except Exception:
        pass

    # 3. Check agent.log (last 120s)
    log_file = ctx['home'] / 'logs' / 'agent.log'
    if log_file.exists():
        try:
            diff = now - log_file.stat().st_mtime
            if diff < 120:
                lines = subprocess.run(['tail', '-n', '30', str(log_file)], capture_output=True, text=True, timeout=2).stdout.split('\n')
                latest_tool = ''
                for line in reversed(lines):
                    if 'tool_executor: tool' in line:
                        m = re.search(r'tool (\w+) (completed|started|running)', line)
                        if m:
                            latest_tool = f'Tool: {m.group(1)} ({m.group(2)})'
                            break
                    elif 'conversation_loop: API call' in line:
                        m = re.search(r'model=([\w\.\-\/]+)', line)
                        if m:
                            latest_tool = f'Inference: {m.group(1).split("/")[-1]}'
                            break
                if latest_tool:
                    if 'Solaris' not in active_agents:
                        active_agents['Solaris'] = {'state': 'working', 'action': latest_tool, 'last_seen_sec': round(diff)}
                    recent_events.append(latest_tool)
        except Exception:
            pass

    result = {
        'is_active': len(active_agents) > 0,
        'active_agents': active_agents,
        'recent_events': recent_events[:5],
        'timestamp': now,
        'instance': inst_key
    }
    _live_activity_cache[inst_key] = result
    return result

@router.get("/api/simulation/live-activity")
def get_simulation_live_activity(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    return get_real_hermes_activity(inst_key)

@router.get("/api/chat/history")
def get_chat_history(agent: Optional[str] = None, request: Request = None, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    if agent:
        key = f"{inst_key}:{agent.lower()}"
        msgs = chat_history.get(key) or chat_history.get(agent.lower(), [])
        return {"agent": agent, "messages": msgs, "instance": inst_key}
    return chat_history

@router.post("/api/chat/clear")
def clear_chat_history(req: ChatClearRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    agent_name = req.agent.strip().lower()
    
    key = f"{inst_key}:{agent_name}"
    existing_msgs = list(chat_history.get(key) or chat_history.get(agent_name, []))

    # BL-CHAT-28: Automatic archive safety net if more than 2 messages exist
    if len(existing_msgs) > 2:
        try:
            from backend.routers.sessions import save_session_snapshot
            from backend.schemas.models import SessionSaveRequest
            auto_req = SessionSaveRequest(
                title=f"[Auto-Archive] 1-on-1 Chat with {req.agent}",
                session_type="direct",
                target=req.agent,
                tags=["auto-archive", "safety-net"],
                description=f"Auto-archived prior to {'Hard Reset' if req.reset_memory else 'Clear'}",
                messages=existing_msgs,
                instance=inst_key,
                is_auto_archive=True,
            )
            # Synchronously save
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(save_session_snapshot(auto_req, request))
                else:
                    loop.run_until_complete(save_session_snapshot(auto_req, request))
            except Exception:
                # Direct call fallback
                from backend.routers.sessions import SESSIONS_DIR, _read_catalog, _write_catalog
                import uuid
                sess_id = f"sess_{uuid.uuid4().hex[:12]}"
                rec = {
                    "id": sess_id,
                    "title": auto_req.title,
                    "session_type": "direct",
                    "target": req.agent,
                    "tags": auto_req.tags,
                    "description": auto_req.description,
                    "message_count": len(existing_msgs),
                    "timestamp": time.time(),
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "instance": inst_key,
                    "is_auto_archive": True,
                }
                with open(SESSIONS_DIR / f"{sess_id}.json", "w", encoding="utf-8") as f:
                    json.dump({**rec, "messages": existing_msgs}, f, indent=2, ensure_ascii=False)
                cat = _read_catalog()
                cat.insert(0, rec)
                _write_catalog(cat)
        except Exception as e:
            # Using a logger is preferred in production, but print for simplicity here
            print(f"[CHAT] Auto-archive failed during clear_chat: {e}")

    chat_history[key] = []
    if agent_name in chat_history:
        chat_history[agent_name] = []
    
    # Prune session from hermes session store under instance user
    purged_sessions = []
    session_title = f"nexusdesk_{agent_name}"
    try:
        # 1. Standard hermes prune
        subprocess.run(
            [
                "sudo", "-u", ctx["user"],
                f"XDG_RUNTIME_DIR={ctx['xdg_runtime']}",
                "hermes", "sessions", "prune",
                "--title", session_title,
                "--yes"
            ],
            capture_output=True,
            timeout=10
        )
    except Exception:
        pass

    # 2. Hard deletion across all fleet stores if reset_memory requested or fallback
    if getattr(req, "reset_memory", False):
        try:
            # BL-EVO-01: Increased timeout for deep audit/hard reset operations
            # The original timeout of 5 seconds for querying and 10 seconds for deleting
            # was insufficient for deep audit operations across multiple user contexts.
            # Increasing to 30 seconds for query and 60 seconds for delete to
            # gracefully handle extended execution times.
            QUERY_TIMEOUT = 30
            DELETE_TIMEOUT = 60

            for u in ["agents_bs", "freecoder", "myvirtualcoder"]:
                db = f"/home/{u}/.hermes/state.db"
                if not Path(db).exists():
                    continue
                query_cmd = [
                    "sudo", "python3", "-c",
                    f'''
import sqlite3
try:
    conn = sqlite3.connect("{db}", timeout={QUERY_TIMEOUT})
    c = conn.cursor()
    rows = [r[0] for r in c.execute("SELECT id FROM sessions WHERE title LIKE ?", ("%{session_title}%",)).fetchall()]
    print(" ".join(rows))
except Exception:
    pass
'''
                ]
                res = subprocess.run(query_cmd, capture_output=True, text=True, timeout=QUERY_TIMEOUT)
                sids = [s.strip() for s in res.stdout.strip().split() if s.strip()]
                for sid in sids:
                    del_cmd = [
                        "sudo", "-u", u,
                        "XDG_RUNTIME_DIR=/run/user/1001",
                        "hermes", "sessions", "delete",
                        "--yes", sid
                    ]
                    del_res = subprocess.run(del_cmd, capture_output=True, text=True, timeout=DELETE_TIMEOUT)
                    if del_res.returncode == 0:
                        purged_sessions.append(f"{u}:{sid}")
        except Exception as e:
            print(f"[CHAT] Error hard purging session for {agent_name}: {e}")

    return {
        "status": "cleared",
        "agent": agent_name,
        "instance": inst_key,
        "reset_memory": getattr(req, "reset_memory", False),
        "purged_sessions": purged_sessions
    }

@router.post("/api/chat")
async def chat_with_agent(req: ChatRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    agent_name = req.agent.strip()
    user_msg = req.message.strip()

    # Telemetry Interceptor: Operator frustration detection (BL-SYS-21)
    try:
        from routers.self_evolving import record_telemetry_event
        FRUSTRATION_RE = re.compile(r'\b(broken|doesn\'?t work|failed again|buggy|can\'?t connect|crash(ed)?|timeout again|fix this bug|fix this error)\b', re.IGNORECASE)
        if FRUSTRATION_RE.search(user_msg):
            record_telemetry_event(
                category="UX & Friction",
                pillar="system_core",
                source="chat",
                summary=f"Operator friction signal: {user_msg[:100]}",
                details=user_msg,
                affected_files=["backend/routers/chat.py"],
                agent=agent_name,
                instance=inst_key
            )
    except Exception:
        pass
    
    cfg_file = ctx["home"] / "config.yaml"
    workspace_dir = None
    agent_role = ""
    agent_model = ""
    agent_engine = None
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                for a in cfg.get("agents", []):
                    if a.get("name", "").lower() == agent_name.lower():
                        workspace_dir = a.get("workspace_dir")
                        agent_role = a.get("role", "")
                        agent_model = a.get("model", "")
                        agent_engine = (a.get("engine") or "").lower().strip()
                        break
        except Exception:
            pass

    if not agent_engine:
        if req.engine and req.engine.strip():
            agent_engine = req.engine.lower().strip()
        else:
            primary_eng, _, _ = resolve_fleet_primary_engine(ctx["user"])
            agent_engine = primary_eng or "hermes"

    # BL-MOD-31: Priority order for active model:
    # 1. Explicit req.model in ChatRequest
    # 2. Universal specialist override (specialists_override.json)
    # 3. config.yaml agent model
    # 4. get_engine_active_model()
    if req.model and req.model.strip() and req.model.strip().lower() not in ("default", "none"):
        agent_model = req.model.strip()
    else:
        override_m = get_agent_override_model(agent_name, username=ctx["user"], eng_id=agent_engine)
        if override_m:
            agent_model = override_m
        elif not agent_model:
            agent_model = get_engine_active_model(agent_engine, ctx["user"], agent_name=agent_name)

    if agent_engine == "agy" and agent_model:
        agent_model = normalize_agy_model_slug(agent_model)

    if not workspace_dir:
        slug_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', agent_name.lower().strip())
        workspace_dir = str(ctx["workspace"] / slug_name)

    # Auto-provision workspace directory if it doesn't exist yet
    ws_path = Path(workspace_dir)
    if not ws_path.exists():
        try:
            ws_path.mkdir(parents=True, exist_ok=True)
            set_instance_perms(ws_path, inst_key)
            memory_dir = ws_path / "memory"
            memory_dir.mkdir(parents=True, exist_ok=True)
            set_instance_perms(memory_dir, inst_key)
            mem_file = memory_dir / "MEMORY.md"
            if not mem_file.exists():
                mem_file.write_text(f"# {agent_name} Workspace Memory\n\nRole: {agent_role or 'Specialist'}\nEngine: {agent_engine.upper()}\nInitialized via NexusDesk.", encoding="utf-8")
                set_instance_perms(mem_file, inst_key)
        except Exception as e:
            print(f"[CHAT] Warning auto-creating workspace {ws_path}: {e}")

    hist_key = f"{inst_key}:{agent_name.lower()}"
    if hist_key not in chat_history:
        chat_history[hist_key] = []
    
    is_first_turn = (len(chat_history[hist_key]) == 0)

    chat_history[hist_key].append({
        "sender": "user",
        "text": user_msg,
        "timestamp": time.time()
    })

    # Broadcast agent state -> WORKING & shout task start
    await broadcast_event("agent_state", {"agent": agent_name, "state": "working", "instance": inst_key, "engine": agent_engine})
    short_task_desc = (user_msg[:45] + "...") if len(user_msg) > 45 else user_msg
    await broadcast_event("agent_shout", {
        "agent": agent_name,
        "message": f"[{agent_engine.upper()}] Working on: {short_task_desc}",
        "category": "task_start",
        "duration": 5,
        "announce_tts": False,
        "instance": inst_key
    })
    
    # Persistent session name per agent for full multi-turn memory
    safe_session_suffix = re.sub(r'[^a-zA-Z0-9_\-]', '_', agent_name.lower().strip())
    session_name = f"nexusdesk_{safe_session_suffix}"

    gw_summary = ""
    try:
        from services.gateways import get_gateways_prompt_summary
        gw_summary = "\n\n" + get_gateways_prompt_summary()
    except Exception:
        pass

    if is_first_turn or any(k in user_msg.lower() for k in ("whatsapp", "telegram", "email", "gateway", "outbound", "sms", "phone", "alert", "message")):
        directive_prompt = f"You are {agent_name}. Role: {agent_role}. You are in direct conversation with Min via the NexusDesk Mission Control Console. Maintain full persistent memory across this session.{gw_summary}\n\nUser instruction: {user_msg}"
    else:
        directive_prompt = user_msg

    custom_timeout_seconds = parse_natural_timeout_directive(user_msg)
    effective_timeout = float(custom_timeout_seconds) if custom_timeout_seconds else float(AGENT_SUBPROCESS_TIMEOUT)
    effective_soft_timeout = float(int(effective_timeout * (600.0 / 720.0)))

    cur_task = asyncio.current_task()
    if cur_task is not None:
        ACTIVE_DIRECT_CHAT_TASKS.setdefault(session_name, set()).add(cur_task)
    try:
        reply, err = await run_agent_cli(
            agent_name=agent_name,
            agent_engine=agent_engine,
            agent_model=agent_model,
            prompt=directive_prompt,
            ctx=ctx,
            workspace_dir=str(ws_path),
            session_name=session_name,
            timeout_seconds=effective_timeout,
            soft_timeout_seconds=effective_soft_timeout
        )
    except asyncio.CancelledError:
        kill_room_agent_proc(session_name)
        await broadcast_event("agent_state", {"agent": agent_name, "state": "idle"})
        return {"agent": agent_name, "reply": "", "status": "interrupted"}
    finally:
        if cur_task is not None:
            ACTIVE_DIRECT_CHAT_TASKS.get(session_name, set()).discard(cur_task)

    if err:
        await broadcast_event("agent_state", {"agent": agent_name, "state": "idle"})
        timeout_msg = f"⚠️ {agent_name} issue: {err}"
        try:
            from routers.self_evolving import record_telemetry_event
            record_telemetry_event(
                category="Engine & Timeouts",
                pillar="operations",
                source="chat",
                summary=f"{agent_name} subprocess error/timeout",
                details=timeout_msg,
                affected_files=["backend/routers/chat.py"],
                agent=agent_name,
                instance=inst_key
            )
        except Exception:
            pass
        chat_history[hist_key].append({
            "sender": agent_name,
            "text": timeout_msg,
            "timestamp": time.time()
        })
        await broadcast_event("chat_message", {"agent": agent_name, "reply": timeout_msg})
        await broadcast_event("agent_shout", {
            "agent": agent_name,
            "message": f"Error processing directive: {agent_name}",
            "category": "critical",
            "duration": 8,
            "announce_tts": True,
            "instance": inst_key
        })
        return {"agent": agent_name, "reply": timeout_msg, "status": "error"}

    chat_history[hist_key].append({
        "sender": agent_name,
        "text": reply,
        "timestamp": time.time()
    })

    # BL-SYS-01 & BL-SYS-63: Intercept <outbound_message> tags in 1-on-1 chat (suppress unsolicited pushes from Web unless explicitly requested)
    recent_u_texts = [user_msg] + [
        m.get("text", "") for m in chat_history.get(hist_key, [])[-6:] if m.get("sender") == "User"
    ]
    user_explicit_push = bool(re.search(
        r'\b(whatsapp|wa|telegram|tg|email|google[_\s]?drive|gdrive)\b|\b(send|push|forward|deliver|share|resend)\b[\s\S]{0,40}\b(phone|whatsapp|wa|telegram|tg|email|mobile)\b',
        " ".join(recent_u_texts),
        re.IGNORECASE
    ))
    outbound_matches = re.finditer(r'<outbound_message(?:\s+channel=["\'](.*?)["\'])?(?:\s+recipient=["\'](.*?)["\'])?(?:\s+file=["\'](.*?)["\'])?>(.*?)</outbound_message>', reply, re.DOTALL | re.IGNORECASE)
    for om in outbound_matches:
        om_chan = (om.group(1) or "whatsapp").strip().lower()
        om_recip = (om.group(2) or "").strip() or None
        om_file = (om.group(3) or "").strip() or None
        om_body = om.group(4).strip()
        if not om_file and om_body.startswith("/") and os.path.isfile(om_body.split("\n")[0].strip()):
            lines = om_body.split("\n")
            om_file = lines[0].strip()
            om_body = "\n".join(lines[1:]).strip()

        if not user_explicit_push:
            print(f"[CHAT] BL-SYS-63: Suppressing unsolicited outbound push to {om_chan} because 1-on-1 turn originated on Web.")
            continue

        if om_body or om_file:
            try:
                from services.gateways import send_outbound_from_agent
                res = send_outbound_from_agent(
                    channel=om_chan,
                    message=om_body or f"Deliverable report: {os.path.basename(om_file)}",
                    agent_name=agent_name,
                    room_id="1-on-1",
                    recipient=om_recip,
                    file_path=om_file
                )
                file_badge = f" with file `{os.path.basename(om_file)}`" if om_file else ""
                confirm_msg = f"📱 [Outbound Gateway] Successfully dispatched to {om_chan.upper()} (+{res.get('target', 'operator')}){file_badge} ✓"
                chat_history[hist_key].append({
                    "sender": "System",
                    "text": confirm_msg,
                    "timestamp": time.time()
                })
                await broadcast_event("chat_message", {"agent": "System", "reply": confirm_msg})
            except Exception as e:
                err_msg = f"⚠️ [Outbound Gateway Failed] Could not dispatch to {om_chan.upper()}: {e}"
                chat_history[hist_key].append({
                    "sender": "System",
                    "text": err_msg,
                    "timestamp": time.time()
                })
                await broadcast_event("chat_message", {"agent": "System", "reply": err_msg})
    
    await broadcast_event("agent_state", {"agent": agent_name, "state": "idle"})
    await broadcast_event("chat_message", {"agent": agent_name, "reply": reply})

    # BL-AGF-14: Announce task completion with identity voice prefix
    completion_snippet = reply.split("\n")[0][:60]
    if len(completion_snippet) > 55:
        completion_snippet = completion_snippet[:52] + "..."
    await broadcast_event("agent_shout", {
        "agent": agent_name,
        "message": f"Task complete: {completion_snippet}",
        "category": "task_complete",
        "duration": 7,
        "announce_tts": True,
        "instance": inst_key
    })

    return {"agent": agent_name, "reply": reply, "status": "ok"}


@router.post("/api/chat/interrupt")
async def interrupt_direct_chat(req: Dict[str, Any]):
    """Hard-stops any active 1-on-1 Direct Chat subprocess and task for the specified agent."""
    agent_name = (req.get("agent") or "Solaris").strip()
    safe_session_suffix = re.sub(r'[^a-zA-Z0-9_\-]', '_', agent_name.lower().strip())
    session_name = f"nexusdesk_{safe_session_suffix}"

    killed = kill_room_agent_proc(session_name)
    cancelled = 0
    for task in list(ACTIVE_DIRECT_CHAT_TASKS.get(session_name, set())):
        if not task.done():
            task.cancel()
            cancelled += 1

    await broadcast_event("agent_state", {"agent": agent_name, "state": "idle"})
    return {
        "status": "interrupted",
        "agent": agent_name,
        "session_name": session_name,
        "killed_subprocess": killed,
        "cancelled_tasks": cancelled,
    }

@router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket, token: Optional[str] = Query(None)):
    if NEXUSDESK_AUTH_ENABLED and not verify_token(token):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    connected_websockets.append(websocket)
    try:
        while True:
            text = await websocket.receive_text()
            if text:
                try:
                    data = json.loads(text)
                    if data.get("type") == "ping":
                        await websocket.send_text(json.dumps({
                            "type": "pong",
                            "timestamp": time.time()
                        }))
                except Exception:
                    if text.strip() == "ping":
                        await websocket.send_text(json.dumps({
                            "type": "pong",
                            "timestamp": time.time()
                        }))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] WebSocket client error/disconnect: {e}")
    finally:
        if websocket in connected_websockets:
            connected_websockets.remove(websocket)

