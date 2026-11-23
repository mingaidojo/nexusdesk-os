import os
import re
import stat
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any
import yaml
from fastapi import APIRouter, Request, HTTPException, Query
from core.config import (
    resolve_instance_key,
    get_instance_user_context,
    backup_file,
    set_instance_perms
)
from services.ai_architect import ai_architect
from schemas.models import FileUpdateRequest, MemoryUpdateRequest, SkillSaveRequest, SkillLockRequest

router = APIRouter(tags=["workspace_memory"])

@router.get("/api/agent/{agent_name}/files")
def list_agent_files(agent_name: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    workspace_dir = None
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                for a in cfg.get("agents", []):
                    if a.get("name", "").lower() == agent_name.lower():
                        workspace_dir = a.get("workspace_dir")
                        break
        except Exception:
            pass

    if not workspace_dir:
        workspace_dir = str(ctx["workspace"] / agent_name.lower())
        
    wdir = Path(workspace_dir)
    if not wdir.exists():
        raise HTTPException(status_code=404, detail=f"Workspace directory {workspace_dir} does not exist")
        
    results = []
    for root, dirs, files in os.walk(wdir):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__pycache__"]
        for fn in files:
            if fn.startswith(".") or fn.endswith(".pyc"):
                continue
            fpath = Path(root) / fn
            rel_path = str(fpath.relative_to(wdir))
            try:
                st = fpath.stat()
                results.append({
                    "name": fn,
                    "path": rel_path,
                    "size": st.st_size,
                    "updated_at": st.st_mtime,
                    "is_markdown": fn.endswith(".md"),
                    "is_json": fn.endswith(".json"),
                    "is_code": fn.endswith((".py", ".sh", ".js", ".html"))
                })
            except Exception:
                pass
                
    results.sort(key=lambda x: (not x["is_markdown"], x["path"]))
    return {"agent": agent_name, "workspace_dir": str(wdir), "files": results, "instance": inst_key}

@router.get("/api/agent/{agent_name}/file")
def get_agent_file(agent_name: str, request: Request, path: str = Query(...), instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    workspace_dir = None
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                for a in cfg.get("agents", []):
                    if a.get("name", "").lower() == agent_name.lower():
                        workspace_dir = a.get("workspace_dir")
                        break
        except Exception:
            pass

    if not workspace_dir:
        workspace_dir = str(ctx["workspace"] / agent_name.lower())
        
    fpath = (Path(workspace_dir) / path).resolve()
    if not str(fpath).startswith(str(Path(workspace_dir).resolve())):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
        
    if not fpath.exists() or not fpath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
        
    try:
        with open(fpath, "r", encoding="utf-8", errors="replace") as f:
            return {"agent": agent_name, "path": path, "content": f.read(), "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/agent/{agent_name}/file")
def save_agent_file(agent_name: str, req: FileUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    workspace_dir = None
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                for a in cfg.get("agents", []):
                    if a.get("name", "").lower() == agent_name.lower():
                        workspace_dir = a.get("workspace_dir")
                        break
        except Exception:
            pass

    if not workspace_dir:
        workspace_dir = str(ctx["workspace"] / agent_name.lower())
        
    fpath = (Path(workspace_dir) / req.path).resolve()
    if not str(fpath).startswith(str(Path(workspace_dir).resolve())):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
        
    try:
        backup_file(fpath)
        fpath.parent.mkdir(parents=True, exist_ok=True)
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(req.content)
        set_instance_perms(fpath, inst_key)
        return {"status": "saved", "agent": agent_name, "path": req.path, "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/memory/{agent_workspace}")
def get_agent_memory(agent_workspace: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    mem_file = ctx["workspace"] / agent_workspace / "memory" / "MEMORY.md"
    if not mem_file.exists():
        raise HTTPException(status_code=404, detail="Memory file not found")
    try:
        with open(mem_file, "r") as f:
            return {"workspace": agent_workspace, "content": f.read(), "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/memory/{agent_workspace}")
def update_agent_memory(agent_workspace: str, req: MemoryUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    mem_file = ctx["workspace"] / agent_workspace / "memory" / "MEMORY.md"
    mem_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        backup_file(mem_file)
        with open(mem_file, "w") as f:
            f.write(req.content)
        set_instance_perms(mem_file, inst_key)
        return {"status": "saved", "workspace": agent_workspace, "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/wiki")
def get_wiki_index(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    wiki_dir = ctx["workspace"] / "wiki"
    if not wiki_dir.exists():
        return {"topics": [], "instance": inst_key}
    topics = []
    for f in sorted(wiki_dir.glob("*.md")):
        topics.append({
            "name": f.name,
            "size": f.stat().st_size,
            "updated_at": f.stat().st_mtime
        })
    return {"topics": topics, "instance": inst_key}

@router.get("/api/wiki/{filename}")
def get_wiki_file(filename: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    fpath = ctx["workspace"] / "wiki" / filename
    if not fpath.exists() or not fpath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        with open(fpath, "r") as f:
            return {"filename": filename, "content": f.read(), "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# AGENT SKILLS STUDIO (BL-OPS-09): Discovery, Trimming, Lock & Ground-Truth
# =============================================================================

def _parse_skill_frontmatter(raw_text: str) -> Dict[str, Any]:
    """Parse YAML frontmatter from SKILL.md if present."""
    meta = {
        "name": "",
        "description": "",
        "tags": [],
        "version": "1.0",
        "user_locked": False
    }
    if raw_text.startswith("---"):
        parts = raw_text.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
                if isinstance(fm, dict):
                    meta["name"] = str(fm.get("name") or "")
                    meta["description"] = str(fm.get("description") or "")
                    tags_val = fm.get("tags", [])
                    if isinstance(tags_val, list):
                        meta["tags"] = [str(t) for t in tags_val]
                    elif isinstance(tags_val, str):
                        meta["tags"] = [t.strip() for t in tags_val.split(",") if t.strip()]
                    meta["version"] = str(fm.get("version") or "1.0")
                    meta["user_locked"] = bool(fm.get("user_locked", False))
            except Exception:
                pass
    return meta


def _extract_ground_truth_targets(raw_text: str) -> List[Dict[str, str]]:
    """Extract Ground-Truth IDs, folder paths, and API endpoints from skill/memory markdown."""
    targets = []
    seen = set()

    patterns = [
        ("ENV / Account ID", r"\b(INSTAGRAM_ACCOUNT_ID(?:_\d+)?\s*=\s*\d+|\b1784\d{11,15}\b)"),
        ("Google Drive ID", r"\b(1[a-zA-Z0-9_-]{25,38})\b"),
        ("Filesystem Path", r"(/home/[a-zA-Z0-9_./-]+|~/.hermes/[a-zA-Z0-9_./-]+)"),
        ("API Endpoint", r"(https?://[a-zA-Z0-9._/-]+)"),
        ("CLI Flag / Script", r"([a-zA-Z0-9_-]+\.py(?:\s+--[a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)?)?)")
    ]

    for category, regex in patterns:
        for match in re.finditer(regex, raw_text):
            val = match.group(1).strip().rstrip(".,;)")
            if len(val) < 5 or val in seen:
                continue
            # Filter out generic markdown links if needed
            seen.add(val)
            targets.append({"category": category, "value": val})
            if len(targets) >= 24:
                return targets
    return targets


def _resolve_skill_roots(ctx: Dict[str, Any], agent_name: str) -> List[Dict[str, Any]]:
    """Return allowed skill root directories for an instance and agent."""
    hermes_home = ctx["home"]
    workspace = ctx["workspace"]
    roots = [
        {"scope": "global", "dir": hermes_home / "skills"},
        {"scope": "profile", "dir": hermes_home / "profiles" / agent_name.lower() / "skills"},
        {"scope": "workspace", "dir": workspace / agent_name.lower() / "skills"},
    ]
    return roots


def _validate_skill_path(fpath: Path, ctx: Dict[str, Any]) -> Path:
    resolved = fpath.resolve()
    allowed_prefixes = [
        str(ctx["home"].resolve()),
        str(ctx["workspace"].resolve())
    ]
    if not any(str(resolved).startswith(prefix) for prefix in allowed_prefixes):
        raise HTTPException(status_code=403, detail="Access denied: skill path outside instance roots")
    if resolved.name != "SKILL.md":
        raise HTTPException(status_code=400, detail="Only SKILL.md files can be managed in Skills Studio")
    return resolved


@router.get("/api/agent/{agent_name}/skills")
def list_agent_skills(agent_name: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)

    # Check agent's assigned skills in config.yaml if any
    assigned_skills = set()
    cfg_file = ctx["home"] / "config.yaml"
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                for a in cfg.get("agents", []):
                    if a.get("name", "").lower() == agent_name.lower():
                        for s in (a.get("skills") or []):
                            assigned_skills.add(str(s).lower())
        except Exception:
            pass

    skills_list = []
    seen_paths = set()

    for root_info in _resolve_skill_roots(ctx, agent_name):
        sdir = root_info["dir"]
        scope = root_info["scope"]
        if not sdir.exists() or not sdir.is_dir():
            continue
        for skill_md in sorted(sdir.glob("*/SKILL.md")):
            try:
                resolved = skill_md.resolve()
                if str(resolved) in seen_paths:
                    continue
                seen_paths.add(str(resolved))

                st = resolved.stat()
                raw = resolved.read_text(encoding="utf-8", errors="replace")
                meta = _parse_skill_frontmatter(raw)
                folder_name = resolved.parent.name
                skill_name = meta["name"] or folder_name

                # Determine lock state: either YAML user_locked: true OR read-only file mode (no owner write bit)
                is_readonly = not bool(st.st_mode & stat.S_IWUSR)
                is_locked = meta["user_locked"] or is_readonly

                skills_list.append({
                    "name": skill_name,
                    "folder": folder_name,
                    "scope": scope,
                    "description": meta["description"] or "Operational procedural skill",
                    "tags": meta["tags"],
                    "version": meta["version"],
                    "locked": is_locked,
                    "readonly_mode": oct(st.st_mode & 0o777),
                    "assigned": (skill_name.lower() in assigned_skills) or (folder_name.lower() in assigned_skills),
                    "path": str(resolved),
                    "size": st.st_size,
                    "updated_at": st.st_mtime,
                    "targets_count": len(_extract_ground_truth_targets(raw))
                })
            except Exception:
                continue

    skills_list.sort(key=lambda x: (not x["locked"], not x["assigned"], x["name"].lower()))
    return {
        "agent": agent_name,
        "instance": inst_key,
        "skills": skills_list
    }


@router.get("/api/agent/{agent_name}/skill")
def get_agent_skill_detail(agent_name: str, request: Request, path: str = Query(...), instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    resolved = _validate_skill_path(Path(path), ctx)
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="SKILL.md not found")

    try:
        st = resolved.stat()
        content = resolved.read_text(encoding="utf-8", errors="replace")
        meta = _parse_skill_frontmatter(content)
        is_readonly = not bool(st.st_mode & stat.S_IWUSR)
        is_locked = meta["user_locked"] or is_readonly
        targets = _extract_ground_truth_targets(content)

        return {
            "agent": agent_name,
            "instance": inst_key,
            "path": str(resolved),
            "name": meta["name"] or resolved.parent.name,
            "description": meta["description"],
            "locked": is_locked,
            "readonly_mode": oct(st.st_mode & 0o777),
            "content": content,
            "targets": targets
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _set_frontmatter_lock_flag(raw_text: str, locked: bool) -> str:
    """Inject or update user_locked: true/false in YAML frontmatter."""
    if raw_text.startswith("---"):
        parts = raw_text.split("---", 2)
        if len(parts) >= 3:
            fm_text = parts[1]
            body = parts[2]
            if re.search(r"^user_locked\s*:", fm_text, flags=re.MULTILINE):
                fm_text = re.sub(
                    r"^user_locked\s*:.*$",
                    f"user_locked: {'true' if locked else 'false'}",
                    fm_text,
                    flags=re.MULTILINE
                )
            else:
                fm_text = fm_text.rstrip() + f"\nuser_locked: {'true' if locked else 'false'}\n"
            return f"---{fm_text}---{body}"
    # If no frontmatter exists, prepend one
    return f"---\nuser_locked: {'true' if locked else 'false'}\n---\n{raw_text}"


@router.post("/api/agent/{agent_name}/skill")
def save_agent_skill(agent_name: str, req: SkillSaveRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    resolved = _validate_skill_path(Path(req.path), ctx)
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="SKILL.md not found")

    # Validate YAML frontmatter if present
    if req.content.startswith("---"):
        parts = req.content.split("---", 2)
        if len(parts) >= 3:
            try:
                yaml.safe_load(parts[1])
            except Exception as ye:
                raise HTTPException(status_code=400, detail=f"Invalid YAML frontmatter: {ye}")

    try:
        st = resolved.stat()
        was_readonly = not bool(st.st_mode & stat.S_IWUSR)
        meta_before = _parse_skill_frontmatter(resolved.read_text(encoding="utf-8", errors="replace"))
        was_locked = meta_before["user_locked"] or was_readonly

        # Operator Override: temporarily grant write permission if file was chmod 0444 locked
        if was_readonly:
            os.chmod(resolved, 0o644)

        backup_file(resolved)
        resolved.write_text(req.content, encoding="utf-8")
        set_instance_perms(resolved, inst_key)

        # Re-check if locked in new content or was locked
        meta_after = _parse_skill_frontmatter(req.content)
        now_locked = meta_after["user_locked"] or was_locked
        if now_locked:
            os.chmod(resolved, 0o444)

        return {
            "status": "saved",
            "path": str(resolved),
            "locked": now_locked,
            "targets": _extract_ground_truth_targets(req.content),
            "instance": inst_key
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/agent/{agent_name}/skill/lock")
def toggle_agent_skill_lock(agent_name: str, req: SkillLockRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    resolved = _validate_skill_path(Path(req.path), ctx)
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="SKILL.md not found")

    try:
        # Temporarily unlock chmod so we can update YAML frontmatter
        os.chmod(resolved, 0o644)
        raw = resolved.read_text(encoding="utf-8", errors="replace")
        updated_raw = _set_frontmatter_lock_flag(raw, req.locked)
        backup_file(resolved)
        resolved.write_text(updated_raw, encoding="utf-8")
        set_instance_perms(resolved, inst_key)

        if req.locked:
            # Enforce read-only 0444 so autonomous Hermes agent cannot mutate or overwrite
            os.chmod(resolved, 0o444)
        else:
            os.chmod(resolved, 0o644)

        st = resolved.stat()
        return {
            "status": "locked" if req.locked else "unlocked",
            "locked": req.locked,
            "readonly_mode": oct(st.st_mode & 0o777),
            "path": str(resolved),
            "content": updated_raw,
            "instance": inst_key
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/agent/{agent_name}/skill/tidy")
async def tidy_agent_skill(agent_name: str, req: Dict[str, Any], request: Request):
    inst_key = resolve_instance_key(request, req.get("instance"))
    ctx = get_instance_user_context(inst_key)
    skill_path_str = req.get("path")
    if not skill_path_str:
        raise HTTPException(status_code=400, detail="Missing required 'path' parameter")
        
    resolved = _validate_skill_path(Path(skill_path_str), ctx)
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="Target SKILL.md file not found")
        
    raw_content = resolved.read_text(encoding="utf-8", errors="replace")
    skill_name = resolved.parent.name or "skill"
    
    try:
        loop = asyncio.get_event_loop()
        tidy_result = await loop.run_in_executor(
            None,
            lambda: ai_architect.tidy_skill(raw_content, skill_name=skill_name, inst_key=inst_key)
        )
        tidy_result["path"] = str(resolved)
        tidy_result["instance"] = inst_key
        return tidy_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


