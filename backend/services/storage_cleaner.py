"""
NexusDesk Storage Maintenance Service (BL-SYS-01 + BL-SYS-57)

Provides:
  - Storage scan (per-room sandboxes, uploads, voice models, snapshot backups, archives, disk usage)
  - Age-based retention cleanup with dry-run preview (scratch files, scratch logs, old snapshots)
  - Room archive manager (bundle a War Room sandbox into a compressed .tar.gz)
  - Background watcher: scheduled auto-clean + disk watermark warning

Safety rules (never violated):
  - Only files inside the sandbox `scratch/` folders and the snapshot backups folder are ever auto-deleted.
  - `deliverables/` is NEVER touched by cleanup. `piper_voices/` (TTS models) and `uploads/` are never auto-deleted.
  - A scratch folder containing a `.persist` marker file is skipped entirely.
  - Symlinks are never followed or deleted through; every delete target is re-validated against its allowed root.
"""

import asyncio
import json
import os
import re
import shutil
import tarfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.config import DATA_DIR, broadcast_event
try:
    from services.snapshot_vault import BACKUPS_DIR
except ImportError:
    BACKUPS_DIR = DATA_DIR / "backups"
from services.war_room.tasks import SANDBOX_BASE

POLICY_FILE = DATA_DIR / "storage_policy.json"
STATE_FILE = DATA_DIR / "storage_state.json"
ARCHIVES_DIR = DATA_DIR / "archives"
UPLOADS_DIR = DATA_DIR / "uploads"
VOICES_DIR = DATA_DIR / "piper_voices"

PERSIST_MARKER = ".persist"
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
SAFE_ARCHIVE_RE = re.compile(r"^[A-Za-z0-9_\-\.]+\.tar\.gz$")

DEFAULT_POLICY: Dict[str, Any] = {
    "scratch_retention_days": 30,      # scratch artifacts older than this are pruned
    "log_retention_days": 14,          # *.log files in scratch older than this are pruned
    "snapshot_keep_latest": 5,         # always keep the newest N pre-flight snapshots
    "snapshot_retention_days": 30,     # older snapshots (beyond keep_latest) are pruned
    "disk_warn_percent": 85,           # warn operator when host disk usage crosses this
    "auto_enabled": False,             # scheduled automatic cleanup
    "auto_interval_hours": 24,
}

POLICY_LIMITS = {
    "scratch_retention_days": (1, 3650),
    "log_retention_days": (1, 3650),
    "snapshot_keep_latest": (1, 100),
    "snapshot_retention_days": (1, 3650),
    "disk_warn_percent": (50, 99),
    "auto_interval_hours": (1, 720),
}


# ---------------------------------------------------------------------------
# Policy & state persistence
# ---------------------------------------------------------------------------

def load_policy() -> Dict[str, Any]:
    policy = dict(DEFAULT_POLICY)
    try:
        if POLICY_FILE.exists():
            stored = json.loads(POLICY_FILE.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                for k in DEFAULT_POLICY:
                    if k in stored:
                        policy[k] = stored[k]
    except Exception:
        pass
    return policy


def save_policy(body: Dict[str, Any]) -> Dict[str, Any]:
    policy = load_policy()
    for key, default in DEFAULT_POLICY.items():
        if key not in body:
            continue
        val = body[key]
        if isinstance(default, bool):
            policy[key] = bool(val)
        else:
            lo, hi = POLICY_LIMITS[key]
            try:
                num = int(val)
            except (TypeError, ValueError):
                raise ValueError(f"{key} must be a whole number")
            if not lo <= num <= hi:
                raise ValueError(f"{key} must be between {lo} and {hi}")
            policy[key] = num
    POLICY_FILE.write_text(json.dumps(policy, indent=2), encoding="utf-8")
    return policy


def load_state() -> Dict[str, Any]:
    try:
        if STATE_FILE.exists():
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _save_state(state: Dict[str, Any]) -> None:
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------

def _dir_stats(path: Path) -> Dict[str, int]:
    """Total bytes and file count under path, without following symlinks."""
    total = 0
    count = 0
    if not path.exists():
        return {"bytes": 0, "files": 0}
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            fp = os.path.join(root, name)
            try:
                if os.path.islink(fp):
                    continue
                total += os.lstat(fp).st_size
                count += 1
            except OSError:
                continue
    return {"bytes": total, "files": count}


def _is_inside(root: Path, target: str) -> bool:
    """True if the real path of target is strictly inside the real path of root."""
    real_root = os.path.realpath(str(root))
    real_target = os.path.realpath(target)
    return real_target.startswith(real_root + os.sep)


def disk_usage() -> Dict[str, Any]:
    probe = SANDBOX_BASE if SANDBOX_BASE.exists() else DATA_DIR
    du = shutil.disk_usage(str(probe))
    return {
        "total": du.total,
        "used": du.used,
        "free": du.free,
        "percent": round(du.used / du.total * 100, 1) if du.total else 0.0,
    }


def _list_room_dirs() -> List[Path]:
    if not SANDBOX_BASE.exists():
        return []
    return sorted([p for p in SANDBOX_BASE.iterdir() if p.is_dir() and not p.is_symlink()])


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------

def scan_storage() -> Dict[str, Any]:
    from services.war_room.participants import get_all_rooms
    known_rooms = {r.get("id"): r.get("name") for r in get_all_rooms() if r.get("id")}
    rooms = []
    for room_dir in _list_room_dirs():
        scratch = _dir_stats(room_dir / "scratch")
        deliverables = _dir_stats(room_dir / "deliverables")
        rid = room_dir.name
        rooms.append({
            "room_id": rid,
            "room_name": known_rooms.get(rid) or ("War Room: General" if rid == "general" else rid),
            "scratch_bytes": scratch["bytes"],
            "scratch_files": scratch["files"],
            "deliverables_bytes": deliverables["bytes"],
            "deliverables_files": deliverables["files"],
            "persistent": (room_dir / "scratch" / PERSIST_MARKER).exists(),
        })
    rooms.sort(key=lambda r: r["scratch_bytes"] + r["deliverables_bytes"], reverse=True)

    backups = _dir_stats(BACKUPS_DIR)
    archives = _dir_stats(ARCHIVES_DIR)
    uploads = _dir_stats(UPLOADS_DIR)
    voices = _dir_stats(VOICES_DIR)

    return {
        "disk": disk_usage(),
        "sandbox_base": str(SANDBOX_BASE),
        "rooms": rooms,
        "totals": {
            "scratch_bytes": sum(r["scratch_bytes"] for r in rooms),
            "deliverables_bytes": sum(r["deliverables_bytes"] for r in rooms),
        },
        "other": {
            "snapshots": {**backups, "protected": False},
            "archives": {**archives, "protected": True},
            "uploads": {**uploads, "protected": True},
            "voice_models": {**voices, "protected": True},
        },
        "policy": load_policy(),
        "state": load_state(),
    }


# ---------------------------------------------------------------------------
# Cleanup planning & execution
# ---------------------------------------------------------------------------

def plan_cleanup(policy: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Builds the list of files that WOULD be removed under the retention policy."""
    policy = policy or load_policy()
    now = time.time()
    scratch_cutoff = now - policy["scratch_retention_days"] * 86400
    log_cutoff = now - policy["log_retention_days"] * 86400
    candidates: List[Dict[str, Any]] = []

    # 1. Sandbox scratch artifacts & logs
    for room_dir in _list_room_dirs():
        scratch = room_dir / "scratch"
        if not scratch.is_dir() or scratch.is_symlink():
            continue
        if (scratch / PERSIST_MARKER).exists():
            continue
        for root, _dirs, files in os.walk(scratch, followlinks=False):
            for name in files:
                if name == PERSIST_MARKER:
                    continue
                fp = os.path.join(root, name)
                try:
                    if os.path.islink(fp):
                        continue
                    st = os.lstat(fp)
                except OSError:
                    continue
                is_log = name.endswith(".log") or ".log." in name
                cutoff = log_cutoff if is_log else scratch_cutoff
                if st.st_mtime < cutoff:
                    candidates.append({
                        "path": fp,
                        "size": st.st_size,
                        "age_days": round((now - st.st_mtime) / 86400, 1),
                        "category": "scratch_log" if is_log else "scratch",
                        "room_id": room_dir.name,
                        "root": str(scratch),
                    })

    # 2. Old pre-flight snapshots (always keep newest N)
    if BACKUPS_DIR.is_dir():
        snaps = []
        for p in BACKUPS_DIR.iterdir():
            if p.is_file() and not p.is_symlink() and p.name.endswith(".tar.gz"):
                try:
                    snaps.append((p, p.stat()))
                except OSError:
                    continue
        snaps.sort(key=lambda x: x[1].st_mtime, reverse=True)
        snap_cutoff = now - policy["snapshot_retention_days"] * 86400
        for idx, (p, st) in enumerate(snaps):
            if idx < policy["snapshot_keep_latest"]:
                continue
            if st.st_mtime < snap_cutoff:
                candidates.append({
                    "path": str(p),
                    "size": st.st_size,
                    "age_days": round((now - st.st_mtime) / 86400, 1),
                    "category": "snapshot",
                    "room_id": "",
                    "root": str(BACKUPS_DIR),
                })
    return candidates


def _summarize(candidates: List[Dict[str, Any]], freed: Optional[int] = None) -> Dict[str, Any]:
    by_cat: Dict[str, Dict[str, int]] = {}
    for c in candidates:
        slot = by_cat.setdefault(c["category"], {"files": 0, "bytes": 0})
        slot["files"] += 1
        slot["bytes"] += c["size"]
    return {
        "total_files": len(candidates),
        "total_bytes": sum(c["size"] for c in candidates),
        "by_category": by_cat,
        "freed_bytes": freed,
    }


def run_cleanup(dry_run: bool = True) -> Dict[str, Any]:
    policy = load_policy()
    candidates = plan_cleanup(policy)
    summary = _summarize(candidates)
    errors: List[str] = []
    removed = 0
    freed = 0

    if not dry_run:
        touched_scratch_dirs = set()
        for c in candidates:
            fp = c["path"]
            root = Path(c["root"])
            try:
                if os.path.islink(fp) or not _is_inside(root, fp):
                    continue
                os.remove(fp)
                removed += 1
                freed += c["size"]
                if c["category"].startswith("scratch"):
                    touched_scratch_dirs.add(root)
            except OSError as e:
                errors.append(f"{fp}: {e}")
        # Remove now-empty sub-folders inside scratch (never scratch itself)
        for scratch in touched_scratch_dirs:
            for root, dirs, files in os.walk(scratch, topdown=False, followlinks=False):
                if Path(root) == scratch:
                    continue
                try:
                    if not os.listdir(root) and not os.path.islink(root):
                        os.rmdir(root)
                except OSError:
                    pass
        state = load_state()
        state["last_cleanup_ts"] = time.time()
        state["last_cleanup_freed_bytes"] = freed
        state["last_cleanup_files"] = removed
        _save_state(state)
        summary["freed_bytes"] = freed
        summary["removed_files"] = removed

    return {
        "dry_run": dry_run,
        "policy": policy,
        "summary": summary,
        "errors": errors[:20],
        # Preview list capped so the UI stays responsive; summary above is always complete
        "candidates": [
            {k: c[k] for k in ("path", "size", "age_days", "category", "room_id")}
            for c in sorted(candidates, key=lambda x: x["size"], reverse=True)[:100]
        ],
    }


# ---------------------------------------------------------------------------
# Archive manager
# ---------------------------------------------------------------------------

def list_archives() -> List[Dict[str, Any]]:
    out = []
    if ARCHIVES_DIR.is_dir():
        for p in ARCHIVES_DIR.iterdir():
            if p.is_file() and not p.is_symlink() and SAFE_ARCHIVE_RE.match(p.name):
                st = p.stat()
                out.append({"name": p.name, "size": st.st_size, "created": st.st_mtime})
    out.sort(key=lambda a: a["created"], reverse=True)
    return out


def create_archive(room_id: str, include_scratch: bool = False) -> Dict[str, Any]:
    if not room_id or not SAFE_ID_RE.match(room_id):
        raise ValueError("Invalid room id")
    room_dir = SANDBOX_BASE / room_id
    if not room_dir.is_dir() or room_dir.is_symlink():
        raise FileNotFoundError(f"No sandbox found for room '{room_id}'")

    ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    name = f"{room_id}_{ts}{'_full' if include_scratch else ''}.tar.gz"
    dest = ARCHIVES_DIR / name

    folders = ["deliverables"] + (["scratch"] if include_scratch else [])
    added = 0
    with tarfile.open(dest, "w:gz") as tar:
        for folder in folders:
            src = room_dir / folder
            if not src.is_dir() or src.is_symlink():
                continue
            for root, _dirs, files in os.walk(src, followlinks=False):
                for fname in files:
                    fp = os.path.join(root, fname)
                    if os.path.islink(fp):
                        continue
                    arc = os.path.join(room_id, os.path.relpath(fp, room_dir))
                    try:
                        tar.add(fp, arcname=arc, recursive=False)
                        added += 1
                    except OSError:
                        continue
    st = dest.stat()
    return {"name": name, "size": st.st_size, "files": added, "created": st.st_mtime}


def resolve_archive(name: str) -> Path:
    if not name or not SAFE_ARCHIVE_RE.match(name):
        raise ValueError("Invalid archive name")
    p = ARCHIVES_DIR / name
    if not p.is_file() or p.is_symlink() or not _is_inside(ARCHIVES_DIR, str(p)):
        raise FileNotFoundError("Archive not found")
    return p


def delete_archive(name: str) -> None:
    resolve_archive(name).unlink()


# ---------------------------------------------------------------------------
# Background watcher (scheduled cleanup + disk watermark)
# ---------------------------------------------------------------------------

WATCH_INTERVAL_SEC = 600
WARN_COOLDOWN_SEC = 6 * 3600
WATERMARK_CLEAN_COOLDOWN_SEC = 3600


async def storage_maintenance_watcher():
    """Runs every 10 minutes: disk watermark warning + scheduled auto-clean (if enabled)."""
    while True:
        try:
            await asyncio.sleep(WATCH_INTERVAL_SEC)
            policy = load_policy()
            state = load_state()
            now = time.time()
            usage = await asyncio.to_thread(disk_usage)
            over_watermark = usage["percent"] >= policy["disk_warn_percent"]

            if over_watermark and now - state.get("last_warn_ts", 0) > WARN_COOLDOWN_SEC:
                state["last_warn_ts"] = now
                _save_state(state)
                await broadcast_event("system_storage_warning", {"disk": usage, "threshold": policy["disk_warn_percent"]})
                try:
                    from services.gateways import notify_operator
                    await notify_operator(
                        "disk_warning",
                        "NexusDesk: disk usage warning",
                        f"Host disk is {usage['percent']}% full (threshold {policy['disk_warn_percent']}%). "
                        f"Open System → Storage & Archival to clean up.",
                        trigger="on_disk_warning",
                    )
                except Exception:
                    pass

            if policy["auto_enabled"]:
                last = state.get("last_cleanup_ts", 0)
                due = now - last >= policy["auto_interval_hours"] * 3600
                urgent = over_watermark and now - last >= WATERMARK_CLEAN_COOLDOWN_SEC
                if due or urgent:
                    result = await asyncio.to_thread(run_cleanup, False)
                    await broadcast_event("system_storage_cleaned", {
                        "source": "auto",
                        "freed_bytes": result["summary"].get("freed_bytes", 0),
                        "files": result["summary"].get("removed_files", 0),
                    })
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[STORAGE_WATCHER] error: {e}")
