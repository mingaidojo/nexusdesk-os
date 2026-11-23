import time
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional
import yaml
from fastapi import APIRouter, Request, HTTPException, Query
from core.config import (
    resolve_instance_key,
    get_instance_user_context,
    backup_file,
    set_instance_perms,
    save_specialist_override,
    get_specialist_overrides,
    broadcast_event
)
from schemas.models import AgentCreateRequest, AgentUpdateRequest

router = APIRouter(prefix="/api/agents", tags=["agents"])

@router.post("/create")
async def create_agent(req: AgentCreateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    
    clean_name = req.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Agent name cannot be empty")
        
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}

        if "agents" not in cfg:
            cfg["agents"] = []

        # Check for duplicate name
        for a in cfg["agents"]:
            if a.get("name", "").lower() == clean_name.lower():
                raise HTTPException(status_code=400, detail=f"Agent '{clean_name}' already exists in fleet")

        # Initialize agent workspace directory
        workspace_dir = ctx["workspace"] / clean_name.lower()
        workspace_dir.mkdir(parents=True, exist_ok=True)
        memory_dir = workspace_dir / "memory"
        memory_dir.mkdir(parents=True, exist_ok=True)
        
        starter_memory = memory_dir / "MEMORY.md"
        if not starter_memory.exists():
            starter_content = f"# Long-Term Memory: {clean_name}\n\n## Core Directives & Context\n- Role: {req.role.strip()}\n- Fleet: {ctx['label']}\n- Deployed: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n## Working Knowledge\n- Autonomous operations ready.\n"
            with open(starter_memory, "w") as f:
                f.write(starter_content)

        set_instance_perms(workspace_dir, inst_key)
        set_instance_perms(memory_dir, inst_key)
        set_instance_perms(starter_memory, inst_key)

        # Fallback models normalization
        clean_fbs = [str(x).strip() for x in (req.fallback_models or []) if x and str(x).strip()]
        if not clean_fbs and req.fallback_model:
            clean_fbs = [req.fallback_model.strip()]
        if not clean_fbs:
            clean_fbs = ["abacus/gemini-3.8-flash"]

        new_agent = {
            "name": clean_name,
            "role": req.role.strip(),
            "engine": (req.engine or "hermes").lower().strip(),
            "model": req.model.strip() if req.model else "abacus/gemini-3.8-flash",
            "fallback_model": clean_fbs[0],
            "fallback_models": clean_fbs[:4],
            "skills": ["general", "problem_solving"],
            "system_prompt": req.system_prompt.strip() or f"You are {clean_name}, specializing in {req.role.strip()}.",
            "allowed_toolsets": ["*"],
            "workspace_dir": str(workspace_dir),
            "theme": req.theme or "custom",
            "color": req.color or "#06b6d4",
            "voice": {
                "gender": req.voice_gender or "female",
                "pitch": req.voice_pitch or 1.0,
                "rate": req.voice_rate or 1.0
            }
        }

        cfg["agents"].append(new_agent)
        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)

        await broadcast_event("agent_created", {"agent": new_agent, "instance": inst_key})
        return {"status": "created", "agent": new_agent, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{agent_name}")
async def update_agent(agent_name: str, req: AgentUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"

    # Build override payload for universal specialist persistence (BL-MOD-31)
    override_payload = {}
    if req.new_name is not None and req.new_name.strip():
        override_payload["name"] = req.new_name.strip()
    if req.engine is not None:
        override_payload["engine"] = req.engine.lower().strip()
    if req.role is not None:
        override_payload["role"] = req.role.strip()
    if req.model is not None:
        override_payload["model"] = req.model.strip()
    if req.fallback_models is not None:
        clean_fbs = [str(x).strip() for x in req.fallback_models if x and str(x).strip()]
        override_payload["fallback_models"] = clean_fbs[:4]
        override_payload["fallback_model"] = clean_fbs[0] if clean_fbs else None
    elif req.fallback_model is not None:
        override_payload["fallback_model"] = req.fallback_model.strip()
        override_payload["fallback_models"] = [req.fallback_model.strip()]
    if req.system_prompt is not None:
        override_payload["system_prompt"] = req.system_prompt.strip()
    if req.theme is not None:
        override_payload["theme"] = req.theme
    if req.color is not None:
        override_payload["color"] = req.color
    if any(v is not None for v in (req.voice_gender, req.voice_pitch, req.voice_rate)):
        override_payload["voice"] = {}
        if req.voice_gender is not None: override_payload["voice"]["gender"] = req.voice_gender
        if req.voice_pitch is not None: override_payload["voice"]["pitch"] = req.voice_pitch
        if req.voice_rate is not None: override_payload["voice"]["rate"] = req.voice_rate

    if override_payload:
        save_specialist_override(agent_name, override_payload, instance_key=inst_key)
        lower_agent = agent_name.lower().strip()
        if "claude" in lower_agent and "model" in override_payload:
            save_specialist_override("claude", {"model": override_payload["model"]})
        elif "opencode" in lower_agent and "model" in override_payload:
            save_specialist_override("opencode", {"model": override_payload["model"]})
        elif ("agy" in lower_agent or (inst_key == "myvirtualcoder" and "developer" in lower_agent)) and "model" in override_payload:
            save_specialist_override("agy", {"model": override_payload["model"]})
        elif "codex" in lower_agent and "model" in override_payload:
            save_specialist_override("codex", {"model": override_payload["model"]})

    if not cfg_file.exists():
        # Synthesized CLI agent without config.yaml — return updated override state cleanly
        synth_agent = {
            "name": override_payload.get("name") or agent_name,
            "role": override_payload.get("role") or "Autonomous Specialist",
            "engine": override_payload.get("engine") or "claude",
            "model": override_payload.get("model") or "",
            "workspace_dir": str(ctx["workspace"]),
            **override_payload
        }
        await broadcast_event("agent_updated", {"agent": synth_agent, "instance": inst_key})
        return {"status": "updated", "agent": synth_agent, "instance": inst_key}

    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}

        target = None
        for a in cfg.get("agents", []):
            if a.get("name", "").lower() == agent_name.lower():
                target = a
                break

        if not target:
            # Agent is a synthesized specialist on a fleet that happens to have config.yaml
            synth_agent = {
                "name": override_payload.get("name") or agent_name,
                "role": override_payload.get("role") or "Autonomous Specialist",
                "engine": override_payload.get("engine") or "claude",
                "model": override_payload.get("model") or "",
                "workspace_dir": str(ctx["workspace"]),
                **override_payload
            }
            await broadcast_event("agent_updated", {"agent": synth_agent, "instance": inst_key})
            return {"status": "updated", "agent": synth_agent, "instance": inst_key}

        # Handle agent renaming if requested
        if req.new_name is not None and req.new_name.strip() and req.new_name.strip().lower() != agent_name.lower():
            clean_new_name = req.new_name.strip()
            # Ensure new name does not conflict with another agent
            for a in cfg.get("agents", []):
                if a.get("name", "").lower() == clean_new_name.lower() and a != target:
                    raise HTTPException(status_code=400, detail=f"Agent '{clean_new_name}' already exists in fleet")

            old_ws = Path(target.get("workspace_dir") or (ctx["workspace"] / agent_name.lower()))
            new_ws = ctx["workspace"] / clean_new_name.lower()

            if old_ws.exists() and not new_ws.exists():
                try:
                    shutil.move(str(old_ws), str(new_ws))
                    target["workspace_dir"] = str(new_ws)
                    set_instance_perms(new_ws, inst_key)
                except Exception as e:
                    # Non-fatal if move fails; retain old path or update to new
                    pass
            elif not old_ws.exists():
                new_ws.mkdir(parents=True, exist_ok=True)
                target["workspace_dir"] = str(new_ws)
                set_instance_perms(new_ws, inst_key)

            target["name"] = clean_new_name

        if req.engine is not None:
            target["engine"] = req.engine.lower().strip()
        if req.role is not None:
            target["role"] = req.role.strip()
        if req.model is not None:
            target["model"] = req.model.strip()
        if req.fallback_models is not None:
            clean_fbs = [str(x).strip() for x in req.fallback_models if x and str(x).strip()]
            target["fallback_models"] = clean_fbs[:4]
            target["fallback_model"] = clean_fbs[0] if clean_fbs else None
        elif req.fallback_model is not None:
            target["fallback_model"] = req.fallback_model.strip()
            target["fallback_models"] = [req.fallback_model.strip()]
        if req.system_prompt is not None:
            target["system_prompt"] = req.system_prompt.strip()
        if req.theme is not None:
            target["theme"] = req.theme
        if req.color is not None:
            target["color"] = req.color
        if any(v is not None for v in (req.voice_gender, req.voice_pitch, req.voice_rate)):
            target["voice"] = target.get("voice", {})
            if req.voice_gender is not None: target["voice"]["gender"] = req.voice_gender
            if req.voice_pitch is not None: target["voice"]["pitch"] = req.voice_pitch
            if req.voice_rate is not None: target["voice"]["rate"] = req.voice_rate

        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)

        await broadcast_event("agent_updated", {"agent": target, "instance": inst_key})
        return {"status": "updated", "agent": target, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{agent_name}")
async def decommission_agent(agent_name: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}

        agents_list = cfg.get("agents", [])
        target = next((a for a in agents_list if a.get("name", "").lower() == agent_name.lower()), None)
        
        if not target:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")

        # Archive workspace safely without data loss
        workspace_dir = Path(target.get("workspace_dir") or (ctx["workspace"] / agent_name.lower()))
        if workspace_dir.exists():
            archive_path = workspace_dir.parent / f"{workspace_dir.name}_archived_{int(time.time())}"
            try:
                shutil.move(str(workspace_dir), str(archive_path))
            except Exception:
                pass

        cfg["agents"] = [a for a in agents_list if a.get("name", "").lower() != agent_name.lower()]
        
        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)

        await broadcast_event("agent_deleted", {"agent": agent_name, "instance": inst_key})
        return {"status": "decommissioned", "agent": agent_name, "instance": inst_key, "archived": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
