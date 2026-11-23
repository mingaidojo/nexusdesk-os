"""
System Storage & Archival API (BL-SYS-01 / BL-SYS-57).
All routes sit under /api/ and are therefore covered by the NexusDesk auth middleware.
"""

import asyncio
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from core.config import broadcast_event
from services import storage_cleaner as sc

router = APIRouter(tags=["system_storage"])


@router.get("/api/system/storage")
async def get_storage_overview():
    """Disk usage, per-room sandbox sizes, protected areas, retention policy and last-run state."""
    data = await asyncio.to_thread(sc.scan_storage)
    data["archives"] = sc.list_archives()
    return data


@router.get("/api/system/storage/policy")
def get_storage_policy():
    return sc.load_policy()


@router.post("/api/system/storage/policy")
async def update_storage_policy(req: Request):
    body = await req.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    try:
        return {"status": "ok", "policy": sc.save_policy(body)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/system/maintenance/clean-storage")
async def clean_storage(req: Request):
    """Retention-policy cleanup. `dry_run` (default true) only previews what would be removed."""
    try:
        body: Dict[str, Any] = await req.json()
    except Exception:
        body = {}
    dry_run = bool(body.get("dry_run", True))
    result = await asyncio.to_thread(sc.run_cleanup, dry_run)
    if not dry_run:
        await broadcast_event("system_storage_cleaned", {
            "source": "manual",
            "freed_bytes": result["summary"].get("freed_bytes", 0),
            "files": result["summary"].get("removed_files", 0),
        })
    return result


@router.get("/api/system/storage/archives")
def get_archives():
    return {"archives": sc.list_archives()}


@router.post("/api/system/storage/archives")
async def create_room_archive(req: Request):
    body = await req.json()
    room_id = (body.get("room_id") or "").strip()
    include_scratch = bool(body.get("include_scratch", False))
    try:
        info = await asyncio.to_thread(sc.create_archive, room_id, include_scratch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok", "archive": info}


@router.get("/api/system/storage/archives/{name}/download")
def download_archive(name: str):
    try:
        path = sc.resolve_archive(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return FileResponse(path, media_type="application/gzip", filename=name)


@router.delete("/api/system/storage/archives/{name}")
def remove_archive(name: str):
    try:
        sc.delete_archive(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "deleted", "name": name}
