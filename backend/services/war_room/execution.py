"""
NexusDesk War Room Agent Execution & Deliberation Service
Constructs contextual prompt chains, enforces participant whitelists, executes agent turns via CLI executor,
and handles two-phase background task coordination.
Part of BL-ARCH-32 modularization.
"""

import asyncio
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from core.config import (
    DATA_DIR,
    AGENT_PALETTE,
    AGENT_SUBPROCESS_TIMEOUT,
    get_instance_user_context,
    discover_instances,
    set_instance_perms,
    safe_path_exists,
    broadcast_event,
    get_specialist_overrides,
    get_agent_override_model,
    get_engine_active_model,
    normalize_agy_model_slug
)
from services.cli_executor import run_agent_cli, kill_room_agent_proc
from services.war_room.tasks import (
    get_room_sandbox_path,
    upsert_room_bg_task,
    get_room_bg_tasks
)
from services.war_room.context_engine import (
    build_war_room_context_prompt_block,
    sync_transcript_mirror_to_sandbox
)

SESSION_EPOCHS_FILE = DATA_DIR / "session_epochs.json"
WAR_ROOM_FILE = DATA_DIR / "war_room_messages.jsonl"
ROOMS_META_FILE = DATA_DIR / "war_room_rooms.json"
OPERATOR_QUEUES_FILE = DATA_DIR / "war_room_operator_queues.json"

# Operator queued directives per room: {room_id: [queued_directive_obj, ...]} (BL-WAR-38 & BL-EVO-11)
ROOM_OPERATOR_QUEUES: Dict[str, List[Dict[str, Any]]] = {}

def _load_operator_queues() -> Dict[str, List[Dict[str, Any]]]:
    global ROOM_OPERATOR_QUEUES
    if not ROOM_OPERATOR_QUEUES and OPERATOR_QUEUES_FILE.exists():
        try:
            with open(OPERATOR_QUEUES_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    ROOM_OPERATOR_QUEUES.update(loaded)
        except Exception as e:
            print(f"[WAR_ROOM_EXEC] Warning loading operator queues: {e}")
    return ROOM_OPERATOR_QUEUES

def _save_operator_queues():
    try:
        with open(OPERATOR_QUEUES_FILE, "w", encoding="utf-8") as f:
            json.dump(ROOM_OPERATOR_QUEUES, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WAR_ROOM_EXEC] Warning saving operator queues: {e}")

def queue_operator_directive(room_id: str, directive: Dict[str, Any]):
    """Appends an operator directive to the priority queue for the room."""
    _load_operator_queues()
    rid = (room_id or "general").strip()
    if rid not in ROOM_OPERATOR_QUEUES:
        ROOM_OPERATOR_QUEUES[rid] = []
    ROOM_OPERATOR_QUEUES[rid].append(directive)
    _save_operator_queues()

def pop_next_operator_directive(room_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves and pops the next priority operator directive for the room if any."""
    _load_operator_queues()
    rid = (room_id or "general").strip()
    q = ROOM_OPERATOR_QUEUES.get(rid)
    if q and len(q) > 0:
        item = q.pop(0)
        _save_operator_queues()
        return item
    return None

def peek_next_operator_directive(room_id: str) -> Optional[Dict[str, Any]]:
    """Returns (without removing) the next queued operator directive for the room if any."""
    _load_operator_queues()
    q = ROOM_OPERATOR_QUEUES.get((room_id or "general").strip())
    return q[0] if q else None

def list_operator_directives(room_id: str) -> List[Dict[str, Any]]:
    """Returns the full list of queued operator directives for the room."""
    _load_operator_queues()
    return list(ROOM_OPERATOR_QUEUES.get((room_id or "general").strip()) or [])

def count_operator_directives(room_id: str) -> int:
    """Number of operator directives currently waiting in the room queue."""
    _load_operator_queues()
    return len(ROOM_OPERATOR_QUEUES.get((room_id or "general").strip()) or [])

def remove_operator_directive(room_id: str, directive_id: str = "all") -> int:
    """Removes a specific queued directive by ID or clears all queued directives for a room."""
    _load_operator_queues()
    rid = (room_id or "general").strip()
    q = ROOM_OPERATOR_QUEUES.get(rid) or []
    if not q:
        return 0
    if directive_id == "all":
        removed = len(q)
        ROOM_OPERATOR_QUEUES.pop(rid, None)
        _save_operator_queues()
        return removed
    new_q = [d for d in q if d.get("id") != directive_id]
    removed = len(q) - len(new_q)
    if removed > 0:
        ROOM_OPERATOR_QUEUES[rid] = new_q
        _save_operator_queues()
    return removed

def clear_operator_directives(room_id: str):
    """Clears all queued operator directives for a room."""
    remove_operator_directive(room_id, "all")


def update_operator_directive(
    room_id: str,
    directive_id: str,
    message: str,
    max_turns: Optional[int] = None,
    execution_mode: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Updates an existing pending queued directive in-place before it is popped."""
    _load_operator_queues()
    rid = (room_id or "general").strip()
    q = ROOM_OPERATOR_QUEUES.get(rid) or []
    for item in q:
        if item.get("id") == directive_id:
            item["message"] = message
            if max_turns is not None:
                item["max_turns"] = max_turns
            if execution_mode is not None:
                item["execution_mode"] = execution_mode
            item["edited_at"] = time.time()
            _save_operator_queues()
            return dict(item)
    return None

# ---------------------------------------------------------------------------
# Room-wide operator interrupt generation (BL-WAR-39)
# Every turn chain (operator dispatch, round-table, background-task return turn) captures the
# generation when it starts. An operator interrupt bumps it, so ANY chain started earlier refuses to
# run further turns or post late replies, no matter which code path launched it.
# ---------------------------------------------------------------------------
ROOM_INTERRUPT_GEN: Dict[str, int] = {}

class TurnInterrupted(asyncio.CancelledError):
    """Raised when an operator interrupt invalidated the chain this turn belongs to."""

def get_interrupt_gen(room_id: str) -> int:
    return ROOM_INTERRUPT_GEN.get(re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "general").strip()) or "general", 0)

def bump_interrupt_gen(room_id: str) -> int:
    rid = re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "general").strip()) or "general"
    ROOM_INTERRUPT_GEN[rid] = ROOM_INTERRUPT_GEN.get(rid, 0) + 1
    return ROOM_INTERRUPT_GEN[rid]

def get_session_epochs() -> Dict[str, int]:
    if SESSION_EPOCHS_FILE.exists():
        try:
            with open(SESSION_EPOCHS_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except Exception:
            pass
    return {}

def get_room_session_epoch(room_id: str) -> int:
    epochs = get_session_epochs()
    return epochs.get(str(room_id).strip(), 1)

def bump_room_session_epoch(room_id: str) -> int:
    epochs = get_session_epochs()
    rid = str(room_id).strip()
    next_epoch = epochs.get(rid, 1) + 1
    epochs[rid] = next_epoch
    try:
        with open(SESSION_EPOCHS_FILE, "w", encoding="utf-8") as f:
            json.dump(epochs, f, indent=2)
    except Exception as e:
        print(f"[WAR_ROOM_EXEC] Warning saving session epoch: {e}")
    return next_epoch

def get_room_file(room_id: str = "general") -> Path:
    safe_id = re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "general").strip()) or "general"
    room_path = DATA_DIR / f"war_room_messages_{safe_id}.jsonl"
    return room_path

def get_all_rooms() -> List[Dict[str, Any]]:
    default_rooms = [
        {"id": "general", "name": "War Room: General", "type": "warroom", "created_at": 0, "is_default": True}
    ]
    if not ROOMS_META_FILE.exists():
        return default_rooms
    try:
        with open(ROOMS_META_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list) and data:
                return data
    except Exception:
        pass
    return default_rooms

def read_war_room_history(room_id: str = "general", limit: int = 100, since: Optional[float] = None) -> List[Dict[str, Any]]:
    rf = get_room_file(room_id)
    if not rf.exists():
        return []
    messages = []
    try:
        with open(rf, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    m = json.loads(line)
                    if since is not None and m.get("timestamp", 0) <= since:
                        continue
                    messages.append(m)
                except Exception:
                    continue
    except Exception as e:
        print(f"[WAR_ROOM_EXEC] Warning reading war room history for {room_id}: {e}")
    return messages[-limit:] if limit else messages

_ROOM_APPEND_LOCKS: Dict[str, threading.Lock] = {}
_ROOM_APPEND_LOCKS_GUARD = threading.Lock()


def _get_room_append_lock(room_id: str) -> threading.Lock:
    key = re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "general").strip()) or "general"
    with _ROOM_APPEND_LOCKS_GUARD:
        lock = _ROOM_APPEND_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _ROOM_APPEND_LOCKS[key] = lock
        return lock


def append_war_room_message(msg: Dict[str, Any], room_id: str = "general"):
    rf = get_room_file(room_id)
    try:
        line = json.dumps(msg, ensure_ascii=False) + "\n"
        with _get_room_append_lock(room_id):
            with open(rf, "a", encoding="utf-8") as f:
                f.write(line)
                f.flush()
            try:
                os.chmod(rf, 0o644)
                sync_transcript_mirror_to_sandbox(room_id, rf)
            except Exception:
                pass
    except Exception as e:
        print(f"[WAR_ROOM_EXEC] Warning writing message to room {room_id}: {e}")


_SHOUT_EXEC_SUMMARY_RE = re.compile(r"<executive_summary>([\s\S]*?)</executive_summary>", re.IGNORECASE)
_SHOUT_CONTROL_BLOCK_RE = re.compile(
    r"<(?:swarm_dispatch|async_task|no_op|set_reminder|outbound_message)>[\s\S]*?</(?:swarm_dispatch|async_task|no_op|set_reminder|outbound_message)>",
    re.IGNORECASE,
)
_SHOUT_STRAY_TAG_RE = re.compile(
    r"</?(?:executive_summary|swarm_dispatch|async_task|no_op|set_reminder|outbound_message)\b[^>]*>",
    re.IGNORECASE,
)


def extract_shout_snippet(reply: str, max_len: int = 80) -> str:
    """
    Extracts a clean spoken/canvas shout snippet from a War Room reply, preferring the
    `<executive_summary>` body instead of grabbing line 1 (`"<executive_summary>"`).
    """
    raw = (reply or "").strip()
    if not raw:
        return ""
    m = _SHOUT_EXEC_SUMMARY_RE.search(raw)
    source = m.group(1) if (m and m.group(1).strip()) else raw
    source = _SHOUT_CONTROL_BLOCK_RE.sub(" ", source)
    source = _SHOUT_STRAY_TAG_RE.sub(" ", source)
    source = re.sub(r"```[\s\S]*?```", " ", source)
    source = re.sub(r"`([^`]+)`", r"\1", source)
    source = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", source)
    source = re.sub(r"^\s*(?:[#>*_]+\s*)*executive\s+(?:summary|synthesis)\b[^\n]*", "", source, flags=re.IGNORECASE | re.MULTILINE)
    source = re.sub(r"[#*_~>|]+", " ", source)
    clean = re.sub(r"\s+", " ", source).strip()
    if not clean:
        return ""
    if len(clean) <= max_len:
        return clean
    cut = clean[: max(1, max_len - 3)].rsplit(" ", 1)[0].strip()
    return (cut or clean[: max(1, max_len - 3)]) + "..."


def update_war_room_message_text(room_id: str, msg_id: str, new_text: str) -> Optional[Dict[str, Any]]:
    """Updates an existing message's text in the room JSONL transcript under the room append lock."""
    rf = get_room_file(room_id)
    if not rf.exists() or not msg_id:
        return None
    try:
        with _get_room_append_lock(room_id):
            lines = rf.read_text(encoding="utf-8").splitlines()
            updated_obj = None
            out_lines = []
            for raw in lines:
                s = raw.strip()
                if not s:
                    continue
                try:
                    obj = json.loads(s)
                    if obj.get("id") == msg_id:
                        obj["text"] = new_text
                        obj["edited_at"] = time.time()
                        updated_obj = obj
                    out_lines.append(json.dumps(obj, ensure_ascii=False))
                except Exception:
                    out_lines.append(s)
            if updated_obj is not None:
                rf.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
                try:
                    os.chmod(rf, 0o644)
                    sync_transcript_mirror_to_sandbox(room_id, rf)
                except Exception:
                    pass
            return updated_obj
    except Exception as e:
        print(f"[WAR_ROOM_EXEC] Warning updating message {msg_id} in room {room_id}: {e}")
        return None

def score_directive_async_complexity(text: str) -> Tuple[int, List[str]]:
    """
    BL-WAR-47 Pillar 2: Semantic & Heuristic Complexity Scoring.
    Evaluates a directive/transcript snippet for batch quantities, iteration patterns, and heavy network/crunching signals.
    If Pillar 2 fails or misses a subtle heavy task, Pillar 3 (240s Soft Interceptor) serves as the physical safety net.
    """
    if not text:
        return 0, []
    lower = text.lower()
    score = 0
    reasons = []

    # 1. Quantity + Unit patterns (e.g., "184 branches", "10 pois", "50 rows", "all 25 items")
    qty_match = re.findall(r'\b(\d+)\s*(branches|items|files|rows|pages|urls|pois|records|nodes|locations|sites|companies|endpoints)\b', lower)
    for num_str, unit in qty_match:
        try:
            n = int(num_str)
            if n >= 5:
                score += 2
                reasons.append(f"batch quantity ({n} {unit})")
        except ValueError:
            pass

    # 2. Iterative / Batch verbs & structures
    iter_patterns = [
        (r'\b(for each|every single|all of them|across all|split.*into.*tasks|parallel.*shard|chunk)\b', "batch iteration"),
        (r'\b(scrape|crawl|overpass|nominatim|geocod\w+|download all|fetch all|enrich all)\b', "external network batching"),
        (r'\b(re-?run|refresh all|expand.*to\s+\d+\s*km|classify.*all)\b', "dataset refresh/classification"),
        (r'task_type\s*:\s*["\']?async_delegated["\']?', "dispatcher async flag"),
    ]
    for pat, label in iter_patterns:
        if re.search(pat, lower):
            score += 1
            reasons.append(label)

    return score, reasons

async def execute_agent_war_room_turn(
    agent: Dict[str, Any],
    directive_text: str,
    transcript: List[Dict[str, Any]],
    room_id: str = "general",
    room_participants: Optional[List[Dict[str, Any]]] = None,
    turn_info: Optional[Dict[str, Any]] = None,
    interrupt_gen: Optional[int] = None,
    origin_channel: Optional[str] = "web",
    timeout_override: Optional[int] = None,
    swarm_assignment: Optional[str] = None,
    parallel_peers: Optional[List[str]] = None,
    swarm_planner_workers: Optional[List[str]] = None
) -> str:
    """
    Executes an agent's turn in a War Room conference using the unified CLI executor.
    Injects recent transcript context, sandbox rules, and whitelist restrictions.
    Supports dynamic turn timeout scaling via BL-WAR-50.
    """
    if interrupt_gen is not None and get_interrupt_gen(room_id) != interrupt_gen:
        raise TurnInterrupted()

    agent_name = agent["name"]
    agent_role = agent.get("role", "Specialist Agent")
    agent_engine = agent.get("engine", "hermes").lower().strip()
    agent_model = agent.get("model", "")
    inst_key = agent.get("fleet", "agents_bs")
    ctx = get_instance_user_context(inst_key)

    rid = (room_id or "general").strip()
    room_override_model = None
    if rid != "general":
        rooms = get_all_rooms()
        matched = next((r for r in rooms if r.get("id") == rid), None)
        if matched and isinstance(matched.get("model_overrides"), dict):
            room_override_model = matched["model_overrides"].get(agent_name.lower().strip()) or matched["model_overrides"].get(agent.get("id", "").lower().strip())

    if room_override_model:
        agent_model = room_override_model
    else:
        override_m = get_agent_override_model(agent_name, username=ctx["user"], eng_id=agent_engine)
        if override_m:
            agent_model = override_m
        elif not agent_model:
            agent_model = get_engine_active_model(agent_engine, ctx["user"], agent_name=agent_name)

    if agent_engine == "agy" and agent_model:
        agent_model = normalize_agy_model_slug(agent_model)

    # BL-EVO-36: Antigravity-Style Multi-Agent Context Engine
    # Loads full room history (with fallback to caller transcript) and builds:
    # 1. <CONTEXT_SUMMARY> (Pinned Operator Notes + Chronological User Requests + Compacted Earlier Turns)
    # 2. <DELIVERABLES_AND_ARTIFACTS> (Deterministic Sandbox File Registry with Creator & CSV/JSON Schema Info)
    # 3. <CONVERSATION_TRANSCRIPT_POINTER> (Deep recall path to full JSONL transcript)
    # 4. Substantive Sliding Transcript Window (Last 12 User/Agent turns @ up to 2,800 chars each)
    full_history = read_war_room_history(room_id=room_id, limit=0) or (transcript or [])
    context_and_transcript_block = await asyncio.to_thread(
        build_war_room_context_prompt_block,
        room_id=room_id,
        full_messages=full_history,
        room_jsonl_file=get_room_file(room_id)
    )
    transcript_text = context_and_transcript_block

    allowed_handles = ""
    if room_participants:
        handles = [f"@{p['name']}" for p in room_participants if p['name'].lower() != agent_name.lower()]
        allowed_handles = ", ".join(handles)
    from core.config import get_operator_name
    op_name = get_operator_name()
    whitelist_rule = (
        f"Exclusive Room Participants Whitelist: [{allowed_handles}]. "
        f"You may ONLY mention/delegate to these authorized participants or @user/@{op_name}. Do NOT call or mention any outside agents."
    ) if allowed_handles else "Consult with @user."

    s_path = get_room_sandbox_path(room_id)
    deliverables_dir = s_path / "deliverables"
    scratch_dir = s_path / "scratch"
    sandbox_rule = (
        f"Shared Multi-Agent Sandbox (BL-WAR-13, BL-EVO-12):\n"
        f"- Deliverables folder: `{deliverables_dir}` (Save final CSVs, reports, images, slides, mockups, and persistent artifacts here).\n"
        f"- Scratch folder: `{scratch_dir}` (Use for temporary parsing, downloads, scratch data; auto-pruned after 7 days).\n"
        f"- Environment variable $WARROOM_SANDBOX points to `{s_path}`.\n"
        f"- MULTIMODAL MEDIA & DELIVERABLE RENDERING (BL-EVO-12): When you generate, convert, or reference images, screenshots, charts, mockups, or deliverables, format them using standard markdown image or file links with their full sandbox path:\n"
        f"  * Images: `![Description]({deliverables_dir}/filename.png)`\n"
        f"  * Files: `[Download Description]({deliverables_dir}/filename.pdf)`\n"
        f"  NexusDesk will automatically render responsive inline image preview cards with lightbox modal zoom and 1-click download cards for @{op_name}."
    )

    turn_context_rule = ""
    if turn_info and isinstance(turn_info, dict):
        cur_t = turn_info.get("current_turn", 1)
        max_t = turn_info.get("max_turns", 1)
        is_final = (cur_t >= max_t)
        if is_final:
            turn_context_rule = (
                f"- DISCUSSION TURN DEPTH: This is Turn {cur_t} of {max_t} (FINAL CONCLUDING TURN for this prompt). "
                f"You MUST synthesize results, answer the operator directly, or state final conclusions. "
                f"Do NOT initiate further open-ended multi-agent delegation handoffs unless requesting background async task processing.\n"
            )
        else:
            turn_context_rule = (
                f"- DISCUSSION TURN DEPTH: This is Turn {cur_t} of {max_t}. "
                f"Collaborate efficiently and advance the objectives before the turn limit is reached.\n"
            )

    # BL-WAR-42 & BL-WAR-36: Room Orchestrator & Domain Preset Directive Injection
    orchestrator_directive = ""
    preset_directive = ""
    worktree_dir_override = None
    try:
        rooms_list = get_all_rooms()
        curr_room = next((r for r in rooms_list if r.get("id") == (room_id or "general").strip()), None)
        if curr_room:
            if curr_room.get("orchestrator", "").lower().strip() == agent_name.lower().strip():
                orchestrator_directive = (
                    f"\n\n[ROOM ORCHESTRATOR & DISPATCHER DIRECTIVE (BL-WAR-42)]:\n"
                    f"You have been officially designated as the Chief Orchestrator and Dispatcher for this War Room.\n"
                    f"- Your primary responsibility is to lead the conference, decompose the operator's directives, and assign specialist tasks.\n"
                    f"- Delegate specific sub-tasks to fellow participants by mentioning their handles (e.g. @Pylon, @Lore, @Chroma, @Scribe, @Claude, etc.).\n"
                    f"- Do not do narrow specialist work yourself if a qualified specialist is present in the room; coordinate their execution, synthesize their findings, and report conclusive status back to the operator.\n"
                )

            room_preset = (curr_room.get("preset") or "general_conference").lower().strip()
            if room_preset == "coding_sprint":
                preset_directive = (
                    f"\n\n[ROOM WORKFLOW PRESET: ⚡ COLLABORATIVE CODING SPRINT (BL-WAR-36)]:\n"
                    f"- Role Division: Architecture & Design (@Claude), Implementation & Patching (@Codex / @OpenCode), Adversarial QA & Verification (@Solaris / @Agy).\n"
                    f"- Engineering Discipline: Prioritize Test-Driven Development (TDD), clean diffs, linting, and concrete execution over conversational filler.\n"
                    f"- Phase Tagging: Prefix your technical section header with your active workflow phase tag: `[PROPOSAL]`, `[IMPLEMENTATION]`, `[QA_REVIEW]`, or `[VERDICT]`.\n"
                )
            elif room_preset == "deep_research":
                preset_directive = (
                    f"\n\n[ROOM WORKFLOW PRESET: 🔬 DEEP MULTI-PERSPECTIVE RESEARCH (BL-WAR-36)]:\n"
                    f"- Role Division: Primary Data Sourcing, Quantitative Synthesis (CSVs/Tables in `{deliverables_dir}`), and Devil's Advocate Red-Teaming.\n"
                    f"- Research Rigor: Cite verifiable data sources, grade evidence quality, and save structured datasets/reports to `{deliverables_dir}`.\n"
                    f"- Phase Tagging: Prefix your technical section with `[PROPOSAL]`, `[IMPLEMENTATION]`, `[QA_REVIEW]`, or `[VERDICT]`.\n"
                )
            elif room_preset == "security_audit":
                preset_directive = (
                    f"\n\n[ROOM WORKFLOW PRESET: 🛡️ SRE & SECURITY RED-TEAMING (BL-WAR-36)]:\n"
                    f"- Blue Team drafts infrastructure, systemd configs, and security rules; Red Team actively probes for race conditions, privilege escalations, and failure modes.\n"
                    f"- Phase Tagging: Prefix your technical section with `[PROPOSAL]`, `[IMPLEMENTATION]`, `[QA_REVIEW]`, or `[VERDICT]`.\n"
                )
            elif room_preset == "executive_advisory":
                preset_directive = (
                    f"\n\n[ROOM WORKFLOW PRESET: 📊 EXECUTIVE BOARD & PITCH DECK (BL-WAR-36)]:\n"
                    f"- Focus on consulting-grade action titles, decision matrices, financial/strategic modeling, and polished presentation deliverables.\n"
                    f"- Phase Tagging: Prefix your technical section with `[PROPOSAL]`, `[IMPLEMENTATION]`, `[QA_REVIEW]`, or `[VERDICT]`.\n"
                )

            # BL-WAR-43: Way of Working (WoW) Rules Injection (Room-specific or Preset Default)
            wow_content = (curr_room.get("wow_rules") or "").strip()
            if not wow_content:
                wow_file = Path(__file__).resolve().parents[2] / "data" / "domain_presets" / f"{room_preset}_wow.md"
                if wow_file.exists():
                    try:
                        wow_content = wow_file.read_text(encoding="utf-8").strip()
                    except Exception:
                        pass
            if wow_content:
                preset_directive += f"\n\n[DOMAIN & ROOM WAY OF WORKING (WoW) RULES (BL-WAR-43)]:\n{wow_content}\n"

            # Isolated Multi-Agent Worktree directory per agent when enabled
            if curr_room.get("worktree_isolation"):
                wt_base = s_path / "worktrees" / agent_name.lower().strip()
                wt_base.mkdir(parents=True, exist_ok=True)
                try:
                    os.chmod(wt_base, 0o777)
                except Exception:
                    pass
                worktree_dir_override = str(wt_base)
                preset_directive += f"- Isolated Agent Worktree Active: Your dedicated working directory is `{worktree_dir_override}` (`$WARROOM_AGENT_WORKTREE`).\n"
    except Exception:
        pass

    gateways_rule = ""
    try:
        from services.gateways import get_gateways_prompt_summary
        gateways_rule = get_gateways_prompt_summary(origin_channel=origin_channel)
    except Exception:
        pass

    # BL-WAR-50 & BL-EVO-31: Dynamic Turn Timeout Override calculation (Default 2700s / 45m)
    effective_timeout = float(timeout_override) if timeout_override else float(AGENT_SUBPROCESS_TIMEOUT)
    # Scale soft timeout proportionally: default is 1800s (30m) for 2700s (45m) (2/3 ratio)
    effective_soft_timeout = float(int(effective_timeout * (1800.0 / 2700.0)))

    # BL-WAR-47 Pillar 2: Heuristic Complexity & Intent Scoring
    complexity_score, complexity_reasons = score_directive_async_complexity(f"{directive_text}\n{transcript_text[-1500:]}")
    pillar2_async_banner = ""
    if complexity_score >= 2:
        reasons_str = ", ".join(complexity_reasons)
        pillar2_async_banner = (
            f"\n🚨 [PRE-FLIGHT COMPLEXITY CLASSIFIER (BL-WAR-47 PILLAR 2) — SCORE {complexity_score} ({reasons_str})]:\n"
            f"- Heavy batch / iterative / network workload detected.\n"
            f"- Synchronous execution of loops or remote queries inside this turn is BLOCKED.\n"
            f"- You have a 60-second composition window: inspect input schema, write your Python/Bash script to `{scratch_dir}/<job_name>.py`, emit the `<async_task>` JSON tag, and yield immediately!\n\n"
        )

    # Snapshot scratch files before turn starts for Pillar 3 & Pillar 4 recovery
    turn_start_ts = time.time()
    scratch_files_before = {}
    if scratch_dir.exists():
        for fp in scratch_dir.glob("*"):
            if fp.is_file() and fp.suffix in (".py", ".sh") and not fp.name.startswith("error_"):
                try:
                    scratch_files_before[str(fp)] = fp.stat().st_mtime
                except Exception:
                    pass

    from services.war_room.schedules import format_active_schedules_prompt_block
    active_schedules_block = format_active_schedules_prompt_block(room_id)

    linked_workspaces_block = ""
    try:
        linked_cfg = (curr_room.get("linked_chat_workspaces") or []) if curr_room else []
        if linked_cfg:
            from services import chat_agents as ca_svc
            lw_lines: List[str] = []
            for lnk in linked_cfg:
                aid_l = str(lnk.get("agent_id") or "").strip().lower()
                sid_l = str(lnk.get("scope_id") or "").strip()
                if not aid_l or not sid_l:
                    continue
                ca_svc.ensure_active_month_rolled_over(aid_l, sid_l)
                recap_meta = ca_svc.get_workspace_recap_script(aid_l, sid_l)
                ws_meta = ca_svc.get_subdata_workspace(aid_l, sid_l) or {}
                grp_name = (ws_meta.get("binding") or {}).get("chat_name") or (ws_meta.get("binding") or {}).get("chat_id") or "unbound"
                mirror_p = ca_svc.get_shared_active_ledger_path(aid_l, sid_l)
                ro_state = recap_meta.get("rollover_state") or {}
                bcast_flag = "ENABLED" if lnk.get("allow_group_broadcast") else "DISABLED"
                lw_lines.append(
                    f"- agent=`{aid_l}`, scope=`{sid_l}` | Active Ledger Mirror (Read-Only): `{mirror_p}` "
                    f"({recap_meta.get('total_posts', 0)} rows, active_month={ro_state.get('active_month_ym', '-')}, "
                    f"custom_hook={'ACTIVE' if recap_meta.get('has_custom_hook') else 'default'}, group=`{grp_name}`, group_broadcast={bcast_flag})"
                )
            if lw_lines:
                linked_workspaces_block = (
                    "\n[LINKED CHAT AGENT WORKSPACES & LIVE COLLECTORS]:\n"
                    + "\n".join(lw_lines)
                    + "\n  * Always read the Active Ledger Mirror path above directly in Python (always points to the live pruned current month).\n"
                    "  * To update the Chat Agent's extractor/rollover rules or `custom_recap_hook.py` directly from this War Room, emit:\n"
                    "    `<chat_agent_recap_config>{\"agent_id\": \"agy\", \"scope_id\": \"lapak_umkm_cgs\", \"rules\": {\"capture_mode\": \"commerce_only\", \"extra_keywords\": [...], \"seasonal_keywords\": [...], \"min_recurring_posts\": 2}, \"hook_code\": \"def transform_entry(entry, context): ...\"}</chat_agent_recap_config>`\n"
                    "  * To publish finished deliverables (clean overwrite, no drafts/symlinks) into the Chat Agent workspace, emit:\n"
                    "    `<chat_agent_publish>{\"agent_id\": \"agy\", \"scope_id\": \"lapak_umkm_cgs\", \"files\": [{\"src\": \"deliverables/katalog_umkm_cgs_active.html\", \"dest\": \"katalog_umkm_cgs_active.html\"}]}</chat_agent_publish>`\n"
                    "  * If `group_broadcast=ENABLED`, to make the Chat Agent send published catalog + intro video to its bound WhatsApp group, emit:\n"
                    "    `<chat_agent_whatsapp>{\"agent_id\": \"agy\", \"scope_id\": \"lapak_umkm_cgs\", \"to\": \"bound_group\", \"files\": [\"katalog_umkm_cgs_active.html\", \"deliverables/panduan_katalog_umkm_cgs_ponsel.mp4\"], \"message\": \"Katalog UMKM CGS terbaru sudah diperbarui!\"}</chat_agent_whatsapp>`\n\n"
                )
    except Exception:
        linked_workspaces_block = ""

    swarm_mode_block = ""
    if swarm_planner_workers:
        workers_csv = ", ".join(f"@{w}" for w in swarm_planner_workers)
        swarm_mode_block = (
            f"\n[PLAN -> SWARM ORCHESTRATOR PHASE 1 — STRICT PLAN-ONLY CONTRACT]:\n"
            f"- You are the Lead Planner for a parallel swarm wave. Available parallel worker agents in this room: {workers_csv}.\n"
            f"- PLAN-ONLY RULE: Do NOT execute code edits, publish posts, send broadcasts, deploy, or spawn internal sub-agents (`delegate_task`) yourself during Phase 1 — NexusDesk will launch your assigned workers in Phase 2.\n"
            f"- Break the operator's directive into clear, strictly NON-OVERLAPPING parallel sub-tasks for ONLY the workers genuinely needed from: {workers_csv}.\n"
            f"- Assign ALL implementation tracks to workers (never reserve an implementation track 'for yourself' during Phase 2; you will handle Phase 3 Synthesis after workers report back).\n"
            f"- SINGLE-OWNER SIDE-EFFECT RULE: Never assign two agents to perform the same external side-effect (publishing a post, deploying to Netlify/Vercel, sending WhatsApp/email, editing the same file).\n"
            f"- You MUST include a machine-readable `<swarm_dispatch>` JSON array tag in your response:\n"
            f"  <swarm_dispatch>[{{\"agent\": \"{swarm_planner_workers[0]}\", \"task\": \"Concrete scoped sub-task and expected output...\"}}]</swarm_dispatch>\n"
            f"- NO-SWARM OPT-OUT: If the operator's prompt is a simple read-only Q&A you already completely answered with read-only checks—or the requested action is ALREADY done/live—emit `<swarm_dispatch>[]</swarm_dispatch>` so Phase 2 is cleanly skipped with zero duplicate worker runs.\n"
            f"- Give each worker distinct scratch/deliverable filenames so concurrent workers never overwrite each other.\n\n"
        )
    elif swarm_assignment or parallel_peers:
        peers_txt = ", ".join(f"@{p}" for p in (parallel_peers or [])) or "fellow swarm peers"
        scoped_txt = f"- YOUR SCOPED SWARM ASSIGNMENT (STRICT BOUNDARY): {swarm_assignment}\n" if swarm_assignment else ""
        agent_slug = re.sub(r"[^a-z0-9_]+", "_", agent_name.lower()).strip("_") or "worker"
        swarm_mode_block = (
            f"\n[PARALLEL SWARM WORKER MODE — ANTI-DUPLICATION & IDEMPOTENCY GUARD]:\n"
            f"- You are executing IN PARALLEL alongside {peers_txt} inside the same War Room sandbox.\n"
            f"{scoped_txt}"
            f"- STRICT SCOPE RULE: Execute and report ONLY your own scoped assignment/specialty. Do NOT repeat peers' work, do NOT re-summarize what Phase 1 or another agent already reported, and do NOT touch files outside your assigned track.\n"
            f"- SIDE-EFFECT IDEMPOTENCY GUARD: Before performing any external action (publishing a social post, sending WhatsApp/email, deploying, overwriting a shared deliverable), check the recent transcript and workspace state/locks. "
            f"If another agent or Phase 1 ALREADY completed the action or fully answered the exact prompt so nothing unique remains for your role, DO NOT repeat the work or echo the same summary—respond ONLY with `<no_op>Already completed by @Agent</no_op>`.\n"
            f"- SANDBOX COLLISION GUARD: Prefix any temporary scripts you create in `{scratch_dir}` with `{agent_slug}_` (e.g. `{scratch_dir}/{agent_slug}_task.py`) so concurrent peers never overwrite your files.\n\n"
        )

    prompt = (
        f"You are {agent_name} ({agent_role}). You are participating in a live Multi-Agent War Room Conference "
        f"with human operator Min (@user) and fellow fleet agents.\n"
        f"Execution Engine: {agent_engine.upper()}."
        f"{orchestrator_directive}"
        f"{preset_directive}\n\n"
        f"{swarm_mode_block}"
        f"{active_schedules_block}"
        f"{linked_workspaces_block}"
        f"{pillar2_async_banner}"
        f"{transcript_text}\n\n"
        f"Directive for {agent_name}:\n{directive_text}\n\n"
        f"Omnidirectional @Mention & Floor Control Rules:\n"
        f"{turn_context_rule}"
        f"- {whitelist_rule}\n"
        f"- {sandbox_rule}\n"
        f"- NEXUSDESK PLATFORM & TOOLS (BL-EVO-35): You are running on NexusDesk (API: http://127.0.0.1:9200). "
        f"Key modules: War Room Conference (`/console`), Deliverables Explorer (`{deliverables_dir}`), Workflows (`/workflows`), Crons (`/crons`), and Omnichannel Gateways (WhatsApp / Telegram). "
        f"To send an outbound WhatsApp message to {op_name} directly from a script, run: `send_whatsapp -m \"<text>\"`.\n"
        f"- AMBIGUITY CLARIFICATION PROTOCOL (BL-EVO-35): If a user prompt or next task is missing essential parameters, context, or requirements, "
        f"do NOT fabricate dummy executions or pretend to finish work. Explicitly ask @user for clarification, listing the concrete choices or missing variables.\n"
        f"- To invite all authorized agents in this room to weigh in, mention @everyagents or @everyone.\n"
        f"- Mention @user or @{op_name} ONLY if you are directly asking the human operator a question or yielding the floor exclusively to the human for a decision.\n"
        f"{gateways_rule}\n"
        f"- DELIVERABLES PRESENTATION RULE (BL-EVO-40):\n"
        f"  * The NexusDesk UI automatically parses and renders interactive 'Deliverables & File Downloads' cards with 👁️ View and ⬇️ Download buttons below your message.\n"
        f"  * Therefore, DO NOT output repetitive bullet lists of raw download links (e.g. `### Deliverables \\n - [Download ...](path)`). "
        f"Only mention files when providing substantive, contextual explanations (e.g. key schema changes, row-level audit findings, or what data is contained within the file).\n"
        f"- ANTI-HALLUCINATION EXECUTION RULE (EVIDENCE-BEFORE-CLAIM): Do NOT make unbacked promises ('I will check later') or claim something is 'Done/Fixed/Sent/Updated/Scheduled' unless you directly ran the tool/command and verified the file or emitted `<set_schedule>` / `<async_task>` / `<outbound_message>` in this turn. Explicitly separate what was **Verified** from what is **Not Run / Blocked** in plain, direct language.\n"
        f"- AUTOMATIC CONVERSATIONAL REMINDERS & FOLLOW-UPS (BL-EVO-39):\n"
        f"  * If you need the room or operator to follow up after a delay (e.g. in 15 minutes, 1 hour, or at a specific time) or after an agent finishes, you can emit a `<set_reminder>` tag:\n"
        f"    `<set_reminder>{{\"text\": \"Check crawler deliverables and verify row counts\", \"in_minutes\": 15, \"target_agent\": \"Claude\"}}</set_reminder>`\n"
        f"  * Alternatively, stating natural phrases like `remind me in 30 minutes to review the logs` or `check back in 15 minutes` will automatically register a live room reminder.\n"
        f"- WAR ROOM SCHEDULER (RECURRING & COMPLEX TASKS INSIDE THIS ROOM):\n"
        f"  * Instead of writing host Linux OS `crontab` scripts, schedule recurring collaborative War Room jobs directly via `<set_schedule>` (frequencies: `once`, `daily`, `weekdays`, `weekly`, `interval`; modes: `agent_dispatch`, `roundtable`, `static_notice`):\n"
        f"    `<set_schedule>{{\"title\": \"Refresh UMKM CGS Catalog\", \"prompt\": \"@Solaris @Claude refresh UMKM CGS catalog data and update deliverables/\", \"frequency\": \"daily\", \"time_hhmm\": \"08:30\", \"mode\": \"agent_dispatch\", \"targets\": [\"Solaris\", \"Claude\"]}}</set_schedule>`\n"
        f"  * To pause, resume, update, or delete an existing schedule listed in `[ACTIVE WAR ROOM SCHEDULES]`, emit:\n"
        f"    `<manage_schedule>{{\"action\": \"pause\", \"id\": \"wrs_...\"}}</manage_schedule>` (`action`: `pause`|`resume`|`update`|`delete`).\n"
        f"- AUTONOMOUS INTERNET RESEARCH & ERROR RESOLUTION RULE (BL-EVO-24):\n"
        f"  * When encountering an error, unfamiliar error log, API blocker (e.g. HTTP 406/403/429/5xx), or failed task: You SHALL actively look for information from the internet about how to fix the situation.\n"
        f"  * You can execute `python3 {scratch_dir}/search_web.py \"<your query>\"` or use network requests/curl to look up error solutions, API documentation, and working mirrors.\n"
        f"  * Autonomously formulate and test a concrete workaround or revised script.\n"
        f"  * If and only if there is genuinely NO WAY OUT (an insurmountable hard blocker requiring operator credentials, human browser intervention, or paid keys), only then report the blocker to @user, detailing what was attempted, what was researched on the internet, and what exact decision is required.\n"
        f"- FLAGSHIP PROACTIVE INTELLIGENCE & MULTI-STRATEGY ENTITY RESOLUTION MANDATE (BL-EVO-25 — GEMINI / CLAUDE / CHATGPT BENCHMARK):\n"
        f"  * NEVER STOP AT NAIVE EXACT-MATCH FAILURE: When looking up names, branches, IDs, columns, or records across CSV/JSON/database files and exact/substring matching returns 0 hits, you are STRICTLY FORBIDDEN from stopping and telling @user 'No matching name found, please clarify'.\n"
        f"  * AUTOMATIC 4-STAGE RESOLUTION CASCADE: You MUST immediately and autonomously run a multi-strategy search in the same turn:\n"
        f"    1. Encoding & Normalization: Always open CSVs with `encoding='utf-8-sig'` (to strip UTF-8 BOM `\\ufeff`), strip punctuation/prefixes (`#`, `KC`, `KCP`, city prefixes), and normalize case.\n"
        f"    2. Token Overlap & Partial Stem Matching: Split query labels into tokens (city vs. street/district/landmark) and score token overlap across all candidate rows.\n"
        f"    3. Fuzzy String Distance / Similarity: Compute `difflib.SequenceMatcher` ratios or run `python3 {scratch_dir}/fuzzy_match_helper.py <csv_path> \"<query1>\" \"<query2>\"` across ALL text columns.\n"
        f"    4. Secondary Column & Cross-File Correlation: Search address columns (`addr`, `address`), raw tags (`raw_tags`), nearby POI names (`poi_name` within 1km), geographic coordinates (`lat`/`lng`), and companion files in `{deliverables_dir}`.\n"
        f"  * PROACTIVE EXECUTION OVER PASSIVE PERMISSION-SEEKING: Act like a flagship AI assistant (Gemini / Claude / ChatGPT). When you resolve ambiguous entities or fix a script/dataset issue, DO NOT pause to ask @user 'Which mapping do you prefer?' or 'Should I re-run the script now?'. Execute the fix/re-run immediately using the highest-confidence best-fit mapping, save the updated deliverable to `{deliverables_dir}`, and present a clear table of the resolved mappings alongside the completed output so @user only needs to intervene if they wish to override a choice.\n"
        f"- ADAPTIVE SYNCHRONOUS AGENTIC CAPABILITY & ASYNC TASK PROTOCOL (BL-WAR-18, BL-WAR-47, BL-EVO-19, BL-EVO-21, BL-EVO-31):\n"
        f"  * SYNCHRONOUS INTELLIGENT ADAPTIVITY (PILLAR 1): You have an expanded speaking window (up to {int(effective_soft_timeout)}s) to inspect files, execute Python/bash checks, read intermediate errors, and adapt dynamically. Use your full reasoning and multi-step tool capability synchronously to solve data issues, reconcile schemas, and produce verified results!\n"
        f"  * ASYNC TASK CRITERIA: Reserve `<async_task>` ONLY for truly massive, long-running batch operations (e.g. multi-hour web scrapers, downloading 500+ MB datasets, or running 5,000+ API calls) that cannot finish within {int(effective_soft_timeout)}s.\n"
        f"  * VPS RESOURCE DISCIPLINE: For headless browser (Chrome/Playwright) jobs, NEVER launch more than 2 concurrent browser workers on this VPS (prefer 1–2 workers with `nice -n 15` and blocked images/media) so the web server and fellow agents are never starved of RAM/CPU.\n"
        f"  * GRACEFUL INTERCEPTION AT {int(effective_soft_timeout)}s: If your turn exceeds {int(effective_soft_timeout)} seconds, the system will send SIGINT to flush your buffers and terminate synchronous execution before the {int(effective_timeout)}s hard ceiling.\n"
        f"  * When a massive batch job is required, use this 1-Turn Async Pattern:\n"
        f"    1. Write a standalone Python/bash script to `/home/nexus_shared/sandboxes/{room_id}/scratch/<job_name>.py` that prints progress after each item (`print(f'PROGRESS: {{i+1}}/{{total}}...', flush=True)`).\n"
        f"    2. Output the `<async_task>` JSON tag in your response to delegate execution to the background runner:\n"
        f"       <async_task>{{\"description\": \"Short job title\", \"command\": \"python3 -u /home/nexus_shared/sandboxes/{room_id}/scratch/<job_name>.py\", \"timeout\": 1800}}</async_task>\n"
        f"       * UPFRONT PERMISSION CHAINING (BL-EVO-19): If the operator has pre-authorized continuous execution, you may include `\"auto_proceed_on_success\": true, \"next_task_description\": \"...\", \"next_command\": \"...\"` inside `<async_task>`.\n"
        f"       * POST-TASK PERMISSION GATE (BL-EVO-19 & BL-EVO-21): When no upfront auto-chaining was pre-authorized, yield your turn. Upon completion, the system wakes you up for a proactive return turn where you must summarize results and ask @user for permission to proceed.\n"
        f"         MANDATORY NEXT STEP RULE (BL-EVO-21): You MUST NOT ask generic questions like 'Approve next step or review output?' or 'Should I proceed?' without naming the step. You MUST declare: (1) The concrete next task title, (2) The script/command to run, (3) Expected deliverables, and wrap the title in <next_step>[Short Action Title]</next_step> so an actionable 1-click approval button renders for the operator.\n"
        f"    3. Yield your turn immediately! The NexusDesk background runner will execute your script asynchronously with live log streaming, preserve partial/final artifacts in `{deliverables_dir}`, and automatically wake you up for a proactive return turn once complete.\n\n"
        f"Response Structure (CRITICAL):\n"
        f"Provide your answer in TWO distinct sections:\n"
        f"1. Begin with an <executive_summary> tag containing 1-2 concise, conversational sentences (situation, what was done, key finding, and direct action/question). This summary is read aloud via speech synthesizer.\n"
        f"2. Follow with the complete technical breakdown, explanations, code blocks, file paths, or tables outside the tag.\n"
        f"Example format:\n"
        f"<executive_summary>\n"
        f"Solaris resolved the 7 mismatched branch labels via fuzzy address/POI correlation and generated the updated deliverable in deliverables/.\n"
        f"</executive_summary>\n\n"
        f"### Technical Analysis & Implementation Details\n"
        f"[Your full detailed answer here]"
    )

    ws_dir = worktree_dir_override or agent.get("workspace_dir") or str(ctx["workspace"])
    safe_rid = re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "general").strip()) or "general"
    epoch = get_room_session_epoch(safe_rid)
    session_name = f"nexusdesk_warroom_{safe_rid}_{agent_name.lower().strip()}_v{epoch}"

    extra_env = {
        "WARROOM_SANDBOX": str(s_path),
        "WARROOM_SCRATCH": str(scratch_dir),
        "WARROOM_DELIVERABLES": str(deliverables_dir)
    }
    if worktree_dir_override:
        extra_env["WARROOM_AGENT_WORKTREE"] = worktree_dir_override

    reply, err = await run_agent_cli(
        agent_name=agent_name,
        agent_engine=agent_engine,
        agent_model=agent_model,
        prompt=prompt,
        ctx=ctx,
        workspace_dir=ws_dir,
        session_name=session_name,
        extra_env=extra_env,
        room_id=safe_rid,
        timeout_seconds=effective_timeout,
        soft_timeout_seconds=effective_soft_timeout
    )

    # Operator interrupted while this turn was running: discard the (killed/partial) output entirely
    if interrupt_gen is not None and get_interrupt_gen(room_id) != interrupt_gen:
        raise TurnInterrupted()

    if err:
        # If session lease lock or timeout occurred, bump epoch so next turn gets a clean session
        if "SESSION_NOT_OWNED" in err or "timed out" in err.lower() or "soft-intercepted" in err.lower():
            try:
                bump_room_session_epoch(safe_rid)
            except Exception:
                pass

        # BL-WAR-47 Pillar 3 & Pillar 4: Inspect flushed output and scratch/ for written scripts or partial progress
        newly_written_scripts = []
        if scratch_dir.exists():
            for fp in scratch_dir.glob("*"):
                if fp.is_file() and fp.suffix in (".py", ".sh") and not fp.name.startswith("error_") and not fp.name.startswith("task_"):
                    try:
                        mtime = fp.stat().st_mtime
                        if mtime >= turn_start_ts - 2.0 or scratch_files_before.get(str(fp), 0) < mtime:
                            newly_written_scripts.append((mtime, fp))
                    except Exception:
                        pass
        newly_written_scripts.sort(key=lambda x: x[0], reverse=True)

        # Pillar 3: Auto-Synthesize <async_task> if the agent wrote a script to scratch/ before soft/hard timeout!
        if newly_written_scripts and ("soft-intercepted" in err.lower() or "timed out" in err.lower()):
            latest_script = newly_written_scripts[0][1]
            runner_bin = "python3 -u" if latest_script.suffix == ".py" else "bash"
            auto_cmd = f"{runner_bin} {latest_script}"
            auto_desc = f"Auto-recovered background job ({latest_script.name}) from {agent_name}"
            partial_extract = ""
            if "--- PARTIAL OUTPUT BEFORE TIMEOUT ---" in err:
                partial_extract = err.split("--- PARTIAL OUTPUT BEFORE TIMEOUT ---", 1)[1].strip()[:1200]
            synthesized_reply = (
                f"<executive_summary>\n"
                f"{agent_name} composed {latest_script.name} in scratch; the {int(effective_soft_timeout)}s soft interceptor automatically registered it as a background task.\n"
                f"</executive_summary>\n\n"
                f"### 🛡️ Graceful Soft-Timeout Interception & Auto-Delegation\n"
                f"- **Intercepted Script**: `{latest_script}`\n"
                f"- **Action**: Automatically wrapped into `<async_task>` before hard kill.\n\n"
                f"<async_task>{json.dumps({'description': auto_desc, 'command': auto_cmd, 'timeout': 1800})}</async_task>\n"
            )
            if partial_extract:
                synthesized_reply += f"\n#### Flushed Output Buffer Preview\n```\n{partial_extract}\n```"
            return synthesized_reply

        # Pillar 4: Same-Agent Emergency 60s Delegation Retry if partial progress was made (not a total stall or token exhaustion)
        is_exhausted = err.startswith("TOKEN_EXHAUSTED:")
        raw_partial = err.split("--- PARTIAL OUTPUT BEFORE TIMEOUT ---", 1)[1].strip() if "--- PARTIAL OUTPUT BEFORE TIMEOUT ---" in err else ""
        clean_partial_lines = [
            l for l in raw_partial.splitlines()
            if l.strip()
            and not l.strip().startswith("Normalized model")
            and not l.strip().startswith("↻ Resumed session")
            and not l.strip().startswith("Session ")
            and not l.strip().startswith("Hermes Agent")
            and not l.strip().startswith("--- STDERR ---")
        ]
        clean_partial = "\n".join(clean_partial_lines).strip()
        has_partial_progress = len(clean_partial) > 30
        if not is_exhausted and has_partial_progress and ("soft-intercepted" in err.lower() or "timed out" in err.lower()):
            partial_snippet = clean_partial[-1500:]
            retry_prompt = (
                f"You are {agent_name} ({agent_role}).\n"
                f"🚨 [EMERGENCY 60-SECOND DELEGATION RECOVERY (BL-WAR-47 PILLAR 4)]:\n"
                f"Your previous speaking turn reached the runtime limit while executing synchronously, but your partial progress was preserved:\n"
                f"```\n{partial_snippet}\n```\n\n"
                f"You retain ownership of this task:\n{directive_text}\n\n"
                f"MANDATORY INSTRUCTION: Do NOT run the workload synchronously! You have 60 seconds to:\n"
                f"1. Write your worker script to `{scratch_dir}/<job_name>.py`.\n"
                f"2. Emit `<executive_summary>...</executive_summary>` and `<async_task>{{\"description\": \"...\", \"command\": \"python3 -u {scratch_dir}/<job_name>.py\", \"timeout\": 1800}}</async_task>`.\n"
                f"3. Yield immediately!"
            )
            retry_reply, retry_err = await run_agent_cli(
                agent_name=agent_name,
                agent_engine=agent_engine,
                agent_model=agent_model,
                prompt=retry_prompt,
                ctx=ctx,
                workspace_dir=ws_dir,
                session_name=f"{session_name}_recovery",
                extra_env=extra_env,
                timeout_seconds=75.0,
                soft_timeout_seconds=60.0,
                room_id=safe_rid
            )
            if not retry_err and retry_reply.strip():
                return retry_reply
            # Also check if the recovery turn wrote a script right before timing out
            if scratch_dir.exists():
                for fp in scratch_dir.glob("*"):
                    if fp.is_file() and fp.suffix in (".py", ".sh") and not fp.name.startswith("error_") and not fp.name.startswith("task_"):
                        try:
                            if fp.stat().st_mtime >= turn_start_ts:
                                runner_bin = "python3 -u" if fp.suffix == ".py" else "bash"
                                auto_cmd = f"{runner_bin} {fp}"
                                auto_desc = f"Auto-recovered background job ({fp.name}) from {agent_name}"
                                return (
                                    f"<executive_summary>\n"
                                    f"{agent_name} composed {fp.name} during recovery; registered as a background job.\n"
                                    f"</executive_summary>\n\n"
                                    f"<async_task>{json.dumps({'description': auto_desc, 'command': auto_cmd, 'timeout': 1800})}</async_task>"
                                )
                        except Exception:
                            pass

        log_file_rel = ""
        try:
            # BL-WAR-29: Automatically persist error/timeout diagnostics to scratch folder for 1-click inspection
            scratch_dir.mkdir(parents=True, exist_ok=True)
            log_filename = f"error_{agent_name.lower()}_{int(time.time())}.log"
            err_log_path = scratch_dir / log_filename
            with open(err_log_path, "w", encoding="utf-8") as f:
                f.write(f"# War Room Turn Execution Error Log\n")
                f.write(f"# Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"# Room: {room_id}\n")
                f.write(f"# Agent: {agent_name} [{agent_engine.upper()}]\n")
                f.write(f"# Model: {agent_model or 'default'}\n")
                f.write(f"# Workspace: {ws_dir}\n")
                f.write(f"\n--- ERROR DETAILS ---\n{err}\n")
            log_file_rel = str(err_log_path)
        except Exception as log_ex:
            print(f"[WAR_ROOM] Failed to persist error log: {log_ex}")

        try:
            from routers.self_evolving import record_telemetry_event
            record_telemetry_event(
                category="Engine & Timeouts",
                error_signature=f"War Room agent {agent_name} hit timeout / execution error",
                raw_sample=f"Room {room_id}: {err}",
                affected_files=["backend/routers/war_room.py", "backend/services/war_room/execution.py"]
            )
        except Exception:
            pass

        log_link = f"\n\n📄 **Diagnostics Log**: `{log_file_rel}`" if log_file_rel else ""
        if is_exhausted:
            return (
                f"⚠️ **Runner Alert [TOKEN_EXHAUSTED]**: {agent_name} [{agent_engine.upper()}] encountered AI token, credit, or rate-limit exhaustion: "
                f"{err.splitlines()[0].replace('TOKEN_EXHAUSTED:', '').strip()}.{log_link}"
            )
        return (
            f"⚠️ **Runner Alert [TOTAL_STALL]**: {agent_name} [{agent_engine.upper()}] encountered an incapacitated stall/timeout with no recoverable script: "
            f"{err.splitlines()[0]}.{log_link}"
        )

    return reply
