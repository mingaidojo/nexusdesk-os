"""
NexusDesk War Room Reminders Service
Parses natural language relative and absolute temporal reminders, watches reminder intervals,
and handles proactive reminder triggers.
Part of BL-ARCH-32 modularization.
"""

import asyncio
import json
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, List, Optional

from core.config import DATA_DIR
from core.config import broadcast_event

def get_reminders_file(room_id: str = "general") -> Path:
    """Returns the persistent JSON file path for room reminders."""
    safe_id = re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "general").strip()) or "general"
    return DATA_DIR / f"war_room_reminders_{safe_id}.json"

def get_room_reminders(room_id: str = "general", active_only: bool = True) -> List[Dict[str, Any]]:
    """Loads reminders for a given room."""
    rf = get_reminders_file(room_id)
    if not rf.exists():
        return []
    try:
        with open(rf, "r", encoding="utf-8") as f:
            items = json.load(f)
            if not isinstance(items, list):
                return []
            if active_only:
                return [r for r in items if r.get("status", "pending") == "pending"]
            return items
    except Exception:
        return []

def save_room_reminders(room_id: str, reminders: List[Dict[str, Any]]):
    """Saves reminders for a given room."""
    rf = get_reminders_file(room_id)
    try:
        with open(rf, "w", encoding="utf-8") as f:
            json.dump(reminders[-60:], f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WAR_ROOM_REMINDERS] Warning saving reminders for {room_id}: {e}")

def add_room_reminder(room_id: str, reminder: Dict[str, Any]) -> Dict[str, Any]:
    """Appends a new reminder to room state."""
    all_rems = get_room_reminders(room_id, active_only=False)
    all_rems.append(reminder)
    save_room_reminders(room_id, all_rems)
    return reminder

def cancel_room_reminder(room_id: str, reminder_id: str = "all") -> int:
    """Cancels one or all pending reminders for a room."""
    all_rems = get_room_reminders(room_id, active_only=False)
    cancelled_count = 0
    for r in all_rems:
        if r.get("status") == "pending":
            if reminder_id == "all" or r.get("id") == reminder_id:
                r["status"] = "cancelled"
                r["cancelled_at"] = time.time()
                cancelled_count += 1
    if cancelled_count > 0:
        save_room_reminders(room_id, all_rems)
    return cancelled_count

def parse_natural_reminder_directive(
    text: str,
    participants: List[Dict[str, Any]],
    room_id: str = "general",
    tz_offset_hours: float = 7.0
) -> Optional[Dict[str, Any]]:
    """
    BL-WAR-19: Parse natural temporal reminder directives from chat messages:
      1. Next-hop / turn-conditioned: 'remind me on the next hop', 'remind me next turn', 'remind me after Solaris finishes'
      2. Relative time: 'remind me in 15m', 'remind me in 2 hours', 'remind me after 30 mins to check X'
      3. Absolute wall-clock time: 'remind me at 12:00 PM jkt to review Y', 'remind me at 14:30 server time'
    """
    if not text:
        return None
    clean = text.strip()
    # BL-EVO-39: Match common reminder directives from users OR agents
    rem_match = re.search(r'\b(?:remind(?:\s+me|\s+us)?|set\s+a?\s*reminder|schedule\s+a?\s*reminder|will\s+check\s+back(?:\s+in)?|check\s+back\s+in|follow\s+up\s+in)\b', clean, re.IGNORECASE)
    if not rem_match:
        return None

    now = time.time()
    rid = (room_id or "general").strip()

    def _clean_note(raw: str) -> str:
        s = re.sub(r'^.*?\b(?:remind(?:\s+me|\s+us)?|set\s+a?\s*reminder|schedule\s+a?\s*reminder|will\s+check\s+back(?:\s+in)?|check\s+back\s+in|follow\s+up\s+in)\b\s*', '', raw, flags=re.IGNORECASE).strip()
        s = re.sub(r'^(?:on\s+the\s+next\s+(?:hop|turn)|next\s+(?:hop|turn))\s*', '', s, flags=re.IGNORECASE).strip()
        s = re.sub(r'^(?:after|once|when)\s+@?[a-zA-Z0-9_\-]+\s+(?:finishes|completes|replies|is\s+done|speaks)\s*', '', s, flags=re.IGNORECASE).strip()
        s = re.sub(r'^(?:in|after)\s+\d+\s*(?:s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours)\s*', '', s, flags=re.IGNORECASE).strip()
        s = re.sub(r'^(?:tomorrow\s+)?at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:jkt|wib|jakarta|utc|gmt[+-]?\d*|cest|cet|server(?:\s+time)?)?\s*', '', s, flags=re.IGNORECASE).strip()
        s = re.sub(r'^(?:to|that|about|for)\s+', '', s, flags=re.IGNORECASE).strip()
        return s.strip(" .,!") or raw.strip()

    # 1. Agent-Completion Condition
    after_ag_m = re.search(
        r'\b(?:after|once|when)\s+@?([a-zA-Z0-9_\-]+)\s+(?:finishes|completes|replies|is\s+done|speaks)\b',
        clean,
        re.IGNORECASE
    )
    if after_ag_m:
        ag_token = after_ag_m.group(1).lower()
        matched_ag = None
        for p in participants:
            if p["name"].lower() == ag_token or p.get("id", "").lower() == ag_token:
                matched_ag = p["name"]
                break
        target_ag = matched_ag or after_ag_m.group(1).capitalize()
        note = _clean_note(clean)
        return {
            "id": f"rem_{uuid.uuid4().hex[:8]}",
            "room_id": rid,
            "text": note,
            "raw_input": clean,
            "trigger_type": "after_agent",
            "target_agent": target_ag,
            "fire_at": None,
            "created_at": now,
            "status": "pending",
            "label": f"After @{target_ag} turn"
        }

    # 2. Next-Hop / Next Turn Condition
    if re.search(r'\b(?:on\s+the\s+next\s+(?:hop|turn)|next\s+(?:hop|turn))\b', clean, re.IGNORECASE):
        note = _clean_note(clean)
        return {
            "id": f"rem_{uuid.uuid4().hex[:8]}",
            "room_id": rid,
            "text": note,
            "raw_input": clean,
            "trigger_type": "next_hop",
            "target_agent": None,
            "fire_at": None,
            "created_at": now,
            "status": "pending",
            "label": "Next Hop (Immediately following this turn)"
        }

    # 3. Relative Interval
    rel_m = re.search(r'\b(?:in|after)\s+(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours)\b', clean, re.IGNORECASE)
    if rel_m:
        val = int(rel_m.group(1))
        unit = rel_m.group(2).lower()
        mult = 1
        unit_lbl = f"{val}s"
        if unit.startswith("m"):
            mult = 60
            unit_lbl = f"{val}m"
        elif unit.startswith("h"):
            mult = 3600
            unit_lbl = f"{val}h"
        fire_time = now + (val * mult)
        note = _clean_note(clean)
        return {
            "id": f"rem_{uuid.uuid4().hex[:8]}",
            "room_id": rid,
            "text": note,
            "raw_input": clean,
            "trigger_type": "relative_time",
            "target_agent": None,
            "fire_at": fire_time,
            "created_at": now,
            "status": "pending",
            "label": f"In {unit_lbl}"
        }

    # 4. Absolute Wall-Clock Time
    abs_m = re.search(
        r'\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(jkt|wib|jakarta|utc|gmt[+-]?\d*|cest|cet|server(?:\s+time)?)?\b',
        clean,
        re.IGNORECASE
    )
    if abs_m:
        hr = int(abs_m.group(1))
        mn = int(abs_m.group(2) or 0)
        merid = (abs_m.group(3) or "").lower()
        tz_str = (abs_m.group(4) or "").lower()

        if merid == "pm" and hr < 12:
            hr += 12
        elif merid == "am" and hr == 12:
            hr = 0

        target_tz_offset = tz_offset_hours
        tz_label = f"GMT{'+' if tz_offset_hours >= 0 else ''}{int(tz_offset_hours)}"
        if tz_str in ("jkt", "wib", "jakarta"):
            target_tz_offset = 7.0
            tz_label = "JKT (UTC+7)"
        elif tz_str in ("utc", "gmt"):
            target_tz_offset = 0.0
            tz_label = "UTC"
        elif tz_str in ("cest", "cet", "server", "server time"):
            target_tz_offset = 2.0  # Server hardware CEST
            tz_label = "CEST (Server)"

        user_tz = timezone(timedelta(hours=target_tz_offset))
        now_dt = datetime.now(user_tz)
        target_dt = now_dt.replace(hour=hr, minute=mn, second=0, microsecond=0)
        if target_dt.timestamp() <= now + 30:
            target_dt += timedelta(days=1)

        fire_time = target_dt.timestamp()
        note = _clean_note(clean)
        clock_str = target_dt.strftime("%I:%M %p").lstrip("0")
        return {
            "id": f"rem_{uuid.uuid4().hex[:8]}",
            "room_id": rid,
            "text": note,
            "raw_input": clean,
            "trigger_type": "clock_time",
            "target_agent": None,
            "fire_at": fire_time,
            "created_at": now,
            "status": "pending",
            "label": f"At {clock_str} {tz_label}"
        }

    return None

async def fire_room_reminder(room_id: str, rem: Dict[str, Any], trigger_context: str = ""):
    """BL-WAR-19: Proactively triggers a scheduled reminder into the war room conversation."""
    from services.war_room.execution import append_war_room_message
    
    note_text = rem.get("text", "Scheduled reminder").strip()
    trigger_lbl = rem.get("label") or trigger_context or "Scheduled Reminder"
    
    from core.config import get_operator_name
    op_name = get_operator_name()
    reminder_msg = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "sender": "NexusDesk Reminders",
        "sender_type": "system",
        "text": f"⏰ **WAR ROOM REMINDER TRIGGERED** ({trigger_lbl})\n\n{note_text}\n\n🔔 **@{op_name}**: Scheduled notice has matured for this room.",
        "mentions": [op_name, "user"],
        "mentions_user": True,
        "timestamp": time.time(),
        "is_reminder": True
    }
    append_war_room_message(reminder_msg, room_id=room_id)
    await broadcast_event("war_room_message", reminder_msg)
    
    rem["status"] = "fired"
    rem["fired_at"] = time.time()
    
    all_rems = get_room_reminders(room_id, active_only=False)
    for i, r in enumerate(all_rems):
        if r.get("id") == rem.get("id"):
            all_rems[i] = rem
            break
    save_room_reminders(room_id, all_rems)
    
    await broadcast_event("war_room_reminders_updated", {
        "room_id": room_id,
        "reminders": get_room_reminders(room_id, active_only=True)
    })

    # Wake targeted agent if an agent explicitly registered an active follow-up reminder
    target_ag = (rem.get("target_agent") or "").strip().lstrip("@")
    should_wake = bool(rem.get("wake_agent") or (target_ag and rem.get("created_by")))
    if should_wake and target_ag:
        try:
            from routers.war_room.routing_helpers import is_room_busy, _safe_room_key
            from schemas.models import WarRoomChatRequest
            from services.war_room.execution import queue_operator_directive

            wake_prompt = f"@{target_ag} [Scheduled Follow-Up Triggered ({trigger_lbl})]: {note_text}"
            if is_room_busy(room_id):
                queue_operator_directive(_safe_room_key(room_id), {
                    "id": f"rem_q_{uuid.uuid4().hex[:6]}",
                    "message": wake_prompt,
                    "max_turns": 2,
                    "handoff_enabled": True,
                    "origin_channel": "scheduler",
                    "queued_at": time.time(),
                })
            else:
                from routers.war_room.chat_turn import war_room_chat
                asyncio.create_task(war_room_chat(WarRoomChatRequest(
                    message=wake_prompt,
                    room_id=room_id,
                    max_turns=2,
                    handoff_enabled=True,
                    skip_user_echo=True,
                    origin_channel="scheduler",
                ), request=None))
        except Exception as wake_e:
            print(f"[WAR_ROOM_REMINDERS] Agent wakeup warning for {room_id}/{target_ag}: {wake_e}")

async def check_and_fire_turn_reminders(room_id: str, completed_agent_name: str):
    """BL-WAR-19: Evaluates turn-conditioned and next-hop reminders immediately after an agent completes a turn."""
    pending = get_room_reminders(room_id, active_only=True)
    if not pending:
        return
        
    for rem in list(pending):
        ttype = rem.get("trigger_type")
        if ttype == "next_hop":
            await fire_room_reminder(room_id, rem, trigger_context="Next Hop / Following Turn")
        elif ttype == "after_agent":
            target = (rem.get("target_agent") or "").lower().strip()
            if target and target in completed_agent_name.lower().strip():
                await fire_room_reminder(room_id, rem, trigger_context=f"After @{completed_agent_name} Finished")

async def war_room_reminders_watcher():
    """Background loop: Checks and fires due temporal reminders and recurring War Room schedules every 5 seconds."""
    from services.war_room.execution import get_all_rooms
    from services.war_room.schedules import process_due_room_schedules
    while True:
        try:
            rooms = get_all_rooms()
            now = time.time()
            for rm in rooms:
                rid = rm.get("id", "general")
                rems = get_room_reminders(rid, active_only=True)
                for r in rems:
                    fire_at = r.get("fire_at")
                    if fire_at and now >= fire_at:
                        await fire_room_reminder(rid, r, trigger_context="Timer Expired")
            await process_due_room_schedules()
        except Exception as e:
            print(f"[WAR_ROOM_REMINDERS] Watcher loop warning: {e}")
        await asyncio.sleep(5)

def parse_natural_timeout_directive(text: str) -> Optional[int]:
    """
    BL-WAR-50: Natural Language Turn Timeout Override.
    Parses operator instructions specifying custom turn timeout or wait thresholds, e.g.:
      - 'time-out is 600s', 'time-out is 600', 'timeout = 10m', 'ceiling: 800s'
      - 'i can wait for 600s', 'will wait max 15m', 'can/will wait for/max 600s'
      - 'turn limit 450s'
    Returns seconds (int) between 30 and 3600 (1 hour), or None if no override matched.
    """
    if not text or not isinstance(text, str):
        return None
    patterns = [
        # Explicit timeout / ceiling / turn limit
        r'(?:time[-_ ]?out|ceiling|turn[-_ ]?(?:ceiling|limit|time))\s*(?:is|=|:)?\s*(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes)?\b',
        # Natural wait phrasing
        r'(?:(?:can|will|wait)[\w\s/]*?wait[\w\s/]*?|wait\s+(?:for|max|up to|[ /]+)?)\s*(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes)\b'
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            unit = (m.group(2) or 's').lower()
            seconds = val * 60 if unit.startswith('m') else val
            if 30 <= seconds <= 3600:
                return seconds
    return None

