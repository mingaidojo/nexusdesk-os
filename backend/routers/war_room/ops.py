"""
NexusDesk War Room Operations: Inquiries, Tasks, Reminders & Queue Control
==========================================================================
Part of NexusDesk War Room Router Package (BL-ARCH-32, BL-WAR-33, BL-WAR-38..39).

Handles:
- Operator Inquiries Deck endpoints
- Two-phase background task registration, live status & cancellation
- Natural-language & explicit reminder CRUD
- Cross-room concurrency state, hard interrupt, and queued directive management
"""

import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request

from core.config import broadcast_event
from routers.war_room.routing_helpers import (
    ACTIVE_WAR_ROOM_TASKS,
    _safe_room_key,
    is_room_busy,
)
from schemas.models import (
    WarRoomChatRequest,
    WarRoomInquiryResolveRequest,
    WarRoomReminderCancelRequest,
    WarRoomReminderCreateRequest,
    WarRoomScheduleSaveRequest,
    WarRoomTaskRegisterRequest,
)
from services.cli_executor import kill_room_agent_proc, list_active_room_procs
from services.war_room.execution import (
    append_war_room_message,
    bump_interrupt_gen,
    bump_room_session_epoch,
    clear_operator_directives,
    count_operator_directives,
    get_interrupt_gen,
    get_room_session_epoch,
    list_operator_directives,
    queue_operator_directive,
    remove_operator_directive,
    update_operator_directive,
    update_war_room_message_text,
)
from services.war_room.inquiries import get_room_inquiries, resolve_room_inquiry
from services.war_room.participants import get_all_rooms, get_room_participants, resolve_participant
from services.war_room.reminders import (
    add_room_reminder,
    cancel_room_reminder,
    get_room_reminders,
    parse_natural_reminder_directive,
)
from services.war_room.schedules import (
    delete_room_schedule,
    fire_room_schedule,
    get_room_schedules,
    toggle_room_schedule,
    upsert_room_schedule,
)
from services.war_room.roundtable import ACTIVE_ROUNDTABLE_TASKS
from services.war_room.tasks import (
    cancel_room_background_task,
    discover_and_adopt_sandbox_bg_processes,
    get_bg_task_live_status,
    get_room_bg_tasks,
    launch_two_phase_background_task,
)

router = APIRouter(tags=["war_room"])


# ---------------------------------------------------------------------------
# 1. Inquiries, Background Tasks & Reminders
# ---------------------------------------------------------------------------

@router.get("/api/war-room/inquiries")
def list_war_room_inquiries(room_id: Optional[str] = Query(None)):
    """Lists unresolved inquiries awaiting operator decision."""
    return {"inquiries": get_room_inquiries(room_id or "general")}


@router.post("/api/war-room/inquiries/resolve")
async def resolve_war_room_inquiry(req: WarRoomInquiryResolveRequest):
    """Resolves an inquiry from the Operator Inquiries Deck."""
    rid = req.room_id or "general"
    changed = resolve_room_inquiry(rid, req.inquiry_id, req.resolution)
    inquiries = get_room_inquiries(rid)
    await broadcast_event("war_room_inquiries_updated", {"room_id": rid, "inquiries": inquiries, "resolved_id": req.inquiry_id})
    return {"status": "ok", "changed": changed, "remaining": len(inquiries)}


@router.get("/api/war-room/tasks")
async def list_war_room_tasks(room_id: str = Query("general")):
    """Returns background tasks ledger for a War Room, auto-discovering any detached sandbox jobs."""
    try:
        await discover_and_adopt_sandbox_bg_processes(room_id, announce_in_room=False)
    except Exception as e:
        print(f"[WAR_ROOM_OPS] Auto-discover warning for {room_id}: {e}")
    return {"tasks": get_room_bg_tasks(room_id)}


@router.post("/api/war-room/tasks/register")
async def register_war_room_task(req: WarRoomTaskRegisterRequest):
    """Formally registers and launches a two-phase background delegated task."""
    rid = req.room_id or "general"
    parts = get_room_participants(rid)
    agent = resolve_participant(req.agent, parts)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {req.agent} not found in this room")

    rec = await launch_two_phase_background_task(
        rid=rid,
        agent=agent,
        task_description=req.task_description,
        command=req.command,
        timeout=req.timeout,
        followup_directive=req.followup_directive,
        auto_proceed_on_success=bool(req.auto_proceed_on_success),
        next_task_description=req.next_task_description,
        next_command=req.next_command,
    )
    return {"status": "registered", "task": rec}


@router.get("/api/war-room/tasks/{task_id}/live")
def get_war_room_task_live(task_id: str, room_id: str = Query("general"), tail: int = Query(40)):
    """Returns real-time progress telemetry and log tail for a background task."""
    return get_bg_task_live_status(room_id, task_id, tail_lines=tail)


@router.post("/api/war-room/tasks/cancel")
async def cancel_war_room_task(payload: Dict[str, Any] = Body(...)):
    """Cancels a running background task and terminates its subprocess group."""
    rid = payload.get("room_id") or "general"
    tid = payload.get("task_id") or ""
    if not tid:
        raise HTTPException(status_code=400, detail="task_id is required")
    res = await cancel_room_background_task(rid, tid)
    return {"status": "cancelled", "task": res}


@router.get("/api/war-room/reminders")
def list_war_room_reminders(room_id: str = Query("general"), active_only: bool = Query(True)):
    """Lists scheduled reminders for a War Room."""
    return {"reminders": get_room_reminders(room_id, active_only=active_only)}


@router.post("/api/war-room/reminders")
async def create_war_room_reminder(req: WarRoomReminderCreateRequest):
    """Creates a scheduled reminder (supports natural-language parsing and explicit fields)."""
    rid = req.room_id or "general"
    raw_text = (req.text or "").strip()
    tz_offset = req.timezone_offset_hours if req.timezone_offset_hours is not None else 7.0
    participants = get_room_participants(rid)

    rem = None
    if not req.trigger_type and not req.fire_at and not req.due_timestamp and not req.delay_seconds:
        rem = parse_natural_reminder_directive(raw_text, participants=participants, room_id=rid, tz_offset_hours=tz_offset)
        if not rem:
            rem = parse_natural_reminder_directive(f"remind me {raw_text}", participants=participants, room_id=rid, tz_offset_hours=tz_offset)

    if not rem:
        rem_id = f"rem_{uuid.uuid4().hex[:8]}"
        now = time.time()
        fire_time = req.fire_at or req.due_timestamp or (now + (req.delay_seconds or 60))
        rem = {
            "id": rem_id,
            "room_id": rid,
            "text": raw_text,
            "raw_input": raw_text,
            "trigger_type": req.trigger_type or "relative_time",
            "target_agent": req.target_agent,
            "fire_at": None if req.trigger_type in ("next_hop", "after_agent") else fire_time,
            "created_at": now,
            "status": "pending",
            "label": req.label or (
                "Next Hop" if req.trigger_type == "next_hop" else (
                    f"After @{req.target_agent} turn" if req.trigger_type == "after_agent" else f"Scheduled for {time.strftime('%H:%M:%S', time.localtime(fire_time))}"
                )
            ),
        }

    add_room_reminder(rid, rem)
    active_rems = get_room_reminders(rid, active_only=True)
    await broadcast_event("war_room_reminders_updated", {"room_id": rid, "reminders": active_rems})
    return {"status": "created", "reminder": rem, "reminders": active_rems}


@router.post("/api/war-room/reminders/cancel")
async def cancel_war_room_reminder_endpoint(req: WarRoomReminderCancelRequest):
    """Cancels one or all scheduled reminders."""
    rid = req.room_id or "general"
    cancelled = cancel_room_reminder(rid, req.reminder_id)
    active_rems = get_room_reminders(rid, active_only=True)
    await broadcast_event("war_room_reminders_updated", {"room_id": rid, "reminders": active_rems})
    return {"status": "cancelled", "cancelled_count": cancelled, "reminders": active_rems}


def _find_schedule_room(schedule_id: str, room_id: Optional[str]) -> Optional[str]:
    if room_id and room_id.lower() != "all":
        return room_id
    match = next((s for s in get_room_schedules("all") if s.get("id") == schedule_id), None)
    return match.get("room_id") if match else None


@router.get("/api/war-room/schedules")
def list_war_room_schedules(room_id: str = Query("general")):
    """Lists War Room recurring & scheduled tasks (supports room_id='all' for global rollup)."""
    return {"schedules": get_room_schedules(room_id)}


@router.post("/api/war-room/schedules")
async def save_war_room_schedule_endpoint(req: WarRoomScheduleSaveRequest):
    """Creates or updates a room-scoped War Room schedule."""
    rid = req.room_id or "general"
    saved = upsert_room_schedule(rid, req.model_dump())
    schedules = get_room_schedules(rid)
    await broadcast_event("war_room_schedules_updated", {"room_id": rid, "schedules": schedules})
    return {"status": "saved", "schedule": saved, "schedules": schedules}


@router.patch("/api/war-room/schedules/{schedule_id}/toggle")
async def toggle_war_room_schedule_endpoint(schedule_id: str, room_id: Optional[str] = Query(None), enabled: Optional[bool] = Query(None)):
    """Pauses or resumes a War Room schedule."""
    rid = _find_schedule_room(schedule_id, room_id) or "general"
    updated = toggle_room_schedule(rid, schedule_id, enabled=enabled)
    if not updated:
        raise HTTPException(status_code=404, detail="War Room schedule not found")
    schedules = get_room_schedules(rid)
    await broadcast_event("war_room_schedules_updated", {"room_id": rid, "schedules": schedules})
    return {"status": "toggled", "schedule": updated, "schedules": schedules}


@router.post("/api/war-room/schedules/{schedule_id}/run")
async def run_war_room_schedule_now_endpoint(schedule_id: str, room_id: Optional[str] = Query(None)):
    """Immediately executes a War Room schedule manually."""
    rid = _find_schedule_room(schedule_id, room_id) or "general"
    sched = next((s for s in get_room_schedules(rid) if s.get("id") == schedule_id), None)
    if not sched:
        raise HTTPException(status_code=404, detail="War Room schedule not found")
    res = await fire_room_schedule(rid, sched, manual=True)
    return {"status": res.get("status", "dispatched"), "schedule": sched}


@router.delete("/api/war-room/schedules/{schedule_id}")
async def delete_war_room_schedule_endpoint(schedule_id: str, room_id: Optional[str] = Query(None)):
    """Deletes a War Room schedule."""
    rid = _find_schedule_room(schedule_id, room_id) or "general"
    deleted = delete_room_schedule(rid, schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="War Room schedule not found")
    schedules = get_room_schedules(rid)
    await broadcast_event("war_room_schedules_updated", {"room_id": rid, "schedules": schedules})
    return {"status": "deleted", "schedules": schedules}


# ---------------------------------------------------------------------------
# 2. Concurrency State, Hard Interrupt & Queue Management
# ---------------------------------------------------------------------------

@router.get("/api/war-room/state")
async def war_room_state(room_id: Optional[str] = Query("general")):
    """Reconciles client Send/Queue/Interrupt UI state with live server execution."""
    safe_rid = _safe_room_key(room_id)
    return {
        "room_id": room_id,
        "active": is_room_busy(room_id),
        "queued": count_operator_directives(safe_rid),
        "queued_directives": list_operator_directives(safe_rid),
        "generation": get_interrupt_gen(safe_rid),
    }


@router.get("/api/war-room/concurrency")
async def war_room_concurrency():
    """Returns live execution status, active subprocesses, and queue loads across ALL War Rooms."""
    rooms = get_all_rooms()
    active_procs = list_active_room_procs()
    procs_by_room: Dict[str, list[Dict[str, Any]]] = {}
    for p in active_procs:
        procs_by_room.setdefault(p.get("room_id") or "general", []).append(p)

    active_rooms = []
    idle_rooms = []

    for r in rooms:
        rid = r.get("id") or "general"
        safe_rid = _safe_room_key(rid)
        busy = is_room_busy(rid)
        queued = count_operator_directives(safe_rid)
        room_procs = procs_by_room.get(safe_rid, []) or procs_by_room.get(rid, [])
        rt_task = ACTIVE_ROUNDTABLE_TASKS.get(rid) or ACTIVE_ROUNDTABLE_TASKS.get(safe_rid)
        room_data = {
            "id": rid,
            "name": r.get("name") or rid,
            "busy": busy,
            "roundtable_active": bool(rt_task and not rt_task.done()),
            "queued_directives": queued,
            "active_subprocesses": len(room_procs),
            "process_pids": [p["pid"] for p in room_procs],
            "epoch": get_room_session_epoch(safe_rid),
            "generation": get_interrupt_gen(safe_rid),
        }
        (active_rooms if (busy or queued > 0) else idle_rooms).append(room_data)

    return {
        "total_rooms": len(rooms),
        "active_rooms_count": len(active_rooms),
        "idle_rooms_count": len(idle_rooms),
        "total_active_subprocesses": len(active_procs),
        "active_rooms": active_rooms,
        "idle_rooms": idle_rooms,
    }


@router.post("/api/war-room/interrupt")
async def interrupt_war_room(req: Dict[str, Any], request: Request):
    """Hard-stops all running agent subprocesses, turn chains, and queued directives for a room."""
    from routers.war_room.chat_turn import war_room_chat

    room_id = (req.get("room_id") or "general").strip()
    safe_rid = _safe_room_key(room_id)
    new_message = (req.get("message") or "").strip()

    bump_interrupt_gen(safe_rid)
    killed = kill_room_agent_proc(safe_rid)

    cancelled = 0
    for task in list(ACTIVE_WAR_ROOM_TASKS.get(safe_rid, set())):
        if not task.done():
            task.cancel()
            cancelled += 1
    for rt_key in {room_id, safe_rid}:
        rt_task = ACTIVE_ROUNDTABLE_TASKS.pop(rt_key, None)
        if rt_task and not rt_task.done():
            rt_task.cancel()
            cancelled += 1

    clear_operator_directives(safe_rid)
    bump_room_session_epoch(safe_rid)
    await broadcast_event("war_room_queue_updated", {"room_id": room_id, "queued": 0, "queued_directives": []})

    from core.config import get_operator_name
    op_name = get_operator_name()
    interrupt_note = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "sender": "NexusDesk Moderator",
        "sender_type": "system",
        "text": f"⚡ **Interrupted by @{op_name}**: All running and pending turns aborted. Floor yielded to **@{op_name}**.",
        "timestamp": time.time(),
    }
    append_war_room_message(interrupt_note, room_id=room_id)
    await broadcast_event("war_room_message", interrupt_note)
    await broadcast_event("war_room_speaker_stop", {"room_id": room_id, "agent": "all"})
    await broadcast_event("agent_state", {"agent": "all", "state": "idle"})
    await broadcast_event("war_room_roundtable_complete", {"room_id": room_id})
    await broadcast_event("war_room_dispatch_complete", {"room_id": room_id, "status": "interrupted"})

    if new_message:
        chat_req = WarRoomChatRequest(
            message=new_message,
            room_id=room_id,
            max_turns=req.get("max_turns", 1),
            handoff_enabled=req.get("handoff_enabled", True),
            execution_mode=req.get("execution_mode", "sequential"),
            lead_agent=req.get("lead_agent"),
            pause_before_swarm=bool(req.get("pause_before_swarm", False)),
            instance=req.get("instance"),
        )
        return await war_room_chat(chat_req, request=request)

    return {"status": "interrupted", "room_id": room_id, "killed_subprocess": killed, "cancelled_tasks": cancelled}


@router.post("/api/war-room/queue")
async def queue_war_room_directive(req: Dict[str, Any]):
    """Queues an operator directive to execute immediately after the current speaking turn."""
    room_id = (req.get("room_id") or "general").strip()
    safe_rid = _safe_room_key(room_id)
    message = (req.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Queued message cannot be empty")
    if not is_room_busy(room_id):
        return {"status": "idle", "room_id": room_id}

    directive_entry = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "message": message,
        "max_turns": req.get("max_turns", 1),
        "handoff_enabled": req.get("handoff_enabled", True),
        "execution_mode": req.get("execution_mode", "sequential"),
        "lead_agent": req.get("lead_agent"),
        "pause_before_swarm": bool(req.get("pause_before_swarm", False)),
        "instance": req.get("instance"),
        "timestamp": time.time(),
    }
    queue_operator_directive(safe_rid, directive_entry)
    q_list = list_operator_directives(safe_rid)

    from core.config import get_operator_name
    queued_note = {
        "id": directive_entry["id"],
        "room_id": room_id,
        "sender": get_operator_name(),
        "sender_type": "user",
        "text": f"📥 **[Queued Next Directive]**: {message}",
        "engine": "human",
        "color": "#10b981",
        "timestamp": time.time(),
    }
    append_war_room_message(queued_note, room_id=room_id)
    await broadcast_event("war_room_message", queued_note)
    await broadcast_event("war_room_queue_updated", {"room_id": room_id, "queued": len(q_list), "queued_directives": q_list})
    return {"status": "queued", "room_id": room_id, "directive": directive_entry, "queued": len(q_list), "queued_directives": q_list}


@router.post("/api/war-room/queue/update")
async def update_war_room_queued_directive(req: Dict[str, Any]):
    """Edits the text (or execution settings) of a pending queued directive before it runs."""
    room_id = (req.get("room_id") or "general").strip()
    safe_rid = _safe_room_key(room_id)
    directive_id = (req.get("directive_id") or "").strip()
    new_message = (req.get("message") or "").strip()
    if not directive_id:
        raise HTTPException(status_code=400, detail="directive_id is required")
    if not new_message:
        raise HTTPException(status_code=400, detail="Queued message cannot be empty")

    updated = update_operator_directive(
        safe_rid,
        directive_id,
        message=new_message,
        max_turns=req.get("max_turns"),
        execution_mode=req.get("execution_mode"),
    )
    q_list = list_operator_directives(safe_rid)
    if updated is None:
        await broadcast_event("war_room_queue_updated", {"room_id": room_id, "queued": len(q_list), "queued_directives": q_list})
        raise HTTPException(status_code=409, detail="Queued directive already started executing or was cancelled")

    updated_msg = update_war_room_message_text(
        room_id,
        directive_id,
        f"📥 **[Queued Next Directive (Edited)]**: {new_message}",
    )
    if updated_msg is not None:
        await broadcast_event("war_room_message_updated", updated_msg)

    await broadcast_event("war_room_queue_updated", {"room_id": room_id, "queued": len(q_list), "queued_directives": q_list})
    return {
        "status": "updated",
        "room_id": room_id,
        "directive": updated,
        "queued": len(q_list),
        "queued_directives": q_list,
    }


@router.post("/api/war-room/queue/cancel")
async def cancel_war_room_queued_directive(req: Dict[str, Any]):
    """Cancels one or all queued operator directives for a room."""
    room_id = (req.get("room_id") or "general").strip()
    safe_rid = _safe_room_key(room_id)
    directive_id = (req.get("directive_id") or "all").strip()
    removed = remove_operator_directive(safe_rid, directive_id)
    q_list = list_operator_directives(safe_rid)
    await broadcast_event("war_room_queue_updated", {"room_id": room_id, "queued": len(q_list), "queued_directives": q_list})
    return {"status": "cancelled", "room_id": room_id, "removed_count": removed, "queued": len(q_list), "queued_directives": q_list}
