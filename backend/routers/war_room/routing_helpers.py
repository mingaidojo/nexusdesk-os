"""
NexusDesk War Room Routing Helpers, Dispatcher Rules & STT Normalization
========================================================================
Part of NexusDesk War Room Router Package (BL-ARCH-32, BL-WAR-09..43).

Provides:
- Turn error classification & concluding orchestrator failover selection
- Dual-stage semantic + rule-based target resolution (`resolve_contextual_targets`)
- Shared per-room active task registry and busy-state predicates (`is_room_busy`)
- REST endpoints for dispatcher rules, participants, domain presets, and STT cleaning
"""

import asyncio
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from core.config import broadcast_event
from services.cli_executor import has_active_room_proc
from services.war_room.execution import read_war_room_history
from services.war_room.inquiries import get_room_inquiries
from services.war_room.orchestration import (
    call_llm_router,
    detect_question_or_call_to_action,
    get_available_dispatcher_agents,
    load_dispatcher_config,
    save_dispatcher_config,
)
from services.war_room.participants import (
    get_all_conference_participants,
    get_all_rooms,
    get_room_participants,
    resolve_participant,
)
from services.war_room.roundtable import ACTIVE_ROUNDTABLE_TASKS

router = APIRouter(tags=["war_room"])

# Active War Room dispatch tasks per room for real-time operator interruption (BL-WAR-38 / BL-WAR-39)
ACTIVE_WAR_ROOM_TASKS: Dict[str, set] = {}

WAR_ROOM_PRESETS_CATALOG = {
    "general_conference": {
        "id": "general_conference",
        "name": "🌐 General Conference",
        "description": "Balanced multi-agent discussion, strategic planning, and general problem solving.",
        "default_participants": ["solaris", "claude", "agy"],
        "worktree_isolation": False,
    },
    "coding_sprint": {
        "id": "coding_sprint",
        "name": "⚡ Collaborative Coding Sprint",
        "description": "Strict engineering workflow: Architecture (Claude), Implementation (Codex/OpenCode), and Adversarial QA (Solaris).",
        "default_participants": ["claude", "codex", "opencode", "solaris"],
        "worktree_isolation": True,
    },
    "deep_research": {
        "id": "deep_research",
        "name": "🔬 Deep Multi-Perspective Research",
        "description": "Rigorous data sourcing, quantitative CSV/table synthesis, and Devil's Advocate red-teaming.",
        "default_participants": ["solaris", "claude", "agy", "codex"],
        "worktree_isolation": False,
    },
    "security_audit": {
        "id": "security_audit",
        "name": "🛡️ SRE & Security Red-Teaming",
        "description": "Blue team drafts infrastructure/configs while Red team scans for vulnerabilities, race conditions & privilege escalations.",
        "default_participants": ["pylon", "claude", "codex", "solaris"],
        "worktree_isolation": False,
    },
    "executive_advisory": {
        "id": "executive_advisory",
        "name": "📊 Executive Board & Pitch Deck",
        "description": "High-level strategic synthesis, financial modeling, and consulting-grade presentation artifacts.",
        "default_participants": ["solaris", "claude", "agy"],
        "worktree_isolation": False,
    },
}


# ---------------------------------------------------------------------------
# 1. Room Concurrency Key & Turn Error Classification Helpers
# ---------------------------------------------------------------------------

def _safe_room_key(room_id: Optional[str]) -> str:
    """Normalizes a War Room ID into an alphanumeric/underscore state key."""
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", (room_id or "general").strip()) or "general"


def _live_room_tasks(safe_rid: str) -> List[asyncio.Task]:
    """Returns currently executing asyncio tasks tracked for a room key."""
    return [t for t in ACTIVE_WAR_ROOM_TASKS.get(safe_rid, set()) if not t.done()]


def is_room_busy(room_id: Optional[str]) -> bool:
    """Server-side source of truth: is any turn chain, round-table or subprocess active?"""
    safe_rid = _safe_room_key(room_id)
    if _live_room_tasks(safe_rid):
        return True
    rt = ACTIVE_ROUNDTABLE_TASKS.get(room_id or "general") or ACTIVE_ROUNDTABLE_TASKS.get(safe_rid)
    if rt and not rt.done():
        return True
    return has_active_room_proc(safe_rid)


def is_error_turn(msg: Dict[str, Any]) -> bool:
    """Checks if a War Room transcript turn represents a crash, timeout, or runner error."""
    if not isinstance(msg, dict):
        return False
    if msg.get("is_error"):
        return True
    txt = (msg.get("text") or "").strip()
    if not txt:
        return False

    clean_txt = re.sub(r"\x1b\[[0-9;]*[mK]", "", txt).strip()
    lower = clean_txt.lower()

    if lower.startswith("reading additional input from stdin") or lower.startswith("reading additional input"):
        return True
    if (
        lower.startswith("⚠️ **runner alert")
        or "[total_stall]" in lower
        or "[token_exhausted]" in lower
        or "subprocess soft-intercepted" in lower
        or "encountered an issue while processing turn:" in lower
    ):
        return True
    if (
        lower.startswith("error: free usage limit reached")
        or "error: free usage limit reached" in lower
        or "subscribe to opencode go to keep going" in lower
    ):
        return True
    if "subprocess timed out after" in lower or "timed out after" in lower:
        return True
    if "engine binary not currently installed" in lower:
        return True
    if "traceback (most recent call last)" in lower:
        return True
    if "the model is not supported when using codex" in lower:
        return True
    if lower.startswith("error: {") or lower.startswith("error: ["):
        return True
    if "<executive_summary>" in txt or "</executive_summary>" in txt:
        return False
    return False


# ---------------------------------------------------------------------------
# 2. Orchestrator Selection & Dual-Stage Target Resolution
# ---------------------------------------------------------------------------

def get_concluding_orchestrator(
    participants: List[Dict[str, Any]],
    room_id: str = "general",
    exclude_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Determines the optimal agent to deliver the final executive concluding turn (BL-WAR-31).
    Prioritizes @Solaris if healthy; otherwise fails over to the most reliable healthy specialist.
    """
    if not participants:
        return None

    recent_history = read_war_room_history(room_id=room_id, limit=20)
    failed_names = set()
    healthy_speakers_ordered = []

    for msg in reversed(recent_history):
        if msg.get("sender_type") == "agent":
            s_name = (msg.get("sender") or "").strip().lower()
            if is_error_turn(msg):
                failed_names.add(s_name)
            elif s_name not in healthy_speakers_ordered:
                healthy_speakers_ordered.append(s_name)

    solaris = resolve_participant("solaris", participants)
    if solaris and solaris.get("id") != exclude_id and solaris["name"].lower() not in failed_names:
        return solaris

    for h_name in healthy_speakers_ordered:
        p = resolve_participant(h_name, participants)
        if p and p.get("id") != exclude_id:
            return p

    for p in participants:
        if p.get("id") != exclude_id and p["name"].lower() not in failed_names:
            return p

    return next((p for p in participants if p.get("id") != exclude_id), participants[0])


def resolve_contextual_targets(
    user_msg: str,
    participants: List[Dict[str, Any]],
    pending_inquiries: List[Dict[str, Any]],
    room_id: str = "general",
) -> tuple[List[Dict[str, Any]], str]:
    """
    Intelligent Dual-Stage War Room Dispatcher (BL-WAR-09, BL-WAR-27, BL-WAR-41):
      Stage 0: Explicit plain-text participant name detection
      Stage 1: Designated Room Orchestrator (BL-WAR-42)
      Stage 2: Fast LLM Semantic Router
      Stage 3: Deterministic continuity cascade (last CTA question, pending inquiry, recent healthy speaker)
    """
    if not participants:
        return [], ""

    clean_msg = (user_msg or "").strip()
    cfg = load_dispatcher_config()
    fixed_rules = cfg.get("fixed_rules", {})
    recent_history = read_war_room_history(room_id=room_id, limit=20) or []

    # Stage 0: Plain-text participant name mention
    if fixed_rules.get("check_plain_text_names", True):
        plain_matches: List[tuple[int, Dict[str, Any], bool]] = []
        seen_ids = set()
        for p in participants:
            pid, pname = p["id"], p["name"]
            m = re.search(rf"\b({re.escape(pname)}|{re.escape(pid)})\b", clean_msg, re.IGNORECASE)
            if m and pid not in seen_ids:
                seen_ids.add(pid)
                window_after = clean_msg[m.start():min(len(clean_msg), m.end() + 35)].lower()
                is_unavailable_ref = bool(
                    re.search(r"\b(seems?\s+out|is\s+out|is\s+down|stuck|offline|unavailable|quiet|failed|timed?\s*out)\b", window_after)
                )
                plain_matches.append((m.start(), p, is_unavailable_ref))

        if plain_matches:
            plain_matches.sort(key=lambda x: x[0])
            active_matches = [item[1] for item in plain_matches if not item[2]]
            chosen = active_matches if active_matches else [item[1] for item in plain_matches]
            names_str = ", ".join(f"**@{p['name']}**" for p in chosen)
            return chosen, f"🧭 **Context-Aware Routing**: Detected plain-text directive for {names_str}."

    # Stage 1: Designated Room Orchestrator
    rooms = get_all_rooms()
    matched_room = next((r for r in rooms if r.get("id") == (room_id or "general").strip()), None)
    room_orch_name = matched_room.get("orchestrator") if matched_room else None
    if room_orch_name:
        orch_p = resolve_participant(room_orch_name, participants)
        if orch_p:
            last_orch_msg = next(
                (m for m in reversed(recent_history) if m.get("sender_type") == "agent" and m.get("sender", "").lower() == orch_p["name"].lower()),
                None,
            )
            if not (last_orch_msg and is_error_turn(last_orch_msg)):
                return [orch_p], f"👑 **Room Orchestrator**: Directing conference floor to **@{orch_p['name']}** as designated room lead."

    # Stage 2: Fast LLM Semantic Router
    if cfg.get("llm_router_enabled", True):
        llm_match = call_llm_router(clean_msg, recent_history, participants, cfg)
        if llm_match:
            matched_agent, routing_note = llm_match
            if fixed_rules.get("skip_failed_agents", True):
                last_agent_msg = next(
                    (m for m in reversed(recent_history) if m.get("sender_type") == "agent" and m.get("sender", "").lower() == matched_agent["name"].lower()),
                    None,
                )
                if not (last_agent_msg and is_error_turn(last_agent_msg)):
                    return [matched_agent], routing_note
            else:
                return [matched_agent], routing_note

    # Stage 3: Deterministic Rule Cascade Fallback
    last_healthy_agent_msg = next(
        (m for m in reversed(recent_history) if m.get("sender_type") == "agent" and not (fixed_rules.get("skip_failed_agents", True) and is_error_turn(m))),
        None,
    )

    if fixed_rules.get("check_last_speaker_question", True) and last_healthy_agent_msg:
        p = resolve_participant(last_healthy_agent_msg.get("sender", ""), participants)
        if p and detect_question_or_call_to_action(last_healthy_agent_msg.get("text", "")):
            return [p], f"↩️ **Direct Conversation Continuity**: Routing untagged reply to **@{p['name']}** (answering direct prompt/question)."

    if fixed_rules.get("check_pending_inquiries", True) and pending_inquiries:
        inquiring_targets = []
        inq_questions = []
        for inq in reversed(pending_inquiries):
            p = resolve_participant(inq.get("agent", ""), participants)
            if p and p not in inquiring_targets:
                if fixed_rules.get("skip_failed_agents", True):
                    recent_turn = next(
                        (m for m in reversed(recent_history) if m.get("sender_type") == "agent" and m.get("sender", "").lower() == p["name"].lower()),
                        None,
                    )
                    if recent_turn and is_error_turn(recent_turn):
                        continue
                inquiring_targets.append(p)
                if inq.get("question"):
                    inq_questions.append(f"@{p['name']}: \"{inq['question']}\"")
        if inquiring_targets:
            names_str = ", ".join(f"**@{p['name']}**" for p in inquiring_targets)
            q_note = f" (answering {'; '.join(inq_questions[:2])})" if inq_questions else ""
            return inquiring_targets, f"↩️ **Q&A Continuity Routing**: Routing untagged reply directly to inquiring agent {names_str}{q_note}."

    if recent_history:
        timed_out_skipped = []
        last_healthy_speaker = None
        last_mentioning_speaker = None
        for msg in reversed(recent_history):
            if msg.get("sender_type") == "agent":
                p = resolve_participant(msg.get("sender", ""), participants)
                if not p:
                    continue
                if is_error_turn(msg):
                    if f"@{p['name']}" not in timed_out_skipped:
                        timed_out_skipped.append(f"@{p['name']}")
                    continue
                if not last_healthy_speaker:
                    last_healthy_speaker = p
                if msg.get("mentions_user") and not last_mentioning_speaker:
                    last_mentioning_speaker = p
                    break

        skipped_note = f" (skipping timed-out {', '.join(timed_out_skipped[:2])})" if timed_out_skipped else ""
        if fixed_rules.get("check_recent_user_mention", True) and last_mentioning_speaker:
            return [last_mentioning_speaker], f"↩️ **Q&A Continuity Routing**: Routing untagged reply to **@{last_mentioning_speaker['name']}** (awaiting your response){skipped_note}."
        if fixed_rules.get("check_last_healthy_speaker", True) and last_healthy_speaker:
            return [last_healthy_speaker], f"💬 **Healthy Speaker Continuity**: Routing untagged reply to last reporting specialist **@{last_healthy_speaker['name']}**{skipped_note}."

    fallback_name = room_orch_name or fixed_rules.get("default_fallback_agent", "Solaris")
    default_p = resolve_participant(fallback_name, participants) or participants[0]
    return ([default_p] if default_p else []), ""


# ---------------------------------------------------------------------------
# 3. Dispatcher, STT, Participants & Presets Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/war-room/dispatcher/rules")
def get_war_room_dispatcher_rules():
    """Returns current LLM Router and fixed fallback rule configuration."""
    cfg = load_dispatcher_config()
    cfg["available_agents"] = get_available_dispatcher_agents()
    return cfg


@router.post("/api/war-room/dispatcher/rules")
async def update_war_room_dispatcher_rules(req: Request):
    """Updates LLM Router and fixed fallback rule configuration."""
    body = await req.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not save_dispatcher_config(body):
        raise HTTPException(status_code=500, detail="Failed to save dispatcher rules")
    cfg = load_dispatcher_config()
    await broadcast_event("war_room_dispatcher_rules_updated", cfg)
    return {"status": "success", "config": cfg}


@router.post("/api/war-room/dispatcher/test")
async def test_war_room_dispatcher(req: Request):
    """Interactive simulation endpoint to test War Room target routing."""
    body = await req.json()
    user_msg = body.get("message", "")
    room_id = body.get("room_id", "general")
    participants = get_room_participants(room_id) or get_all_conference_participants()
    pending = get_room_inquiries(room_id)
    targets, reason = resolve_contextual_targets(user_msg, participants, pending, room_id=room_id)
    return {"targets": targets, "reason": reason, "target_names": [p["name"] for p in targets]}


@router.post("/api/war-room/stt/clean")
async def clean_speech_to_text(req: Request):
    """Normalizes voice transcript output using the active War Room Dispatcher LLM."""
    from services.war_room.orchestration import clean_stt_transcript_with_dispatcher
    body = await req.json()
    raw_transcript = body.get("transcript", "")
    room_id = body.get("room_id", "general")
    room_title = body.get("room_title", "General")

    participants = get_room_participants(room_id) or get_all_conference_participants()
    recent_history = read_war_room_history(room_id, limit=4) if callable(read_war_room_history) else []

    cleaned = clean_stt_transcript_with_dispatcher(
        raw_transcript=raw_transcript,
        participants=participants,
        room_title=room_title,
        recent_history=recent_history,
    )
    return {"raw": raw_transcript, "cleaned": cleaned}


@router.get("/api/war-room/participants")
def list_war_room_participants(room_id: Optional[str] = Query(None)):
    """Returns conference panelists for a specific room or the full conference pool."""
    if room_id:
        return {"participants": get_room_participants(room_id)}
    return {"participants": get_all_conference_participants()}


@router.get("/api/war-room/presets")
def list_war_room_presets():
    """Lists specialized multi-agent War Room workflow presets."""
    return {"presets": list(WAR_ROOM_PRESETS_CATALOG.values())}
