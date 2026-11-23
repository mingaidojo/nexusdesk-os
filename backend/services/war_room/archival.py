"""
NexusDesk War Room Archive-Before-Delete Service
=================================================
Orchestrates the 4-step safe deletion pipeline for custom War Rooms:
1. Summarize the full conversation & deliverables into `warroom-readme.md`.
2. Prune duplicate files (SHA-256) and temporary scratch/backup clutter.
3. Archive README, transcript, metadata, and deliverables to `/home/nexus_shared/archives/*.zip` and verify integrity.
4. Abort any active processes and delete the sandbox, transcript, and all room-scoped state.
"""

import hashlib
import json
import os
import re
import shutil
import time
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core.config import DATA_DIR, safe_path_exists
from services.war_room.context_engine import (
    build_deterministic_summary,
    clear_room_context_state,
    extract_chronological_user_requests,
    is_noisy_moderator_message,
)
from services.war_room.execution import (
    bump_interrupt_gen,
    get_room_file,
    kill_room_agent_proc,
    read_war_room_history,
)

ARCHIVES_ROOT = Path("/home/nexus_shared/archives")


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", (name or "warroom").strip()).strip("_")
    return cleaned[:48] or "warroom"


def _sha256_file(fp: Path) -> str:
    h = hashlib.sha256()
    with open(fp, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _collect_deliverables(sandbox_path: Path) -> List[Dict[str, Any]]:
    deliv_dir = sandbox_path / "deliverables"
    items: List[Dict[str, Any]] = []
    if not safe_path_exists(deliv_dir):
        return items
    for root, _, files in os.walk(deliv_dir):
        for fname in sorted(files):
            fp = Path(root) / fname
            try:
                st = fp.stat()
                items.append({
                    "rel_path": str(fp.relative_to(sandbox_path)),
                    "name": fname,
                    "size_bytes": st.st_size,
                    "size_kb": round(st.st_size / 1024.0, 1),
                    "mtime": st.st_mtime,
                })
            except Exception:
                pass
    return items


def _build_transcript_markdown(room_name: str, room_id: str, messages: List[Dict[str, Any]]) -> str:
    from core.config import get_user_timezone
    user_tz = get_user_timezone()
    lines = [f"# Transcript Archive: {room_name} (`{room_id}`)", ""]
    for m in messages:
        if is_noisy_moderator_message(m):
            continue
        sender = m.get("sender") or "Unknown"
        eng = f" [{m.get('engine').upper()}]" if m.get("engine") else ""
        ts = m.get("timestamp")
        ts_str = datetime.fromtimestamp(ts, tz=user_tz).strftime("%Y-%m-%d %H:%M:%S") if ts else ""
        txt = (m.get("text") or "").strip()
        lines.append(f"### {sender}{eng}" + (f" — {ts_str}" if ts_str else ""))
        lines.append(txt)
        lines.append("")
    return "\n".join(lines)


def generate_warroom_readme(
    room_id: str,
    room_meta: Dict[str, Any],
    messages: List[Dict[str, Any]],
    deliverables: List[Dict[str, Any]],
) -> str:
    """Generates `warroom-readme.md` summarizing the conversation and deliverables via fast LLM with deterministic fallback."""
    room_name = room_meta.get("name") or room_id
    topic = room_meta.get("topic") or room_name
    participants = ", ".join(room_meta.get("participants") or []) or "N/A"
    archived_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    deliv_lines = [
        f"- `{d['rel_path']}` ({d['size_kb']} KB)"
        for d in deliverables[:80]
    ]
    deliv_block = "\n".join(deliv_lines) if deliv_lines else "_No deliverables present._"

    meaningful = [m for m in messages if not is_noisy_moderator_message(m)]
    user_reqs = extract_chronological_user_requests(meaningful)

    # Attempt fast LLM summary
    llm_summary: Optional[str] = None
    if meaningful:
        try:
            from services.war_room.orchestration import (
                get_llm_provider_creds,
                load_dispatcher_config,
                resolve_agent_model_creds,
            )

            cfg = load_dispatcher_config()
            creds = None
            model = cfg.get("llm_model", "gemini-2.5-flash")
            if cfg.get("llm_source") == "agent":
                agent_creds = resolve_agent_model_creds(
                    cfg.get("llm_agent_name", "Chroma"),
                    model_override=cfg.get("llm_model"),
                )
                if agent_creds:
                    creds = {"api_key": agent_creds["api_key"], "base_url": agent_creds["base_url"]}
                    model = agent_creds["model"]
            if not creds:
                creds = get_llm_provider_creds(cfg.get("llm_provider", "abacus"))

            if creds and creds.get("api_key") and creds.get("base_url"):
                sampled = meaningful if len(meaningful) <= 40 else (meaningful[:15] + meaningful[-25:])
                turns_text = "\n\n".join(
                    f"[{m.get('sender_type', 'agent').upper()}] {m.get('sender', '?')}: {(m.get('text') or '').strip()[:700]}"
                    for m in sampled
                )
                reqs_text = "\n".join(f"{r['index']}. {r['text']}" for r in user_reqs[:25]) or "(None)"
                system_prompt = (
                    "You are writing `warroom-readme.md` for an archived multi-agent War Room.\n"
                    "Produce a crisp, accurate Markdown README (max 650 words) covering:\n"
                    "## 1. Executive Summary & Objectives\n"
                    "## 2. Key Decisions & Outcomes\n"
                    "## 3. Agent Contributions\n"
                    "## 4. Deliverables Overview\n"
                    "## 5. Open Items / Follow-up Notes\n"
                    "Preserve exact filenames, metrics, URLs, and conclusions."
                )
                user_prompt = (
                    f"Room: {room_name} ({room_id})\nTopic: {topic}\nParticipants: {participants}\n\n"
                    f"Operator Requests:\n{reqs_text}\n\n"
                    f"Deliverables:\n{deliv_block}\n\n"
                    f"Conversation Excerpts ({len(meaningful)} total turns):\n{turns_text}"
                )
                url = creds["base_url"].rstrip("/") + "/chat/completions"
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 1200,
                }
                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {creds['api_key']}",
                        "User-Agent": "NexusDesk-Archival/1.0",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=20.0) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    content = resp_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                    if content and len(content) > 60:
                        llm_summary = content
        except Exception as e:
            print(f"[WAR_ROOM_ARCHIVE] LLM summary fallback for {room_id}: {e}")

    if not llm_summary:
        det_summary = build_deterministic_summary(meaningful) if meaningful else "_No conversation messages recorded._"
        reqs_md = "\n".join(f"- {r['text']}" for r in user_reqs[:20]) or "- _None recorded_"
        llm_summary = (
            f"## 1. Operator Requests\n{reqs_md}\n\n"
            f"## 2. Conversation Digest\n{det_summary}"
        )

    header = (
        f"# War Room Archive: {room_name}\n\n"
        f"- **Room ID**: `{room_id}`\n"
        f"- **Topic**: {topic}\n"
        f"- **Participants**: {participants}\n"
        f"- **Total Messages**: {len(meaningful)}\n"
        f"- **Archived At**: {archived_at}\n\n---\n\n"
    )
    deliverables_section = f"\n\n---\n\n## Deliverables Inventory ({len(deliverables)} files)\n{deliv_block}\n"
    return header + llm_summary + deliverables_section


_VERSION_PATTERNS = [
    re.compile(r"(?i)(?:^|[_\-\s.])v(\d+(?:[._]\d+)*)(?=$|[_\-\s.])"),
    re.compile(r"(?i)(?:^|[_\-\s.])(?:rev|r)(\d+)(?=$|[_\-\s.])"),
    re.compile(r"(?:^|[_\-\s])(20\d{6}(?:[_-]?\d{6})?)(?=$|[_\-\s.])"),
]


def _extract_version_key(
    fp: Path,
    deliv_dir: Path,
) -> Optional[Tuple[Tuple[str, str, str], Tuple[int, ...]]]:
    """Extracts (version_family_key, numeric_version_tuple) if filename has an explicit version/revision/date token."""
    stem = fp.stem
    for pat in _VERSION_PATTERNS:
        matches = list(pat.finditer(stem))
        if not matches:
            continue
        m = matches[-1]
        raw_ver = m.group(1)
        ver_parts = tuple(int(x) for x in re.findall(r"\d+", raw_ver))
        if not ver_parts:
            continue
        canonical_stem = (stem[:m.start()] + stem[m.end():]).strip("_- .")
        if not canonical_stem:
            continue
        rel_parent = str(fp.parent.relative_to(deliv_dir))
        family_key = (rel_parent, canonical_stem.lower(), fp.suffix.lower())
        return family_key, ver_parts
    return None


def prune_sandbox_duplicates(
    sandbox_path: Path,
    prune_scratch: bool = True,
    prune_duplicates: bool = True,
    keep_last_versions: Optional[int] = 3,
) -> Dict[str, Any]:
    """Prunes byte-identical duplicate files (SHA-256), backup clutter, old deliverable versions (>3), and optionally `scratch/`."""
    removed_files = 0
    freed_bytes = 0

    if not safe_path_exists(sandbox_path):
        return {"removed_files": 0, "freed_mb": 0.0}

    if prune_scratch:
        scratch_dir = sandbox_path / "scratch"
        if safe_path_exists(scratch_dir):
            for root, _, files in os.walk(scratch_dir):
                for fname in files:
                    try:
                        freed_bytes += (Path(root) / fname).stat().st_size
                        removed_files += 1
                    except Exception:
                        pass
            shutil.rmtree(scratch_dir, ignore_errors=True)

    deliv_dir = sandbox_path / "deliverables"
    if prune_duplicates and safe_path_exists(deliv_dir):
        # 1. Remove obvious backup/cache clutter
        for root, dirs, files in os.walk(deliv_dir, topdown=False):
            if Path(root).name == "__pycache__":
                for fname in files:
                    fp = Path(root) / fname
                    try:
                        freed_bytes += fp.stat().st_size
                        fp.unlink()
                        removed_files += 1
                    except Exception:
                        pass
                try:
                    Path(root).rmdir()
                except Exception:
                    pass
                continue
            for fname in files:
                lower = fname.lower()
                if lower.endswith((".bak", ".tmp")) or "_backup." in lower or ".backup." in lower:
                    fp = Path(root) / fname
                    try:
                        freed_bytes += fp.stat().st_size
                        fp.unlink()
                        removed_files += 1
                    except Exception:
                        pass

        # 2. Deduplicate byte-identical files by SHA-256 (keep newest mtime, then shortest path)
        by_hash: Dict[str, List[Tuple[float, int, Path]]] = {}
        for root, _, files in os.walk(deliv_dir):
            for fname in files:
                fp = Path(root) / fname
                try:
                    st = fp.stat()
                    if st.st_size == 0:
                        continue
                    digest = _sha256_file(fp)
                    by_hash.setdefault(digest, []).append((st.st_mtime, -len(str(fp)), fp))
                except Exception:
                    pass

        for _, group in by_hash.items():
            if len(group) <= 1:
                continue
            group.sort(reverse=True)
            for _, _, dup_fp in group[1:]:
                try:
                    sz = dup_fp.stat().st_size
                    dup_fp.unlink()
                    removed_files += 1
                    freed_bytes += sz
                except Exception:
                    pass

    # 3. Retain only the latest N versions of versioned deliverable families
    if keep_last_versions is not None and keep_last_versions > 0 and safe_path_exists(deliv_dir):
        version_families: Dict[Tuple[str, str, str], List[Tuple[Tuple[int, ...], float, Path]]] = {}
        for root, _, files in os.walk(deliv_dir):
            for fname in files:
                fp = Path(root) / fname
                parsed = _extract_version_key(fp, deliv_dir)
                if not parsed:
                    continue
                family_key, ver_tuple = parsed
                try:
                    mtime = fp.stat().st_mtime
                except Exception:
                    mtime = 0.0
                version_families.setdefault(family_key, []).append((ver_tuple, mtime, fp))

        for _, fam_files in version_families.items():
            if len(fam_files) <= keep_last_versions:
                continue
            fam_files.sort(key=lambda item: (item[0], item[1]), reverse=True)
            for _, _, old_fp in fam_files[keep_last_versions:]:
                try:
                    sz = old_fp.stat().st_size
                    old_fp.unlink()
                    removed_files += 1
                    freed_bytes += sz
                except Exception:
                    pass

    return {
        "removed_files": removed_files,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
    }


def archive_room_to_zip(
    room_id: str,
    room_meta: Dict[str, Any],
    sandbox_path: Path,
    readme_text: str,
    messages: List[Dict[str, Any]],
) -> Path:
    """Packages README, metadata, transcript, and sandbox files into `/home/nexus_shared/archives/*.zip` and verifies integrity."""
    ARCHIVES_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(ARCHIVES_ROOT, 0o777)
    except Exception:
        pass

    room_name = room_meta.get("name") or room_id
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"{_safe_filename(room_name)}_{room_id}_{ts}.zip"
    zip_path = ARCHIVES_ROOT / zip_name

    transcript_jsonl = "\n".join(json.dumps(m, ensure_ascii=False) for m in messages)
    transcript_md = _build_transcript_markdown(room_name, room_id, messages)
    meta_json = json.dumps(room_meta, indent=2, ensure_ascii=False)

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("warroom-readme.md", readme_text.encode("utf-8"))
        zf.writestr("room_metadata.json", meta_json.encode("utf-8"))
        zf.writestr("transcript.jsonl", transcript_jsonl.encode("utf-8"))
        zf.writestr("transcript.md", transcript_md.encode("utf-8"))

        if safe_path_exists(sandbox_path):
            for root, _, files in os.walk(sandbox_path):
                for fname in files:
                    fp = Path(root) / fname
                    try:
                        arcname = str(fp.relative_to(sandbox_path))
                        zf.write(fp, arcname=arcname)
                    except Exception as e:
                        print(f"[WAR_ROOM_ARCHIVE] Skipping {fp}: {e}")

    # Verify zip integrity before allowing deletion
    with zipfile.ZipFile(zip_path, "r") as zf:
        bad_file = zf.testzip()
        if bad_file is not None:
            raise RuntimeError(f"Zip integrity check failed on member: {bad_file}")

    try:
        os.chmod(zip_path, 0o666)
    except Exception:
        pass
    return zip_path


def cleanup_all_room_state(room_id: str) -> None:
    """Aborts active processes and removes sandbox, transcript, reminders, inquiries, bg tasks, and omnichannel pins."""
    from routers.war_room.sandbox import get_room_sandbox_path

    bump_interrupt_gen(room_id)
    kill_room_agent_proc(room_id)
    clear_room_context_state(room_id)

    sandbox_path = get_room_sandbox_path(room_id)
    if safe_path_exists(sandbox_path):
        shutil.rmtree(sandbox_path, ignore_errors=True)

    rf = get_room_file(room_id)
    if rf.exists():
        try:
            rf.unlink()
        except Exception:
            pass

    reminders_file = DATA_DIR / f"war_room_reminders_{room_id}.json"
    if reminders_file.exists():
        try:
            reminders_file.unlink()
        except Exception:
            pass

    for ledger_name in ("war_room_inquiries.json", "war_room_bg_tasks.json"):
        lp = DATA_DIR / ledger_name
        if lp.exists():
            try:
                data = json.loads(lp.read_text(encoding="utf-8"))
                changed = False
                if isinstance(data, list):
                    filtered = [x for x in data if x.get("room_id") != room_id]
                    if len(filtered) != len(data):
                        data = filtered
                        changed = True
                elif isinstance(data, dict):
                    keys = [k for k, v in data.items() if isinstance(v, dict) and v.get("room_id") == room_id]
                    for k in keys:
                        del data[k]
                        changed = True
                if changed:
                    lp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            except Exception:
                pass

    omni_file = DATA_DIR / "omnichannel_sessions.json"
    if omni_file.exists():
        try:
            omni_data = json.loads(omni_file.read_text(encoding="utf-8"))
            if isinstance(omni_data, dict):
                changed = False
                for _, sess in omni_data.items():
                    if isinstance(sess, dict) and sess.get("room_id") == room_id:
                        sess["room_id"] = "general"
                        changed = True
                if changed:
                    omni_file.write_text(json.dumps(omni_data, indent=2), encoding="utf-8")
        except Exception:
            pass


def execute_archive_and_delete(
    room_id: str,
    room_meta: Dict[str, Any],
    prune_scratch: bool = True,
    prune_duplicates: bool = True,
    keep_last_versions: Optional[int] = 3,
) -> Dict[str, Any]:
    """Runs the full 4-step Archive-Before-Delete pipeline atomically."""
    from routers.war_room.sandbox import get_room_sandbox_path

    sandbox_path = get_room_sandbox_path(room_id)
    messages = read_war_room_history(room_id, limit=5000)
    deliverables_before = _collect_deliverables(sandbox_path)

    # Step 1: Summarize conversation & deliverables to warroom-readme.md
    readme_text = generate_warroom_readme(room_id, room_meta, messages, deliverables_before)
    if safe_path_exists(sandbox_path):
        try:
            (sandbox_path / "warroom-readme.md").write_text(readme_text, encoding="utf-8")
        except Exception:
            pass

    # Step 2: Prune duplicates, old versions (>3), & scratch clutter
    prune_stats = prune_sandbox_duplicates(
        sandbox_path,
        prune_scratch=prune_scratch,
        prune_duplicates=prune_duplicates,
        keep_last_versions=keep_last_versions,
    )

    # Step 3: Archive to /home/nexus_shared/archives/*.zip and verify
    zip_path = archive_room_to_zip(room_id, room_meta, sandbox_path, readme_text, messages)
    zip_size_mb = round(zip_path.stat().st_size / (1024 * 1024), 2)

    # Step 4: Delete sandbox and all room-scoped state (only after verified zip!)
    cleanup_all_room_state(room_id)

    return {
        "archive_path": str(zip_path),
        "archive_name": zip_path.name,
        "archive_size_mb": zip_size_mb,
        "pruned_files": prune_stats["removed_files"],
        "freed_mb": prune_stats["freed_mb"],
        "message_count": len(messages),
        "deliverables_count": len(deliverables_before),
    }


def get_delete_preview(room_id: str, room_meta: Dict[str, Any]) -> Dict[str, Any]:
    """Returns sandbox size, deliverables count, and message count for the Delete confirmation modal."""
    from routers.war_room.sandbox import get_sandbox_stats

    stats = get_sandbox_stats(room_id)
    messages = read_war_room_history(room_id, limit=5000)
    return {
        "room_id": room_id,
        "room_name": room_meta.get("name") or room_id,
        "message_count": len(messages),
        "sandbox_stats": stats,
        "archive_dir": str(ARCHIVES_ROOT),
    }
