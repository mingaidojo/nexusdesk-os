"""
NexusDesk War Room Antigravity-Style Multi-Agent Context Engine (BL-EVO-36)
Provides persistent long-horizon memory across multi-agent War Room sessions via 4 pillars:
  1. Chronological User Requests Ledger (Deterministic extraction; mission & constraints never drop)
  2. Threshold-Triggered Multi-Agent <CONTEXT_SUMMARY> Compaction (Instant deterministic + Async LLM distillation)
  3. Deterministic Sandbox Deliverables & Scratch Registry (Auto-attributed by agent with CSV/JSON schema metrics)
  4. Substantive Sliding Transcript Window (12 turns @ 2,800 chars) + Deep Recall JSONL Transcript Mirror
"""

import asyncio
import csv
import json
import os
import pwd
import re
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core.config import DATA_DIR, broadcast_event
from services.war_room.tasks import get_room_sandbox_path, get_room_bg_tasks

# Sliding window & compaction thresholds
RECENT_SUBSTANTIVE_WINDOW = 12       # Keep last 12 substantive (User + Agent) turns in full recent window
PER_MESSAGE_CHAR_LIMIT = 2800        # Max chars per recent turn (2000 head + 800 tail)
TOTAL_RECENT_CHAR_BUDGET = 24000     # Max total chars for the recent transcript window
COMPACTION_DELTA_THRESHOLD = 4       # Re-run deterministic/LLM compaction when >=4 new turns fall out of window
MAX_PINNED_USER_REQUESTS = 15        # Pin initial mission + up to 14 most recent operator requests

# Track in-flight async compaction tasks per room to prevent duplicate concurrent runs
ACTIVE_COMPACTION_TASKS: Dict[str, asyncio.Task] = {}

# Map Linux system user accounts to War Room fleet agent handles
LINUX_USER_TO_AGENT = {
    "thecodexer": "@Codex",
    "freecoder": "@Claude",
    "myvirtualcoder": "@Agy",
    "agents_bs": "@Solaris/@Hermes",
    "desktop": "@OpenCode"
}


def _safe_room_id(room_id: str = "general") -> str:
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "general").strip()) or "general"


def get_room_context_file(room_id: str = "general") -> Path:
    safe_id = _safe_room_id(room_id)
    return DATA_DIR / f"war_room_context_{safe_id}.json"


def load_room_context_state(room_id: str = "general") -> Dict[str, Any]:
    """Loads persisted context summary state for a War Room."""
    cf = get_room_context_file(room_id)
    default_state = {
        "room_id": (room_id or "general").strip(),
        "pinned_notes": "",
        "compacted_summary": "",
        "compaction_mode": "none",
        "compacted_substantive_count": 0,
        "llm_compacted_count": 0,
        "total_messages_seen": 0,
        "updated_at": 0.0
    }
    if not cf.exists():
        return default_state
    try:
        with open(cf, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                default_state.update(data)
    except Exception as e:
        print(f"[WAR_ROOM_CONTEXT] Warning loading context state for {room_id}: {e}")
    return default_state


def save_room_context_state(room_id: str, state: Dict[str, Any]) -> None:
    """Persists context summary state to disk and mirrors CONTEXT_SUMMARY.md to room sandbox."""
    cf = get_room_context_file(room_id)
    state["room_id"] = (room_id or "general").strip()
    state["updated_at"] = time.time()
    try:
        with open(cf, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WAR_ROOM_CONTEXT] Warning saving context state for {room_id}: {e}")

    # Mirror human/agent-readable CONTEXT_SUMMARY.md into sandbox
    try:
        s_path = get_room_sandbox_path(room_id)
        md_file = s_path / "CONTEXT_SUMMARY.md"
        lines = [
            f"# War Room Context Summary (`{room_id}`)",
            f"_Last Updated: {time.strftime('%Y-%m-%d %H:%M:%S')} • Mode: {state.get('compaction_mode', 'deterministic')}_",
            ""
        ]
        if state.get("pinned_notes"):
            lines.extend([
                "## 📌 Operator Pinned Directives & Guardrails",
                state["pinned_notes"].strip(),
                ""
            ])
        if state.get("compacted_summary"):
            lines.extend([
                "## 🧠 Compacted Session Memory",
                state["compacted_summary"].strip(),
                ""
            ])
        md_file.write_text("\n".join(lines), encoding="utf-8")
        os.chmod(md_file, 0o666)
    except Exception:
        pass


def clear_room_context_state(room_id: str = "general") -> None:
    """Clears compacted memory when operator resets War Room brain memory."""
    cf = get_room_context_file(room_id)
    if cf.exists():
        try:
            cf.unlink()
        except Exception:
            pass
    try:
        s_path = get_room_sandbox_path(room_id)
        for fname in ("CONTEXT_SUMMARY.md", "transcript.jsonl"):
            fp = s_path / fname
            if fp.exists():
                fp.unlink()
    except Exception:
        pass


def is_noisy_moderator_message(msg: Dict[str, Any]) -> bool:
    """
    Identifies routine system routing/handoff banners that should NOT consume
    substantive sliding-window slots.
    """
    if msg.get("sender_type") != "system":
        return False
    txt = (msg.get("text") or "").strip()
    noisy_prefixes = (
        "🧭 **Context-Aware Routing**",
        "👑 **Room Orchestrator**",
        "↩️ **Direct Conversation Continuity**",
        "↩️ **Q&A Continuity Routing**",
        "💬 **Healthy Speaker Continuity**",
        "🔄 **Autonomous Handoff**",
        "📢 **Broadcast Directive**",
        "📢 **Agent Broadcast Handoff**",
        "👤 **Operator Input Requested**",
        "👤 **Input Requested",
        "⚡ **Interrupted by",
        "🎯 **Final Concluding Turn**",
        "📥 **Injecting Queued Operator Directive**",
        "📥 **Running Queued Operator Directive**",
        "📥 **Autonomous Queue Drain**",
        "🚪 **Specialist Added**",
        "🚪 **Specialist Removed**",
        "🚪 **Agent Added**",
        "🚪 **Agent Removed**",
        "🏷️ **War Room Renamed**"
    )
    return any(txt.startswith(p) for p in noisy_prefixes)


def extract_chronological_user_requests(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Pillar 1: Deterministically extracts chronological operator requests from full room history.
    Always preserves Request #1 (founding mission) + up to MAX_PINNED_USER_REQUESTS - 1 recent requests.
    """
    user_reqs = []
    seen_texts = set()
    idx = 0
    for m in messages:
        if m.get("sender_type") != "user":
            continue
        raw_txt = (m.get("text") or "").strip()
        if not raw_txt:
            continue
        # Strip queued prefix if present
        clean_txt = re.sub(r'^📥\s*\*\*\[Queued Next Directive\]\*\*\s*:\s*', '', raw_txt).strip()
        if not clean_txt:
            continue
        # Deduplicate consecutive identical echo prompts
        norm_key = clean_txt.lower()[:200]
        if norm_key in seen_texts and len(user_reqs) > 0 and user_reqs[-1]["text"].lower()[:200] == norm_key:
            continue
        seen_texts.add(norm_key)
        idx += 1
        ts = m.get("timestamp", 0)
        ts_str = time.strftime("%H:%M:%S", time.localtime(ts)) if ts else ""
        clipped = clean_txt if len(clean_txt) <= 550 else (clean_txt[:520] + " ...")
        user_reqs.append({
            "index": idx,
            "timestamp": ts_str,
            "text": clipped
        })

    if len(user_reqs) <= MAX_PINNED_USER_REQUESTS:
        return user_reqs

    # Keep the first 2 founding requests + the most recent (MAX_PINNED_USER_REQUESTS - 2) requests
    return user_reqs[:2] + user_reqs[-(MAX_PINNED_USER_REQUESTS - 2):]


def _inspect_file_Quick_schema(fp: Path, size_bytes: int) -> str:
    """Extracts fast row count + column header preview for CSV/TSV/JSON files (< 10 MB)."""
    if size_bytes == 0:
        return "0 bytes (EMPTY)"
    if size_bytes > 10 * 1024 * 1024:
        return ""
    ext = fp.suffix.lower()
    try:
        if ext in (".csv", ".tsv"):
            delim = "\t" if ext == ".tsv" else ","
            with open(fp, "r", encoding="utf-8-sig", errors="replace") as f:
                reader = csv.reader(f, delimiter=delim)
                header = next(reader, None)
                row_count = sum(1 for row in reader if any( row ))
            if header:
                cols_preview = ", ".join(h.strip() for h in header[:8] if h.strip())
                if len(header) > 8:
                    cols_preview += f", +{len(header) - 8} more"
                return f"{row_count:,} rows | cols: [{cols_preview}]"
            return f"{row_count:,} rows"
        elif ext == ".json":
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                data = json.load(f)
            if isinstance(data, list):
                return f"{len(data):,} JSON items"
            elif isinstance(data, dict):
                keys = list(data.keys())[:6]
                return f"JSON keys: [{', '.join(str(k) for k in keys)}]"
    except Exception:
        pass
    return ""


_SKIP_SCAN_DIRS = {
    "__pycache__", "node_modules", ".git",
    "Cache", "Code Cache", "GPUPersistentCache", "Safe Browsing",
    "ShaderCache", "GrShaderCache", "NativeMessagingHosts",
    "extensions_crx_cache", "component_crx_cache", "segmentation_platform",
    "OptimizationGuideModelsManifest", "Default",
}
_SCHEMA_HINT_CACHE: Dict[Tuple[str, float, int], str] = {}
_ARTIFACT_REGISTRY_CACHE: Dict[str, Tuple[float, int, List[Dict[str, Any]]]] = {}
_ARTIFACT_CACHE_TTL_SEC = 15.0
_BULK_FOLDER_THRESHOLD = 40
_MAX_SCAN_DEPTH = 2


def _cached_quick_schema(fp: Path, st_mtime: float, st_size: int) -> str:
    key = (str(fp), st_mtime, st_size)
    cached = _SCHEMA_HINT_CACHE.get(key)
    if cached is not None:
        return cached
    hint = _inspect_file_Quick_schema(fp, st_size)
    if len(_SCHEMA_HINT_CACHE) > 500:
        _SCHEMA_HINT_CACHE.clear()
    _SCHEMA_HINT_CACHE[key] = hint
    return hint


def scan_room_artifacts_registry(room_id: str = "general", messages: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """
    Pillar 3 (Antigravity-Style Shallow Map + Bulk-Folder Collapse + O(1) Referenced Pinning):
    Scans deliverables/ and scratch/ at bounded depth (<=2) with os.scandir, collapses bulk
    subfolders (>40 entries) into concise [FOLDER] pointers, pins recently referenced files
    via O(1) stat, and applies stat-keyed schema inspection ONLY to the final top files.
    """
    now = time.time()
    msg_count = len(messages) if messages else 0
    cache_key = _safe_room_id(room_id)
    cached_entry = _ARTIFACT_REGISTRY_CACHE.get(cache_key)
    if cached_entry and (now - cached_entry[0]) < _ARTIFACT_CACHE_TTL_SEC and cached_entry[1] == msg_count:
        return cached_entry[2]

    s_path = get_room_sandbox_path(room_id)
    deliverables_dir = s_path / "deliverables"
    scratch_dir = s_path / "scratch"

    # Build file -> agent attribution map & collect explicitly referenced deep paths from recent turns
    artifact_owner_map: Dict[str, str] = {}
    pinned_candidates: List[Tuple[str, Path]] = []
    pinned_seen: set = set()

    def _add_pinned(cat: str, p: Path):
        sp = str(p)
        if sp not in pinned_seen:
            pinned_seen.add(sp)
            pinned_candidates.append((cat, p))

    try:
        bg_tasks = get_room_bg_tasks(room_id)
        for t in bg_tasks[-15:]:
            ag = t.get("agent")
            for art in (t.get("artifacts") or []):
                if ag:
                    artifact_owner_map[os.path.basename(art)] = f"@{ag}"
                ap = Path(art)
                if not ap.is_absolute():
                    ap = s_path / art
                cat = "deliverable" if "deliverables" in ap.parts else "scratch"
                _add_pinned(cat, ap)
    except Exception:
        pass

    recent_msgs = messages[-16:] if messages else []
    if messages:
        for m in messages[-40:]:
            if m.get("sender_type") == "agent" and m.get("sender"):
                txt = m.get("text") or ""
                for fname in re.findall(r'[\w\-\.]+\.(?:csv|tsv|json|py|sh|md|pdf|png|jpg|html|xlsx|pptx|zip|tar\.gz|sql)', txt, re.IGNORECASE):
                    artifact_owner_map[fname] = f"@{m['sender']}"

    for m in recent_msgs:
        txt = m.get("text") or ""
        for rel in re.findall(r'((?:deliverables|scratch)/[^\s`"\')>\]]+\.[a-zA-Z0-9]{1,8})', txt):
            rel_clean = rel.rstrip(".,;:")
            cat = "deliverable" if rel_clean.startswith("deliverables/") else "scratch"
            _add_pinned(cat, s_path / rel_clean)

    folder_entries: List[Dict[str, Any]] = []
    file_candidates: List[Tuple[int, int, float, str, Path, Path, os.stat_result]] = []
    seen_file_paths: set = set()

    def _scan_dir(cat_name: str, base_dir: Path, cur_dir: Path, depth: int):
        try:
            with os.scandir(cur_dir) as it:
                entries = list(it)
        except Exception:
            return

        # Bulk-folder collapse: keep every project folder visible without walking thousands of files
        if depth >= 1 and len(entries) > _BULK_FOLDER_THRESHOLD:
            try:
                st = cur_dir.stat()
                rel_d = cur_dir.relative_to(base_dir)
                rel_prefix = "deliverables" if cat_name == "deliverable" else "scratch"
                folder_entries.append({
                    "name": f"{cur_dir.name}/",
                    "category": "folder",
                    "abs_path": str(cur_dir),
                    "rel_path": f"{rel_prefix}/{rel_d}/",
                    "owner": "project",
                    "size_bytes": 0,
                    "size_str": f"{len(entries)}+ items",
                    "mtime": st.st_mtime,
                    "mtime_str": time.strftime("%H:%M:%S", time.localtime(st.st_mtime)),
                    "schema_hint": "Bulk folder — use ls/find on demand",
                })
            except Exception:
                pass
            return

        subdirs: List[Path] = []
        for entry in entries:
            name = entry.name
            if name.startswith("."):
                continue
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
            except Exception:
                continue
            if is_dir:
                if name.startswith("profile_") or name in _SKIP_SCAN_DIRS:
                    continue
                if depth < _MAX_SCAN_DEPTH:
                    subdirs.append(Path(entry.path))
                else:
                    # Emit concise folder pointer at max depth instead of descending further
                    try:
                        st = entry.stat(follow_symlinks=False)
                        rel_d = Path(entry.path).relative_to(base_dir)
                        rel_prefix = "deliverables" if cat_name == "deliverable" else "scratch"
                        folder_entries.append({
                            "name": f"{name}/",
                            "category": "folder",
                            "abs_path": entry.path,
                            "rel_path": f"{rel_prefix}/{rel_d}/",
                            "owner": "project",
                            "size_bytes": 0,
                            "size_str": "subfolder",
                            "mtime": st.st_mtime,
                            "mtime_str": time.strftime("%H:%M:%S", time.localtime(st.st_mtime)),
                            "schema_hint": "Subfolder — inspect on demand",
                        })
                    except Exception:
                        pass
            else:
                if cat_name == "scratch":
                    if name in ("search_web.py", "fuzzy_match_helper.py"):
                        continue
                    if name.startswith("error_") or (name.startswith("task_") and name.endswith(".log")):
                        continue
                try:
                    st = entry.stat(follow_symlinks=False)
                    ap = entry.path
                    if ap not in seen_file_paths:
                        seen_file_paths.add(ap)
                        pri_cat = 0 if cat_name == "deliverable" else 1
                        is_pinned = 0 if ap in pinned_seen else 1
                        file_candidates.append((is_pinned, pri_cat, -st.st_mtime, cat_name, base_dir, Path(ap), st))
                except Exception:
                    pass

        for sd in subdirs:
            _scan_dir(cat_name, base_dir, sd, depth + 1)

    for cat_name, base_dir in (("deliverable", deliverables_dir), ("scratch", scratch_dir)):
        if base_dir.exists():
            _scan_dir(cat_name, base_dir, base_dir, 0)

    # O(1) stat for deep conversation-referenced or bg-task files not reached at depth <= 2
    for cat_name, fp in pinned_candidates:
        sp = str(fp)
        if sp in seen_file_paths:
            continue
        try:
            if fp.is_file():
                st = fp.stat()
                base_dir = deliverables_dir if cat_name == "deliverable" else scratch_dir
                seen_file_paths.add(sp)
                pri_cat = 0 if cat_name == "deliverable" else 1
                file_candidates.append((0, pri_cat, -st.st_mtime, cat_name, base_dir, fp, st))
        except Exception:
            pass

    file_candidates.sort(key=lambda x: (x[0], x[1], x[2]))
    top_files = file_candidates[:20]

    uid_cache: Dict[int, str] = {}
    registry: List[Dict[str, Any]] = []
    for _, _, _, cat_name, base_dir, fp, st in top_files:
        fname = fp.name
        owner_handle = artifact_owner_map.get(fname, "")
        if not owner_handle:
            if st.st_uid in uid_cache:
                owner_handle = uid_cache[st.st_uid]
            else:
                try:
                    pw_name = pwd.getpwuid(st.st_uid).pw_name
                    owner_handle = LINUX_USER_TO_AGENT.get(pw_name, pw_name)
                except Exception:
                    owner_handle = "agent"
                uid_cache[st.st_uid] = owner_handle

        size_kb = round(st.st_size / 1024.0, 1)
        size_str = f"{size_kb} KB" if size_kb < 1024 else f"{round(size_kb / 1024.0, 2)} MB"
        mtime_str = time.strftime("%H:%M:%S", time.localtime(st.st_mtime))
        schema_hint = _cached_quick_schema(fp, st.st_mtime, st.st_size)

        try:
            rel_p = str(fp.relative_to(base_dir))
            rel_path = f"deliverables/{rel_p}" if cat_name == "deliverable" else f"scratch/{rel_p}"
        except Exception:
            rel_path = fname

        registry.append({
            "name": fname,
            "category": cat_name,
            "abs_path": str(fp),
            "rel_path": rel_path,
            "owner": owner_handle,
            "size_bytes": st.st_size,
            "size_str": size_str,
            "mtime": st.st_mtime,
            "mtime_str": mtime_str,
            "schema_hint": schema_hint,
        })

    # Append all collapsed project folder pointers so every project stays visible without blind cutoff
    folder_entries.sort(key=lambda x: -x["mtime"])
    registry.extend(folder_entries[:15])

    _ARTIFACT_REGISTRY_CACHE[cache_key] = (now, msg_count, registry)
    return registry


def _extract_turn_digest(msg: Dict[str, Any]) -> str:
    """Extracts a concise, high-signal digest from a historical agent or user turn."""
    sender = msg.get("sender") or "Unknown"
    eng = f" [{msg.get('engine').upper()}]" if msg.get("engine") else ""
    txt = (msg.get("text") or "").strip()
    if not txt:
        return ""

    # 1. Check for <executive_summary>
    exec_m = re.search(r'<executive_summary>(.*?)</executive_summary>', txt, re.DOTALL | re.IGNORECASE)
    exec_sum = exec_m.group(1).strip() if exec_m else ""
    exec_sum = re.sub(r'\s+', ' ', exec_sum)

    # 2. Extract phase tags or markdown headers
    headers = re.findall(r'^(?:\s*#{1,3}\s+|\s*\[(?:PROPOSAL|IMPLEMENTATION|QA_REVIEW|VERDICT)\]\s*)([^\n\r]{3,90})', txt, re.MULTILINE)
    clean_headers = [re.sub(r'[*_`#]', '', h).strip() for h in headers[:3]]

    # 3. Extract mentioned file paths or deliverables
    files = list(dict.fromkeys(re.findall(r'(?:deliverables|scratch)/[\w\-\./]+\.\w+|[\w\-]+\.(?:csv|json|py|sh|md|pdf|png|html|pptx|xlsx)', txt)))[:4]

    # 4. Extract <next_step> or <async_task>
    async_m = re.search(r'<async_task>\s*\{[^}]*"description"\s*:\s*"([^"]+)"', txt, re.DOTALL | re.IGNORECASE)
    async_desc = async_m.group(1).strip() if async_m else ""

    if exec_sum:
        summary_core = exec_sum[:260]
    else:
        # Take first non-empty paragraph/lines
        lines = [l.strip() for l in txt.splitlines() if l.strip() and not l.strip().startswith("```")]
        summary_core = " ".join(lines[:2])[:240]

    extras = []
    if clean_headers:
        extras.append(f"Sections: {'; '.join(clean_headers)}")
    if files:
        extras.append(f"Files: {', '.join(files)}")
    if async_desc:
        extras.append(f"Async Job: {async_desc}")

    extra_str = f" ({' | '.join(extras)})" if extras else ""
    return f"- **@{sender}{eng}**: {summary_core}{extra_str}"


def build_deterministic_summary(older_messages: List[Dict[str, Any]]) -> str:
    """
    Fast (<1ms) deterministic multi-agent context compactor.
    Groups older turns into Milestones by Speaker, Resolved Decisions, and Errors/Blockers.
    """
    if not older_messages:
        return ""

    agent_milestones: List[str] = []
    errors_and_fixes: List[str] = []

    for m in older_messages:
        stype = m.get("sender_type")
        txt = (m.get("text") or "").strip()
        if not txt:
            continue
        if stype == "agent":
            if m.get("is_error") or "⚠️ **Runner Alert" in txt or "Blockers" in txt:
                sender = m.get("sender", "Agent")
                first_line = txt.splitlines()[0][:180]
                errors_and_fixes.append(f"- **@{sender}**: {first_line}")
            else:
                digest = _extract_turn_digest(m)
                if digest:
                    agent_milestones.append(digest)
        elif stype == "system" and ("Async Handshake" in txt or "Round-Table" in txt or "Scheduled Reminder" in txt):
            clean_sys = re.sub(r'\s+', ' ', txt)[:180]
            agent_milestones.append(f"- *[System]*: {clean_sys}")

    sections = []
    if agent_milestones:
        # Keep up to 18 most informative milestone bullets
        capped_milestones = agent_milestones[:4] + agent_milestones[-14:] if len(agent_milestones) > 18 else agent_milestones
        sections.append("### Multi-Agent Progress & Speaker History (Earlier Turns)\n" + "\n".join(capped_milestones))

    if errors_and_fixes:
        sections.append("### Earlier Blockers & Recovery Notes\n" + "\n".join(errors_and_fixes[-5:]))

    return "\n\n".join(sections)


def _run_llm_compaction_sync(
    room_id: str,
    older_messages: List[Dict[str, Any]],
    existing_summary: str,
    user_requests: List[Dict[str, Any]]
) -> Optional[str]:
    """
    Synchronously calls the configured fast LLM provider (in a worker thread) to produce
    an Antigravity-style structured <CONTEXT_SUMMARY> across multi-agent turns.
    """
    try:
        from services.war_room.orchestration import (
            load_dispatcher_config,
            resolve_agent_model_creds,
            get_llm_provider_creds
        )
        cfg = load_dispatcher_config()
        creds = None
        model = cfg.get("llm_model", "gemini-2.5-flash")

        if cfg.get("llm_source") == "agent":
            agent_creds = resolve_agent_model_creds(
                cfg.get("llm_agent_name", "Chroma"),
                model_override=cfg.get("llm_model")
            )
            if agent_creds:
                creds = {"api_key": agent_creds["api_key"], "base_url": agent_creds["base_url"]}
                model = agent_creds["model"]

        if not creds:
            creds = get_llm_provider_creds(cfg.get("llm_provider", "abacus"))

        if not creds or not creds.get("api_key") or not creds.get("base_url"):
            return None

        # Format the turns to compact
        turn_lines = []
        for m in older_messages[-24:]:
            sender = m.get("sender") or "Unknown"
            stype = m.get("sender_type", "agent")
            eng = f" [{m.get('engine').upper()}]" if m.get("engine") else ""
            txt = (m.get("text") or "").strip()
            if len(txt) > 900:
                txt = txt[:650] + " ... " + txt[-250:]
            turn_lines.append(f"[{stype.upper()}] {sender}{eng}: {txt}")

        reqs_txt = "\n".join([f"{r['index']}. {r['text']}" for r in user_requests])
        transcript_chunk = "\n\n".join(turn_lines)

        system_prompt = (
            "You are the Antigravity Context Compactor for a Multi-Agent War Room.\n"
            "Condense the earlier conversation history into a high-precision, token-efficient markdown summary (max 450 words).\n"
            "Preserve exact filenames, file paths, column names, database schemas, agreed parameters, negative constraints, and speaker attribution (@AgentName).\n"
            "Output strictly using these 4 markdown headers:\n"
            "### 1. Mission Scope & Active Constraints\n"
            "### 2. Multi-Agent Progress (Who Did What)\n"
            "### 3. Settled Technical Decisions & Data Schemas\n"
            "### 4. Resolved Blockers & Pending Next Steps"
        )
        user_prompt = (
            f"Operator Chronological Requests:\n{reqs_txt}\n\n"
            f"Previous Compacted Summary (if any):\n{existing_summary or '(None)'}\n\n"
            f"Earlier War Room Turns to Compact:\n{transcript_chunk}\n\n"
            f"Produce the updated, consolidated 4-section Context Summary:"
        )

        url = creds["base_url"].rstrip("/") + "/chat/completions"
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.1,
            "max_tokens": 750
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {creds['api_key']}",
                "User-Agent": "NexusDesk-ContextEngine/1.0"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=12.0) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            content = resp_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            if content and len(content) > 60:
                return content
    except Exception as e:
        print(f"[WAR_ROOM_CONTEXT] Async LLM compaction fallback for {room_id}: {e}")
    return None


async def maybe_trigger_async_compaction(room_id: str, messages: List[Dict[str, Any]], force: bool = False) -> Optional[Dict[str, Any]]:
    """
    Asynchronously updates the room's <CONTEXT_SUMMARY> using the LLM compactor in a background thread
    when enough older turns have accumulated, never blocking live agent turns.
    """
    safe_rid = _safe_room_id(room_id)
    if not force and safe_rid in ACTIVE_COMPACTION_TASKS and not ACTIVE_COMPACTION_TASKS[safe_rid].done():
        return None

    substantive = [m for m in messages if not is_noisy_moderator_message(m)]
    older = substantive[:-RECENT_SUBSTANTIVE_WINDOW] if len(substantive) > RECENT_SUBSTANTIVE_WINDOW else []
    if not older and not force:
        return None

    state = load_room_context_state(room_id)
    older_count = len(older)
    llm_compacted = state.get("llm_compacted_count", 0)

    if not force and (older_count - llm_compacted) < COMPACTION_DELTA_THRESHOLD:
        return state

    async def _worker():
        try:
            user_reqs = extract_chronological_user_requests(messages)
            target_msgs = older if older else substantive
            llm_summary = await asyncio.to_thread(
                _run_llm_compaction_sync,
                room_id,
                target_msgs,
                state.get("compacted_summary", ""),
                user_reqs
            )
            curr_state = load_room_context_state(room_id)
            if llm_summary:
                curr_state["compacted_summary"] = llm_summary
                curr_state["compaction_mode"] = "llm_antigravity"
                curr_state["llm_compacted_count"] = older_count
            else:
                det_summary = build_deterministic_summary(target_msgs)
                if det_summary:
                    curr_state["compacted_summary"] = det_summary
                    curr_state["compaction_mode"] = "deterministic"
            curr_state["compacted_substantive_count"] = older_count
            curr_state["total_messages_seen"] = len(messages)
            save_room_context_state(room_id, curr_state)
            await broadcast_event("war_room_context_updated", {
                "room_id": room_id,
                "compaction_mode": curr_state["compaction_mode"],
                "compacted_turns": older_count,
                "total_messages": len(messages),
                "updated_at": curr_state["updated_at"]
            })
            return curr_state
        finally:
            ACTIVE_COMPACTION_TASKS.pop(safe_rid, None)

    if force:
        return await _worker()
    else:
        task = asyncio.create_task(_worker())
        ACTIVE_COMPACTION_TASKS[safe_rid] = task
        return state


def sync_transcript_mirror_to_sandbox(room_id: str, room_jsonl_file: Path) -> Path:
    """
    Pillar 4: Ensures `/home/nexus_shared/sandboxes/{room_id}/transcript.jsonl` points to or mirrors
    the full untruncated War Room JSONL history with world-readable permissions (0644) for deep recall.
    """
    s_path = get_room_sandbox_path(room_id)
    mirror_path = s_path / "transcript.jsonl"
    try:
        if room_jsonl_file.exists():
            try:
                os.chmod(room_jsonl_file, 0o644)
            except Exception:
                pass
            if not mirror_path.exists() or mirror_path.is_symlink():
                if not mirror_path.exists():
                    try:
                        os.symlink(room_jsonl_file, mirror_path)
                    except Exception:
                        import shutil
                        shutil.copy2(room_jsonl_file, mirror_path)
                        os.chmod(mirror_path, 0o644)
            else:
                # If it's a regular file and older/smaller than source, refresh copy
                if mirror_path.stat().st_size != room_jsonl_file.stat().st_size:
                    import shutil
                    shutil.copy2(room_jsonl_file, mirror_path)
                    os.chmod(mirror_path, 0o644)
    except Exception:
        pass
    return mirror_path


def build_war_room_context_prompt_block(
    room_id: str,
    full_messages: List[Dict[str, Any]],
    room_jsonl_file: Path
) -> str:
    """
    Constructs the complete Antigravity-Style Context & Transcript prompt block for an agent turn:
      1. <CONTEXT_SUMMARY> (Pinned Operator Notes + Chronological User Requests + Compacted Earlier History)
      2. <DELIVERABLES_AND_ARTIFACTS> (Deterministic Sandbox File Registry with Creator & Schema Info)
      3. <RECENT_TRANSCRIPT> (Last 12 substantive User/Agent turns @ up to 2,800 chars each)
      4. <CONVERSATION_TRANSCRIPT_POINTER> (Deep recall path to full JSONL transcript)
    Also schedules background LLM compaction if the threshold is crossed.
    """
    state = load_room_context_state(room_id)
    user_requests = extract_chronological_user_requests(full_messages)
    artifacts = scan_room_artifacts_registry(room_id, full_messages)
    mirror_path = sync_transcript_mirror_to_sandbox(room_id, room_jsonl_file)

    # Filter out noisy routing banners so substantive turns get full sliding window slots
    substantive = [m for m in full_messages if not is_noisy_moderator_message(m)]
    older_substantive = substantive[:-RECENT_SUBSTANTIVE_WINDOW] if len(substantive) > RECENT_SUBSTANTIVE_WINDOW else []
    recent_substantive = substantive[-RECENT_SUBSTANTIVE_WINDOW:] if substantive else []

    # If older turns exist and haven't been compacted yet (or fell behind by >= COMPACTION_DELTA_THRESHOLD),
    # immediately update the deterministic summary (<1ms) and schedule async LLM compaction in background
    compacted_summary = state.get("compacted_summary", "").strip()
    if older_substantive:
        delta = len(older_substantive) - state.get("compacted_substantive_count", 0)
        if not compacted_summary or delta >= COMPACTION_DELTA_THRESHOLD:
            if state.get("compaction_mode") != "llm_antigravity" or not compacted_summary:
                compacted_summary = build_deterministic_summary(older_substantive)
                state["compacted_summary"] = compacted_summary
                state["compaction_mode"] = "deterministic"
                state["compacted_substantive_count"] = len(older_substantive)
                state["total_messages_seen"] = len(full_messages)
                save_room_context_state(room_id, state)
            # Trigger non-blocking async LLM upgrade if running inside an event loop
            try:
                loop = asyncio.get_running_loop()
                if loop.is_running():
                    asyncio.create_task(maybe_trigger_async_compaction(room_id, full_messages))
            except RuntimeError:
                pass

    # -------------------------------------------------------------------------
    # Block 1: <CONTEXT_SUMMARY>
    # -------------------------------------------------------------------------
    summary_parts = ["<CONTEXT_SUMMARY>"]
    if state.get("pinned_notes", "").strip():
        summary_parts.append(
            "# 📌 Operator Pinned Room Directives & Constraints (LOCKED)\n"
            f"{state['pinned_notes'].strip()}\n"
        )

    if user_requests:
        req_lines = ["# Chronological Operator Requests (Mission Ledger)"]
        for r in user_requests:
            ts_lbl = f" [{r['timestamp']}]" if r.get("timestamp") else ""
            req_lines.append(f"{r['index']}.{ts_lbl} {r['text']}")
        summary_parts.append("\n".join(req_lines) + "\n")

    if compacted_summary:
        summary_parts.append(
            f"# Compacted Earlier Session Summary ({len(older_substantive)} earlier turns)\n"
            f"{compacted_summary}\n"
        )

    summary_parts.append("</CONTEXT_SUMMARY>")
    context_summary_block = "\n".join(summary_parts)

    # -------------------------------------------------------------------------
    # Block 2: <DELIVERABLES_AND_ARTIFACTS>
    # -------------------------------------------------------------------------
    if artifacts:
        art_lines = [
            "<DELIVERABLES_AND_ARTIFACTS>",
            "Live Sandbox File Inventory (Auto-Scanned by NexusDesk — Do NOT guess filenames; use exact paths below):"
        ]
        for a in artifacts:
            tag = "FOLDER" if a["category"] == "folder" else ("DELIVERABLE" if a["category"] == "deliverable" else "SCRATCH")
            schema_part = f" • {a['schema_hint']}" if a.get("schema_hint") else ""
            art_lines.append(
                f"- [{tag}] `{a['abs_path']}` (by {a['owner']}, {a['size_str']}, updated {a['mtime_str']}{schema_part})"
            )
        art_lines.append("</DELIVERABLES_AND_ARTIFACTS>")
        artifacts_block = "\n".join(art_lines)
    else:
        artifacts_block = (
            "<DELIVERABLES_AND_ARTIFACTS>\n"
            "(No files created in sandbox deliverables/ or scratch/ yet.)\n"
            "</DELIVERABLES_AND_ARTIFACTS>"
        )

    # -------------------------------------------------------------------------
    # Block 3: <RECENT_TRANSCRIPT> (Substantive Sliding Window)
    # -------------------------------------------------------------------------
    transcript_blocks = []
    for m in recent_substantive:
        sender_lbl = m.get("sender", "Unknown")
        eng_lbl = f" [{m.get('engine').upper()}]" if m.get("engine") else ""
        msg_content = (m.get("text") or "").strip()
        if len(msg_content) > PER_MESSAGE_CHAR_LIMIT:
            head_len = int(PER_MESSAGE_CHAR_LIMIT * 0.72)
            tail_len = PER_MESSAGE_CHAR_LIMIT - head_len
            msg_content = (
                msg_content[:head_len]
                + f"\n... [truncated middle ({len(msg_content) - PER_MESSAGE_CHAR_LIMIT} chars); full text in {mirror_path}] ...\n"
                + msg_content[-tail_len:]
            )
        transcript_blocks.append(f"{sender_lbl}{eng_lbl}: {msg_content}")

    transcript_text = "\n\n".join(transcript_blocks) if transcript_blocks else "(Room just convened. No prior messages.)"
    if len(transcript_text) > TOTAL_RECENT_CHAR_BUDGET:
        transcript_text = transcript_text[-TOTAL_RECENT_CHAR_BUDGET:]

    # -------------------------------------------------------------------------
    # Block 4: <CONVERSATION_TRANSCRIPT_POINTER> (Deep Recall)
    # -------------------------------------------------------------------------
    deep_recall_block = (
        "<CONVERSATION_TRANSCRIPT_POINTER>\n"
        f"- Full untruncated room transcript ({len(full_messages)} total messages): `{mirror_path}`\n"
        f"- Compacted room summary markdown: `{get_room_sandbox_path(room_id) / 'CONTEXT_SUMMARY.md'}`\n"
        "- DEEP RECALL RULE: If an earlier instruction, code block, schema, or table was compacted or truncated above, "
        f"inspect or grep `{mirror_path}` directly instead of asking @user to repeat prior information.\n"
        "</CONVERSATION_TRANSCRIPT_POINTER>"
    )

    return (
        f"{context_summary_block}\n\n"
        f"{artifacts_block}\n\n"
        f"{deep_recall_block}\n\n"
        f"--- WAR ROOM RECENT CONVERSATION TRANSCRIPT (Last {len(recent_substantive)} Substantive Turns) ---\n"
        f"{transcript_text}\n"
        f"--------------------------------------------------------------------------------"
    )


def get_room_context_inspector_payload(room_id: str, full_messages: List[Dict[str, Any]], room_jsonl_file: Path) -> Dict[str, Any]:
    """
    Returns full diagnostic & editable context payload for the War Room UI Memory Inspector Modal.
    """
    state = load_room_context_state(room_id)
    user_requests = extract_chronological_user_requests(full_messages)
    artifacts = scan_room_artifacts_registry(room_id, full_messages)
    substantive = [m for m in full_messages if not is_noisy_moderator_message(m)]
    older_substantive = substantive[:-RECENT_SUBSTANTIVE_WINDOW] if len(substantive) > RECENT_SUBSTANTIVE_WINDOW else []

    if older_substantive and not state.get("compacted_summary"):
        state["compacted_summary"] = build_deterministic_summary(older_substantive)
        state["compaction_mode"] = "deterministic"
        state["compacted_substantive_count"] = len(older_substantive)
        save_room_context_state(room_id, state)

    mirror_path = sync_transcript_mirror_to_sandbox(room_id, room_jsonl_file)

    return {
        "room_id": (room_id or "general").strip(),
        "pinned_notes": state.get("pinned_notes", ""),
        "compacted_summary": state.get("compacted_summary", ""),
        "compaction_mode": state.get("compaction_mode", "none"),
        "total_messages": len(full_messages),
        "substantive_messages": len(substantive),
        "older_compacted_count": len(older_substantive),
        "recent_window_count": min(len(substantive), RECENT_SUBSTANTIVE_WINDOW),
        "recent_window_limit": RECENT_SUBSTANTIVE_WINDOW,
        "updated_at": state.get("updated_at", 0),
        "user_requests": user_requests,
        "artifacts": artifacts,
        "transcript_path": str(mirror_path)
    }
