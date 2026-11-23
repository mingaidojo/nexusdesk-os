from pathlib import Path
from typing import Optional
import yaml
from fastapi import APIRouter, Request, HTTPException, Query
from core.config import (
    resolve_instance_key,
    get_instance_user_context,
    backup_file,
    set_instance_perms,
    resolve_fleet_primary_engine,
    get_engine_active_model,
    detect_user_engines,
    get_engine_models_catalog,
    get_specialist_overrides,
    save_specialist_override,
    register_custom_model,
    broadcast_event,
    ENGINE_DEFAULTS
)
from services.war_room.participants import clear_agent_room_overrides
from services.model_specs import MODEL_LIBRARY_SPECS, get_model_specs
from schemas.models import (
    FallbackUpdateRequest,
    ReasoningUpdateRequest,
    AgentModelUpdateRequest,
    GlobalModelUpdateRequest
)

router = APIRouter(tags=["models"])

@router.get("/api/models/engine-catalog")
def get_engine_catalog(refresh: bool = Query(False)):
    """BL-MOD-31: Return the dynamic per-engine LLM catalog for agy, claude, opencode, codex, and hermes."""
    return get_engine_models_catalog(force_refresh=refresh)

@router.get("/api/config/models")
def get_model_config(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    cfg = {}
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
        except Exception:
            cfg = {}
    try:
        
        primary_eng, primary_color, primary_theme = resolve_fleet_primary_engine(ctx["user"])
        overrides = get_specialist_overrides()

        agent_configs = []
        available_agents = []
        for a in cfg.get("agents", []):
            a_name = a.get("name")
            if a_name:
                available_agents.append(a_name)
            fb_list = a.get("fallback_models")
            if not fb_list and a.get("fallback_model"):
                fb_list = [a.get("fallback_model")]
            elif not fb_list:
                fb_list = []

            eng_val = (a.get("engine") or primary_eng).lower().strip()
            model_val = a.get("model")
            if a_name:
                ov = overrides.get(f"{inst_key.lower()}:{a_name.lower()}") or overrides.get(a_name.lower())
                if isinstance(ov, dict):
                    if ov.get("model"):
                        model_val = ov["model"]
                    if ov.get("engine"):
                        eng_val = ov["engine"]

            agent_configs.append({
                "name": a_name,
                "role": a.get("role"),
                "model": model_val,
                "fallback_model": a.get("fallback_model"),
                "fallback_models": fb_list,
                "workspace_dir": a.get("workspace_dir"),
                "engine": eng_val,
                "theme": a.get("theme", "custom"),
                "color": a.get("color") or primary_color,
                "system_prompt": a.get("system_prompt", ""),
                "voice": a.get("voice", {})
            })

        engines = detect_user_engines(ctx["user"])
        is_online = any(e.get("daemon_running") or e.get("installed") for e in engines.values())

        # Synthesize Default Primary Agents for active or installed engines if no config.yaml exists
        if not agent_configs and is_online:
            active_engine_keys = [
                eng_id for eng_id, edata in engines.items()
                if edata.get("daemon_running")
            ]
            if not active_engine_keys:
                active_engine_keys = [
                    eng_id for eng_id, edata in engines.items()
                    if edata.get("installed")
                ]
            if not active_engine_keys:
                active_engine_keys = [primary_eng]

            for eng_id in active_engine_keys:
                eng_meta = engines.get(eng_id, {})
                eng_label = eng_meta.get("name") or eng_id.capitalize()
                if len(active_engine_keys) == 1:
                    def_name = f"{ctx['label'].split()[0]} Agent" if ctx.get("label") else f"{eng_label} Specialist"
                else:
                    def_name = f"{ctx['label'].split()[0]} {eng_label.split()[0]}" if ctx.get("label") else f"{eng_label} Agent"

                active_model = get_engine_active_model(eng_id, ctx["user"], agent_name=def_name)
                eng_color = ENGINE_DEFAULTS.get(eng_id, {}).get("color", primary_color)
                available_agents.append(def_name)
                agent_configs.append({
                    "name": def_name,
                    "role": f"Autonomous {eng_label} Specialist & Command Console",
                    "model": active_model,
                    "fallback_model": None,
                    "fallback_models": [],
                    "workspace_dir": str(ctx["workspace"]),
                    "engine": eng_id,
                    "theme": primary_theme,
                    "color": eng_color,
                    "system_prompt": "",
                    "voice": {}
                })
            
        providers = []
        for p_name, p_val in cfg.get("providers", {}).items():
            providers.append({
                "name": p_name,
                "base_url": p_val.get("base_url") if isinstance(p_val, dict) else None,
                "has_key": bool(p_val.get("api_key")) if isinstance(p_val, dict) else False
            })

        fallback_providers = []
        for fb in cfg.get("fallback_providers", []):
            if isinstance(fb, dict):
                fb_copy = dict(fb)
                # Ensure agents list is present and normalized
                if "agents" not in fb_copy or not fb_copy["agents"]:
                    fb_copy["agents"] = ["all"]
                elif isinstance(fb_copy["agents"], str):
                    fb_copy["agents"] = [fb_copy["agents"]]
                fallback_providers.append(fb_copy)

        agent_sec = cfg.get("agent", {})
        model_sec = cfg.get("model", {})
        active_primary_model = get_engine_active_model(primary_eng, ctx["user"])
        default_model_str = model_sec.get("default", "") if isinstance(model_sec, dict) else str(model_sec or "")
        if not default_model_str and is_online:
            default_model_str = active_primary_model
        default_provider = "anthropic" if primary_eng == "claude" else ("google" if primary_eng == "agy" else "abacus")

        if isinstance(model_sec, dict):
            global_model_info = {
                "default": default_model_str,
                "provider": model_sec.get("provider") or default_provider,
                "base_url": model_sec.get("base_url")
            }
        else:
            global_model_info = {
                "default": default_model_str,
                "provider": default_provider,
                "base_url": None
            }

        return {
            "agents": agent_configs,
            "available_agents": available_agents,
            "providers": providers,
            "fallback_providers": fallback_providers,
            "global_model": global_model_info,
            "reasoning_effort": agent_sec.get("reasoning_effort", "medium"),
            "reasoning_overrides": agent_sec.get("reasoning_overrides", {}),
            "instance": inst_key
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/config/fallback")
def update_fallback_chain(req: FallbackUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}
            
        cleaned = []
        for fb in req.fallback_providers:
            entry = {
                "provider": str(fb.get("provider", "")).strip(),
                "model": str(fb.get("model", "")).strip(),
            }
            if fb.get("base_url"):
                entry["base_url"] = str(fb.get("base_url")).strip()
            
            raw_agents = fb.get("agents")
            if raw_agents:
                if isinstance(raw_agents, list):
                    entry["agents"] = [str(x).strip() for x in raw_agents if str(x).strip()]
                else:
                    entry["agents"] = [str(raw_agents).strip()]
            else:
                entry["agents"] = ["all"]
            cleaned.append(entry)
            
        cfg["fallback_providers"] = cleaned[:5]
        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)
        return {"status": "ok", "fallback_providers": cfg["fallback_providers"], "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/config/reasoning")
def update_reasoning_config(req: ReasoningUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}
            
        if "agent" not in cfg:
            cfg["agent"] = {}
        cfg["agent"]["reasoning_effort"] = req.reasoning_effort
        if req.reasoning_overrides is not None:
            cfg["agent"]["reasoning_overrides"] = req.reasoning_overrides
            
        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)
        return {
            "status": "ok", 
            "reasoning_effort": cfg["agent"]["reasoning_effort"],
            "reasoning_overrides": cfg["agent"].get("reasoning_overrides", {}),
            "instance": inst_key
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/config/agent-model")
async def update_agent_model(req: AgentModelUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    clean_model = req.model.strip()
    if not clean_model:
        raise HTTPException(status_code=400, detail="Model cannot be empty")

    # Normalize fallback_models (up to 4)
    raw_fbs = req.fallback_models or []
    clean_fbs = [str(x).strip() for x in raw_fbs if x and str(x).strip() and str(x).strip().lower() not in ("none", "null")]
    if not clean_fbs and req.fallback_model and req.fallback_model.strip().lower() not in ("", "none", "null"):
        clean_fbs = [req.fallback_model.strip()]
    clean_fbs = clean_fbs[:4]

    # Always persist to universal specialists_override.json so CLI specialists (Agy, Claude, OpenCode, Codex) and War Room panelists stay in sync
    override_payload = {
        "model": clean_model,
        "fallback_models": clean_fbs,
        "fallback_model": clean_fbs[0] if clean_fbs else None
    }
    if req.engine:
        override_payload["engine"] = req.engine.lower().strip()
    save_specialist_override(req.agent_name, override_payload, instance_key=inst_key)

    # Also map short aliases (e.g. "Autonomous Claude" -> "claude", "Developer Agent" -> "agy")
    lower_agent = req.agent_name.lower().strip()
    if "claude" in lower_agent:
        save_specialist_override("claude", {"model": clean_model})
    elif "opencode" in lower_agent:
        save_specialist_override("opencode", {"model": clean_model})
    elif "agy" in lower_agent or (inst_key == "myvirtualcoder" and "developer" in lower_agent):
        save_specialist_override("agy", {"model": clean_model})
    elif "codex" in lower_agent:
        save_specialist_override("codex", {"model": clean_model})

    # If this fleet has a Hermes config.yaml and the agent is present in it, update config.yaml as well
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}

            found = False
            for a in cfg.get("agents", []):
                if a.get("name", "").lower() == lower_agent:
                    a["model"] = clean_model
                    if req.engine:
                        a["engine"] = req.engine.lower().strip()
                    if clean_fbs:
                        a["fallback_models"] = clean_fbs
                        a["fallback_model"] = clean_fbs[0]
                    else:
                        a.pop("fallback_models", None)
                        a.pop("fallback_model", None)
                    found = True
                    break

            if found:
                backup_file(cfg_file)
                with open(cfg_file, "w") as f:
                    yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
                set_instance_perms(cfg_file, inst_key)
        except Exception as e:
            print(f"[MODELS] Warning updating config.yaml for {req.agent_name}: {e}")

    # Persist custom model in engine catalog so it remains selectable in dropdowns
    resolved_engine = (req.engine or "").lower().strip()
    if not resolved_engine and lower_agent in ENGINE_DEFAULTS:
        resolved_engine = lower_agent
    if not resolved_engine and cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg_eng = yaml.safe_load(f) or {}
                for a in cfg_eng.get("agents", []):
                    if a.get("name", "").lower() == lower_agent and a.get("engine"):
                        resolved_engine = str(a["engine"]).lower().strip()
                        break
        except Exception:
            pass
    register_custom_model(resolved_engine or "hermes", clean_model)

    # Clear stale per-room overrides so global model changes take effect across War Rooms
    cleared_rooms = 0
    if req.clear_room_overrides:
        cleared_rooms = clear_agent_room_overrides(req.agent_name)

    await broadcast_event("agent_model_updated", {
        "agent": req.agent_name,
        "model": clean_model,
        "engine": req.engine,
        "fallback_model": clean_fbs[0] if clean_fbs else None,
        "fallback_models": clean_fbs,
        "instance": inst_key,
        "cleared_room_overrides": cleared_rooms
    })

    return {
        "status": "ok",
        "agent": req.agent_name,
        "model": clean_model,
        "fallback_model": clean_fbs[0] if clean_fbs else None,
        "fallback_models": clean_fbs,
        "instance": inst_key,
        "cleared_room_overrides": cleared_rooms
    }

@router.post("/api/config/global-model")
def update_global_model(req: GlobalModelUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}
            
        model_name = (req.default or req.model or "").strip()
        if not model_name:
            raise HTTPException(status_code=400, detail="Global default model cannot be empty")
        cfg["model"]["default"] = model_name
        if req.provider is not None:
            cfg["model"]["provider"] = req.provider.strip()
        if req.base_url is not None:
            cfg["model"]["base_url"] = req.base_url.strip()
            
        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)
        return {"status": "ok", "global_model": cfg["model"], "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/models/library")
def get_model_library(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    configured_models = set()
    reasoning_overrides = {}
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                reasoning_overrides = cfg.get("agent", {}).get("reasoning_overrides", {})
                if "model" in cfg and isinstance(cfg["model"], dict) and "default" in cfg["model"]:
                    configured_models.add(cfg["model"]["default"])
                for a in cfg.get("agents", []):
                    if a.get("model"):
                        configured_models.add(a["model"])
                    for fb in a.get("fallback_models", []):
                        configured_models.add(fb)
                for fb in cfg.get("fallback_providers", []):
                    if isinstance(fb, dict) and fb.get("model"):
                        configured_models.add(fb["model"])
        except Exception:
            pass

    library_items = []
    seen_ids = set()

    for spec in MODEL_LIBRARY_SPECS:
        s_id = spec["id"]
        seen_ids.add(s_id.lower())
        spec_copy = dict(spec)
        spec_copy["is_configured"] = any(s_id.lower() in m.lower() for m in configured_models)
        spec_copy["reasoning_effort"] = reasoning_overrides.get(s_id, "none")
        library_items.append(spec_copy)

    # Add any extra models configured in config.yaml that were not in the preset
    for m in configured_models:
        if m and m.lower() not in seen_ids and not any(spec["id"].lower() == m.lower() for spec in MODEL_LIBRARY_SPECS):
            spec = get_model_specs(m)
            spec["is_configured"] = True
            spec["reasoning_effort"] = reasoning_overrides.get(m, "none")
            library_items.append(spec)
            seen_ids.add(m.lower())

    return {"models": library_items, "instance": inst_key}

@router.get("/api/agents/memory-specs")
def get_agents_memory_specs(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}

        agents_data = []
        global_default_model = cfg.get("model", {}).get("default") or "nvidia/nemotron-3-ultra-550b-a55b"

        for a in cfg.get("agents", []):
            name = a.get("name", "Unknown")
            role = a.get("role", "Specialist Agent")
            model = a.get("model") or global_default_model
            workspace_dir = a.get("workspace_dir") or str(ctx["workspace"] / name.lower())
            w_path = Path(workspace_dir)

            total_bytes = 0
            total_chars = 0
            file_count = 0
            memory_file_bytes = 0
            memory_file_exists = False

            if w_path.exists() and w_path.is_dir():
                ignored_dirs = {".git", "node_modules", "venv", ".venv", "__pycache__", ".cache", ".local", ".npm", ".opencode", "dist", "build"}
                scanned_files = 0
                for root_str, dirs, files in os.walk(str(w_path)):
                    dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
                    for fname in files:
                        if scanned_files >= 400:
                            break
                        p = Path(root_str) / fname
                        file_count += 1
                        scanned_files += 1
                        try:
                            f_size = p.stat().st_size
                            total_bytes += f_size
                            if f_size < 512000 and p.suffix.lower() in (".md", ".txt", ".json", ".yaml", ".yml", ".py", ".js", ".html"):
                                if p.name == "MEMORY.md":
                                    memory_file_bytes = f_size
                                    memory_file_exists = True
                                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                                    total_chars += len(f.read())
                        except Exception:
                            pass
                    if scanned_files >= 400:
                        break

            estimated_tokens = max(round(total_chars / 4), 250) if total_chars else 250
            model_spec = get_model_specs(model)
            max_ctx = model_spec["max_context"]

            utilization = round((estimated_tokens / max_ctx) * 100, 2)
            if utilization < 40.0:
                health = "OPTIMAL"
                health_color = "emerald"
                recommendation = f"🟢 Optimal headroom ({utilization}%). Active memory fits comfortably inside {model_spec['name']}."
            elif utilization < 75.0:
                health = "ELEVATED"
                health_color = "amber"
                recommendation = f"🟡 Elevated memory footprint ({utilization}%). Consider summarizing older notes."
            else:
                health = "HIGH_RISK"
                health_color = "rose"
                recommendation = f"🔴 High context pressure ({utilization}%). Strongly recommend upgrading to Gemini 3.8 Flash (1M tokens)."

            if max_ctx <= 65536 and estimated_tokens > 25000:
                recommendation += " 💡 Nemotron's 65k context may fill up during multi-turn chats."

            agents_data.append({
                "name": name,
                "role": role,
                "model": model,
                "model_spec": model_spec,
                "workspace_dir": str(w_path),
                "file_count": file_count,
                "total_kb": round(total_bytes / 1024, 1),
                "memory_file_bytes": memory_file_bytes,
                "memory_file_exists": memory_file_exists,
                "estimated_tokens": estimated_tokens,
                "max_context": max_ctx,
                "max_context_label": model_spec["max_context_label"],
                "utilization_percent": utilization,
                "health": health,
                "health_color": health_color,
                "recommendation": recommendation
            })

        return {"agents": agents_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
