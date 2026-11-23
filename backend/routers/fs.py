import io
import os
import re
import tarfile
import zipfile
import posixpath
import datetime
import mimetypes
import urllib.parse
from pathlib import Path
from typing import Optional, Tuple
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from core.config import resolve_instance_key, get_instance_user_context

router = APIRouter(tags=["filesystem_artifacts"])

# BL-FILE-12: Strict whitelist restriction: downloads and previews must come from /home/nexus_shared only
ALLOWED_ROOTS = [
    Path("/home/nexus_shared"),
]

OFFICE_EXTS = {".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".odt", ".ods", ".odp"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}
ARCHIVE_SINGLE_EXTS = {".zip", ".tar", ".tgz", ".tbz2", ".txz"}
ARCHIVE_DOUBLE_EXTS = (".tar.gz", ".tar.bz2", ".tar.xz")
MAX_ARCHIVE_ENTRY_BYTES = 25 * 1024 * 1024  # 25 MB decompressed zip-bomb safety ceiling
TEXT_EXTS = {
    ".txt", ".log", ".py", ".sh", ".json", ".jsonl", ".yaml", ".yml", ".md", ".csv", ".tsv",
    ".env", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".sql", ".xml", ".toml", ".ini",
    ".cfg", ".conf", ".c", ".h", ".cpp", ".hpp", ".go", ".rs", ".java", ".rb", ".php", ".html", ".htm"
}

BLOCKED_COMPONENTS = {".ssh", ".gnupg", ".pki", "shadow", "passwd", "id_rsa", "id_ed25519"}

def validate_and_resolve_path(raw_path: str, room_id: Optional[str] = None) -> Path:
    if not raw_path or not raw_path.strip():
        raise HTTPException(status_code=400, detail="Path parameter is required")
    
    clean_path = raw_path.strip()
    if clean_path.startswith("file://"):
        clean_path = clean_path[7:]

    # BL-EVO-12: Automatically resolve relative deliverable/scratch paths to room sandbox
    if not clean_path.startswith("/"):
        safe_rid = re.sub(r'[^a-zA-Z0-9_\-]', '_', (room_id or "").strip()) if room_id else ""
        if safe_rid:
            candidate = (Path("/home/nexus_shared/sandboxes") / safe_rid / clean_path).resolve()
            if candidate.exists():
                clean_path = str(candidate)
            else:
                clean_path = str(Path("/home/nexus_shared/sandboxes") / safe_rid / clean_path)
        else:
            # Fallback to general room or searching sandboxes
            candidate = (Path("/home/nexus_shared/sandboxes/general") / clean_path).resolve()
            if candidate.exists():
                clean_path = str(candidate)
            else:
                clean_path = str(Path("/home/nexus_shared") / clean_path)

    p = Path(clean_path).expanduser().resolve()

    # Block access to path components that match sensitive keywords
    for part in p.parts:
        if part in BLOCKED_COMPONENTS or part.startswith(".ssh"):
            raise HTTPException(status_code=403, detail="Access denied: sensitive directory or file blocked")

    # Verify target starts with an allowed root
    is_allowed = any(
        str(p).startswith(str(root.resolve()))
        for root in ALLOWED_ROOTS
    )
    if not is_allowed:
        raise HTTPException(status_code=403, detail="Access denied: path is outside permitted workspaces and sandboxes")

    if not p.exists() or not p.is_file():
        # Subfolder fallback: if the file lives inside a nested folder under the room's deliverables/ or scratch/
        sb_match = re.match(r"^(/home/nexus_shared/sandboxes/[^/]+)/(deliverables|scratch)/", str(p))
        if sb_match and p.name:
            sb_root = Path(sb_match.group(1))
            primary_sub = sb_match.group(2)
            search_dirs = [sb_root / primary_sub, sb_root / ("scratch" if primary_sub == "deliverables" else "deliverables")]
            matches = []
            for sdir in search_dirs:
                if not sdir.exists():
                    continue
                for root_d, dirs, files in os.walk(sdir):
                    rel_depth = len(Path(root_d).relative_to(sdir).parts)
                    if rel_depth >= 4:
                        dirs[:] = []
                    if p.name in files:
                        cand = (Path(root_d) / p.name).resolve()
                        try:
                            matches.append((cand.stat().st_mtime, cand))
                        except Exception:
                            pass
                if matches:
                    break
            if matches:
                matches.sort(reverse=True)
                return matches[0][1]
        raise HTTPException(status_code=404, detail=f"File not found or is not a regular file: {p.name}")

    return p

@router.get("/api/fs/download")
def download_server_file(
    path: str = Query(..., description="Absolute server file path"),
    room_id: Optional[str] = Query(None, description="Optional War Room ID for relative path resolution"),
    token: Optional[str] = Query(None)
):
    """Secure Authenticated File Download Endpoint (BL-FILE-12, BL-EVO-12)"""
    target = validate_and_resolve_path(path, room_id=room_id)
    mime_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(
        target,
        media_type=mime_type or "application/octet-stream",
        filename=target.name
    )

@router.get("/api/fs/stat")
def stat_server_file(
    path: str = Query(..., description="Server file path"),
    room_id: Optional[str] = Query(None, description="Optional War Room ID"),
    token: Optional[str] = Query(None)
):
    """File metadata inspection endpoint (BL-EVO-12)"""
    target = validate_and_resolve_path(path, room_id=room_id)
    stat = target.stat()
    ext = target.suffix.lower()
    mime_type, _ = mimetypes.guess_type(str(target))
    return {
        "status": "ok",
        "name": target.name,
        "path": str(target),
        "size": stat.st_size,
        "ext": ext,
        "mime_type": mime_type or "application/octet-stream",
        "is_image": ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}
    }

def _format_xlsx_cell(val) -> str:
    if val is None:
        return ""
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, datetime.datetime):
        if val.hour == 0 and val.minute == 0 and val.second == 0:
            return val.strftime("%Y-%m-%d")
        return val.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(val, (datetime.date, datetime.time)):
        return val.isoformat()
    return str(val)


def _parse_xlsx_preview(source, max_rows: int = 500, max_cols: int = 100) -> Optional[dict]:
    """Read workbook sheets from a file Path or BytesIO stream using openpyxl read_only."""
    try:
        import openpyxl
    except ImportError:
        return None

    wb = None
    try:
        wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
        sheets = []
        any_truncated = False
        for name in wb.sheetnames:
            ws = wb[name]
            rows = []
            truncated = False
            for idx, raw_row in enumerate(ws.iter_rows(values_only=True)):
                if idx >= max_rows:
                    truncated = True
                    any_truncated = True
                    break
                row_vals = [_format_xlsx_cell(v) for v in raw_row[:max_cols]]
                # Trim trailing empty cells per row
                while row_vals and row_vals[-1] == "":
                    row_vals.pop()
                rows.append(row_vals)
            # Trim trailing completely empty rows
            while rows and not rows[-1]:
                rows.pop()
            max_row_count = ws.max_row if isinstance(ws.max_row, int) and ws.max_row > 0 else len(rows)
            max_col_count = ws.max_column if isinstance(ws.max_column, int) and ws.max_column > 0 else max((len(r) for r in rows), default=0)
            sheets.append({
                "name": name,
                "rows": rows,
                "total_rows": max_row_count,
                "total_cols": max_col_count,
                "truncated": truncated,
            })
        return {"sheets": sheets, "truncated": any_truncated}
    except Exception:
        return None
    finally:
        if wb is not None:
            try:
                wb.close()
            except Exception:
                pass


def _is_archive_path(target: Path) -> bool:
    name_l = target.name.lower()
    return target.suffix.lower() in ARCHIVE_SINGLE_EXTS or any(name_l.endswith(sfx) for sfx in ARCHIVE_DOUBLE_EXTS)


def _normalize_archive_entry(raw_name: str) -> str:
    cleaned = (raw_name or "").replace("\\", "/").strip()
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    cleaned = cleaned.lstrip("/")
    if not cleaned:
        return ""
    norm = posixpath.normpath(cleaned)
    if norm in ("", ".") or norm.startswith("..") or "/../" in f"/{norm}/":
        return ""
    return norm


def _classify_archive_ext(entry_name: str) -> Tuple[str, str]:
    ext = posixpath.splitext(entry_name)[1].lower()
    if ext in IMAGE_EXTS:
        return ext, "image"
    if ext in {".html", ".htm"}:
        return ext, "html"
    if ext == ".pdf":
        return ext, "pdf"
    if ext in {".xlsx", ".xlsm"}:
        return ext, "xlsx"
    if ext in {".csv", ".tsv"}:
        return ext, "table"
    if ext == ".md":
        return ext, "md"
    if ext in TEXT_EXTS:
        return ext, "code"
    if ext in OFFICE_EXTS:
        return ext, "office"
    return ext, "file"


def _detect_binary_bytes(head: bytes) -> bool:
    if not head:
        return False
    nontext = sum(1 for b in head if b < 9 or (13 < b < 32) or b == 127)
    if b"\x00" in head or (nontext / len(head)) > 0.15:
        return True
    try:
        head.decode("utf-8")
        return False
    except UnicodeDecodeError as exc:
        return exc.start < len(head) - 4


def _inspect_archive_preview(target: Path, max_entries: int = 1000) -> Optional[dict]:
    """Lists entries inside a .zip or .tar* archive in-memory without extracting to disk."""
    name_l = target.name.lower()
    entries = []
    total_files = 0
    total_dirs = 0
    total_uncompressed = 0
    truncated = False

    try:
        if target.suffix.lower() == ".zip":
            with zipfile.ZipFile(target, "r") as zf:
                for info in zf.infolist():
                    is_dir = info.is_dir() or info.filename.endswith("/")
                    norm = _normalize_archive_entry(info.filename.rstrip("/"))
                    if not norm:
                        continue
                    if is_dir:
                        total_dirs += 1
                        continue
                    total_files += 1
                    total_uncompressed += int(info.file_size or 0)
                    if len(entries) < max_entries:
                        ext, kind = _classify_archive_ext(norm)
                        dt_str = ""
                        try:
                            if info.date_time and info.date_time[0] >= 1980:
                                dt_str = f"{info.date_time[0]:04d}-{info.date_time[1]:02d}-{info.date_time[2]:02d} {info.date_time[3]:02d}:{info.date_time[4]:02d}"
                        except Exception:
                            pass
                        entries.append({
                            "path": norm,
                            "name": posixpath.basename(norm),
                            "dir": posixpath.dirname(norm),
                            "size": int(info.file_size or 0),
                            "compressed_size": int(info.compress_size or 0),
                            "ext": ext,
                            "kind": kind,
                            "modified": dt_str,
                        })
                    else:
                        truncated = True
        elif any(name_l.endswith(s) for s in (".tar", ".tgz", ".tbz2", ".txz", ".tar.gz", ".tar.bz2", ".tar.xz")):
            with tarfile.open(target, "r:*") as tf:
                for member in tf:
                    if member.isdir():
                        total_dirs += 1
                        continue
                    if not member.isfile():
                        continue
                    norm = _normalize_archive_entry(member.name)
                    if not norm:
                        continue
                    total_files += 1
                    total_uncompressed += int(member.size or 0)
                    if len(entries) < max_entries:
                        ext, kind = _classify_archive_ext(norm)
                        dt_str = ""
                        try:
                            if member.mtime:
                                dt_str = datetime.datetime.fromtimestamp(member.mtime).strftime("%Y-%m-%d %H:%M")
                        except Exception:
                            pass
                        entries.append({
                            "path": norm,
                            "name": posixpath.basename(norm),
                            "dir": posixpath.dirname(norm),
                            "size": int(member.size or 0),
                            "compressed_size": int(member.size or 0),
                            "ext": ext,
                            "kind": kind,
                            "modified": dt_str,
                        })
                    else:
                        truncated = True
        else:
            return None
    except Exception:
        return None

    # Sort entries cleanly: shallowest README / preview / docs first or folder-grouped alphabetical
    def _sort_key(e):
        parts = e["path"].split("/")
        return (len(parts), e["dir"].lower(), e["name"].lower())

    entries.sort(key=_sort_key)

    # Smart hero / default entry and up to 4 quick picks
    default_entry = None
    quick_picks = []
    pick_seen = set()

    def _add_pick(candidate):
        if candidate and candidate["path"] not in pick_seen and len(quick_picks) < 4:
            pick_seen.add(candidate["path"])
            quick_picks.append({"path": candidate["path"], "name": candidate["name"], "kind": candidate["kind"]})

    readme_cand = next((e for e in entries if e["name"].lower() in ("readme.md", "readme.txt", "readme")), None)
    html_cand = next((e for e in entries if e["name"].lower() in ("index.html", "index.htm")) or (e["kind"] == "html" for _ in [0]), None)
    if not html_cand:
        html_cand = next((e for e in entries if e["kind"] == "html"), None)
    img_cand = next((e for e in entries if e["kind"] == "image" and "preview" in e["name"].lower()), None) or next((e for e in entries if e["kind"] == "image"), None)
    data_cand = next((e for e in entries if e["kind"] in ("xlsx", "table", "pdf")), None)

    for c in (readme_cand, img_cand, html_cand, data_cand):
        _add_pick(c)

    first_previewable = next((e for e in entries if e["kind"] != "file"), None) or (entries[0] if entries else None)
    default_entry = (readme_cand or img_cand or html_cand or data_cand or first_previewable or {}).get("path")

    return {
        "entries": entries,
        "total_files": total_files,
        "total_dirs": total_dirs,
        "total_uncompressed": total_uncompressed,
        "truncated": truncated,
        "default_entry": default_entry,
        "quick_picks": quick_picks,
    }


def _read_archive_entry_bytes(target: Path, entry_path: str, max_bytes: int = MAX_ARCHIVE_ENTRY_BYTES) -> Tuple[bytes, int, str]:
    """Reads a single entry from a .zip or .tar* archive in memory with decompressed size cap."""
    want = _normalize_archive_entry(entry_path)
    if not want:
        raise HTTPException(status_code=400, detail="Invalid archive entry path")

    name_l = target.name.lower()
    if target.suffix.lower() == ".zip":
        try:
            with zipfile.ZipFile(target, "r") as zf:
                matched_info = None
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    if _normalize_archive_entry(info.filename) == want:
                        matched_info = info
                        break
                if matched_info is None:
                    raise HTTPException(status_code=404, detail=f"Entry not found in archive: {want}")
                total_size = int(matched_info.file_size or 0)
                if total_size > max_bytes:
                    raise HTTPException(status_code=413, detail=f"Archive entry exceeds {max_bytes // (1024 * 1024)} MB inline safety limit")
                buf = bytearray()
                with zf.open(matched_info, "r") as ef:
                    while True:
                        chunk = ef.read(65536)
                        if not chunk:
                            break
                        buf.extend(chunk)
                        if len(buf) > max_bytes:
                            raise HTTPException(status_code=413, detail="Archive entry exceeds decompressed size limit")
                return bytes(buf), max(total_size, len(buf)), posixpath.basename(want)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to read zip entry: {exc}")
    elif any(name_l.endswith(s) for s in (".tar", ".tgz", ".tbz2", ".txz", ".tar.gz", ".tar.bz2", ".tar.xz")):
        try:
            with tarfile.open(target, "r:*") as tf:
                matched_member = None
                for member in tf:
                    if not member.isfile():
                        continue
                    if _normalize_archive_entry(member.name) == want:
                        matched_member = member
                        break
                if matched_member is None:
                    raise HTTPException(status_code=404, detail=f"Entry not found in archive: {want}")
                total_size = int(matched_member.size or 0)
                if total_size > max_bytes:
                    raise HTTPException(status_code=413, detail=f"Archive entry exceeds {max_bytes // (1024 * 1024)} MB inline safety limit")
                ef = tf.extractfile(matched_member)
                if ef is None:
                    raise HTTPException(status_code=404, detail=f"Unable to read tar entry: {want}")
                data = ef.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise HTTPException(status_code=413, detail="Archive entry exceeds decompressed size limit")
                return data, max(total_size, len(data)), posixpath.basename(want)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to read tar entry: {exc}")
    raise HTTPException(status_code=400, detail="Unsupported archive format")


def _rewrite_archive_html_assets(html_text: str, archive_path: str, current_entry: str, token: Optional[str]) -> str:
    """Rewrites relative href/src URLs inside packaged HTML so CSS/JS/images load from the archive endpoint."""
    base_dir = posixpath.dirname(current_entry)
    enc_archive = urllib.parse.quote(archive_path, safe="")
    token_q = f"&token={urllib.parse.quote(token, safe='')}" if token else ""

    def _repl(match):
        attr, quote, raw_ref = match.group(1), match.group(2), match.group(3).strip()
        lower = raw_ref.lower()
        if not raw_ref or lower.startswith(("http://", "https://", "//", "data:", "blob:", "mailto:", "tel:", "#", "javascript:", "/api/")):
            return match.group(0)
        ref_clean = raw_ref.split("#", 1)[0].split("?", 1)[0]
        resolved = posixpath.normpath(posixpath.join(base_dir, ref_clean)) if not ref_clean.startswith("/") else ref_clean.lstrip("/")
        if resolved.startswith(".."):
            return match.group(0)
        enc_entry = urllib.parse.quote(resolved, safe="")
        return f'{attr}={quote}/api/fs/archive-entry?path={enc_archive}&entry={enc_entry}&raw=1{token_q}{quote}'

    return re.sub(r'\b(href|src)=(["\'])([^"\']+)\2', _repl, html_text, flags=re.IGNORECASE)


@router.get("/api/fs/preview")
def preview_server_file(
    path: str = Query(..., description="Absolute server file path"),
    max_bytes: int = Query(2 * 1024 * 1024),
    room_id: Optional[str] = Query(None, description="Optional War Room ID for relative path resolution"),
    token: Optional[str] = Query(None)
):
    """Instant HTML / Text / Image / Code Quick-Viewer (BL-FILE-12, BL-EVO-12)"""
    target = validate_and_resolve_path(path, room_id=room_id)
    stat = target.stat()
    file_size = stat.st_size
    ext = target.suffix.lower()

    mime_type, _ = mimetypes.guess_type(str(target))
    if not mime_type:
        mime_type = "text/plain; charset=utf-8" if ext in {".txt", ".log", ".py", ".sh", ".json", ".yaml", ".yml", ".md", ".csv", ".tsv", ".env"} else "application/octet-stream"

    # Images
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}:
        return FileResponse(target, media_type=mime_type)

    # HTML files - served safely for iframe embedding
    if ext in {".html", ".htm"}:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(max_bytes)
        return Response(content=content, media_type="text/html; charset=utf-8")

    # PDF documents - streamed inline so the browser's native PDF viewer renders them
    if ext == ".pdf":
        return FileResponse(
            target,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{target.name}"'}
        )

    # Excel workbooks (.xlsx / .xlsm) - parse sheets natively for interactive spreadsheet preview
    if ext in {".xlsx", ".xlsm"}:
        parsed = _parse_xlsx_preview(target)
        if parsed is not None:
            return {
                "status": "ok",
                "name": target.name,
                "path": str(target),
                "size": file_size,
                "ext": ext,
                "mime_type": mime_type,
                "kind": "xlsx",
                "sheets": parsed["sheets"],
                "truncated": parsed["truncated"],
                "content": ""
            }

    # Office documents - pair with a sibling PDF render if one exists (agents convert via LibreOffice)
    if ext in OFFICE_EXTS:
        sibling_pdf = target.with_suffix(".pdf")
        return {
            "status": "ok",
            "name": target.name,
            "path": str(target),
            "size": file_size,
            "ext": ext,
            "mime_type": mime_type,
            "kind": "office",
            "paired_pdf": str(sibling_pdf) if sibling_pdf.exists() else None,
            "truncated": False,
            "content": ""
        }

    # Archives (.zip, .tar.gz, .tgz, .tar) - inspect directory tree in memory
    if _is_archive_path(target):
        parsed_arch = _inspect_archive_preview(target)
        if parsed_arch is not None:
            return {
                "status": "ok",
                "name": target.name,
                "path": str(target),
                "size": file_size,
                "ext": ext,
                "mime_type": mime_type or "application/zip",
                "kind": "archive",
                "entries": parsed_arch["entries"],
                "total_files": parsed_arch["total_files"],
                "total_dirs": parsed_arch["total_dirs"],
                "total_uncompressed": parsed_arch["total_uncompressed"],
                "truncated": parsed_arch["truncated"],
                "default_entry": parsed_arch["default_entry"],
                "quick_picks": parsed_arch["quick_picks"],
                "content": ""
            }

    # Unknown / binary files - do not dump raw bytes into the text viewer
    if ext not in TEXT_EXTS:
        with open(target, "rb") as bf:
            head = bf.read(8192)
        if _detect_binary_bytes(head):
            return {
                "status": "ok",
                "name": target.name,
                "path": str(target),
                "size": file_size,
                "ext": ext,
                "mime_type": mime_type,
                "kind": "binary",
                "truncated": False,
                "content": ""
            }

    # Text / Code / Markdown / CSV / JSON
    if file_size > max_bytes:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(max_bytes)
        truncated = True
    else:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        truncated = False

    return {
        "status": "ok",
        "name": target.name,
        "path": str(target),
        "size": file_size,
        "ext": ext,
        "mime_type": mime_type,
        "truncated": truncated,
        "content": content
    }


@router.get("/api/fs/archive-entry")
def preview_or_download_archive_entry(
    path: str = Query(..., description="Absolute server archive path"),
    entry: str = Query(..., description="Relative path inside the archive"),
    raw: int = Query(0, description="Return raw bytes for inline image/PDF/HTML rendering"),
    download: int = Query(0, description="Force attachment download of this archive entry"),
    max_bytes: int = Query(2 * 1024 * 1024),
    room_id: Optional[str] = Query(None),
    token: Optional[str] = Query(None)
):
    """Preview or download a single file inside a .zip / .tar* archive without extracting to disk."""
    target = validate_and_resolve_path(path, room_id=room_id)
    if not _is_archive_path(target):
        raise HTTPException(status_code=400, detail="Target file is not a supported archive")

    norm_entry = _normalize_archive_entry(entry)
    raw_bytes, total_size, base_name = _read_archive_entry_bytes(target, norm_entry)
    ext = posixpath.splitext(base_name)[1].lower()
    mime_type, _ = mimetypes.guess_type(base_name)
    if not mime_type:
        mime_type = "text/plain; charset=utf-8" if ext in TEXT_EXTS else "application/octet-stream"

    if download:
        return Response(
            content=raw_bytes,
            media_type=mime_type,
            headers={"Content-Disposition": f'attachment; filename="{base_name}"'}
        )

    if raw:
        if ext in {".html", ".htm"}:
            html_str = raw_bytes[:max_bytes].decode("utf-8", errors="replace")
            rewritten = _rewrite_archive_html_assets(html_str, str(target), norm_entry, token)
            return Response(content=rewritten, media_type="text/html; charset=utf-8")
        if ext == ".pdf":
            return Response(
                content=raw_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="{base_name}"'}
            )
        return Response(content=raw_bytes, media_type=mime_type)

    if ext in IMAGE_EXTS:
        return {
            "status": "ok",
            "entry": norm_entry,
            "name": base_name,
            "size": total_size,
            "ext": ext,
            "mime_type": mime_type,
            "kind": "image",
            "content": ""
        }

    if ext == ".pdf":
        return {
            "status": "ok",
            "entry": norm_entry,
            "name": base_name,
            "size": total_size,
            "ext": ext,
            "mime_type": "application/pdf",
            "kind": "pdf",
            "content": ""
        }

    if ext in {".xlsx", ".xlsm"}:
        parsed = _parse_xlsx_preview(io.BytesIO(raw_bytes))
        if parsed is not None:
            return {
                "status": "ok",
                "entry": norm_entry,
                "name": base_name,
                "size": total_size,
                "ext": ext,
                "mime_type": mime_type,
                "kind": "xlsx",
                "sheets": parsed["sheets"],
                "truncated": parsed["truncated"],
                "content": ""
            }

    if ext not in TEXT_EXTS and _detect_binary_bytes(raw_bytes[:8192]):
        return {
            "status": "ok",
            "entry": norm_entry,
            "name": base_name,
            "size": total_size,
            "ext": ext,
            "mime_type": mime_type,
            "kind": "binary",
            "truncated": False,
            "content": ""
        }

    truncated = len(raw_bytes) > max_bytes
    text_slice = raw_bytes[:max_bytes].decode("utf-8", errors="replace")
    entry_kind = "html" if ext in {".html", ".htm"} else ("md" if ext == ".md" else ("table" if ext in {".csv", ".tsv"} else "text"))
    return {
        "status": "ok",
        "entry": norm_entry,
        "name": base_name,
        "size": total_size,
        "ext": ext,
        "mime_type": mime_type,
        "kind": entry_kind,
        "truncated": truncated,
        "content": text_slice
    }
