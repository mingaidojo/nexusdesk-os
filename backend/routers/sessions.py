import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request

from core.config import (
    BASE_DIR,
    get_instance_user_context,
    resolve_instance_key,
    set_instance_perms,
    backup_file,
)
from schemas.models import (
    SessionSaveRequest,
    SessionRestoreRequest,
    SessionDistillWikiRequest,
)

logger = logging.getLogger("nexusdesk.sessions")
router = APIRouter(prefix="/api/sessions", tags=["sessions"])

SESSIONS_DIR = BASE_DIR / "backend" / "data" / "saved_sessions"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _get_catalog_file() -> Path:
    return SESSIONS_DIR / "catalog.json"


def _read_catalog() -> List[Dict[str, Any]]:
    cat_file = _get_catalog_file()
    if not cat_file.exists():
        return []
    try:
        with open(cat_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading session catalog: {e}")
        return []


def _write_catalog(catalog: List[Dict[str, Any]]):
    cat_file = _get_catalog_file()
    try:
        with open(cat_file, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2, ensure_ascii=False)
        try:
            os.chmod(cat_file, 0o666)
        except Exception:
            pass
    except Exception as e:
        logger.error(f"Error writing session catalog: {e}")


@router.get("/list")
async def list_saved_sessions(
    request: Request,
    session_type: Optional[str] = None,
    target: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
):
    inst_key = resolve_instance_key(request, None)
    catalog = _read_catalog()

    # Filter
    results = []
    q = (search or "").strip().lower()
    for item in catalog:
        # Match instance if present
        if item.get("instance") and item.get("instance") != inst_key:
            continue
        if session_type and item.get("session_type") != session_type:
            continue
        if target and item.get("target") != target:
            continue
        if q:
            title = (item.get("title") or "").lower()
            tags = " ".join(item.get("tags") or []).lower()
            desc = (item.get("description") or "").lower()
            if q not in title and q not in tags and q not in desc:
                continue
        results.append(item)

    # Sort reverse chronological
    results.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    return {"sessions": results[:limit], "total": len(results)}


@router.post("/save")
async def save_session_snapshot(req: SessionSaveRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    now = time.time()

    # Messages can be passed directly from client; if empty and room_id provided, read from war_room history
    messages = req.messages or []
    if not messages and req.session_type == "warroom":
        from routers.war_room import read_war_room_history
        messages = read_war_room_history(room_id=req.target, limit=1000)

    if not messages and not req.is_auto_archive:
        raise HTTPException(status_code=400, detail="Cannot save an empty session with no messages.")

    record = {
        "id": session_id,
        "title": req.title.strip() or f"Session Snapshot ({time.strftime('%Y-%m-%d %H:%M')})",
        "session_type": req.session_type,
        "target": req.target,
        "tags": [t.strip() for t in req.tags if t.strip()] if req.tags else [],
        "description": req.description or "",
        "message_count": len(messages),
        "timestamp": now,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
        "instance": inst_key,
        "is_auto_archive": req.is_auto_archive,
    }

    # Write full payload file
    file_path = SESSIONS_DIR / f"{session_id}.json"
    full_payload = {
        **record,
        "messages": messages,
    }
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(full_payload, f, indent=2, ensure_ascii=False)
    try:
        os.chmod(file_path, 0o666)
    except Exception:
        pass

    # Update catalog
    catalog = _read_catalog()
    catalog.insert(0, record)
    _write_catalog(catalog)

    logger.info(f"Saved session snapshot '{record['title']}' ({session_id}) with {len(messages)} messages.")
    return {"status": "ok", "session": record}


@router.get("/{session_id}")
async def get_session_snapshot(session_id: str):
    file_path = SESSIONS_DIR / f"{session_id}.json"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Saved session not found")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read session: {e}")


@router.delete("/{session_id}")
async def delete_session_snapshot(session_id: str):
    file_path = SESSIONS_DIR / f"{session_id}.json"
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete file {file_path}: {e}")

    catalog = _read_catalog()
    catalog = [item for item in catalog if item.get("id") != session_id]
    _write_catalog(catalog)

    return {"status": "ok", "deleted_id": session_id}


@router.post("/{session_id}/restore")
async def restore_session_snapshot(session_id: str, req: SessionRestoreRequest, request: Request):
    """
    Restores the snapshot messages back into either:
    - Active War Room room_id
    - Direct 1-on-1 chat history
    """
    inst_key = resolve_instance_key(request, req.instance)
    file_path = SESSIONS_DIR / f"{session_id}.json"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Saved session not found")

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    messages = data.get("messages", [])
    target_mode = req.target_mode or data.get("session_type", "warroom")
    target_id = req.target_id or data.get("target", "general")

    if target_mode == "warroom":
        from routers.war_room import append_war_room_message, _get_room_history_file
        hist_file = _get_room_history_file(target_id)
        # Append marker notice that a session was restored
        restore_notice = {
            "id": f"restore_{uuid.uuid4().hex[:8]}",
            "sender": "System",
            "sender_type": "system",
            "role": "Session Restorer",
            "text": f"🔄 **RESTORED ARCHIVE**: *'{data.get('title')}'* ({len(messages)} messages from {data.get('created_at')}).",
            "timestamp": time.time(),
            "room_id": target_id,
        }
        append_war_room_message(restore_notice, room_id=target_id)
        for m in messages:
            m_copy = dict(m)
            m_copy["id"] = f"rest_{uuid.uuid4().hex[:8]}"
            m_copy["room_id"] = target_id
            m_copy["restored"] = True
            append_war_room_message(m_copy, room_id=target_id)

        return {
            "status": "ok",
            "restored_count": len(messages),
            "target_mode": "warroom",
            "target_id": target_id,
            "title": data.get("title"),
        }
    else:
        # Direct 1-on-1 chat
        from routers.chat import chat_history
        agent_name = target_id.strip().lower()
        key = f"{inst_key}:{agent_name}"
        if key not in chat_history:
            chat_history[key] = []
        for m in messages:
            chat_history[key].append(m)

        return {
            "status": "ok",
            "restored_count": len(messages),
            "target_mode": "direct",
            "target_id": target_id,
            "title": data.get("title"),
        }


@router.post("/distill-wiki")
async def distill_session_to_wiki(req: SessionDistillWikiRequest, request: Request):
    """
    Saves conversation markdown or an executive summary directly into:
    1. Agent Memory: ~/workspace/<agent>/memory/MEMORY.md (appended or updated)
    2. Shared Wiki/Notes: ~/workspace/shared/wiki/<folder>/<filename>.md
    """
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    ws_dir = ctx["workspace"]

    safe_title = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", req.title.strip()) or "session_notes"
    target_folder = (req.folder or "notes").lower()
    date_str = time.strftime("%Y-%m-%d %H:%M")

    # Build content if not explicitly provided
    body_content = req.content
    if not body_content and req.messages:
        lines = [f"# {req.title}\n", f"- **Date**: {date_str}", f"- **Turn Count**: {len(req.messages)}\n", "---\n"]
        for m in req.messages:
            time_str = time.strftime("%H:%M:%S", time.localtime(m.get("timestamp", time.time())))
            sender = m.get("sender") or (m.get("sender_type") == "user" and "Operator") or "Agent"
            eng = f" [{m.get('engine', '').upper()}]" if m.get("engine") else ""
            lines.append(f"### [{time_str}] {sender}{eng}")
            if m.get("role"):
                lines.append(f"*{m['role']}*")
            lines.append(f"{m.get('text', '')}\n")
        body_content = "\n".join(lines)

    if not body_content:
        raise HTTPException(status_code=400, detail="No content or messages provided to distill.")

    # Destination 1: Agent MEMORY.md
    if target_folder == "memory" and req.target_agent:
        agent_dir = ws_dir / req.target_agent.lower() / "memory"
        agent_dir.mkdir(parents=True, exist_ok=True)
        mem_file = agent_dir / "MEMORY.md"
        backup_file(mem_file)
        
        append_block = f"\n\n## Session Archive: {req.title} ({date_str})\n\n{body_content}\n"
        with open(mem_file, "a", encoding="utf-8") as f:
            f.write(append_block)
        set_instance_perms(mem_file, inst_key)
        return {
            "status": "ok",
            "destination": "memory",
            "path": str(mem_file),
            "bytes_written": len(append_block),
        }

    # Destination 2: Wiki / Shared Notes folder
    wiki_dir = ws_dir / "wiki" / target_folder
    wiki_dir.mkdir(parents=True, exist_ok=True)
    out_file = wiki_dir / f"{safe_title}_{time.strftime('%Y%m%d_%H%M%S')}.md"
    
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(body_content)
    set_instance_perms(out_file, inst_key)

    logger.info(f"Distilled session '{req.title}' to wiki file: {out_file}")
    return {
        "status": "ok",
        "destination": "wiki",
        "path": str(out_file),
        "file_name": out_file.name,
        "bytes_written": len(body_content),
    }
