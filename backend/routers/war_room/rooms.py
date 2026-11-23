"""
NexusDesk War Room Management, Messages & Context Inspector Routes
==================================================================
Part of NexusDesk War Room Router Package (BL-ARCH-32 & BL-EVO-36).

Handles room creation, renaming, deletion, invite/removal of specialists,
per-room model/orchestrator/preset overrides, transcript reads/clears,
and the Antigravity-style Context Engine inspector & compaction endpoints.
"""

import asyncio
import io
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse

from core.config import (
    NEXUSDESK_MAX_CUSTOM_WAR_ROOMS,
    NEXUSDESK_MAX_WAR_ROOM_AGENTS,
    broadcast_event,
    get_operator_name,
    get_user_profile,
    register_custom_model,
    save_operator_name,
    save_specialist_override,
    save_user_profile,
)
from services.war_room.archival import (
    cleanup_all_room_state,
    execute_archive_and_delete,
    get_delete_preview,
)
from services.war_room.participants import clear_agent_room_overrides, get_all_conference_participants
from routers.war_room.routing_helpers import WAR_ROOM_PRESETS_CATALOG
from schemas.models import (
    WarRoomAgentModelRequest,
    WarRoomClearRequest,
    WarRoomCreateRoomRequest,
    WarRoomInviteRequest,
    WarRoomOrchestratorRequest,
    WarRoomPresetRequest,
    WarRoomRemoveAgentRequest,
    WarRoomRenameRequest,
)
from services.war_room.context_engine import (
    clear_room_context_state,
    get_room_context_inspector_payload,
    load_room_context_state,
    maybe_trigger_async_compaction,
    save_room_context_state,
)
from services.war_room.execution import (
    append_war_room_message,
    bump_room_session_epoch,
    get_room_file,
    read_war_room_history,
)
from services.war_room.participants import (
    get_all_conference_participants,
    get_all_rooms,
    resolve_participant,
    save_rooms,
)

router = APIRouter(tags=["war_room"])


# ---------------------------------------------------------------------------
# 1. Room Lifecycle & Participant Roster Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/war-room/rooms")
def list_war_room_rooms():
    """Lists all available War Room instances."""
    return {"rooms": get_all_rooms()}


@router.post("/api/war-room/rooms")
async def create_war_room_room(req: WarRoomCreateRoomRequest):
    """Creates a new War Room instance with optional domain preset and isolated worktree."""
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Room name cannot be empty")
    rooms = get_all_rooms()
    if NEXUSDESK_MAX_CUSTOM_WAR_ROOMS > 0:
        custom_count = sum(1 for r in rooms if r.get("id") != "general" and not r.get("is_default"))
        if custom_count >= NEXUSDESK_MAX_CUSTOM_WAR_ROOMS:
            raise HTTPException(
                status_code=403,
                detail=f"OSS Edition limit reached: maximum {NEXUSDESK_MAX_CUSTOM_WAR_ROOMS} custom War Rooms (plus #general). Upgrade to NexusDesk Pro for unlimited rooms."
            )
    rid = f"room_{uuid.uuid4().hex[:8]}"
    preset_id = (req.preset or "general_conference").strip().lower()
    if preset_id not in WAR_ROOM_PRESETS_CATALOG:
        preset_id = "general_conference"
    preset_meta = WAR_ROOM_PRESETS_CATALOG[preset_id]

    participants = list(req.participants or preset_meta["default_participants"])
    if NEXUSDESK_MAX_WAR_ROOM_AGENTS > 0 and len(participants) > NEXUSDESK_MAX_WAR_ROOM_AGENTS:
        participants = participants[:NEXUSDESK_MAX_WAR_ROOM_AGENTS]

    new_room = {
        "id": rid,
        "name": name,
        "topic": (req.topic or name).strip(),
        "type": "warroom",
        "preset": preset_id,
        "worktree_isolation": bool(req.worktree_isolation) if req.worktree_isolation is not None else preset_meta["worktree_isolation"],
        "created_at": time.time(),
        "is_default": False,
        "participants": participants,
    }
    rooms.append(new_room)
    save_rooms(rooms)
    await broadcast_event("war_room_room_created", new_room)
    return {"status": "created", "room": new_room}


@router.post("/api/war-room/invite")
async def invite_agent_to_room(req: WarRoomInviteRequest):
    """Adds a specialist agent into an active War Room."""
    rid = req.room_id or "general"
    rooms = get_all_rooms()
    matched = next((r for r in rooms if r.get("id") == rid), None)
    if not matched:
        raise HTTPException(status_code=404, detail="War Room not found")

    all_part = get_all_conference_participants()
    p = resolve_participant(req.agent_name, all_part)
    if not p:
        raise HTTPException(status_code=404, detail=f"Agent {req.agent_name} not found")

    cur_parts = matched.get("participants")
    if cur_parts is None:
        cur_parts = ["solaris", "claude", "agy"]

    if p["name"].lower() not in [x.lower() for x in cur_parts]:
        if NEXUSDESK_MAX_WAR_ROOM_AGENTS > 0 and len(cur_parts) >= NEXUSDESK_MAX_WAR_ROOM_AGENTS:
            raise HTTPException(
                status_code=403,
                detail=f"OSS Edition limit reached: maximum {NEXUSDESK_MAX_WAR_ROOM_AGENTS} agents per War Room. Upgrade to NexusDesk Pro for unlimited agents."
            )
        cur_parts.append(p["name"])
        matched["participants"] = cur_parts
        save_rooms(rooms)

    invite_msg = {
        "id": str(uuid.uuid4()),
        "room_id": rid,
        "sender": "NexusDesk Moderator",
        "sender_type": "system",
        "text": f"🚪 **Agent Added**: **@{p['name']}** [{p['engine'].upper()} - {p['role']}] has entered the room.",
        "timestamp": time.time(),
    }
    append_war_room_message(invite_msg, room_id=rid)
    await broadcast_event("war_room_message", invite_msg)
    await broadcast_event("war_room_participant_invited", {"room_id": rid, "agent": p})
    await broadcast_event("war_room_participant_added", {"room_id": rid, "agent": p})
    return {"status": "added", "agent": p, "participants": cur_parts}


@router.post("/api/war-room/remove-agent")
async def remove_agent_from_room(req: WarRoomRemoveAgentRequest):
    """Removes an agent from an active War Room's participants."""
    rid = req.room_id or "general"
    rooms = get_all_rooms()
    matched = next((r for r in rooms if r.get("id") == rid), None)
    if not matched:
        raise HTTPException(status_code=404, detail="War Room not found")

    cur_parts = matched.get("participants")
    if cur_parts is None:
        cur_parts = ["solaris", "claude", "agy"]

    agent_target = req.agent_name.strip()
    filtered = [x for x in cur_parts if x.lower() != agent_target.lower()]
    if len(filtered) == len(cur_parts):
        return {"status": "already_removed", "agent_name": agent_target, "remaining_count": len(filtered)}
    if len(filtered) < 1:
        raise HTTPException(status_code=400, detail="Cannot remove all agents. At least 1 agent must remain in the War Room.")

    matched["participants"] = filtered
    save_rooms(rooms)

    remove_msg = {
        "id": str(uuid.uuid4()),
        "room_id": rid,
        "sender": "NexusDesk Moderator",
        "sender_type": "system",
        "text": f"🚪 **Agent Removed**: **@{agent_target}** has been removed from the War Room.",
        "timestamp": time.time(),
    }
    append_war_room_message(remove_msg, room_id=rid)
    await broadcast_event("war_room_message", remove_msg)
    await broadcast_event("war_room_participant_removed", {"room_id": rid, "agent_name": agent_target})
    return {"status": "removed", "agent_name": agent_target, "remaining_count": len(filtered)}


@router.patch("/api/war-room/rooms/{room_id}")
async def rename_war_room(room_id: str, req: WarRoomRenameRequest):
    """Renames an existing War Room."""
    rid = (room_id or "general").strip()
    new_name = req.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Room name cannot be empty")

    rooms = get_all_rooms()
    matched = next((r for r in rooms if r.get("id") == rid), None)
    if not matched:
        raise HTTPException(status_code=404, detail="War Room not found")

    old_name = matched.get("name", rid)
    matched["name"] = new_name
    save_rooms(rooms)

    rename_msg = {
        "id": str(uuid.uuid4()),
        "room_id": rid,
        "sender": "NexusDesk Moderator",
        "sender_type": "system",
        "text": f"🏷️ **War Room Renamed**: Room updated from **{old_name}** to **{new_name}**.",
        "timestamp": time.time(),
    }
    append_war_room_message(rename_msg, room_id=rid)
    await broadcast_event("war_room_message", rename_msg)
    await broadcast_event("war_room_room_renamed", {"room_id": rid, "name": new_name, "old_name": old_name})
    return {"status": "ok", "room_id": rid, "name": new_name}


@router.post("/api/war-room/rooms/{room_id}/agent-model")
async def update_room_agent_model(room_id: str, req: WarRoomAgentModelRequest):
    """Updates the model assigned to an agent globally or for this War Room."""
    rid = (room_id or "general").strip()
    rooms = get_all_rooms()
    matched = next((r for r in rooms if r.get("id") == rid), None)
    if not matched:
        raise HTTPException(status_code=404, detail="War Room not found")

    scope = req.scope.lower().strip() if req.scope else "room"
    agent_key = req.agent_name.lower().strip()
    new_model = req.model.strip()

    # Persist custom model in engine catalog so it stays selectable
    all_parts = get_all_conference_participants()
    matched_part = next(
        (p for p in all_parts if p.get("name", "").lower() == agent_key or p.get("id", "").lower() == agent_key),
        None
    )
    register_custom_model(matched_part.get("engine") if matched_part else "hermes", new_model)

    if scope == "global" or rid == "general":
        save_specialist_override(req.agent_name, {"model": new_model})
        clear_agent_room_overrides(req.agent_name)
    else:
        matched.setdefault("model_overrides", {})[agent_key] = new_model
        save_rooms(rooms)

    await broadcast_event("war_room_room_model_updated", {"room_id": rid, "agent": req.agent_name, "model": new_model, "scope": scope})
    return {"status": "ok", "room_id": rid, "agent": req.agent_name, "model": new_model, "scope": scope}


@router.post("/api/war-room/rooms/{room_id}/orchestrator")
async def update_room_orchestrator(room_id: str, req: WarRoomOrchestratorRequest):
    """Sets or clears the designated Room Orchestrator for this War Room (BL-WAR-42)."""
    rid = (room_id or "general").strip()
    rooms = get_all_rooms()
    matched = next((r for r in rooms if r.get("id") == rid), None)
    if not matched:
        if rid == "general":
            matched = {"id": "general", "name": "War Room: General", "type": "warroom", "created_at": 0, "is_default": True}
            rooms.append(matched)
        else:
            raise HTTPException(status_code=404, detail="War Room not found")

    new_orchestrator = req.orchestrator.strip() if req.orchestrator and req.orchestrator.strip() else None
    if new_orchestrator:
        matched["orchestrator"] = new_orchestrator
    else:
        matched.pop("orchestrator", None)
    save_rooms(rooms)

    await broadcast_event("war_room_room_orchestrator_updated", {"room_id": rid, "orchestrator": new_orchestrator})
    return {"status": "ok", "room_id": rid, "orchestrator": new_orchestrator}


@router.post("/api/war-room/rooms/{room_id}/preset")
async def update_room_preset(room_id: str, req: WarRoomPresetRequest):
    """Updates active domain preset and custom Way of Working (WoW) rules for a War Room."""
    rid = (room_id or "general").strip()
    rooms = get_all_rooms()
    matched = next((r for r in rooms if r.get("id") == rid), None)
    if not matched:
        if rid == "general":
            matched = {"id": "general", "name": "War Room: General", "type": "warroom", "created_at": 0, "is_default": True}
            rooms.append(matched)
        else:
            raise HTTPException(status_code=404, detail="War Room not found")

    new_preset = req.preset.strip().lower() if req.preset else "general_conference"
    matched["preset"] = new_preset
    if req.wow_rules is not None:
        matched["wow_rules"] = req.wow_rules.strip()
    save_rooms(rooms)

    active_wow = matched.get("wow_rules") or ""
    if not active_wow:
        wow_file = Path(__file__).resolve().parents[2] / "data" / "domain_presets" / f"{new_preset}_wow.md"
        if wow_file.exists():
            try:
                active_wow = wow_file.read_text(encoding="utf-8").strip()
            except Exception:
                pass

    await broadcast_event("war_room_room_preset_updated", {"room_id": rid, "preset": new_preset, "wow_rules": active_wow})
    return {"status": "ok", "room_id": rid, "preset": new_preset, "wow_rules": active_wow}


@router.post("/api/war-room/rooms/{room_id}/linked-workspaces")
async def update_room_linked_workspaces(room_id: str, payload: Dict[str, Any] = Body(...)):
    """Links or updates authorized Chat Agent sub-data workspaces (and broadcast permission) for a War Room."""
    rid = (room_id or "general").strip()
    rooms = get_all_rooms()
    matched = next((r for r in rooms if r.get("id") == rid), None)
    if not matched:
        if rid == "general":
            matched = {"id": "general", "name": "War Room: General", "type": "warroom", "created_at": 0, "is_default": True}
            rooms.append(matched)
        else:
            raise HTTPException(status_code=404, detail="War Room not found")

    raw_links = payload.get("linked_chat_workspaces")
    clean_links: List[Dict[str, Any]] = []
    if isinstance(raw_links, list):
        for item in raw_links:
            if not isinstance(item, dict):
                continue
            aid = str(item.get("agent_id") or "").strip().lower()
            sid = str(item.get("scope_id") or "").strip()
            if not aid or not sid:
                continue
            clean_links.append({
                "agent_id": aid,
                "scope_id": sid,
                "allow_group_broadcast": bool(item.get("allow_group_broadcast")),
            })
    matched["linked_chat_workspaces"] = clean_links
    save_rooms(rooms)

    # Ensure active ledger mirror exists immediately for every linked scope
    try:
        from services import chat_agents as ca_svc
        for lnk in clean_links:
            ca_svc.ensure_active_month_rolled_over(lnk["agent_id"], lnk["scope_id"])
    except Exception:
        pass

    await broadcast_event("war_room_rooms_updated", {"rooms": rooms})
    return {"status": "ok", "room_id": rid, "linked_chat_workspaces": clean_links}


@router.get("/api/war-room/rooms/{room_id}/delete-preview")
def preview_war_room_delete(room_id: str):
    """Returns sandbox size, message count, and archive target before deleting a custom War Room."""
    if room_id == "general":
        raise HTTPException(status_code=400, detail="Cannot delete default General War Room")
    rooms = get_all_rooms()
    room_meta = next((r for r in rooms if r.get("id") == room_id), None)
    if not room_meta:
        raise HTTPException(status_code=404, detail="Room not found")
    return get_delete_preview(room_id, room_meta)


@router.post("/api/war-room/rooms/{room_id}/archive-and-delete")
@router.delete("/api/war-room/rooms/{room_id}")
async def delete_war_room_room(
    room_id: str,
    prune_scratch: bool = Query(True),
    prune_duplicates: bool = Query(True),
    keep_last_versions: Optional[int] = Query(3),
    skip_archive: bool = Query(False),
    body: Optional[Dict[str, Any]] = Body(default=None),
):
    """Archives a custom War Room (README + pruned deliverables + transcript -> zip) then deletes sandbox & room."""
    if room_id == "general":
        raise HTTPException(status_code=400, detail="Cannot delete default General War Room")
    rooms = get_all_rooms()
    idx = next((i for i, r in enumerate(rooms) if r.get("id") == room_id), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="Room not found")
    room_meta = dict(rooms[idx])

    if isinstance(body, dict):
        if "prune_scratch" in body:
            prune_scratch = bool(body["prune_scratch"])
        if "prune_duplicates" in body:
            prune_duplicates = bool(body["prune_duplicates"])
        if "keep_last_versions" in body:
            raw_kv = body["keep_last_versions"]
            keep_last_versions = int(raw_kv) if raw_kv is not None else None
        if "skip_archive" in body:
            skip_archive = bool(body["skip_archive"])

    archive_result: Dict[str, Any] = {}
    if skip_archive:
        await asyncio.to_thread(cleanup_all_room_state, room_id)
    else:
        archive_result = await asyncio.to_thread(
            execute_archive_and_delete,
            room_id,
            room_meta,
            prune_scratch,
            prune_duplicates,
            keep_last_versions,
        )

    # Remove from war_room_rooms.json only after verified archival + cleanup
    rooms_latest = get_all_rooms()
    rooms_latest = [r for r in rooms_latest if r.get("id") != room_id]
    save_rooms(rooms_latest)

    await broadcast_event("war_room_room_deleted", {"room_id": room_id, **archive_result})
    return {"status": "deleted", "room_id": room_id, **archive_result}


@router.get("/api/system/profile")
def get_system_user_profile():
    """Returns the configured NexusDesk user/operator profile (display_name, tz_offset, tz_label)."""
    return get_user_profile()


@router.put("/api/system/profile")
async def update_system_user_profile(payload: Dict[str, Any] = Body(...)):
    """Updates and persists the NexusDesk user/operator profile."""
    profile = save_user_profile(
        display_name=payload.get("display_name") if "display_name" in payload else None,
        tz_offset=payload.get("tz_offset") if "tz_offset" in payload else None,
        tz_label=payload.get("tz_label") if "tz_label" in payload else None,
    )
    await broadcast_event("system_profile_updated", profile)
    return {"status": "saved", **profile}


@router.post("/api/war-room/export-table")
async def export_war_room_table_xlsx(payload: Dict[str, Any] = Body(...)):
    """Exports a 2D table of strings from a War Room / Chat bubble as a formatted .xlsx workbook."""
    rows: List[List[Any]] = payload.get("rows") or []
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="No table rows provided")

    raw_name = str(payload.get("filename") or "warroom_table").strip()
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", raw_name).strip("_")[:48] or "warroom_table"

    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Table"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    wrap_align = Alignment(vertical="top", wrap_text=True)

    for r_idx, row in enumerate(rows, start=1):
        clean_row = [str(cell) if cell is not None else "" for cell in (row if isinstance(row, list) else [row])]
        ws.append(clean_row)
        for c_idx in range(1, len(clean_row) + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.alignment = wrap_align
            if r_idx == 1:
                cell.font = header_font
                cell.fill = header_fill

    ws.freeze_panes = "A2"
    for col in ws.columns:
        col_letter = col[0].column_letter
        max_len = max((len(str(c.value or "")) for c in col), default=10)
        ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 60)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.xlsx"'},
    )


@router.post("/api/war-room/specialist/{agent_name}/model")
async def update_specialist_model(agent_name: str, req: Dict[str, Any]):
    """Updates specialist model override globally."""
    new_model = req.get("model", "").strip()
    save_specialist_override(agent_name, {"model": new_model})
    await broadcast_event("specialist_model_updated", {"agent": agent_name, "model": new_model})
    return {"status": "updated", "agent": agent_name, "model": new_model}


# ---------------------------------------------------------------------------
# 2. Transcript History & Context Engine Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/war-room/messages")
def get_war_room_messages(
    room_id: str = Query("general"),
    limit: int = Query(100),
    since: Optional[float] = Query(None),
):
    """Fetches message history for a War Room."""
    return {"messages": read_war_room_history(room_id, limit, since), "room_id": room_id}


@router.post("/api/war-room/clear")
async def clear_war_room(req: Optional[WarRoomClearRequest] = None):
    """Clears message history, resets compacted context memory, and bumps session epoch."""
    rid = (req.room_id if req and req.room_id else "general").strip()
    rf = get_room_file(rid)
    if rf.exists():
        try:
            rf.unlink()
        except Exception:
            pass
    clear_room_context_state(rid)
    new_epoch = bump_room_session_epoch(rid)
    await broadcast_event("war_room_cleared", {"room_id": rid, "epoch": new_epoch})
    return {"status": "cleared", "room_id": rid, "epoch": new_epoch}


@router.get("/api/war-room/context")
def get_war_room_context(room_id: str = Query("general")):
    """Returns Context Engine state: pinned directives, user requests, summary, and deliverables."""
    rid = (room_id or "general").strip()
    full_msgs = read_war_room_history(rid, limit=0)
    return get_room_context_inspector_payload(rid, full_msgs, get_room_file(rid))


@router.put("/api/war-room/context")
async def update_war_room_context(payload: Dict[str, Any] = Body(...)):
    """Allows operator to pin/edit room directives or override compacted summary."""
    rid = (payload.get("room_id") or "general").strip()
    state = load_room_context_state(rid)
    if "pinned_notes" in payload:
        state["pinned_notes"] = (payload.get("pinned_notes") or "").strip()
    if "compacted_summary" in payload:
        state["compacted_summary"] = (payload.get("compacted_summary") or "").strip()
        if state["compacted_summary"]:
            state["compaction_mode"] = "operator_edited"
    save_room_context_state(rid, state)
    await broadcast_event("war_room_context_updated", {
        "room_id": rid,
        "compaction_mode": state.get("compaction_mode", "operator_edited"),
        "updated_at": state.get("updated_at"),
    })
    full_msgs = read_war_room_history(rid, limit=0)
    return get_room_context_inspector_payload(rid, full_msgs, get_room_file(rid))


@router.post("/api/war-room/context/compact")
async def trigger_war_room_context_compaction(payload: Dict[str, Any] = Body(...)):
    """Triggers immediate compaction of a War Room's conversation history."""
    rid = (payload.get("room_id") or "general").strip()
    full_msgs = read_war_room_history(rid, limit=0)
    await maybe_trigger_async_compaction(rid, full_msgs, force=True)
    return get_room_context_inspector_payload(rid, full_msgs, get_room_file(rid))
