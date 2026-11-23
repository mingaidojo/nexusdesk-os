"""
NexusDesk War Room Scheduler Service
====================================
Manages room-scoped recurring schedules and scheduled AI dispatches / roundtables
distinct from global DAG/Hermes crons and Chat Agent crons.

Storage:
  backend/data/war_room_schedules_{safe_room_id}.json
"""

import asyncio
import json
import re
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.config import DATA_DIR, broadcast_event, get_operator_name

_WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_WEEKDAY_LOOKUP = {
    "mon": 0, "monday": 0,
    "tue": 1, "tues": 1, "tuesday": 1,
    "wed": 2, "wednesday": 2,
    "thu": 3, "thur": 3, "thurs": 3, "thursday": 3,
    "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5,
    "sun": 6, "sunday": 6,
}


def _safe_rid(room_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", (room_id or "general").strip()) or "general"


def get_schedules_file(room_id: str = "general") -> Path:
    return DATA_DIR / f"war_room_schedules_{_safe_rid(room_id)}.json"


def _parse_hhmm(time_str: Optional[str]) -> tuple[int, int]:
    raw = (time_str or "08:30").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$", raw, re.IGNORECASE)
    if not m:
        return 8, 30
    hr = int(m.group(1))
    mn = max(0, min(59, int(m.group(2))))
    merid = (m.group(3) or "").lower()
    if merid == "pm" and hr < 12:
        hr += 12
    elif merid == "am" and hr == 12:
        hr = 0
    return max(0, min(23, hr)), mn


def _normalize_days(days: Optional[List[int]]) -> List[int]:
    if not isinstance(days, list) or not days:
        return [0]
    cleaned = sorted({int(d) for d in days if str(d).isdigit() and 0 <= int(d) <= 6})
    return cleaned or [0]


def format_schedule_human(sched: Dict[str, Any]) -> str:
    freq = (sched.get("frequency") or "daily").lower()
    tz_off = float(sched.get("tz_offset_hours") if sched.get("tz_offset_hours") is not None else 7.0)
    tz_lbl = f"GMT{'+' if tz_off >= 0 else ''}{int(tz_off)}"
    hr, mn = _parse_hhmm(sched.get("time_hhmm"))
    dt_disp = datetime(2026, 1, 1, hr, mn).strftime("%I:%M %p").lstrip("0")

    if freq == "once":
        fire_at = sched.get("fire_at") or sched.get("next_run_at")
        if fire_at:
            tz = timezone(timedelta(hours=tz_off))
            d = datetime.fromtimestamp(float(fire_at), tz=tz)
            return f"Once · {d.strftime('%b %d %I:%M %p').replace(' 0', ' ')} ({tz_lbl})"
        return f"Once · {dt_disp} ({tz_lbl})"
    if freq == "daily":
        return f"Daily · {dt_disp} ({tz_lbl})"
    if freq == "weekdays":
        return f"Weekdays (Mon–Fri) · {dt_disp} ({tz_lbl})"
    if freq == "weekly":
        days = _normalize_days(sched.get("days_of_week"))
        names = ", ".join(_WEEKDAY_NAMES[d] for d in days)
        return f"Weekly ({names}) · {dt_disp} ({tz_lbl})"
    if freq == "interval":
        mins = max(5, int(sched.get("interval_minutes") or 60))
        if mins % 60 == 0:
            hrs = mins // 60
            return f"Every {hrs}h"
        return f"Every {mins}m"
    return f"Daily · {dt_disp} ({tz_lbl})"


def compute_next_run_ts(sched: Dict[str, Any], now_ts: Optional[float] = None) -> Optional[float]:
    """Computes the next UTC epoch timestamp matching schedule rules & tz_offset_hours."""
    if sched.get("enabled") is False:
        return sched.get("next_run_at")

    now = float(now_ts if now_ts is not None else time.time())
    freq = (sched.get("frequency") or "daily").lower()
    tz_off = float(sched.get("tz_offset_hours") if sched.get("tz_offset_hours") is not None else 7.0)
    tz = timezone(timedelta(hours=tz_off))

    if freq == "interval":
        mins = max(5, int(sched.get("interval_minutes") or 60))
        return now + (mins * 60)

    if freq == "once":
        explicit_fire = sched.get("fire_at")
        if explicit_fire and float(explicit_fire) > now + 5:
            return float(explicit_fire)
        delay_mins = sched.get("delay_minutes")
        if delay_mins:
            return now + (max(1, int(delay_mins)) * 60)
        hr, mn = _parse_hhmm(sched.get("time_hhmm"))
        now_dt = datetime.now(tz)
        cand = now_dt.replace(hour=hr, minute=mn, second=0, microsecond=0)
        if cand.timestamp() <= now + 5:
            cand += timedelta(days=1)
        return cand.timestamp()

    hr, mn = _parse_hhmm(sched.get("time_hhmm"))
    now_dt = datetime.now(tz)
    cand = now_dt.replace(hour=hr, minute=mn, second=0, microsecond=0)

    if freq == "daily":
        if cand.timestamp() <= now + 5:
            cand += timedelta(days=1)
        return cand.timestamp()

    if freq == "weekdays":
        for _ in range(8):
            if cand.weekday() < 5 and cand.timestamp() > now + 5:
                return cand.timestamp()
            cand += timedelta(days=1)
        return cand.timestamp()

    if freq == "weekly":
        days = set(_normalize_days(sched.get("days_of_week")))
        for _ in range(15):
            if cand.weekday() in days and cand.timestamp() > now + 5:
                return cand.timestamp()
            cand += timedelta(days=1)
        return cand.timestamp()

    if cand.timestamp() <= now + 5:
        cand += timedelta(days=1)
    return cand.timestamp()


def _format_next_run_display(next_ts: Optional[float], tz_off: float = 7.0, enabled: bool = True) -> str:
    if not enabled:
        return "Paused"
    if not next_ts:
        return "Completed"
    tz = timezone(timedelta(hours=tz_off))
    dt = datetime.fromtimestamp(float(next_ts), tz=tz)
    return dt.strftime("%a %b %d, %I:%M %p").replace(" 0", " ")


def _enrich_schedule(sched: Dict[str, Any], room_names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    item = dict(sched)
    tz_off = float(item.get("tz_offset_hours") if item.get("tz_offset_hours") is not None else 7.0)
    enabled = item.get("enabled", True) is not False
    item["schedule_human"] = format_schedule_human(item)
    item["next_run_display"] = _format_next_run_display(item.get("next_run_at"), tz_off=tz_off, enabled=enabled)
    item["next_run_iso"] = (
        datetime.fromtimestamp(float(item["next_run_at"]), tz=timezone.utc).isoformat()
        if item.get("next_run_at")
        else None
    )
    rid = item.get("room_id") or "general"
    if room_names:
        item["room_name"] = room_names.get(rid, rid)
    return item


def get_room_schedules(room_id: str = "general") -> List[Dict[str, Any]]:
    """Loads schedules for one War Room or across all War Rooms when room_id == 'all'."""
    from services.war_room.participants import get_all_rooms

    rooms_meta = {r.get("id", "general"): (r.get("title") or r.get("name") or r.get("id", "general")) for r in get_all_rooms()}
    rid = (room_id or "general").strip()

    if rid.lower() == "all":
        all_items: List[Dict[str, Any]] = []
        for sf in sorted(DATA_DIR.glob("war_room_schedules_*.json")):
            try:
                with open(sf, "r", encoding="utf-8") as f:
                    items = json.load(f)
                if isinstance(items, list):
                    for it in items:
                        if isinstance(it, dict):
                            all_items.append(_enrich_schedule(it, rooms_meta))
            except Exception:
                continue
        all_items.sort(key=lambda x: (x.get("enabled") is False, x.get("next_run_at") or 9e18))
        return all_items

    sf = get_schedules_file(rid)
    if not sf.exists():
        return []
    try:
        with open(sf, "r", encoding="utf-8") as f:
            items = json.load(f)
        if not isinstance(items, list):
            return []
        return [_enrich_schedule(it, rooms_meta) for it in items if isinstance(it, dict)]
    except Exception:
        return []


def save_room_schedules(room_id: str, schedules: List[Dict[str, Any]]) -> None:
    sf = get_schedules_file(room_id)
    try:
        clean = [dict(s) for s in schedules]
        with open(sf, "w", encoding="utf-8") as f:
            json.dump(clean, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WAR_ROOM_SCHEDULES] Warning saving schedules for {room_id}: {e}")


def upsert_room_schedule(room_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    rid = (room_id or payload.get("room_id") or "general").strip()
    existing = get_room_schedules(rid)
    sid = (payload.get("id") or "").strip() or f"wrs_{uuid.uuid4().hex[:8]}"
    now = time.time()

    prev = next((s for s in existing if s.get("id") == sid), None)
    prompt_txt = (payload.get("prompt") or (prev or {}).get("prompt") or "").strip()
    title_txt = (payload.get("title") or "").strip() or (prompt_txt[:56] + ("..." if len(prompt_txt) > 56 else ""))

    freq = (payload.get("frequency") or (prev or {}).get("frequency") or "daily").lower()
    if freq not in ("once", "daily", "weekdays", "weekly", "interval"):
        freq = "daily"

    mode = (payload.get("mode") or (prev or {}).get("mode") or "agent_dispatch").lower()
    if mode not in ("static_notice", "agent_dispatch", "roundtable"):
        mode = "agent_dispatch"

    targets = payload.get("targets") if payload.get("targets") is not None else (prev or {}).get("targets") or ["Solaris"]
    if isinstance(targets, str):
        targets = [t.strip().lstrip("@") for t in targets.split(",") if t.strip()]
    targets = [str(t).strip().lstrip("@") for t in (targets or []) if str(t).strip()]

    enabled = payload.get("enabled") if payload.get("enabled") is not None else (prev.get("enabled", True) if prev else True)
    record: Dict[str, Any] = {
        "id": sid,
        "room_id": rid,
        "title": title_txt or "War Room Task",
        "prompt": prompt_txt or title_txt,
        "frequency": freq,
        "days_of_week": _normalize_days(payload.get("days_of_week") if payload.get("days_of_week") is not None else (prev or {}).get("days_of_week")),
        "time_hhmm": payload.get("time_hhmm") or (prev or {}).get("time_hhmm") or "08:30",
        "delay_minutes": payload.get("delay_minutes"),
        "interval_minutes": payload.get("interval_minutes") if payload.get("interval_minutes") is not None else (prev or {}).get("interval_minutes"),
        "fire_at": payload.get("fire_at"),
        "tz_offset_hours": float(payload.get("tz_offset_hours") if payload.get("tz_offset_hours") is not None else (prev or {}).get("tz_offset_hours", 7.0)),
        "mode": mode,
        "targets": targets,
        "roundtable_rounds": max(1, min(6, int(payload.get("roundtable_rounds") or (prev or {}).get("roundtable_rounds") or 2))),
        "push_to_owner_channel": bool(payload.get("push_to_owner_channel") if payload.get("push_to_owner_channel") is not None else (prev or {}).get("push_to_owner_channel", False)),
        "enabled": bool(enabled),
        "created_at": (prev or {}).get("created_at") or now,
        "updated_at": now,
        "last_run_at": (prev or {}).get("last_run_at"),
        "last_status": (prev or {}).get("last_status"),
        "run_count": int((prev or {}).get("run_count") or 0),
        "created_by": payload.get("created_by") or (prev or {}).get("created_by") or "operator",
        "created_via": payload.get("created_via") or (prev or {}).get("created_via") or "modal",
    }
    record["next_run_at"] = compute_next_run_ts(record, now_ts=now) if record["enabled"] else (prev or {}).get("next_run_at")

    if prev:
        updated = [record if s.get("id") == sid else s for s in existing]
    else:
        updated = [record] + existing
    save_room_schedules(rid, updated)
    return _enrich_schedule(record)


def toggle_room_schedule(room_id: str, schedule_id: str, enabled: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    rid = (room_id or "general").strip()
    items = get_room_schedules(rid)
    target = None
    now = time.time()
    for it in items:
        if it.get("id") == schedule_id:
            new_state = (not it.get("enabled", True)) if enabled is None else bool(enabled)
            it["enabled"] = new_state
            it["updated_at"] = now
            if new_state:
                it["next_run_at"] = compute_next_run_ts(it, now_ts=now)
            target = it
            break
    if target is None:
        return None
    save_room_schedules(rid, items)
    return _enrich_schedule(target)


def delete_room_schedule(room_id: str, schedule_id: str) -> bool:
    rid = (room_id or "general").strip()
    items = get_room_schedules(rid)
    filtered = [it for it in items if it.get("id") != schedule_id]
    if len(filtered) == len(items):
        return False
    save_room_schedules(rid, filtered)
    return True


def manage_room_schedule_action(
    room_id: str,
    action: str,
    schedule_id: Optional[str] = None,
    title_query: Optional[str] = None,
    updates: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Executes agent or conversational CRUD actions (pause/resume/delete/update) safely."""
    rid = (room_id or "general").strip()
    items = get_room_schedules(rid)
    if not items:
        return None

    target = None
    if schedule_id:
        target = next((it for it in items if it.get("id") == schedule_id.strip()), None)
    if target is None and title_query:
        tq = title_query.strip().lower()
        target = next(
            (it for it in items if tq in (it.get("title") or "").lower() or tq in (it.get("prompt") or "").lower()),
            None,
        )
    if target is None:
        return None

    act = (action or "").strip().lower()
    sid = target["id"]
    if act in ("pause", "disable", "stop"):
        return toggle_room_schedule(rid, sid, enabled=False)
    if act in ("resume", "enable", "start"):
        return toggle_room_schedule(rid, sid, enabled=True)
    if act in ("delete", "remove", "cancel"):
        ok = delete_room_schedule(rid, sid)
        return {"id": sid, "title": target.get("title"), "deleted": ok} if ok else None
    if act == "update" and isinstance(updates, dict):
        merged = dict(target)
        for k in ("title", "prompt", "frequency", "days_of_week", "time_hhmm", "interval_minutes", "mode", "targets", "roundtable_rounds", "push_to_owner_channel", "enabled"):
            if k in updates and updates[k] is not None:
                merged[k] = updates[k]
        return upsert_room_schedule(rid, merged)
    return None


def parse_natural_schedule_directive(
    text: str,
    participants: List[Dict[str, Any]],
    room_id: str = "general",
    tz_offset_hours: float = 7.0,
) -> Optional[Dict[str, Any]]:
    """
    Detects recurring conversational schedule directives from the War Room user chat, e.g.:
      - 'Every morning at 08:30 @Solaris summarize overnight sandbox commits'
      - 'Every weekday at 09:00 @Claude @Agy check test coverage'
      - 'Every Monday at 10:00 run a 2-round roundtable on pricing'
      - 'Every 2 hours check crawler progress'
    """
    if not text or not isinstance(text, str):
        return None
    clean = text.strip()
    has_recurring_cue = bool(
        re.search(
            r"\b(?:every\s+(?:day|morning|evening|night|weekday|weekdays|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d+\s*(?:h|hr|hrs|hours|m|min|mins|minutes))|daily\s+at|weekly\s+at)\b",
            clean,
            re.IGNORECASE,
        )
    )
    has_intent_cue = bool(
        re.search(r"\b(?:schedule|cron|recurring|remind|summarize|check|review|refresh|update|run|roundtable|convene)\b", clean, re.IGNORECASE)
    )
    if not (has_recurring_cue and has_intent_cue):
        return None

    freq = "daily"
    days_of_week: List[int] = [0]
    interval_minutes: Optional[int] = None
    time_hhmm = "08:30"

    int_m = re.search(r"\bevery\s+(\d+)\s*(h|hr|hrs|hours|m|min|mins|minutes)\b", clean, re.IGNORECASE)
    if int_m:
        freq = "interval"
        val = int(int_m.group(1))
        unit = int_m.group(2).lower()
        interval_minutes = val * 60 if unit.startswith("h") else max(5, val)
    else:
        if re.search(r"\bweekday(?:s)?\b", clean, re.IGNORECASE):
            freq = "weekdays"
        else:
            found_days = []
            for tok, idx in _WEEKDAY_LOOKUP.items():
                if re.search(rf"\b(?:every\s+)?{tok}\b", clean, re.IGNORECASE):
                    found_days.append(idx)
            if found_days and re.search(r"\bevery\b", clean, re.IGNORECASE):
                freq = "weekly"
                days_of_week = sorted(set(found_days))

        tm = re.search(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", clean, re.IGNORECASE)
        if tm and not int_m:
            hr = int(tm.group(1))
            mn = int(tm.group(2) or 0)
            merid = (tm.group(3) or "").lower()
            if 0 <= hr <= 23 and 0 <= mn <= 59:
                if merid == "pm" and hr < 12:
                    hr += 12
                elif merid == "am" and hr == 12:
                    hr = 0
                time_hhmm = f"{hr:02d}:{mn:02d}"

    targets = []
    if re.search(r"@(?:everyone|everyagents|all)\b", clean, re.IGNORECASE):
        targets = ["everyone"]
    else:
        for p in participants or []:
            pname = p.get("name", "")
            if pname and re.search(rf"@{re.escape(pname)}\b", clean, re.IGNORECASE):
                targets.append(pname)
        if not targets:
            targets = ["Solaris"]

    mode = "roundtable" if re.search(r"\broundtable\b", clean, re.IGNORECASE) else "agent_dispatch"
    if re.search(r"\b(?:notice\s+only|static\s+notice|\$0)\b", clean, re.IGNORECASE):
        mode = "static_notice"

    rounds = 2
    rm = re.search(r"(\d+)\s*[- ]?round", clean, re.IGNORECASE)
    if rm:
        rounds = max(1, min(6, int(rm.group(1))))

    push_owner = bool(re.search(r"\b(?:push|send|notify)\b.*\b(?:whatsapp|telegram|owner|my phone)\b", clean, re.IGNORECASE))

    return {
        "room_id": room_id,
        "title": clean[:58] + ("..." if len(clean) > 58 else ""),
        "prompt": clean,
        "frequency": freq,
        "days_of_week": days_of_week,
        "time_hhmm": time_hhmm,
        "interval_minutes": interval_minutes,
        "tz_offset_hours": tz_offset_hours,
        "mode": mode,
        "targets": targets,
        "roundtable_rounds": rounds,
        "push_to_owner_channel": push_owner,
        "enabled": True,
        "created_by": "operator",
        "created_via": "user_chat",
    }


def format_active_schedules_prompt_block(room_id: str) -> str:
    """Renders compact context block so War Room agents see existing schedules and avoid duplicates."""
    items = [s for s in get_room_schedules(room_id) if s.get("enabled", True)]
    if not items:
        return ""
    lines = ["[ACTIVE WAR ROOM SCHEDULES (Use IDs if asked to pause/update/delete):]"]
    for s in items[:8]:
        tgts = ", ".join(f"@{t}" for t in (s.get("targets") or [])) or "@room"
        lines.append(
            f"- {s['id']} | {s.get('schedule_human')} | {s.get('mode')} ({tgts}) | \"{s.get('title')}\" [by {s.get('created_by', 'operator')}]"
        )
    return "\n".join(lines) + "\n"


async def fire_room_schedule(room_id: str, sched: Dict[str, Any], manual: bool = False) -> Dict[str, Any]:
    """Executes a scheduled War Room job (Static Notice, AI Dispatch, or Roundtable)."""
    from routers.war_room.routing_helpers import _safe_room_key, is_room_busy
    from schemas.models import WarRoomChatRequest, WarRoomRoundTableRequest
    from services.war_room.execution import append_war_room_message, queue_operator_directive, list_operator_directives
    from services.war_room.participants import get_room_participants

    rid = (room_id or sched.get("room_id") or "general").strip()
    mode = (sched.get("mode") or "agent_dispatch").lower()
    prompt_txt = (sched.get("prompt") or sched.get("title") or "Scheduled check-in").strip()
    targets = [t for t in (sched.get("targets") or []) if t]
    op_name = get_operator_name()

    now = time.time()
    all_items = get_room_schedules(rid)
    for it in all_items:
        if it.get("id") == sched.get("id"):
            it["last_run_at"] = now
            it["run_count"] = int(it.get("run_count") or 0) + 1
            if (it.get("frequency") or "").lower() == "once":
                it["enabled"] = False
                it["next_run_at"] = None
                it["last_status"] = "completed"
            else:
                it["next_run_at"] = compute_next_run_ts(it, now_ts=now + 5)
                it["last_status"] = "dispatched"
            break
    save_room_schedules(rid, all_items)
    await broadcast_event("war_room_schedules_updated", {"room_id": rid, "schedules": get_room_schedules(rid)})

    trigger_tag = "MANUAL TEST RUN" if manual else "SCHEDULED RUN"

    if mode == "static_notice":
        notice_msg = {
            "id": str(uuid.uuid4()),
            "room_id": rid,
            "sender": "NexusDesk Scheduler",
            "sender_type": "system",
            "text": (
                f"🗓️ **WAR ROOM SCHEDULE · {trigger_tag}** (`{sched.get('id')}` · {sched.get('schedule_human', '')})\n\n"
                f"{prompt_txt}\n\n🔔 **@{op_name}**: Static notice ($0 AI tokens used)."
            ),
            "mentions": [op_name, "user"],
            "mentions_user": True,
            "timestamp": now,
            "is_reminder": True,
        }
        append_war_room_message(notice_msg, room_id=rid)
        await broadcast_event("war_room_message", notice_msg)
        return {"status": "fired_static", "schedule_id": sched.get("id")}

    mentions_prefix = " ".join(f"@{t}" for t in targets) if targets else "@Solaris"
    full_directive = prompt_txt if mentions_prefix.lower() in prompt_txt.lower() else f"{mentions_prefix} {prompt_txt}"
    push_note = ""
    if sched.get("push_to_owner_channel"):
        push_note = "\n\n[Scheduler Delivery Flag: User explicitly opted in to receive a concise completion summary on WhatsApp/Telegram via <outbound_message> once finished.]"

    banner = {
        "id": str(uuid.uuid4()),
        "room_id": rid,
        "sender": "NexusDesk Scheduler",
        "sender_type": "system",
        "text": (
            f"⏰ **WAR ROOM SCHEDULER · {trigger_tag}** (`{sched.get('id')}`)\n"
            f"**Job**: *{sched.get('title')}* · **Mode**: `{mode.upper()}` · **Targets**: {mentions_prefix}"
        ),
        "timestamp": now,
    }
    append_war_room_message(banner, room_id=rid)
    await broadcast_event("war_room_message", banner)

    if mode == "roundtable":
        from routers.war_room.chat_turn import start_war_room_roundtable

        parts = get_room_participants(rid)
        part_names = [p["name"] for p in parts]
        rt_agents = [t for t in targets if t.lower() != "everyone"]
        if len(rt_agents) < 2:
            rt_agents = part_names[:3]
        if len(rt_agents) >= 2:
            rt_req = WarRoomRoundTableRequest(
                topic=prompt_txt + push_note,
                agents=rt_agents,
                rounds=int(sched.get("roundtable_rounds") or 2),
                room_id=rid,
            )
            asyncio.create_task(start_war_room_roundtable(rt_req))
            return {"status": "dispatched_roundtable", "schedule_id": sched.get("id")}

    # Agent Dispatch (or fallback if <2 roundtable panelists)
    if is_room_busy(rid) and not manual:
        safe_rid = _safe_room_key(rid)
        queue_operator_directive(safe_rid, {
            "id": f"sched_q_{uuid.uuid4().hex[:6]}",
            "message": full_directive + push_note,
            "max_turns": 4,
            "handoff_enabled": True,
            "origin_channel": "whatsapp" if sched.get("push_to_owner_channel") else "scheduler",
            "queued_at": now,
        })
        q_list = list_operator_directives(safe_rid)
        await broadcast_event("war_room_queue_updated", {"room_id": rid, "queued": len(q_list), "queued_directives": q_list})
        q_note = {
            "id": str(uuid.uuid4()),
            "room_id": rid,
            "sender": "NexusDesk Scheduler",
            "sender_type": "system",
            "text": f"📥 Room currently busy—scheduled job `{sched.get('id')}` queued automatically and will run right after the active turn.",
            "timestamp": time.time(),
        }
        append_war_room_message(q_note, room_id=rid)
        await broadcast_event("war_room_message", q_note)
        return {"status": "queued_busy", "schedule_id": sched.get("id")}

    from routers.war_room.chat_turn import war_room_chat

    chat_req = WarRoomChatRequest(
        message=full_directive + push_note,
        room_id=rid,
        handoff_enabled=True,
        max_turns=4,
        skip_user_echo=True,
        origin_channel="whatsapp" if sched.get("push_to_owner_channel") else "scheduler",
    )
    asyncio.create_task(war_room_chat(chat_req, request=None))
    return {"status": "dispatched_agent", "schedule_id": sched.get("id")}


async def process_due_room_schedules() -> None:
    """Evaluates all rooms' enabled recurring/one-off schedules and triggers due entries."""
    from services.war_room.participants import get_all_rooms

    now = time.time()
    for rm in get_all_rooms():
        rid = rm.get("id", "general")
        for s in get_room_schedules(rid):
            if not s.get("enabled", True):
                continue
            next_at = s.get("next_run_at")
            if next_at and now >= float(next_at):
                try:
                    await fire_room_schedule(rid, s, manual=False)
                except Exception as e:
                    print(f"[WAR_ROOM_SCHEDULES] Dispatch warning for {rid}/{s.get('id')}: {e}")


def list_system_crontabs_readonly() -> List[Dict[str, Any]]:
    """
    Strictly READ-ONLY audit of Linux OS user crontabs across known NexusDesk/agent Linux accounts.
    Ensures zero hidden VPS shell crons go unnoticed alongside NexusDesk DAG & War Room schedulers.
    """
    from services.cron_formatter import format_cron_schedule

    users = ["myvirtualcoder", "agents_bs", "freecoder", "thecodexer"]
    results: List[Dict[str, Any]] = []
    seen_sigs = set()

    for usr in users:
        raw_lines: List[str] = []
        for cmd in (["crontab", "-u", usr, "-l"], ["sudo", "-n", "-u", usr, "crontab", "-l"]):
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=2.5)
                if proc.returncode == 0 and proc.stdout.strip():
                    raw_lines = proc.stdout.splitlines()
                    break
            except Exception:
                continue

        if not raw_lines and usr == "myvirtualcoder":
            try:
                proc = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=2.5)
                if proc.returncode == 0 and proc.stdout.strip():
                    raw_lines = proc.stdout.splitlines()
            except Exception:
                pass

        for idx, line in enumerate(raw_lines):
            s = line.strip()
            if not s or s.startswith("#") or "=" in s.split()[0]:
                continue
            parts = s.split(None, 5)
            if len(parts) < 6 and not s.startswith("@"):
                continue
            if s.startswith("@"):
                expr, command = parts[0], " ".join(parts[1:])
            else:
                expr, command = " ".join(parts[:5]), parts[5]

            sig = f"{usr}:{expr}:{command}"
            if sig in seen_sigs:
                continue
            seen_sigs.add(sig)
            timing = format_cron_schedule(expr)
            results.append({
                "id": f"sys_{usr}_{idx}",
                "name": f"[{usr}] {command[:48]}{'...' if len(command) > 48 else ''}",
                "prompt": command,
                "agent": usr,
                "schedule": {"expr": expr},
                "schedule_display": expr,
                "schedule_human": timing.get("human_schedule") or expr,
                "next_execution": timing.get("next_execution") or "OS Managed",
                "next_run_at": timing.get("next_run_iso"),
                "last_status": "READ-ONLY",
                "enabled": True,
                "engine_type": "system_crontab",
                "engine_label": f"VPS System Crontab ({usr})",
                "read_only": True,
            })

    return results
