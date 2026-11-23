"""
NexusDesk War Room Sandbox File Browser, Serving & Storage Routes
=================================================================
Part of NexusDesk War Room Router Package (BL-ARCH-32, BL-EVO-12, BL-UI-50, BL-FS-51).

Handles sandbox disk usage stats, deliverable/scratch file browsing, batch metadata
lookup, authenticated file serving, tar.gz archiving, and scratch pruning.
"""

import mimetypes
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from core.config import broadcast_event
from routers.fs import validate_and_resolve_path
from schemas.models import WarRoomSandboxArchiveRequest, WarRoomSandboxPruneRequest
from services.war_room.tasks import get_room_sandbox_path, get_sandbox_stats

router = APIRouter(tags=["war_room"])


@router.get("/api/war-room/sandbox/stats")
def war_room_sandbox_stats(room_id: str = Query("general")):
    """Retrieves disk space usage statistics and quota tracking for a room's sandbox."""
    return get_sandbox_stats(room_id)


@router.get("/api/war-room/sandbox/files")
def war_room_sandbox_files(
    room_id: str = Query("general"),
    category: Optional[str] = Query(None, description="Optional filter: 'deliverables' or 'scratch'"),
    search: Optional[str] = Query(None, description="Optional filename search query"),
    limit: int = Query(250, description="Max files to return"),
):
    """Lists sandbox deliverables and scratch files with sizes and timestamps."""
    rid = (room_id or "general").strip()
    s_path = get_room_sandbox_path(rid)

    dirs_to_scan = []
    if category == "deliverables":
        dirs_to_scan.append(("deliverables", s_path / "deliverables"))
    elif category == "scratch":
        dirs_to_scan.append(("scratch", s_path / "scratch"))
    else:
        dirs_to_scan.append(("deliverables", s_path / "deliverables"))
        dirs_to_scan.append(("scratch", s_path / "scratch"))

    q = (search or "").strip().lower()
    files_list = []
    total_found = 0

    for cat_name, base_dir in dirs_to_scan:
        if not base_dir.exists():
            continue
        for root, dirs, files in os.walk(base_dir):
            dirs[:] = [
                d for d in dirs
                if not d.startswith(".")
                and not d.startswith("profile_")
                and d not in ("node_modules", "__pycache__", ".git", "Cache", "Code Cache", "GPUPersistentCache", "Safe Browsing", "ShaderCache")
            ]
            dirs.sort()
            files.sort()
            for f in files:
                if f.startswith(".") or (q and q not in f.lower()):
                    continue
                total_found += 1
                if len(files_list) >= limit:
                    continue
                fp = Path(root) / f
                try:
                    st = fp.stat()
                    files_list.append({
                        "name": f,
                        "rel_path": str(fp.relative_to(base_dir)),
                        "category": cat_name,
                        "abs_path": str(fp),
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                        "ext": fp.suffix.lower(),
                    })
                except Exception:
                    pass

    files_list.sort(key=lambda x: x["mtime"], reverse=True)
    return {
        "room_id": rid,
        "sandbox_path": str(s_path),
        "total_files": total_found,
        "returned": len(files_list),
        "files": files_list,
    }


@router.get("/api/war-room/sandbox/file-meta")
def war_room_sandbox_file_meta(
    paths: List[str] = Query(..., description="File paths (absolute or relative to room sandbox)"),
    room_id: Optional[str] = Query(None, description="War Room ID"),
):
    """Batch metadata lookup for deliverable cards (missing files return `exists=False`)."""
    out: Dict[str, Any] = {}
    for raw in paths[:50]:
        try:
            target = validate_and_resolve_path(raw, room_id=room_id)
            st = target.stat()
            out[raw] = {
                "exists": True,
                "abs_path": str(target),
                "folder": str(target.parent),
                "size": st.st_size,
                "mtime": st.st_mtime,
            }
        except Exception:
            out[raw] = {"exists": False}
    return {"files": out}


@router.get("/api/war-room/sandbox-file")
def war_room_sandbox_file(
    path: str = Query(..., description="File path (absolute or relative to room sandbox)"),
    room_id: Optional[str] = Query(None, description="War Room ID"),
    download: bool = Query(False, description="Whether to trigger file download"),
    token: Optional[str] = Query(None),
):
    """Serves agent-generated images, PDFs, HTML artifacts, and downloadable files securely."""
    target = validate_and_resolve_path(path, room_id=room_id)
    mime_type, _ = mimetypes.guess_type(str(target))
    ext = target.suffix.lower()

    if download:
        return FileResponse(target, media_type=mime_type or "application/octet-stream", filename=target.name)
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}:
        return FileResponse(target, media_type=mime_type or "image/png")
    if ext == ".pdf":
        return FileResponse(target, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{target.name}"'})
    if ext in {".html", ".htm"}:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(2 * 1024 * 1024)
        return Response(content=content, media_type="text/html; charset=utf-8")

    return FileResponse(target, media_type=mime_type or "application/octet-stream", filename=target.name)


@router.post("/api/war-room/sandbox/archive")
async def war_room_sandbox_archive(req: WarRoomSandboxArchiveRequest):
    """Archives scratch or deliverables into a compressed tarball inside deliverables."""
    rid = req.room_id or "general"
    s_path = get_room_sandbox_path(rid)
    target_dir = s_path / req.target
    if not target_dir.exists():
        raise HTTPException(status_code=404, detail=f"Target directory {req.target} not found")

    ts = time.strftime("%Y%m%d_%H%M%S")
    archive_name = f"sandbox_{rid}_{req.target}_{ts}.tar.gz"
    archive_file = s_path / "deliverables" / archive_name

    proc = subprocess.run(["tar", "-czf", str(archive_file), "-C", str(target_dir), "."], capture_output=True, text=True)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Archive error: {proc.stderr}")

    try:
        os.chmod(archive_file, 0o666)
    except Exception:
        pass

    return {
        "status": "archived",
        "archive_file": str(archive_file),
        "archive_name": archive_name,
        "size_mb": round(archive_file.stat().st_size / (1024 * 1024), 2),
    }


@router.post("/api/war-room/sandbox/prune-scratch")
async def war_room_sandbox_prune_scratch(req: WarRoomSandboxPruneRequest):
    """Prunes temporary scratch files for a room while preserving all deliverables."""
    rid = (req.room_id or "general").strip()
    s_path = get_room_sandbox_path(rid)
    scratch_dir = s_path / "scratch"
    if not scratch_dir.exists():
        return {"status": "ok", "deleted_files": 0, "freed_mb": 0.0, "room_id": rid}

    deleted_count = 0
    freed_bytes = 0
    for root, dirs, files in os.walk(scratch_dir, topdown=False):
        for f in files:
            fp = Path(root) / f
            try:
                sz = fp.stat().st_size
                fp.unlink()
                deleted_count += 1
                freed_bytes += sz
            except Exception as e:
                print(f"[WAR_ROOM_FS] Warning removing scratch file {fp}: {e}")
        for d in dirs:
            try:
                (Path(root) / d).rmdir()
            except Exception:
                pass

    freed_mb = round(freed_bytes / (1024 * 1024), 2)
    stats_now = get_sandbox_stats(rid)
    await broadcast_event("war_room_sandbox_updated", {"room_id": rid, "stats": stats_now})
    return {"status": "pruned", "room_id": rid, "deleted_files": deleted_count, "freed_mb": freed_mb, "stats": stats_now}
