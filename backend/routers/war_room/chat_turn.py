"""
NexusDesk War Room Multi-Turn Chat Chain, Round-Table & Queue Watcher
=====================================================================
Part of NexusDesk War Room Router Package (BL-ARCH-32, BL-WAR-18..50, BL-SYS-60/63).

Orchestrates sequential autonomous agent turn chains (`_war_room_chat_impl`),
parses inline `<async_task>`, `<set_reminder>`, and `<outbound_message>` blocks,
handles cross-engine incapacitation failover, coordinates rotational round-table
deliberations, and drains idle room queues asynchronously.
"""

import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

from core.config import broadcast_event, get_operator_name
from routers.war_room.routing_helpers import (
    ACTIVE_WAR_ROOM_TASKS,
    _safe_room_key,
    get_concluding_orchestrator,
    is_error_turn,
    is_room_busy,
    resolve_contextual_targets,
)
from schemas.models import WarRoomChatRequest, WarRoomRoundTableRequest, WarRoomSwarmLaunchRequest
from services.war_room.context_engine import maybe_trigger_async_compaction
from services.war_room.execution import (
    TurnInterrupted,
    append_war_room_message,
    count_operator_directives,
    execute_agent_war_room_turn,
    extract_shout_snippet,
    get_interrupt_gen,
    list_operator_directives,
    peek_next_operator_directive,
    pop_next_operator_directive,
    read_war_room_history,
)
from services.war_room.inquiries import (
    extract_inquiry_from_reply,
    extract_quick_chips,
    get_room_inquiries,
    resolve_room_inquiry,
    set_room_inquiry,
)
from services.war_room.participants import (
    find_unroped_mentions,
    get_all_conference_participants,
    get_all_rooms,
    get_broadcast_panelists,
    get_room_participants,
    parse_all_mentions,
    parse_special_mentions,
    resolve_participant,
)
from services.war_room.reminders import (
    add_room_reminder,
    check_and_fire_turn_reminders,
    get_room_reminders,
    parse_natural_reminder_directive,
    parse_natural_timeout_directive,
)
from services.war_room.schedules import (
    get_room_schedules,
    manage_room_schedule_action,
    parse_natural_schedule_directive,
    upsert_room_schedule,
)
from services.war_room.roundtable import ACTIVE_ROUNDTABLE_TASKS, run_roundtable_deliberation
from services.war_room.tasks import (
    discover_and_adopt_sandbox_bg_processes,
    launch_two_phase_background_task,
)

router = APIRouter(tags=["war_room"])

# Active 10-second Pre-Flight Understanding & Action Plan countdown gates:
# key = f"{safe_rid}:{agent_lower}" -> {"event": asyncio.Event, "action": "proceed"|"hold"|"cancel"}
ACTIVE_PREFLIGHT_GATES: Dict[str, Dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# 1. Per-Turn Agent Tag Helpers
# ---------------------------------------------------------------------------

_WAR_ROOM_CONTROL_TAG_RE = re.compile(
    r"<(chat_agent_whatsapp|chat_agent_publish|chat_agent_recap_config|async_task|set_reminder|set_schedule|manage_schedule|outbound_message|next_step)\b[^>]*>.*?</\1>",
    re.DOTALL | re.IGNORECASE,
)


def _strip_executed_war_room_control_tags(text: str) -> str:
    """Removes executed internal XML+JSON control blocks from stored War Room chat display text."""
    if not text:
        return ""
    cleaned = _WAR_ROOM_CONTROL_TAG_RE.sub("", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


async def _process_agent_async_tasks(
    reply: str,
    room_id: str,
    agent: Dict[str, Any],
    user_msg: str,
    recent_user_texts: List[str],
) -> None:
    """Parses `<async_task>` JSON blocks from an agent reply and launches background jobs."""
    cleaned_for_async = re.sub(r"`<async_task>`", "", reply, flags=re.IGNORECASE)
    async_matches = list(re.finditer(r"<async_task>((?:(?!</?async_task>).)*?)</async_task>", cleaned_for_async, re.DOTALL | re.IGNORECASE))
    for m in async_matches:
        raw_payload = m.group(1).strip()
        try:
            clean_payload = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_payload, flags=re.IGNORECASE | re.MULTILINE).strip()
            if not clean_payload.startswith("{"):
                json_obj_match = re.search(r"(\{[\s\S]*\})", clean_payload)
                if json_obj_match:
                    clean_payload = json_obj_match.group(1)
            task_data = json.loads(clean_payload)
            desc = task_data.get("description") or f"Delegated work from {agent['name']}"
            cmd = task_data.get("command")
            t_out = int(task_data.get("timeout") or 600)
            fol_dir = task_data.get("followup_directive")

            auto_chain = bool(task_data.get("auto_proceed_on_success") or task_data.get("auto_proceed"))
            if not auto_chain:
                combined_prompt = f"{user_msg} {' '.join(recent_user_texts)}"
                if re.search(
                    r"\b(?:auto(?:matically)?\s+(?:proceed|continue|execute|do|run|chain)|auto[-_]proceed(?:[-_]on[-_]success)?|(?:if|once)\s+(?:(?:(?:the\s+)?async\s+job\s+)?finished\s+without\s+error|no\s+error|clean|success|ok|without\s+error)\s+(?:you\s+can\s+|agents?\s+can\s+)?(?:proceed|continue|run|do|chain))\b",
                    combined_prompt,
                    re.I,
                ):
                    auto_chain = True

            next_desc = task_data.get("next_task_description") or task_data.get("next_description")
            next_cmd = task_data.get("next_command")
            await launch_two_phase_background_task(
                rid=room_id,
                agent=agent,
                task_description=desc,
                command=cmd,
                timeout=t_out,
                followup_directive=fol_dir,
                auto_proceed_on_success=auto_chain,
                next_task_description=next_desc,
                next_command=next_cmd,
            )
        except Exception as e:
            print(f"[WAR_ROOM] Warning parsing async_task tag from {agent['name']}: {e} | Payload snippet: {raw_payload[:120]!r}")

    # Auto-discover & adopt any self-spawned background process launched via the agent's internal Bash tool
    try:
        await discover_and_adopt_sandbox_bg_processes(room_id, default_agent=agent, announce_in_room=True)
    except Exception as ad_e:
        print(f"[WAR_ROOM] Auto-adopt sandbox job warning for {agent['name']}: {ad_e}")


async def _process_agent_reminders(
    reply: str,
    room_id: str,
    agent: Dict[str, Any],
    participants: List[Dict[str, Any]],
) -> None:
    """Parses `<set_reminder>` tags or natural-language reminder requests emitted by an agent."""
    try:
        agent_rem_matches = list(re.finditer(r"<set_reminder>(.*?)</set_reminder>", reply, re.DOTALL | re.IGNORECASE))
        for arm in agent_rem_matches:
            raw_rem = arm.group(1).strip()
            try:
                rem_payload = json.loads(raw_rem)
                rem_text = rem_payload.get("text") or rem_payload.get("description") or f"Follow-up by {agent['name']}"
                in_mins = rem_payload.get("in_minutes") or rem_payload.get("minutes") or rem_payload.get("delay_minutes")
                target_ag = rem_payload.get("target_agent") or rem_payload.get("agent")

                now_ts = time.time()
                fire_at = None
                trigger_type = "relative_time"
                if in_mins:
                    fire_at = now_ts + (float(in_mins) * 60)
                    label = f"In {int(in_mins) if float(in_mins).is_integer() else in_mins}m"
                elif target_ag:
                    trigger_type = "after_agent"
                    label = f"After @{target_ag} turn"
                else:
                    fire_at = now_ts + 600
                    label = "In 10m"

                new_rem = {
                    "id": f"rem_{uuid.uuid4().hex[:8]}",
                    "room_id": room_id,
                    "text": rem_text,
                    "raw_input": raw_rem,
                    "trigger_type": trigger_type,
                    "target_agent": target_ag,
                    "fire_at": fire_at,
                    "created_at": now_ts,
                    "status": "pending",
                    "label": label,
                    "created_by": agent["name"],
                }
                add_room_reminder(room_id, new_rem)
                await broadcast_event("war_room_reminders_updated", {"room_id": room_id, "reminders": get_room_reminders(room_id, active_only=True)})
                rem_sys_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"⏰ **Scheduled Reminder Set by @{agent['name']} (`{new_rem['id']}`)**: *\"{new_rem['text']}\"* — Trigger: **{new_rem['label']}**.",
                    "timestamp": time.time(),
                }
                append_war_room_message(rem_sys_note, room_id=room_id)
                await broadcast_event("war_room_message", rem_sys_note)
            except Exception as parse_e:
                print(f"[WAR_ROOM] Warning parsing <set_reminder> JSON: {parse_e} | raw: {raw_rem[:100]!r}")

        if not agent_rem_matches:
            natural_agent_rem = parse_natural_reminder_directive(reply, participants=participants, room_id=room_id)
            if natural_agent_rem:
                natural_agent_rem["created_by"] = agent["name"]
                add_room_reminder(room_id, natural_agent_rem)
                await broadcast_event("war_room_reminders_updated", {"room_id": room_id, "reminders": get_room_reminders(room_id, active_only=True)})
                nat_sys_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"⏰ **Conversational Reminder Set by @{agent['name']} (`{natural_agent_rem['id']}`)**: *\"{natural_agent_rem['text']}\"* — Trigger: **{natural_agent_rem['label']}**.",
                    "timestamp": time.time(),
                }
                append_war_room_message(nat_sys_note, room_id=room_id)
                await broadcast_event("war_room_message", nat_sys_note)
    except Exception as e:
        print(f"[WAR_ROOM] Warning processing agent reminder: {e}")


async def _process_agent_schedules(
    reply: str,
    room_id: str,
    agent: Dict[str, Any],
) -> None:
    """Parses `<set_schedule>` and `<manage_schedule>` blocks emitted by a War Room agent."""
    try:
        cleaned_reply = re.sub(r"`<(/?(?:set|manage)_schedule)>`", "", reply or "", flags=re.IGNORECASE)

        sched_matches = list(re.finditer(r"<set_schedule>((?:(?!</?set_schedule>).)*?)</set_schedule>", cleaned_reply, re.DOTALL | re.IGNORECASE))
        for sm in sched_matches:
            raw_json = sm.group(1).strip()
            try:
                payload = json.loads(raw_json)
                if not isinstance(payload, dict):
                    continue
                payload["room_id"] = room_id
                payload["created_by"] = agent["name"]
                payload["created_via"] = "agent_tag"
                saved = upsert_room_schedule(room_id, payload)
                await broadcast_event("war_room_schedules_updated", {"room_id": room_id, "schedules": get_room_schedules(room_id)})
                sched_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Scheduler",
                    "sender_type": "system",
                    "text": (
                        f"🗓️ **War Room Schedule Created by @{agent['name']} (`{saved['id']}`)**: "
                        f"**{saved['title']}** — {saved['schedule_human']} · Mode: `{saved['mode']}` · Next: **{saved['next_run_display']}**"
                    ),
                    "timestamp": time.time(),
                }
                append_war_room_message(sched_note, room_id=room_id)
                await broadcast_event("war_room_message", sched_note)
            except Exception as pe:
                print(f"[WAR_ROOM] Warning parsing <set_schedule> JSON from {agent['name']}: {pe} | raw: {raw_json[:100]!r}")
                err_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Scheduler",
                    "sender_type": "system",
                    "text": f"⚠️ **Schedule Not Saved**: @{agent['name']} attempted to set a recurring schedule, but it could not be processed. Please re-add it via the **⏰ Scheduler** button or ask again cleanly.",
                    "timestamp": time.time(),
                }
                append_war_room_message(err_note, room_id=room_id)
                await broadcast_event("war_room_message", err_note)

        mgr_matches = list(re.finditer(r"<manage_schedule>((?:(?!</?manage_schedule>).)*?)</manage_schedule>", cleaned_reply, re.DOTALL | re.IGNORECASE))
        for mm in mgr_matches:
            raw_json = mm.group(1).strip()
            try:
                payload = json.loads(raw_json)
                if not isinstance(payload, dict):
                    continue
                res = manage_room_schedule_action(
                    room_id=room_id,
                    action=payload.get("action", ""),
                    schedule_id=payload.get("id") or payload.get("schedule_id"),
                    title_query=payload.get("title") or payload.get("query"),
                    updates=payload.get("updates") or payload,
                )
                if res:
                    await broadcast_event("war_room_schedules_updated", {"room_id": room_id, "schedules": get_room_schedules(room_id)})
                    act_lbl = str(payload.get("action", "updated")).upper()
                    mgr_note = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Scheduler",
                        "sender_type": "system",
                        "text": f"🗓️ **Schedule {act_lbl} by @{agent['name']} (`{res.get('id')}`)**: *{res.get('title', '')}*",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(mgr_note, room_id=room_id)
                    await broadcast_event("war_room_message", mgr_note)
            except Exception as me:
                print(f"[WAR_ROOM] Warning parsing <manage_schedule> JSON from {agent['name']}: {me} | raw: {raw_json[:100]!r}")
    except Exception as e:
        print(f"[WAR_ROOM] Warning processing agent schedules: {e}")


async def _process_agent_outbound_messages(
    reply: str,
    room_id: str,
    agent: Dict[str, Any],
    origin_channel: Optional[str],
    recent_user_texts: List[str],
) -> set:
    """Executes `<outbound_message>` blocks honoring channel-origin isolation rules (BL-SYS-63)."""
    explicit_dispatched_channels = set()
    req_origin = (origin_channel or "web").strip().lower()
    combined_user_context = " ".join(recent_user_texts)
    user_explicit_push = bool(
        re.search(
            r"\b(whatsapp|wa|telegram|tg|email|google[_\s]?drive|gdrive)\b|\b(send|push|forward|deliver|share|resend)\b[\s\S]{0,40}\b(phone|whatsapp|wa|telegram|tg|email|mobile)\b",
            combined_user_context,
            re.IGNORECASE,
        )
    )

    outbound_matches = re.finditer(
        r'<outbound_message(?:\s+channel=["\'](.*?)["\'])?(?:\s+recipient=["\'](.*?)["\'])?(?:\s+file=["\'](.*?)["\'])?>(.*?)</outbound_message>',
        reply,
        re.DOTALL | re.IGNORECASE,
    )
    for om in outbound_matches:
        om_chan = (om.group(1) or "whatsapp").strip().lower()
        om_recip = (om.group(2) or "").strip() or None
        om_file = (om.group(3) or "").strip() or None
        om_body = om.group(4).strip()

        if not om_file and om_body.startswith("/") and os.path.isfile(om_body.split("\n")[0].strip()):
            lines = om_body.split("\n")
            om_file = lines[0].strip()
            om_body = "\n".join(lines[1:]).strip()

        if req_origin in ("web", "ui", "internal") and not user_explicit_push:
            print(f"[WAR_ROOM] BL-SYS-63: Suppressing unsolicited outbound push to {om_chan} because operator turn originated on Web.")
            continue
        if req_origin in ("whatsapp", "wa") and om_chan in ("all", "telegram"):
            om_chan = "whatsapp"
        if req_origin in ("telegram", "tg") and om_chan in ("all", "whatsapp"):
            om_chan = "telegram"

        if om_body or om_file:
            try:
                from services.gateways import send_outbound_from_agent
                res = send_outbound_from_agent(
                    channel=om_chan,
                    message=om_body or f"Deliverable report: {os.path.basename(om_file)}",
                    agent_name=agent["name"],
                    room_id=room_id,
                    recipient=om_recip,
                    file_path=om_file,
                )
                if om_chan == "all":
                    explicit_dispatched_channels.update(["whatsapp", "telegram", "email", "webhook", "google_drive"])
                else:
                    explicit_dispatched_channels.add(om_chan)
                file_badge = f" with file `{os.path.basename(om_file)}`" if om_file else ""
                gw_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"📱 **Outbound Gateway**: **{agent['name']}** successfully dispatched message to **{om_chan.upper()}** ({res.get('target', 'operator')}){file_badge} ✓",
                    "timestamp": time.time(),
                }
                append_war_room_message(gw_note, room_id=room_id)
                await broadcast_event("war_room_message", gw_note)
            except Exception as e:
                err_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Gateway",
                    "sender_type": "system",
                    "text": f"⚠️ **Outbound Gateway Failed**: Could not dispatch via **{om_chan.upper()}**: {e}",
                    "timestamp": time.time(),
                }
                append_war_room_message(err_note, room_id=room_id)
                await broadcast_event("war_room_message", err_note)

    return explicit_dispatched_channels


async def _process_war_room_chat_agent_bridges(
    reply: str,
    room_id: str,
    agent: Dict[str, Any],
) -> None:
    """Executes authorized `<chat_agent_recap_config>`, `<chat_agent_publish>`, and `<chat_agent_whatsapp>` tags."""
    if not reply or ("<chat_agent_" not in reply.lower()):
        return

    from services.war_room.participants import get_all_rooms
    from services import chat_agents as ca_svc

    room_obj = next((r for r in get_all_rooms() if r.get("id") == room_id), None) or {}
    linked = room_obj.get("linked_chat_workspaces") or []
    link_map = {(str(x.get("agent_id") or "").lower(), str(x.get("scope_id") or "")): x for x in linked if isinstance(x, dict)}
    sandbox_root = Path(f"/home/nexus_shared/sandboxes/{room_id}")

    async def _post_sys(text_msg: str) -> None:
        note = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Workspace Bridge",
            "sender_type": "system",
            "text": text_msg,
            "timestamp": time.time(),
        }
        append_war_room_message(note, room_id=room_id)
        await broadcast_event("war_room_message", note)

    # 1. <chat_agent_recap_config>...</chat_agent_recap_config>
    for m in re.finditer(r"<chat_agent_recap_config>((?:(?!</?chat_agent_recap_config>).)*?)</chat_agent_recap_config>", reply, re.S | re.I):
        try:
            payload = json.loads(m.group(1).strip())
            aid = str(payload.get("agent_id") or "").strip().lower()
            sid = str(payload.get("scope_id") or "").strip()
            if (aid, sid) not in link_map:
                await _post_sys(f"⚠️ **Bridge Blocked**: Workspace `{aid}/{sid}` is not linked to this War Room.")
                continue
            saved = ca_svc.save_workspace_recap_script(
                aid,
                sid,
                code_text=payload.get("hook_code") or payload.get("code"),
                rules_dict=payload.get("rules"),
                remove_hook=bool(payload.get("remove_hook")),
            )
            if payload.get("trigger_rollover"):
                ca_svc.rollover_market_intelligence_month(aid, sid, dry_run=bool(payload.get("dry_run")))
            await _post_sys(f"⚙️ **Extractor Updated by @{agent['name']}**: `{aid}/{sid}` (`hook={'ACTIVE' if saved.get('has_custom_hook') else 'default'}`, {saved.get('total_posts', 0)} rows) ✓")
        except Exception as e:
            await _post_sys(f"⚠️ **Extractor Update Failed**: {e}")

    # 2. <chat_agent_publish>...</chat_agent_publish>
    for m in re.finditer(r"<chat_agent_publish>((?:(?!</?chat_agent_publish>).)*?)</chat_agent_publish>", reply, re.S | re.I):
        try:
            payload = json.loads(m.group(1).strip())
            aid = str(payload.get("agent_id") or "").strip().lower()
            sid = str(payload.get("scope_id") or "").strip()
            if (aid, sid) not in link_map:
                await _post_sys(f"⚠️ **Publish Blocked**: Workspace `{aid}/{sid}` is not linked to this War Room.")
                continue
            res = ca_svc.publish_deliverable_to_subdata(aid, sid, files=payload.get("files") or [], sandbox_root=sandbox_root)
            names = ", ".join(f"`{p['filename']}`" for p in res.get("published", [])) or "none"
            await _post_sys(f"📦 **Published to Chat Agent (`{aid}/{sid}`) by @{agent['name']}**: {names} ✓")
        except Exception as e:
            await _post_sys(f"⚠️ **Workspace Publish Failed**: {e}")

    # 3. <chat_agent_whatsapp>...</chat_agent_whatsapp>
    for m in re.finditer(r"<chat_agent_whatsapp>((?:(?!</?chat_agent_whatsapp>).)*?)</chat_agent_whatsapp>", reply, re.S | re.I):
        try:
            payload = json.loads(m.group(1).strip())
            aid = str(payload.get("agent_id") or "").strip().lower()
            sid = str(payload.get("scope_id") or "").strip()
            lnk = link_map.get((aid, sid))
            if not lnk:
                await _post_sys(f"⚠️ **Broadcast Blocked**: Workspace `{aid}/{sid}` is not linked to this War Room.")
                continue
            if not lnk.get("allow_group_broadcast"):
                await _post_sys(f"⚠️ **Broadcast Blocked**: Enable `Allow Group Broadcast` for `{aid}/{sid}` in Room Settings first.")
                continue
            res = await asyncio.to_thread(
                ca_svc.broadcast_subdata_files_to_whatsapp,
                aid,
                sid,
                files=payload.get("files") or [],
                message=str(payload.get("message") or payload.get("caption") or ""),
                to_target=str(payload.get("to") or "bound_group"),
                sandbox_root=sandbox_root,
            )
            sent_names = ", ".join(f"`{d.get('file') or 'message'}`" for d in res.get("dispatched", []))
            ag_display = (ca_svc.get_chat_agent(aid) or {}).get("name") or aid
            await _post_sys(f"📢 **{ag_display} (`{aid}`) Group Broadcast to `{res.get('target')}`**: {sent_names} ✓")
        except Exception as e:
            await _post_sys(f"⚠️ **Group Broadcast Failed**: {e}")


async def _handle_user_yield_inquiry(
    reply: str,
    room_id: str,
    agent: Dict[str, Any],
    origin_channel: Optional[str],
) -> None:
    """Registers an operator inquiry & quick chips when an agent genuinely requests `@user` input."""
    op_name = get_operator_name()
    extracted = extract_inquiry_from_reply(reply, agent["name"], op_name=op_name)
    if not extracted:
        # Passive mention only (no question, no <next_step>, no direct action request)
        return

    inquiry_q = extracted["question"]
    extracted_ns = extracted.get("next_step")
    chips = extracted.get("chips") or extract_quick_chips(inquiry_q, next_step=extracted_ns, full_reply=reply)

    # Suppress repetitive 5-minute scheduler polling chatter from re-posting duplicate Moderator notes
    # when the exact same inquiry from the same agent is already pending in the room
    existing_inqs = get_room_inquiries(room_id)
    already_same = any(
        i.get("agent", "").lower() == agent["name"].lower() and i.get("question") == inquiry_q
        for i in existing_inqs
    )

    inquiry_entry = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "agent": agent["name"],
        "engine": agent["engine"],
        "color": agent["color"],
        "timestamp": time.time(),
        "status": extracted.get("status", "input_needed"),
        "question": inquiry_q,
        "next_step": extracted_ns,
        "chips": chips,
    }
    set_room_inquiry(room_id, inquiry_entry)
    await broadcast_event("war_room_inquiries_updated", {"room_id": room_id, "inquiries": get_room_inquiries(room_id)})

    if origin_channel == "scheduler" and already_same:
        return

    user_yield_note = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "sender": "NexusDesk Moderator",
        "sender_type": "system",
        "text": f"👤 **Input Requested (@{op_name})**: **{agent['name']}** is awaiting your input.",
        "timestamp": time.time(),
    }
    append_war_room_message(user_yield_note, room_id=room_id)
    await broadcast_event("war_room_message", user_yield_note)
    await broadcast_event("war_room_user_mentioned", {
        "room_id": room_id,
        "agent": agent["name"],
        "engine": agent["engine"],
        "text": reply,
        "inquiry": inquiry_entry,
        "origin_channel": origin_channel or "web",
        "timestamp": time.time(),
    })


@router.post("/api/war-room/preflight/decision")
async def war_room_preflight_decision(payload: Dict[str, Any]):
    """Allows the operator to Proceed Immediately, Hold/Adjust, or Cancel during the 10s pre-flight plan window."""
    room_id = str(payload.get("room_id") or "general").strip()
    safe_rid = _safe_room_key(room_id)
    agent_name = str(payload.get("agent") or "").strip().lower()
    action = str(payload.get("action") or "proceed").strip().lower()
    if action not in ("proceed", "hold", "cancel"):
        action = "proceed"

    matched_keys = []
    if agent_name and agent_name != "all":
        k = f"{safe_rid}:{agent_name}"
        if k in ACTIVE_PREFLIGHT_GATES:
            matched_keys.append(k)
    if not matched_keys:
        matched_keys = [k for k in list(ACTIVE_PREFLIGHT_GATES.keys()) if k.startswith(f"{safe_rid}:")]

    for k in matched_keys:
        g = ACTIVE_PREFLIGHT_GATES.get(k)
        if g:
            g["action"] = action
            ev = g.get("event")
            if ev and not ev.is_set():
                ev.set()

    return {"status": "ok", "room_id": room_id, "agent": agent_name, "action": action, "matched": len(matched_keys)}


async def _run_preflight_understanding_gate(
    *,
    room_id: str,
    safe_rid: str,
    chain_gen: int,
    agent: Dict[str, Any],
    directive_text: str,
    recent_history: List[Dict[str, Any]],
    swarm_phase: str = "",
    origin_channel: Optional[str] = "web",
    hold_for_countdown: bool = True,
    manual_review_only: bool = False,
    countdown_seconds: int = 10,
) -> str:
    """
    Generates a structured Pre-Flight Understanding & Action Plan brief (~1-2s),
    displays it in the live agent card with a 10-second countdown (or manual gate if Review Plan is toggled),
    and returns 'proceed' (if 10s elapses with no feedback or user clicks Proceed) or 'hold' (if user clicks Hold/Adjust).
    """
    from services.war_room.orchestration import generate_pre_execution_brief

    is_interactive = (origin_channel or "web").lower() in ("web", "ui", "")
    enable_gate = bool(is_interactive and hold_for_countdown)
    effective_countdown = 0 if (enable_gate and manual_review_only) else (countdown_seconds if enable_gate else 0)

    gate_key = f"{safe_rid}:{agent['name'].lower().strip()}"
    ev = asyncio.Event()
    gate_obj = {"event": ev, "action": "proceed", "agent": agent["name"], "room_id": room_id}
    if enable_gate:
        ACTIVE_PREFLIGHT_GATES[gate_key] = gate_obj

    try:
        try:
            brief = await asyncio.to_thread(
                generate_pre_execution_brief,
                agent["name"],
                agent.get("role", "Specialist Agent"),
                directive_text,
                recent_history,
                swarm_phase,
            )
        except Exception:
            brief = {
                "understanding": f"Execute assigned {agent.get('role', 'Specialist')} task.",
                "plan_steps": ["Inspect sandbox context and files", "Execute required actions and verify output"],
                "intent": f"Executing {agent['name']} turn...",
            }

        if get_interrupt_gen(safe_rid) != chain_gen:
            return "hold"

        await broadcast_event("war_room_agent_intent", {
            "room_id": room_id,
            "agent": agent["name"],
            "engine": agent["engine"],
            "color": agent.get("color", "#06b6d4"),
            "swarm_phase": swarm_phase,
            "intent": brief.get("intent") or brief.get("understanding") or "",
            "understanding": brief.get("understanding") or "",
            "plan_steps": brief.get("plan_steps") or [],
            "preflight_gate": enable_gate and not ev.is_set(),
            "manual_review_only": bool(enable_gate and manual_review_only),
            "countdown_seconds": effective_countdown,
            "timestamp": time.time(),
        })

        if not enable_gate:
            return "proceed"

        if not ev.is_set():
            if manual_review_only:
                # Wait up to 10 minutes when manual 'Review Plan' toggle is explicitly ON
                await asyncio.wait_for(ev.wait(), timeout=600.0)
            else:
                # Default: 10-second countdown; if no feedback from user within 10s, auto-proceed!
                try:
                    await asyncio.wait_for(ev.wait(), timeout=float(countdown_seconds))
                except asyncio.TimeoutError:
                    gate_obj["action"] = "proceed"
    finally:
        ACTIVE_PREFLIGHT_GATES.pop(gate_key, None)

    if get_interrupt_gen(safe_rid) != chain_gen:
        return "hold"

    final_action = gate_obj.get("action", "proceed")
    await broadcast_event("war_room_preflight_resolved", {
        "room_id": room_id,
        "agent": agent["name"],
        "action": final_action,
        "timestamp": time.time(),
    })

    if final_action in ("hold", "cancel"):
        op_name = get_operator_name()
        hold_note = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": (
                f"⏸️ **Pre-Flight Held (@{op_name})**: **@{agent['name']}** paused before executing the action plan. "
                f"Send your adjusted instructions whenever ready."
            ),
            "timestamp": time.time(),
        }
        append_war_room_message(hold_note, room_id=room_id)
        await broadcast_event("war_room_message", hold_note)
        await broadcast_event("agent_state", {"agent": agent["name"], "state": "idle"})
        await broadcast_event("war_room_speaker_stop", {"room_id": room_id, "agent": agent["name"]})
        return "hold"

    return "proceed"


def _spawn_pre_execution_intent(
    *,
    room_id: str,
    safe_rid: str,
    chain_gen: int,
    agent: Dict[str, Any],
    directive_text: str,
    recent_history: List[Dict[str, Any]],
    swarm_phase: str = "",
) -> asyncio.Task:
    """Fires a non-blocking fast intent preview (~1-2s) in parallel with follow-up/non-gated agent turns."""
    async def _runner():
        try:
            from services.war_room.orchestration import generate_pre_execution_brief
            brief = await asyncio.to_thread(
                generate_pre_execution_brief,
                agent["name"],
                agent.get("role", "Specialist Agent"),
                directive_text,
                recent_history,
                swarm_phase,
            )
            if get_interrupt_gen(safe_rid) != chain_gen:
                return
            if brief:
                await broadcast_event("war_room_agent_intent", {
                    "room_id": room_id,
                    "agent": agent["name"],
                    "engine": agent["engine"],
                    "color": agent.get("color", "#06b6d4"),
                    "swarm_phase": swarm_phase,
                    "intent": brief.get("intent") or brief.get("understanding") or "",
                    "understanding": brief.get("understanding") or "",
                    "plan_steps": brief.get("plan_steps") or [],
                    "preflight_gate": False,
                    "countdown_seconds": 0,
                    "timestamp": time.time(),
                })
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
    return asyncio.create_task(_runner())


def _parse_swarm_dispatch_with_flag(
    reply_text: str,
    candidate_workers: List[Dict[str, Any]],
    lead_id: str,
) -> tuple[bool, List[Dict[str, Any]]]:
    """
    Parses `<swarm_dispatch>[{\"agent\": ..., \"task\": ...}]</swarm_dispatch>` from Lead Planner reply.
    Returns `(tag_present, resolved_items)` so an explicit `<swarm_dispatch>[]</swarm_dispatch>`
    cleanly signals '0 workers needed' instead of triggering a fallback launch.
    """
    if not reply_text:
        return False, []
    cleaned = re.sub(r"`<swarm_dispatch>`", "", reply_text, flags=re.IGNORECASE)
    matches = list(re.finditer(r"<swarm_dispatch>([\s\S]*?)</swarm_dispatch>", cleaned, re.IGNORECASE))
    if not matches:
        return False, []
    resolved: List[Dict[str, Any]] = []
    seen_ids = {lead_id}
    for m in matches:
        raw_json = m.group(1).strip()
        raw_json = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_json, flags=re.IGNORECASE).strip()
        try:
            payload = json.loads(raw_json)
            if isinstance(payload, dict):
                payload = payload.get("tasks") or payload.get("workers") or [payload]
            if not isinstance(payload, list):
                continue
            for item in payload:
                if not isinstance(item, dict):
                    continue
                ag_name = str(item.get("agent") or item.get("name") or "").strip().lstrip("@")
                task_txt = str(item.get("task") or item.get("assignment") or item.get("prompt") or "").strip()
                if not ag_name:
                    continue
                p = resolve_participant(ag_name, candidate_workers)
                if p and p["id"] not in seen_ids:
                    seen_ids.add(p["id"])
                    resolved.append({"agent": p, "task": task_txt})
        except Exception as e:
            print(f"[WAR_ROOM_SWARM] Warning parsing <swarm_dispatch>: {e}")
    return True, resolved


def _parse_swarm_dispatch(
    reply_text: str,
    candidate_workers: List[Dict[str, Any]],
    lead_id: str,
) -> List[Dict[str, Any]]:
    _, items = _parse_swarm_dispatch_with_flag(reply_text, candidate_workers, lead_id)
    return items


def _extract_noop_reason(reply_text: str) -> Optional[str]:
    """Detects an explicit `<no_op>` / `<no_op>reason</no_op>` worker bailout when no unique work remains."""
    if not reply_text:
        return None
    # Never treat as no_op if the agent emitted actual action tags
    if re.search(r"<(?:async_task|set_schedule|manage_schedule|outbound_message|chat_agent_publish|chat_agent_recap_config|chat_agent_whatsapp)\b", reply_text, re.IGNORECASE):
        return None
    m_body = re.search(r"<no_op>(.*?)</no_op>", reply_text, flags=re.IGNORECASE | re.DOTALL)
    if m_body:
        reason = re.sub(r"\s+", " ", m_body.group(1)).strip()
        return reason or "Already handled by another agent"
    if re.search(r"<no_op\s*/>", reply_text, flags=re.IGNORECASE):
        stripped = re.sub(r"<no_op\s*/>", "", reply_text, flags=re.IGNORECASE).strip()
        return (stripped[:140] if stripped and len(stripped) < 180 else "Already handled by another agent")
    return None


async def _finalize_agent_reply(
    *,
    agent: Dict[str, Any],
    reply: str,
    room_id: str,
    participants: List[Dict[str, Any]],
    all_conf_participants: List[Dict[str, Any]],
    user_msg: str,
    curr_transcript: List[Dict[str, Any]],
    origin_channel: Optional[str],
    current_turn: int,
    max_turns: int,
    extra_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Post-processes, persists, and broadcasts a single completed agent reply."""
    # Quiet anti-duplication bailout: if a swarm worker emitted <no_op>, skip duplicate chat bubble & TTS
    noop_reason = _extract_noop_reason(reply)
    if noop_reason is not None and extra_meta and extra_meta.get("swarm_phase") in ("worker", "swarm"):
        skip_note = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"⏭️ **@{agent['name']}** skipped redundant turn: {noop_reason}",
            "timestamp": time.time(),
        }
        append_war_room_message(skip_note, room_id=room_id)
        await broadcast_event("war_room_message", skip_note)
        await broadcast_event("agent_state", {"agent": agent["name"], "state": "idle"})
        await broadcast_event("war_room_speaker_stop", {"room_id": room_id, "agent": agent["name"]})
        return {
            "agent": agent,
            "reply": reply,
            "msg_entry": skip_note,
            "reply_mentions": [],
            "reply_special": {"is_broadcast": False, "mentions_user": False},
            "is_error": False,
            "is_noop": True,
            "snippet": f"[Skipped: {noop_reason[:60]}]",
        }

    reply_mentions = parse_all_mentions(reply, participants)
    reply_special = parse_special_mentions(reply)
    turn_mentions = [p["name"] for p in reply_mentions]
    if reply_special["is_broadcast"]:
        turn_mentions.insert(0, "everyone")
    if reply_special["mentions_user"]:
        turn_mentions.append("user")

    unroped_in_reply = find_unroped_mentions(reply, participants, all_conf_participants)
    if unroped_in_reply:
        unroped_lbls = ", ".join(f"**@{p['name']}**" for p in unroped_in_reply)
        guard_note = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"🛡️ **Whitelist Guard**: **{agent['name']}** attempted to delegate to {unroped_lbls}, who is not in this room. Delegation intercepted to prevent hallucinated handoffs.",
            "timestamp": time.time(),
        }
        append_war_room_message(guard_note, room_id=room_id)
        await broadcast_event("war_room_message", guard_note)

    recent_user_texts = [user_msg] + [m.get("text", "") for m in curr_transcript[-6:] if m.get("sender_type") == "user"]
    await _process_agent_async_tasks(reply, room_id, agent, user_msg, recent_user_texts)
    await _process_agent_reminders(reply, room_id, agent, participants)
    await _process_agent_schedules(reply, room_id, agent)
    await _process_war_room_chat_agent_bridges(reply, room_id, agent)
    explicit_dispatched_channels = await _process_agent_outbound_messages(
        reply, room_id, agent, origin_channel, recent_user_texts
    )

    is_error = is_error_turn({"text": reply})
    display_reply = _strip_executed_war_room_control_tags(reply) or reply
    if not is_error and origin_channel and origin_channel not in ["web", "ui", "internal"]:
        try:
            from services.gateways import mirror_agent_turn_to_omnichannel
            await mirror_agent_turn_to_omnichannel(
                agent_name=agent["name"],
                agent_engine=agent["engine"],
                reply_text=display_reply,
                room_id=room_id,
                explicit_dispatched_channels=explicit_dispatched_channels,
                origin_channel=origin_channel,
            )
        except Exception as omni_err:
            print(f"[WAR_ROOM] Omnichannel mirror warning: {omni_err}")

    msg_entry = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "sender": agent["name"],
        "sender_type": "agent",
        "text": display_reply,
        "engine": agent["engine"],
        "color": agent["color"],
        "role": agent.get("role", ""),
        "is_error": is_error,
        "mentions": turn_mentions,
        "mentions_user": reply_special["mentions_user"],
        "timestamp": time.time(),
        "turn_index": current_turn,
        "turn": current_turn,
        "max_turns": max_turns,
        "origin_channel": origin_channel or "web",
    }
    if extra_meta:
        msg_entry.update(extra_meta)

    append_war_room_message(msg_entry, room_id=room_id)
    await broadcast_event("war_room_message", msg_entry)

    snippet = extract_shout_snippet(display_reply, max_len=80)
    await broadcast_event("agent_shout", {
        "agent": agent["name"],
        "message": snippet,
        "category": "info",
        "duration": 6,
        "announce_tts": True,
        "voice": agent.get("voice"),
    })
    await broadcast_event("agent_state", {"agent": agent["name"], "state": "idle"})
    await broadcast_event("war_room_speaker_stop", {"room_id": room_id, "agent": agent["name"]})
    await check_and_fire_turn_reminders(room_id, agent["name"])

    return {
        "agent": agent,
        "reply": reply,
        "msg_entry": msg_entry,
        "reply_mentions": reply_mentions,
        "reply_special": reply_special,
        "is_error": is_error,
        "snippet": snippet,
    }


async def _run_parallel_wave(
    *,
    wave_items: List[Dict[str, Any]],
    room_id: str,
    safe_rid: str,
    participants: List[Dict[str, Any]],
    all_conf_participants: List[Dict[str, Any]],
    directive_for_agents: str,
    user_msg: str,
    origin_channel: Optional[str],
    custom_timeout_seconds: Optional[int],
    chain_gen: int,
    wave_num: int,
    max_waves: int,
    swarm_phase: str = "swarm",
) -> List[Dict[str, Any]]:
    """
    Executes a deduplicated batch of agents concurrently and streams each result
    to the War Room transcript the instant it finishes.
    """
    unique_items: List[Dict[str, Any]] = []
    seen_ids = set()
    for item in wave_items:
        ag = item["agent"]
        if ag["id"] not in seen_ids:
            seen_ids.add(ag["id"])
            unique_items.append(item)

    if not unique_items:
        return []

    curr_transcript = read_war_room_history(room_id=room_id, limit=20)
    all_names = [it["agent"]["name"] for it in unique_items]

    for it in unique_items:
        ag = it["agent"]
        payload = {
            "room_id": room_id,
            "agent": ag["name"],
            "engine": ag["engine"],
            "color": ag["color"],
            "swarm_wave": wave_num,
        }
        if custom_timeout_seconds:
            payload["timeout_seconds"] = custom_timeout_seconds
        await broadcast_event("war_room_speaker_start", payload)
        await broadcast_event("agent_state", {"agent": ag["name"], "state": "working"})

    async def _run_single_worker(it: Dict[str, Any]) -> Dict[str, Any]:
        ag = it["agent"]
        peers = [n for n in all_names if n.lower() != ag["name"].lower()]
        task_override = (it.get("task") or "").strip()
        worker_directive = (
            f"{directive_for_agents}\n\n[ASSIGNED SWARM SUB-TASK FOR @{ag['name']}]:\n{task_override}"
            if task_override
            else directive_for_agents
        )
        if wave_num == 1 and swarm_phase == "swarm":
            pf_act = await _run_preflight_understanding_gate(
                room_id=room_id,
                safe_rid=safe_rid,
                chain_gen=chain_gen,
                agent=ag,
                directive_text=task_override or directive_for_agents,
                recent_history=curr_transcript,
                swarm_phase=swarm_phase,
                origin_channel=origin_channel or "web",
                hold_for_countdown=True,
                manual_review_only=False,
                countdown_seconds=10,
            )
            if pf_act == "hold":
                return {"agent": ag, "reply": "", "held": True}
            intent_task = None
        else:
            intent_task = _spawn_pre_execution_intent(
                room_id=room_id,
                safe_rid=safe_rid,
                chain_gen=chain_gen,
                agent=ag,
                directive_text=task_override or directive_for_agents,
                recent_history=curr_transcript,
                swarm_phase=swarm_phase,
            )
        try:
            reply = await execute_agent_war_room_turn(
                agent=ag,
                directive_text=worker_directive,
                transcript=curr_transcript,
                room_id=room_id,
                room_participants=participants,
                turn_info={"current_turn": wave_num, "max_turns": max_waves, "swarm_wave": wave_num},
                interrupt_gen=chain_gen,
                origin_channel=origin_channel or "web",
                timeout_override=custom_timeout_seconds,
                swarm_assignment=task_override or None,
                parallel_peers=peers,
            )
        finally:
            if intent_task and not intent_task.done():
                intent_task.cancel()
        return {"agent": ag, "reply": reply}

    tasks = [asyncio.create_task(_run_single_worker(it)) for it in unique_items]
    results: List[Dict[str, Any]] = []
    try:
        for fut in asyncio.as_completed(tasks):
            if get_interrupt_gen(safe_rid) != chain_gen:
                raise TurnInterrupted()
            try:
                worker_out = await fut
            except TurnInterrupted:
                raise
            except asyncio.CancelledError:
                raise
            except Exception as worker_err:
                print(f"[WAR_ROOM_SWARM] Worker error in wave {wave_num}: {worker_err}")
                continue
            if get_interrupt_gen(safe_rid) != chain_gen:
                raise TurnInterrupted()
            if worker_out.get("held"):
                continue
            fin = await _finalize_agent_reply(
                agent=worker_out["agent"],
                reply=worker_out["reply"],
                room_id=room_id,
                participants=participants,
                all_conf_participants=all_conf_participants,
                user_msg=user_msg,
                curr_transcript=curr_transcript,
                origin_channel=origin_channel,
                current_turn=wave_num,
                max_turns=max_waves,
                extra_meta={
                    "execution_mode": "parallel",
                    "swarm_wave": wave_num,
                    "swarm_phase": swarm_phase,
                },
            )
            results.append(fin)
    except (TurnInterrupted, asyncio.CancelledError):
        for t in tasks:
            if not t.done():
                t.cancel()
        raise
    return results


# ---------------------------------------------------------------------------
# 2. Primary Chat Turn Chain & REST Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/war-room/chat")
async def war_room_chat(req: WarRoomChatRequest, request: Request = None):
    """Interrupt-safe FastAPI wrapper around the multi-turn War Room engine."""
    safe_rid = _safe_room_key(req.room_id)
    task = asyncio.current_task()
    if task:
        ACTIVE_WAR_ROOM_TASKS.setdefault(safe_rid, set()).add(task)
    try:
        return await _war_room_chat_impl(req, request)
    except asyncio.CancelledError:
        if task is not None and hasattr(task, "uncancel"):
            try:
                while task.cancelling():
                    task.uncancel()
            except Exception:
                pass
        await broadcast_event("war_room_speaker_stop", {"room_id": req.room_id or "general", "agent": "all"})
        await broadcast_event("agent_state", {"agent": "all", "state": "idle"})
        return {
            "status": "interrupted",
            "room_id": req.room_id or "general",
            "turns_executed": 0,
            "turns": [],
            "hops": 0,
            "total_turns": 0,
            "max_turns": 0,
        }
    finally:
        if task:
            tasks_set = ACTIVE_WAR_ROOM_TASKS.get(safe_rid)
            if tasks_set is not None:
                tasks_set.discard(task)
                if not tasks_set:
                    ACTIVE_WAR_ROOM_TASKS.pop(safe_rid, None)


async def _war_room_chat_impl(req: WarRoomChatRequest, request: Optional[Request] = None):
    """Dispatches a user directive into the War Room with autonomous turn chaining."""
    user_msg = req.message.strip()
    if not user_msg:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    room_id = req.room_id or "general"
    safe_rid = re.sub(r"[^a-zA-Z0-9_\-]", "_", room_id) or "general"

    # Acoustic Echo & Loop Suppression (BL-VOICE-26)
    recent_msgs = read_war_room_history(room_id=room_id, limit=3)
    if recent_msgs:
        last_agent_msg = next((m for m in reversed(recent_msgs) if m.get("sender_type") == "agent"), None)
        if last_agent_msg and last_agent_msg.get("text"):
            u_clean = re.sub(r"[^\w\s]", "", user_msg.lower()).strip()
            a_clean = re.sub(r"[^\w\s]", "", last_agent_msg.get("text", "").strip().lower()).strip()
            if u_clean and len(u_clean) > 10 and (u_clean in a_clean or a_clean.startswith(u_clean)):
                print(f"[WAR_ROOM] Suppressed acoustic echo turn matching recent agent output: '{user_msg[:60]}...'")
                return {"status": "suppressed", "reason": "acoustic_echo_loop_detected", "room_id": room_id, "turns": []}

    chain_gen = get_interrupt_gen(safe_rid)
    participants = get_room_participants(room_id)
    all_conf_participants = get_all_conference_participants()
    special_user = parse_special_mentions(user_msg)

    user_mentions = parse_all_mentions(user_msg, participants)
    mention_labels = [p["name"] for p in user_mentions]
    if special_user["is_broadcast"]:
        mention_labels.insert(0, "everyone")

    unroped_user = find_unroped_mentions(user_msg, participants, all_conf_participants)
    if unroped_user:
        unroped_names = ", ".join(f"**@{p['name']}**" for p in unroped_user)
        unroped_note = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"⚠️ {unroped_names} is not in this War Room. Use the **[+ Rope In]** button to invite them into the discussion first.",
            "timestamp": time.time(),
        }
        append_war_room_message(unroped_note, room_id=room_id)
        await broadcast_event("war_room_message", unroped_note)

    pending_inquiries_before = list(get_room_inquiries(room_id))
    if special_user["is_broadcast"] or not user_mentions:
        resolve_room_inquiry(room_id, "all")
    else:
        for p in user_mentions:
            resolve_room_inquiry(room_id, "by_agent", agent_name=p["name"])
    await broadcast_event("war_room_inquiries_updated", {"room_id": room_id, "inquiries": get_room_inquiries(room_id)})

    if not req.skip_user_echo:
        user_msg_entry = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": get_operator_name(),
            "sender_type": "user",
            "text": user_msg,
            "engine": "human",
            "color": "#10b981",
            "mentions": mention_labels,
            "timestamp": time.time(),
            "origin_channel": req.origin_channel or "web",
        }
        append_war_room_message(user_msg_entry, room_id=room_id)
        await broadcast_event("war_room_message", user_msg_entry)

    auto_sched = None if (req.origin_channel == "scheduler") else parse_natural_schedule_directive(user_msg, participants=participants, room_id=room_id)
    if auto_sched:
        saved_sched = upsert_room_schedule(room_id, auto_sched)
        await broadcast_event("war_room_schedules_updated", {"room_id": room_id, "schedules": get_room_schedules(room_id)})
        sched_ack = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Scheduler",
            "sender_type": "system",
            "text": (
                f"🗓️ **War Room Schedule Registered (`{saved_sched['id']}`)**: *\"{saved_sched['title']}\"* — "
                f"**{saved_sched['schedule_human']}** · Next run: **{saved_sched['next_run_display']}**"
            ),
            "timestamp": time.time(),
        }
        append_war_room_message(sched_ack, room_id=room_id)
        await broadcast_event("war_room_message", sched_ack)
        if not user_mentions and not special_user["is_broadcast"]:
            return {"status": "schedule_created", "room_id": room_id, "schedule": saved_sched, "turns_executed": 0, "turns": [], "hops": 0, "total_turns": 0, "max_turns": 0}

    auto_rem = None if auto_sched else parse_natural_reminder_directive(user_msg, participants=participants, room_id=room_id)
    if auto_rem:
        add_room_reminder(room_id, auto_rem)
        await broadcast_event("war_room_reminders_updated", {"room_id": room_id, "reminders": get_room_reminders(room_id, active_only=True)})
        rem_ack = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"⏰ **Scheduled Reminder Registered (`{auto_rem['id']}`)**: *\"{auto_rem['text']}\"* — Trigger: **{auto_rem['label']}**.",
            "timestamp": time.time(),
        }
        append_war_room_message(rem_ack, room_id=room_id)
        await broadcast_event("war_room_message", rem_ack)
        if not user_mentions and not special_user["is_broadcast"]:
            return {"status": "reminder_scheduled", "room_id": room_id, "reminder": auto_rem, "turns_executed": 0, "turns": [], "hops": 0, "total_turns": 0, "max_turns": 0}

    custom_timeout_seconds = parse_natural_timeout_directive(user_msg)
    directive_for_agents = user_msg
    if special_user["is_broadcast"]:
        target_agents = get_broadcast_panelists(participants)
        panel_str = ", ".join(f"**@{p['name']}**" for p in target_agents)
        bcast_note = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"📢 **Broadcast Directive**: Operator tagged **@everyone** — convening round of perspectives across {panel_str}.",
            "timestamp": time.time(),
        }
        append_war_room_message(bcast_note, room_id=room_id)
        await broadcast_event("war_room_message", bcast_note)
    elif user_mentions:
        target_agents = user_mentions
    else:
        target_agents, routing_note = resolve_contextual_targets(user_msg, participants, pending_inquiries_before, room_id=room_id)
        if routing_note:
            sys_route_msg = {
                "id": str(uuid.uuid4()),
                "room_id": room_id,
                "sender": "NexusDesk Moderator",
                "sender_type": "system",
                "text": routing_note,
                "timestamp": time.time(),
            }
            append_war_room_message(sys_route_msg, room_id=room_id)
            await broadcast_event("war_room_message", sys_route_msg)

    executed_turns = []
    exec_mode = (req.execution_mode or "sequential").strip().lower()
    if exec_mode not in ("sequential", "parallel", "orchestrate_parallel"):
        exec_mode = "sequential"

    # ------------------------------------------------------------------
    # MODE B & C: PARALLEL SWARM & PLAN -> SWARM (ORCHESTRATE FIRST)
    # ------------------------------------------------------------------
    if exec_mode in ("parallel", "orchestrate_parallel"):
        max_waves = min(max(req.max_turns or 1, 1), 20)
        current_turn = 0
        spoken_ids = set()

        # Smart fallback when user toggled Swarm / Plan->Swarm with 0 or 1 @mentions
        if exec_mode == "parallel" and not user_mentions and not special_user["is_broadcast"]:
            # If pending inquiry / direct Q&A continuity matched 1 specific agent, keep it;
            # otherwise broadcast across active room panelists (up to 6) or promote to Plan->Swarm if >6
            if pending_inquiries_before and len(target_agents) == 1:
                pass
            elif 2 <= len(participants) <= 6:
                target_agents = get_broadcast_panelists(participants)
                panel_str = ", ".join(f"**@{p['name']}**" for p in target_agents)
                auto_sw_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"⚡ **Auto-Swarm Broadcast**: No `@agent` tagged in Swarm mode — launching parallel wave across all {len(target_agents)} room panelists ({panel_str}).",
                    "timestamp": time.time(),
                }
                append_war_room_message(auto_sw_note, room_id=room_id)
                await broadcast_event("war_room_message", auto_sw_note)
            elif len(participants) > 6:
                exec_mode = "orchestrate_parallel"
                promote_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"👑 **Smart Swarm Guard**: Room has {len(participants)} agents and no `@agent` was tagged — promoting to **Plan → Swarm** so the Lead Orchestrator can assign focused parallel workers.",
                    "timestamp": time.time(),
                }
                append_war_room_message(promote_note, room_id=room_id)
                await broadcast_event("war_room_message", promote_note)

        if exec_mode == "orchestrate_parallel":
            # Resolve Lead Planner & Worker Candidates
            lead_agent = None
            worker_candidates: List[Dict[str, Any]] = []
            if req.lead_agent:
                lead_agent = resolve_participant(req.lead_agent, participants)
            if not lead_agent:
                if len(user_mentions) >= 2:
                    lead_agent = user_mentions[0]
                    worker_candidates = user_mentions[1:]
                elif len(user_mentions) == 1:
                    lead_agent = user_mentions[0]
                    worker_candidates = get_broadcast_panelists(participants, exclude_id=lead_agent["id"])
                else:
                    lead_agent = get_concluding_orchestrator(participants, room_id=room_id) or (participants[0] if participants else None)
                    if lead_agent:
                        worker_candidates = get_broadcast_panelists(participants, exclude_id=lead_agent["id"])
                        auto_lead_note = {
                            "id": str(uuid.uuid4()),
                            "room_id": room_id,
                            "sender": "NexusDesk Moderator",
                            "sender_type": "system",
                            "text": f"👑 **Auto-Lead Planner**: No lead tagged in **Plan → Swarm** — **@{lead_agent['name']}** will plan first and dispatch parallel workers.",
                            "timestamp": time.time(),
                        }
                        append_war_room_message(auto_lead_note, room_id=room_id)
                        await broadcast_event("war_room_message", auto_lead_note)
            else:
                explicit_others = [p for p in user_mentions if p["id"] != lead_agent["id"]]
                worker_candidates = explicit_others if explicit_others else get_broadcast_panelists(participants, exclude_id=lead_agent["id"])

            if lead_agent:
                # Cap auto-selected worker candidates to 5 if room is very large and not explicitly tagged
                if not user_mentions and len(worker_candidates) > 5:
                    worker_candidates = worker_candidates[:5]

                # Phase 1: Lead Planner Turn
                if get_interrupt_gen(safe_rid) != chain_gen:
                    raise TurnInterrupted()
                current_turn += 1
                spoken_ids.add(lead_agent["id"])
                plan_banner = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"👑 **Phase 1 (Plan → Swarm)**: **@{lead_agent['name']}** is planning and assigning parallel sub-tasks...",
                    "timestamp": time.time(),
                }
                append_war_room_message(plan_banner, room_id=room_id)
                await broadcast_event("war_room_message", plan_banner)

                start_payload = {
                    "room_id": room_id,
                    "agent": lead_agent["name"],
                    "engine": lead_agent["engine"],
                    "color": lead_agent["color"],
                    "swarm_phase": "plan",
                }
                if custom_timeout_seconds:
                    start_payload["timeout_seconds"] = custom_timeout_seconds
                await broadcast_event("war_room_speaker_start", start_payload)
                await broadcast_event("agent_state", {"agent": lead_agent["name"], "state": "working"})

                curr_transcript = read_war_room_history(room_id=room_id, limit=20)
                plan_intent_task = _spawn_pre_execution_intent(
                    room_id=room_id,
                    safe_rid=safe_rid,
                    chain_gen=chain_gen,
                    agent=lead_agent,
                    directive_text=directive_for_agents,
                    recent_history=curr_transcript,
                    swarm_phase="plan",
                )
                try:
                    plan_reply = await execute_agent_war_room_turn(
                        agent=lead_agent,
                        directive_text=directive_for_agents,
                        transcript=curr_transcript,
                        room_id=room_id,
                        room_participants=participants,
                        turn_info={"current_turn": current_turn, "max_turns": max_waves, "is_swarm_planner": True},
                        interrupt_gen=chain_gen,
                        origin_channel=req.origin_channel or "web",
                        timeout_override=custom_timeout_seconds,
                        swarm_planner_workers=[w["name"] for w in worker_candidates],
                    )
                finally:
                    if not plan_intent_task.done():
                        plan_intent_task.cancel()
                # Parse <swarm_dispatch> before finalizing Phase 1 so msg_entry carries approval metadata if paused
                has_dispatch_tag, dispatched_items = _parse_swarm_dispatch_with_flag(plan_reply, participants, lead_agent["id"])
                skip_phase2_reason = ""
                if has_dispatch_tag and not dispatched_items:
                    skip_phase2_reason = f"**@{lead_agent['name']}** explicitly confirmed no parallel swarm workers are needed (`<swarm_dispatch>[]</swarm_dispatch>`)."
                elif not has_dispatch_tag:
                    # Lead omitted <swarm_dispatch>: consult fast Swarm Coordinator instead of blindly launching duplicate workers!
                    from services.war_room.orchestration import coordinate_swarm_dispatch
                    coord = await asyncio.to_thread(
                        coordinate_swarm_dispatch,
                        directive_for_agents,
                        worker_candidates,
                        plan_reply,
                        curr_transcript,
                        "plan_fallback",
                    )
                    if coord.get("action") == "complete" or not coord.get("tasks"):
                        skip_phase2_reason = coord.get("reason") or f"Phase 1 (**@{lead_agent['name']}**) already resolved the directive."
                        dispatched_items = []
                    else:
                        dispatched_items = []
                        seen_fb = {lead_agent["id"]}
                        for t_item in coord.get("tasks", []):
                            p_w = resolve_participant(t_item.get("agent", ""), participants)
                            if p_w and p_w["id"] not in seen_fb:
                                seen_fb.add(p_w["id"])
                                dispatched_items.append({"agent": p_w, "task": t_item.get("task", "")})

                awaiting_approval = bool(req.pause_before_swarm and dispatched_items)
                plan_extra_meta: Dict[str, Any] = {
                    "execution_mode": "orchestrate_parallel",
                    "swarm_phase": "plan",
                }
                if awaiting_approval:
                    plan_extra_meta.update({
                        "swarm_awaiting_approval": True,
                        "swarm_lead": lead_agent["name"],
                        "swarm_directive": directive_for_agents,
                        "swarm_dispatch_items": [
                            {"agent": it["agent"]["name"], "task": it.get("task", "")}
                            for it in dispatched_items
                        ],
                    })

                plan_fin = await _finalize_agent_reply(
                    agent=lead_agent,
                    reply=plan_reply,
                    room_id=room_id,
                    participants=participants,
                    all_conf_participants=all_conf_participants,
                    user_msg=user_msg,
                    curr_transcript=curr_transcript,
                    origin_channel=req.origin_channel,
                    current_turn=current_turn,
                    max_turns=max_waves,
                    extra_meta=plan_extra_meta,
                )
                executed_turns.append({"agent": lead_agent["name"], "engine": lead_agent["engine"], "turn": current_turn, "reply_snippet": plan_fin["snippet"]})

                if skip_phase2_reason and not dispatched_items and not awaiting_approval:
                    skip_banner = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"✅ **Swarm Guard (No Duplicate Work)**: {skip_phase2_reason} Skipping redundant Phase 2 workers.",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(skip_banner, room_id=room_id)
                    await broadcast_event("war_room_message", skip_banner)

                # If Review Plan approval gate is active, pause before launching Phase 2 workers
                if awaiting_approval:
                    pause_note = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"⏸️ **Plan Ready for Review**: **@{lead_agent['name']}** drafted a parallel plan for {len(dispatched_items)} worker(s). Click **⚡ Approve & Launch Swarm** on the plan card above when ready.",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(pause_note, room_id=room_id)
                    await broadcast_event("war_room_message", pause_note)
                    dispatched_items = []

                if dispatched_items and get_interrupt_gen(safe_rid) == chain_gen:
                    worker_names_md = ", ".join(f"**@{it['agent']['name']}**" for it in dispatched_items)
                    wave_banner = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"⚡ **Phase 2 (Parallel Swarm)**: Launching {len(dispatched_items)} agent(s) simultaneously — {worker_names_md}.",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(wave_banner, room_id=room_id)
                    await broadcast_event("war_room_message", wave_banner)

                    wave_results = await _run_parallel_wave(
                        wave_items=dispatched_items,
                        room_id=room_id,
                        safe_rid=safe_rid,
                        participants=participants,
                        all_conf_participants=all_conf_participants,
                        directive_for_agents=directive_for_agents,
                        user_msg=user_msg,
                        origin_channel=req.origin_channel,
                        custom_timeout_seconds=custom_timeout_seconds,
                        chain_gen=chain_gen,
                        wave_num=1,
                        max_waves=max_waves,
                        swarm_phase="worker",
                    )
                    for r_fin in wave_results:
                        current_turn += 1
                        spoken_ids.add(r_fin["agent"]["id"])
                        executed_turns.append({
                            "agent": r_fin["agent"]["name"],
                            "engine": r_fin["agent"]["engine"],
                            "turn": current_turn,
                            "reply_snippet": r_fin["snippet"],
                        })

                    # Phase 3: Lead Executive Synthesis (when Depth >= 2 and substantive worker results exist)
                    substantive_wave_results = [r for r in wave_results if not r.get("is_noop")]
                    if max_waves >= 2 and req.synthesize_swarm and substantive_wave_results and get_interrupt_gen(safe_rid) == chain_gen:
                        current_turn += 1
                        synth_banner = {
                            "id": str(uuid.uuid4()),
                            "room_id": room_id,
                            "sender": "NexusDesk Moderator",
                            "sender_type": "system",
                            "text": f"🎯 **Phase 3 (Swarm Synthesis)**: Handing floor back to **@{lead_agent['name']}** to synthesize all parallel worker outputs for **@{get_operator_name()}**.",
                            "timestamp": time.time(),
                        }
                        append_war_room_message(synth_banner, room_id=room_id)
                        await broadcast_event("war_room_message", synth_banner)

                        await broadcast_event("war_room_speaker_start", {**start_payload, "swarm_phase": "synthesis"})
                        await broadcast_event("agent_state", {"agent": lead_agent["name"], "state": "working"})
                        synth_transcript = read_war_room_history(room_id=room_id, limit=25)
                        synth_directive = (
                            f"All parallel swarm workers have reported back on: '{directive_for_agents}'. "
                            f"Synthesize their parallel findings, resolve any conflicts, and present a clear, unified executive conclusion for @{get_operator_name()}."
                        )
                        synth_intent_task = _spawn_pre_execution_intent(
                            room_id=room_id,
                            safe_rid=safe_rid,
                            chain_gen=chain_gen,
                            agent=lead_agent,
                            directive_text=synth_directive,
                            recent_history=synth_transcript,
                            swarm_phase="synthesis",
                        )
                        try:
                            synth_reply = await execute_agent_war_room_turn(
                                agent=lead_agent,
                                directive_text=synth_directive,
                                transcript=synth_transcript,
                                room_id=room_id,
                                room_participants=participants,
                                turn_info={"current_turn": current_turn, "max_turns": current_turn},
                                interrupt_gen=chain_gen,
                                origin_channel=req.origin_channel or "web",
                                timeout_override=custom_timeout_seconds,
                            )
                        finally:
                            if not synth_intent_task.done():
                                synth_intent_task.cancel()
                        synth_fin = await _finalize_agent_reply(
                            agent=lead_agent,
                            reply=synth_reply,
                            room_id=room_id,
                            participants=participants,
                            all_conf_participants=all_conf_participants,
                            user_msg=user_msg,
                            curr_transcript=synth_transcript,
                            origin_channel=req.origin_channel,
                            current_turn=current_turn,
                            max_turns=current_turn,
                            extra_meta={"execution_mode": "orchestrate_parallel", "swarm_phase": "synthesis"},
                        )
                        executed_turns.append({
                            "agent": lead_agent["name"],
                            "engine": lead_agent["engine"],
                            "turn": current_turn,
                            "reply_snippet": synth_fin["snippet"],
                        })
        else:
            # Pure Parallel Swarm (supports 1..max_waves combined with Turns depth!)
            wave_targets = list(target_agents)
            for wave_idx in range(1, max_waves + 1):
                if not wave_targets or get_interrupt_gen(safe_rid) != chain_gen:
                    break
                wave_items_to_run = [{"agent": p, "task": ""} for p in wave_targets]
                if wave_idx == 1 and len(wave_targets) >= 2:
                    # Partition parallel swarm work into distinct non-overlapping sub-tasks (or 1 owner for single-shot side-effects)
                    from services.war_room.orchestration import coordinate_swarm_dispatch
                    pre_hist = read_war_room_history(room_id=room_id, limit=8)
                    split_res = await asyncio.to_thread(
                        coordinate_swarm_dispatch,
                        directive_for_agents,
                        wave_targets,
                        "",
                        pre_hist,
                        "swarm_split",
                    )
                    if split_res.get("tasks"):
                        mapped_items = []
                        seen_sp = set()
                        for t_item in split_res["tasks"]:
                            p_w = resolve_participant(t_item.get("agent", ""), wave_targets)
                            if p_w and p_w["id"] not in seen_sp:
                                seen_sp.add(p_w["id"])
                                mapped_items.append({"agent": p_w, "task": t_item.get("task", "")})
                        if mapped_items:
                            wave_items_to_run = mapped_items
                            if len(mapped_items) == 1 and len(wave_targets) >= 2:
                                narrow_note = {
                                    "id": str(uuid.uuid4()),
                                    "room_id": room_id,
                                    "sender": "NexusDesk Moderator",
                                    "sender_type": "system",
                                    "text": f"🛡️ **Swarm Deduplication Guard**: Narrowed single-action directive to **@{mapped_items[0]['agent']['name']}** ({split_res.get('reason') or 'preventing duplicate execution'}).",
                                    "timestamp": time.time(),
                                }
                                append_war_room_message(narrow_note, room_id=room_id)
                                await broadcast_event("war_room_message", narrow_note)

                if len(wave_items_to_run) >= 2:
                    w_names = ", ".join(f"**@{it['agent']['name']}**" for it in wave_items_to_run)
                    w_note = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"⚡ **Parallel Swarm Wave {wave_idx}/{max_waves}**: Running {len(wave_items_to_run)} agents concurrently with distinct scopes — {w_names}.",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(w_note, room_id=room_id)
                    await broadcast_event("war_room_message", w_note)
                elif wave_idx == 1 and len(wave_targets) == 1 and user_mentions:
                    single_note = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"ℹ️ **Single Target**: Only **@{wave_targets[0]['name']}** tagged in Swarm mode — executing directly.",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(single_note, room_id=room_id)
                    await broadcast_event("war_room_message", single_note)

                wave_results = await _run_parallel_wave(
                    wave_items=wave_items_to_run,
                    room_id=room_id,
                    safe_rid=safe_rid,
                    participants=participants,
                    all_conf_participants=all_conf_participants,
                    directive_for_agents=directive_for_agents,
                    user_msg=user_msg,
                    origin_channel=req.origin_channel,
                    custom_timeout_seconds=custom_timeout_seconds,
                    chain_gen=chain_gen,
                    wave_num=wave_idx,
                    max_waves=max_waves,
                    swarm_phase="swarm",
                )
                next_wave_targets: List[Dict[str, Any]] = []
                next_seen = set()
                any_user_yield = False
                for r_fin in wave_results:
                    if r_fin.get("is_noop"):
                        continue
                    current_turn += 1
                    spoken_ids.add(r_fin["agent"]["id"])
                    executed_turns.append({
                        "agent": r_fin["agent"]["name"],
                        "engine": r_fin["agent"]["engine"],
                        "turn": current_turn,
                        "reply_snippet": r_fin["snippet"],
                    })
                    if r_fin["reply_special"]["mentions_user"] and not r_fin["reply_mentions"]:
                        any_user_yield = True
                        await _handle_user_yield_inquiry(r_fin["reply"], room_id, r_fin["agent"], req.origin_channel)
                    if req.handoff_enabled and wave_idx < max_waves:
                        for mp in r_fin["reply_mentions"]:
                            if mp["id"] != r_fin["agent"]["id"] and mp["id"] not in next_seen:
                                next_seen.add(mp["id"])
                                next_wave_targets.append(mp)

                if any_user_yield and not next_wave_targets:
                    break
                wave_targets = next_wave_targets

        max_turns = max_waves
        queue = []  # Skip sequential loop below
    else:
        requested_agent_count = len(target_agents) if user_mentions else 0
        max_turns = min(max(req.max_turns or 5, requested_agent_count, 1), 20)
        current_turn = 0
        spoken_ids = set()
        queue = list(target_agents)
        explicit_requested_ids = {p["id"] for p in target_agents} if user_mentions else set()

    while queue and current_turn < max_turns:
        if get_interrupt_gen(safe_rid) != chain_gen:
            raise TurnInterrupted()
        agent = queue.pop(0)
        current_turn += 1
        spoken_ids.add(agent["id"])

        speaker_start_payload = {"room_id": room_id, "agent": agent["name"], "engine": agent["engine"], "color": agent["color"]}
        if custom_timeout_seconds:
            speaker_start_payload["timeout_seconds"] = custom_timeout_seconds
        await broadcast_event("war_room_speaker_start", speaker_start_payload)
        await broadcast_event("agent_state", {"agent": agent["name"], "state": "working"})

        curr_transcript = read_war_room_history(room_id=room_id, limit=20)
        pf_action = await _run_preflight_understanding_gate(
            room_id=room_id,
            safe_rid=safe_rid,
            chain_gen=chain_gen,
            agent=agent,
            directive_text=directive_for_agents,
            recent_history=curr_transcript,
            swarm_phase="",
            origin_channel=req.origin_channel or "web",
            hold_for_countdown=(current_turn == 1),
            manual_review_only=bool(req.pause_before_swarm and current_turn == 1),
            countdown_seconds=10,
        )
        if pf_action == "hold":
            queue.clear()
            break

        reply = await execute_agent_war_room_turn(
            agent=agent,
            directive_text=directive_for_agents,
            transcript=curr_transcript,
            room_id=room_id,
            room_participants=participants,
            turn_info={"current_turn": current_turn, "max_turns": max_turns},
            interrupt_gen=chain_gen,
            origin_channel=req.origin_channel or "web",
            timeout_override=custom_timeout_seconds,
        )

        reply_mentions = parse_all_mentions(reply, participants)
        reply_special = parse_special_mentions(reply)
        turn_mentions = [p["name"] for p in reply_mentions]
        if reply_special["is_broadcast"]:
            turn_mentions.insert(0, "everyone")
        if reply_special["mentions_user"]:
            turn_mentions.append("user")

        unroped_in_reply = find_unroped_mentions(reply, participants, all_conf_participants)
        if unroped_in_reply:
            unroped_lbls = ", ".join(f"**@{p['name']}**" for p in unroped_in_reply)
            guard_note = {
                "id": str(uuid.uuid4()),
                "room_id": room_id,
                "sender": "NexusDesk Moderator",
                "sender_type": "system",
                "text": f"🛡️ **Whitelist Guard**: **{agent['name']}** attempted to delegate to {unroped_lbls}, who is not in this room. Delegation intercepted to prevent hallucinated handoffs.",
                "timestamp": time.time(),
            }
            append_war_room_message(guard_note, room_id=room_id)
            await broadcast_event("war_room_message", guard_note)

        recent_user_texts = [user_msg] + [m.get("text", "") for m in curr_transcript[-6:] if m.get("sender_type") == "user"]
        await _process_agent_async_tasks(reply, room_id, agent, user_msg, recent_user_texts)
        await _process_agent_reminders(reply, room_id, agent, participants)
        await _process_agent_schedules(reply, room_id, agent)
        await _process_war_room_chat_agent_bridges(reply, room_id, agent)
        explicit_dispatched_channels = await _process_agent_outbound_messages(
            reply, room_id, agent, req.origin_channel, recent_user_texts
        )

        is_error = is_error_turn({"text": reply})
        display_reply = _strip_executed_war_room_control_tags(reply) or reply
        if not is_error and req.origin_channel and req.origin_channel not in ["web", "ui", "internal"]:
            try:
                from services.gateways import mirror_agent_turn_to_omnichannel
                await mirror_agent_turn_to_omnichannel(
                    agent_name=agent["name"],
                    agent_engine=agent["engine"],
                    reply_text=display_reply,
                    room_id=room_id,
                    explicit_dispatched_channels=explicit_dispatched_channels,
                    origin_channel=req.origin_channel,
                )
            except Exception as omni_err:
                print(f"[WAR_ROOM] Omnichannel mirror warning: {omni_err}")

        msg_entry = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": agent["name"],
            "sender_type": "agent",
            "text": display_reply,
            "engine": agent["engine"],
            "color": agent["color"],
            "role": agent.get("role", ""),
            "is_error": is_error,
            "mentions": turn_mentions,
            "mentions_user": reply_special["mentions_user"],
            "timestamp": time.time(),
            "turn_index": current_turn,
            "turn": current_turn,
            "max_turns": max_turns,
            "origin_channel": req.origin_channel or "web",
        }
        append_war_room_message(msg_entry, room_id=room_id)
        await broadcast_event("war_room_message", msg_entry)

        snippet = extract_shout_snippet(display_reply, max_len=80)
        await broadcast_event("agent_shout", {
            "agent": agent["name"],
            "message": snippet,
            "category": "info",
            "duration": 6,
            "announce_tts": True,
            "voice": agent.get("voice"),
        })
        await broadcast_event("agent_state", {"agent": agent["name"], "state": "idle"})
        await broadcast_event("war_room_speaker_stop", {"room_id": room_id, "agent": agent["name"]})
        await check_and_fire_turn_reminders(room_id, agent["name"])

        executed_turns.append({"agent": agent["name"], "engine": agent["engine"], "turn": current_turn, "reply_snippet": snippet})

        valid_next_agents = [p for p in reply_mentions if p["id"] != agent["id"]]
        has_colleagues = bool(valid_next_agents) or reply_special["is_broadcast"]

        if is_error and ("[TOKEN_EXHAUSTED]" in reply or "[TOTAL_STALL]" in reply) and not queue:
            failover_candidates = [p for p in participants if p["id"] != agent["id"] and p["id"] not in spoken_ids] or [
                p for p in participants if p["id"] != agent["id"]
            ]
            if failover_candidates:
                diff_engine_cands = [p for p in failover_candidates if p.get("engine") != agent.get("engine")]
                next_specialist = diff_engine_cands[0] if diff_engine_cands else failover_candidates[0]
                queue.insert(0, next_specialist)
                max_turns = min(max(max_turns, current_turn + 1), 20)
                reason_tag = "AI token/credit/rate-limit exhaustion" if "[TOKEN_EXHAUSTED]" in reply else "total stall with zero progress"
                failover_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": (
                        f"🛡️ **Incapacitation Failover**: **@{agent['name']}** (`{agent['engine'].upper()}`) experienced "
                        f"{reason_tag}. Automatically reassigning directive to **@{next_specialist['name']}** (`{next_specialist['engine'].upper()}`)."
                    ),
                    "timestamp": time.time(),
                }
                append_war_room_message(failover_note, room_id=room_id)
                await broadcast_event("war_room_message", failover_note)

        if req.handoff_enabled and has_colleagues and current_turn < max_turns:
            if reply_special["is_broadcast"]:
                bcast_candidates = [
                    p for p in get_broadcast_panelists(participants, exclude_id=agent["id"]) if p["id"] not in spoken_ids and p not in queue
                ]
                if bcast_candidates:
                    max_turns = min(max(max_turns, current_turn + len(bcast_candidates)), 20)
                    cand_names = ", ".join(f"**@{c['name']}**" for c in bcast_candidates)
                    handoff_note = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"📢 **Agent Broadcast Handoff**: **{agent['name']}** tagged **@everyagents** — queuing {cand_names}.",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(handoff_note, room_id=room_id)
                    await broadcast_event("war_room_message", handoff_note)
                    queue.extend(bcast_candidates)
            elif valid_next_agents:
                queued_now = []
                for next_p in valid_next_agents:
                    if next_p not in queue:
                        queue.append(next_p)
                        queued_now.append(next_p)
                if queued_now:
                    q_labels = ", ".join(f"**@{p['name']}**" for p in queued_now)
                    handoff_note = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"🔄 **Autonomous Handoff**: **{agent['name']}** passed the floor to {q_labels} (Turn {current_turn + 1}/{max_turns}).",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(handoff_note, room_id=room_id)
                    await broadcast_event("war_room_message", handoff_note)

            has_pending_explicit_agent = any(p["id"] in explicit_requested_ids and p["id"] not in spoken_ids for p in queue)
            if max_turns > 1 and current_turn == max_turns - 1 and len(queue) > 0 and not has_pending_explicit_agent:
                concluding_p = get_concluding_orchestrator(participants, room_id=room_id, exclude_id=agent["id"])
                if concluding_p and queue[0]["id"] != concluding_p["id"]:
                    queue.insert(0, concluding_p)
                    queue = queue[:1]
                    orch_title = "Orchestrator" if concluding_p["name"].lower() == "solaris" else "Designated Concluding Agent"
                    conclude_note = {
                        "id": str(uuid.uuid4()),
                        "room_id": room_id,
                        "sender": "NexusDesk Moderator",
                        "sender_type": "system",
                        "text": f"🎯 **Final Concluding Turn**: Handing floor to {orch_title} **@{concluding_p['name']}** to synthesize findings and conclude the discussion for **@{get_operator_name()}**.",
                        "timestamp": time.time(),
                    }
                    append_war_room_message(conclude_note, room_id=room_id)
                    await broadcast_event("war_room_message", conclude_note)

        elif reply_special["mentions_user"]:
            queue.clear()
            await _handle_user_yield_inquiry(reply, room_id, agent, req.origin_channel)
            break

        peeked = peek_next_operator_directive(safe_rid)
        if peeked and parse_all_mentions((peeked.get("message") or ""), participants):
            queued_op_directive = pop_next_operator_directive(safe_rid)
            q_rem = list_operator_directives(safe_rid)
            await broadcast_event("war_room_queue_updated", {"room_id": room_id, "queued": len(q_rem), "queued_directives": q_rem})
            q_msg = (queued_op_directive or {}).get("message", "").strip()
            if q_msg:
                directive_for_agents = q_msg
                q_mentions = parse_all_mentions(q_msg, participants)
                if q_mentions:
                    queue = list(q_mentions)
                max_turns = min(max_turns + queued_op_directive.get("max_turns", 1), 20)
                ack_note = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"📥 **Injecting Queued Operator Directive**: Floor steered to prioritize: *\"{q_msg[:120]}\"*",
                    "timestamp": time.time(),
                }
                append_war_room_message(ack_note, room_id=room_id)
                await broadcast_event("war_room_message", ack_note)

        if queue:
            await asyncio.sleep(1.2)

    if get_interrupt_gen(safe_rid) == chain_gen:
        leftover = pop_next_operator_directive(safe_rid)
        if leftover and (leftover.get("message") or "").strip():
            q_rem = list_operator_directives(safe_rid)
            await broadcast_event("war_room_queue_updated", {"room_id": room_id, "queued": len(q_rem), "queued_directives": q_rem})
            drain_note = {
                "id": str(uuid.uuid4()),
                "room_id": room_id,
                "sender": "NexusDesk Moderator",
                "sender_type": "system",
                "text": f"📥 **Running Queued Operator Directive**: *\"{leftover['message'].strip()[:120]}\"*",
                "timestamp": time.time(),
            }
            append_war_room_message(drain_note, room_id=room_id)
            await broadcast_event("war_room_message", drain_note)
            return await _war_room_chat_impl(
                WarRoomChatRequest(
                    message=leftover["message"],
                    room_id=room_id,
                    max_turns=leftover.get("max_turns", 1),
                    handoff_enabled=leftover.get("handoff_enabled", True),
                    execution_mode=leftover.get("execution_mode", "sequential"),
                    lead_agent=leftover.get("lead_agent"),
                    instance=req.instance,
                    skip_user_echo=True,
                ),
                request,
            )

    completion_payload = {
        "status": "completed",
        "room_id": room_id,
        "turns_executed": len(executed_turns),
        "turns": executed_turns,
        "hops": current_turn,
        "total_turns": current_turn,
        "max_turns": max_turns,
    }
    await broadcast_event("war_room_dispatch_complete", completion_payload)

    try:
        asyncio.create_task(maybe_trigger_async_compaction(room_id, read_war_room_history(room_id, limit=0)))
    except Exception:
        pass

    return completion_payload


@router.post("/api/war-room/swarm/launch")
async def launch_approved_war_room_swarm(req: WarRoomSwarmLaunchRequest):
    """Launches Phase 2 parallel swarm workers (and optional Phase 3 Lead synthesis) after operator plan approval."""
    room_id = req.room_id or "general"
    safe_rid = _safe_room_key(room_id)
    participants = get_room_participants(room_id)
    all_conf_participants = get_all_conference_participants()
    if not req.tasks:
        raise HTTPException(status_code=400, detail="No swarm worker tasks provided")

    dispatched_items: List[Dict[str, Any]] = []
    seen_ids = set()
    for t in req.tasks:
        ag_name = str(t.get("agent") or t.get("name") or "").strip().lstrip("@")
        task_txt = str(t.get("task") or t.get("assignment") or "").strip()
        p = resolve_participant(ag_name, participants)
        if p and p["id"] not in seen_ids:
            seen_ids.add(p["id"])
            dispatched_items.append({"agent": p, "task": task_txt})

    if not dispatched_items:
        raise HTTPException(status_code=400, detail="Could not resolve any authorized room participants for swarm launch")

    task = asyncio.current_task()
    if task:
        ACTIVE_WAR_ROOM_TASKS.setdefault(safe_rid, set()).add(task)

    chain_gen = get_interrupt_gen(safe_rid)
    max_waves = min(max(req.max_waves or 1, 1), 20)
    directive_text = (req.directive or "").strip() or "Execute your approved swarm assignment from the Lead Planner's plan above."
    executed_turns: List[Dict[str, Any]] = []

    try:
        worker_names_md = ", ".join(f"**@{it['agent']['name']}**" for it in dispatched_items)
        wave_banner = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"⚡ **Approved Swarm Launched**: Running {len(dispatched_items)} worker(s) simultaneously — {worker_names_md}.",
            "timestamp": time.time(),
        }
        append_war_room_message(wave_banner, room_id=room_id)
        await broadcast_event("war_room_message", wave_banner)

        wave_results = await _run_parallel_wave(
            wave_items=dispatched_items,
            room_id=room_id,
            safe_rid=safe_rid,
            participants=participants,
            all_conf_participants=all_conf_participants,
            directive_for_agents=directive_text,
            user_msg=directive_text,
            origin_channel="web",
            custom_timeout_seconds=None,
            chain_gen=chain_gen,
            wave_num=1,
            max_waves=max_waves,
            swarm_phase="worker",
        )
        for idx, r_fin in enumerate(wave_results, start=1):
            executed_turns.append({
                "agent": r_fin["agent"]["name"],
                "engine": r_fin["agent"]["engine"],
                "turn": idx,
                "reply_snippet": r_fin["snippet"],
            })

        # Optional Phase 3 Lead Synthesis when Depth >= 2 and substantive worker results exist
        substantive_approved_results = [r for r in wave_results if not r.get("is_noop")]
        if max_waves >= 2 and req.synthesize_swarm and substantive_approved_results and get_interrupt_gen(safe_rid) == chain_gen:
            lead_agent = resolve_participant(req.lead_agent, participants) if req.lead_agent else None
            if not lead_agent:
                lead_agent = get_concluding_orchestrator(participants, room_id=room_id)
            if lead_agent:
                synth_banner = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": f"🎯 **Phase 3 (Swarm Synthesis)**: Handing floor back to **@{lead_agent['name']}** to synthesize all parallel worker outputs for **@{get_operator_name()}**.",
                    "timestamp": time.time(),
                }
                append_war_room_message(synth_banner, room_id=room_id)
                await broadcast_event("war_room_message", synth_banner)

                await broadcast_event("war_room_speaker_start", {
                    "room_id": room_id,
                    "agent": lead_agent["name"],
                    "engine": lead_agent["engine"],
                    "color": lead_agent["color"],
                    "swarm_phase": "synthesis",
                })
                await broadcast_event("agent_state", {"agent": lead_agent["name"], "state": "working"})
                synth_transcript = read_war_room_history(room_id=room_id, limit=25)
                synth_directive = (
                    f"All approved parallel swarm workers have reported back on: '{directive_text}'. "
                    f"Synthesize their parallel findings, resolve any conflicts, and present a clear, unified executive conclusion for @{get_operator_name()}."
                )
                approved_synth_intent = _spawn_pre_execution_intent(
                    room_id=room_id,
                    safe_rid=safe_rid,
                    chain_gen=chain_gen,
                    agent=lead_agent,
                    directive_text=synth_directive,
                    recent_history=synth_transcript,
                    swarm_phase="synthesis",
                )
                try:
                    synth_reply = await execute_agent_war_room_turn(
                        agent=lead_agent,
                        directive_text=synth_directive,
                        transcript=synth_transcript,
                        room_id=room_id,
                        room_participants=participants,
                        turn_info={"current_turn": len(executed_turns) + 1, "max_turns": len(executed_turns) + 1},
                        interrupt_gen=chain_gen,
                        origin_channel="web",
                    )
                finally:
                    if not approved_synth_intent.done():
                        approved_synth_intent.cancel()
                synth_fin = await _finalize_agent_reply(
                    agent=lead_agent,
                    reply=synth_reply,
                    room_id=room_id,
                    participants=participants,
                    all_conf_participants=all_conf_participants,
                    user_msg=directive_text,
                    curr_transcript=synth_transcript,
                    origin_channel="web",
                    current_turn=len(executed_turns) + 1,
                    max_turns=len(executed_turns) + 1,
                    extra_meta={"execution_mode": "orchestrate_parallel", "swarm_phase": "synthesis"},
                )
                executed_turns.append({
                    "agent": lead_agent["name"],
                    "engine": lead_agent["engine"],
                    "turn": len(executed_turns) + 1,
                    "reply_snippet": synth_fin["snippet"],
                })

        completion_payload = {
            "status": "completed",
            "room_id": room_id,
            "turns_executed": len(executed_turns),
            "turns": executed_turns,
            "hops": len(executed_turns),
            "total_turns": len(executed_turns),
            "max_turns": max_waves,
        }
        await broadcast_event("war_room_dispatch_complete", completion_payload)
        return completion_payload
    except (TurnInterrupted, asyncio.CancelledError):
        if task is not None and hasattr(task, "uncancel"):
            try:
                while task.cancelling():
                    task.uncancel()
            except Exception:
                pass
        await broadcast_event("war_room_speaker_stop", {"room_id": room_id, "agent": "all"})
        await broadcast_event("agent_state", {"agent": "all", "state": "idle"})
        return {"status": "interrupted", "room_id": room_id, "turns_executed": len(executed_turns), "turns": executed_turns}
    finally:
        if task:
            tasks_set = ACTIVE_WAR_ROOM_TASKS.get(safe_rid)
            if tasks_set is not None:
                tasks_set.discard(task)
                if not tasks_set:
                    ACTIVE_WAR_ROOM_TASKS.pop(safe_rid, None)


@router.post("/api/war-room/roundtable")
async def start_war_room_roundtable(req: WarRoomRoundTableRequest):
    """Convenes a multi-agent rotational round-table deliberation."""
    topic = req.topic.strip()
    room_id = req.room_id or "general"
    if not topic:
        raise HTTPException(status_code=400, detail="Topic cannot be empty")
    if not req.agents or len(req.agents) < 2:
        raise HTTPException(status_code=400, detail="Round-table requires at least 2 agents")

    participants = get_all_conference_participants()
    selected_agents = []
    for a_name in req.agents:
        p = resolve_participant(a_name, participants)
        if p and p not in selected_agents:
            selected_agents.append(p)
    if len(selected_agents) < 2:
        raise HTTPException(status_code=400, detail="Could not resolve at least 2 valid conference agents")

    rounds = max(1, min(req.rounds or 3, 6))
    if room_id in ACTIVE_ROUNDTABLE_TASKS:
        old_task = ACTIVE_ROUNDTABLE_TASKS.pop(room_id)
        if not old_task.done():
            old_task.cancel()

    panelist_str = ", ".join(f"**@{a['name']}** [{a['engine'].upper()}]" for a in selected_agents)
    intro_msg = {
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "sender": "NexusDesk Moderator",
        "sender_type": "system",
        "text": f"🎯 **ROUND-TABLE DISCUSSION CONVENED**\n\n**Topic**: *{topic}*\n**Panelists**: {panelist_str}\n**Format**: {rounds} Round(s) of deliberation followed by Executive Synthesis.",
        "timestamp": time.time(),
    }
    append_war_room_message(intro_msg, room_id=room_id)
    await broadcast_event("war_room_message", intro_msg)

    ACTIVE_ROUNDTABLE_TASKS[room_id] = asyncio.create_task(
        run_roundtable_deliberation(
            room_id=room_id,
            topic=topic,
            selected_agents=selected_agents,
            rounds=rounds,
            turn_callback=check_and_fire_turn_reminders,
        )
    )
    return {"status": "roundtable_initiated", "room_id": room_id, "topic": topic, "rounds": rounds, "panelists": [a["name"] for a in selected_agents]}


async def war_room_queue_drain_watcher():
    """Periodically pops queued operator directives whenever a War Room becomes idle."""
    while True:
        try:
            for r in get_all_rooms():
                rid = r.get("id") or "general"
                safe_rid = _safe_room_key(rid)
                if not is_room_busy(rid) and count_operator_directives(safe_rid) > 0:
                    leftover = pop_next_operator_directive(safe_rid)
                    if leftover and (leftover.get("message") or "").strip():
                        q_rem = list_operator_directives(safe_rid)
                        await broadcast_event("war_room_queue_updated", {"room_id": rid, "queued": len(q_rem), "queued_directives": q_rem})
                        drain_note = {
                            "id": str(uuid.uuid4()),
                            "room_id": rid,
                            "sender": "NexusDesk Moderator",
                            "sender_type": "system",
                            "text": f"📥 **Autonomous Queue Drain**: Executing next queued directive: *\"{leftover['message'].strip()[:120]}\"*",
                            "timestamp": time.time(),
                        }
                        append_war_room_message(drain_note, room_id=rid)
                        await broadcast_event("war_room_message", drain_note)
                        chat_req = WarRoomChatRequest(
                            message=leftover["message"],
                            room_id=rid,
                            max_turns=leftover.get("max_turns", 1),
                            handoff_enabled=leftover.get("handoff_enabled", True),
                            execution_mode=leftover.get("execution_mode", "sequential"),
                            lead_agent=leftover.get("lead_agent"),
                            instance=leftover.get("instance"),
                            skip_user_echo=True,
                        )
                        asyncio.create_task(war_room_chat(chat_req, request=None))
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[WAR_ROOM_QUEUE] Drain watcher warning: {e}")
        await asyncio.sleep(2.5)
