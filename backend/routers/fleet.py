import yaml
import psutil
import subprocess
import asyncio
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Request, Query, HTTPException
from core.config import (
    APP_VERSION,
    get_app_version,
    get_build_id,
    discover_instances,
    get_instance_user_context,
    detect_user_engines,
    resolve_fleet_primary_engine,
    get_engine_active_model,
    get_specialist_overrides,
    broadcast_event
)

router = APIRouter(tags=["fleet"])

@router.get("/api/version")
async def get_version_info():
    """Return canonical NexusDesk semantic version and frontend build ID."""
    return {
        "name": "NexusDesk",
        "version": get_app_version(),
        "build": get_build_id(),
    }

@router.get("/api/system")
async def get_system_health():
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    return {
        "version": get_app_version(),
        "build": get_build_id(),
        "cpu_percent": psutil.cpu_percent(interval=None),
        "ram_used_mb": round(vm.used / (1024 * 1024), 1),
        "ram_total_mb": round(vm.total / (1024 * 1024), 1),
        "ram_percent": vm.percent,
        "disk_percent": disk.percent,
        "disk_free_gb": round(disk.free / (1024 * 1024 * 1024), 1),
    }

@router.get("/api/system/daemon/status")
def get_daemon_status():
    """Retrieve live systemd daemon status for nexusdesk."""
    try:
        proc = subprocess.run(
            ["systemctl", "is-active", "nexusdesk"],
            capture_output=True,
            text=True,
            timeout=5
        )
        is_active = (proc.stdout.strip() == "active")
        
        # Get uptime / start info
        show_proc = subprocess.run(
            ["systemctl", "show", "nexusdesk", "--property=ActiveEnterTimestamp,MainPID,MemoryCurrent"],
            capture_output=True,
            text=True,
            timeout=5
        )
        props = {}
        for line in show_proc.stdout.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                props[k.strip()] = v.strip()
        
        mem_bytes = int(props.get("MemoryCurrent", 0)) if props.get("MemoryCurrent", "").isdigit() else 0
        mem_mb = round(mem_bytes / (1024 * 1024), 1) if mem_bytes > 0 else None

        return {
            "service": "nexusdesk.service",
            "active": is_active,
            "status": proc.stdout.strip() or "unknown",
            "pid": props.get("MainPID"),
            "started_at": props.get("ActiveEnterTimestamp"),
            "memory_mb": mem_mb
        }
    except Exception as e:
        return {
            "service": "nexusdesk.service",
            "active": True,
            "status": "running",
            "error": str(e)
        }

@router.get("/api/system/daemon/logs")
def get_daemon_logs(lines: int = 40):
    """Fetch recent systemd journal logs for the nexusdesk daemon."""
    num_lines = min(max(lines, 10), 200)
    try:
        proc = subprocess.run(
            ["sudo", "-n", "journalctl", "-u", "nexusdesk", "-n", str(num_lines), "--no-pager"],
            capture_output=True,
            text=True,
            timeout=6
        )
        output = proc.stdout.strip()
        if not output and proc.stderr:
            output = proc.stderr.strip()
        return {"service": "nexusdesk.service", "logs": output or "No logs available."}
    except Exception as e:
        return {"service": "nexusdesk.service", "logs": f"Failed to retrieve logs: {e}"}

@router.post("/api/system/restart")
async def restart_nexusdesk_daemon():
    """
    Restart the NexusDesk systemd daemon safely.
    Dispatches the restart in a detached background subprocess after a short delay
    so the HTTP response finishes cleanly before the process is killed.
    """
    await broadcast_event("system_restarting", {
        "message": "NexusDesk daemon restart requested by operator. Reloading in 1s...",
        "service": "nexusdesk.service"
    })

    # Spawn background restart script detached from current process group
    restart_script = (
        "sleep 0.8 && "
        "sudo -n systemctl restart nexusdesk || "
        "sudo -n /etc/init.d/nexusdesk restart"
    )
    subprocess.Popen(
        ["nohup", "bash", "-c", restart_script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=getattr(subprocess, "setpgrp", None)
    )

    return {
        "status": "restarting",
        "message": "NexusDesk service restart initiated. UI will automatically reconnect upon startup.",
        "reconnect_delay_ms": 3000
    }


@router.get("/api/instances")
def list_instances():
    all_instances = discover_instances()
    result = []
    for k in all_instances:
        ctx = get_instance_user_context(k)
        cfg_path = ctx["home"] / "config.yaml"
        exists = cfg_path.exists()
        agent_count = 0
        if exists:
            try:
                with open(cfg_path, "r") as f:
                    data = yaml.safe_load(f) or {}
                    agent_count = len(data.get("agents", []))
            except Exception:
                pass
        
        engines = detect_user_engines(ctx["user"])
        is_online = any(e.get("daemon_running") for e in engines.values())
        running_engine_count = sum(1 for e in engines.values() if e.get("daemon_running"))
        active_engine_count = sum(1 for e in engines.values() if e.get("daemon_running") or e.get("installed"))

        result.append({
            "key": k,
            "user": ctx["user"],
            "uid": ctx["uid"],
            "label": ctx["label"],
            "badge": ctx["badge"],
            "color": ctx["color"],
            "home": str(ctx["home"]),
            "workspace": str(ctx["workspace"]),
            "has_hermes_config": exists,
            "agent_count": agent_count,
            "is_online": is_online,
            "running_engine_count": running_engine_count,
            "engines": engines,
            "active_engine_count": active_engine_count
        })
    return {"instances": result, "default": "agents_bs"}

@router.get("/api/fleet")
def get_fleet_status():
    status = {}
    all_instances = discover_instances()
    for key in all_instances:
        ctx = get_instance_user_context(key)
        home = ctx["home"]
        cfg_file = home / "config.yaml"
        cron_file = home / "cron" / "jobs.json"
        
        cfg = {}
        if cfg_file.exists():
            try:
                with open(cfg_file, "r") as f:
                    cfg = yaml.safe_load(f) or {}
            except Exception:
                pass
                
        cron_count = 0
        if cron_file.exists():
            try:
                with open(cron_file, "r") as f:
                    import json
                    crons = json.load(f).get("jobs", [])
                    cron_count = len(crons)
            except Exception:
                pass
                
        primary_eng, _, _ = resolve_fleet_primary_engine(ctx["user"])
        overrides = get_specialist_overrides()

        agents = []
        for a in cfg.get("agents", []):
            a_name = a.get("name") or ""
            eng_val = (a.get("engine") or primary_eng).lower().strip()
            model_val = a.get("model")
            role_val = a.get("role")
            ov = overrides.get(f"{key.lower()}:{a_name.lower()}") or overrides.get(a_name.lower())
            if isinstance(ov, dict):
                if ov.get("model"):
                    model_val = ov["model"]
                if ov.get("engine"):
                    eng_val = ov["engine"]
                if ov.get("role"):
                    role_val = ov["role"]

            agents.append({
                "name": a_name,
                "role": role_val,
                "model": model_val,
                "fallback_model": a.get("fallback_model"),
                "workspace_dir": a.get("workspace_dir"),
                "engine": eng_val
            })

        engines = detect_user_engines(ctx["user"])
        is_online = any(e.get("daemon_running") or e.get("installed") for e in engines.values())

        # Synthesize Default Primary Agents for any active or installed engines if no config.yaml exists
        if not agents and is_online:
            # Check all running daemons first, or installed engines
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

            # Generate individual specialist agents for each active engine (e.g. Claude, OpenCode)
            for eng_id in active_engine_keys:
                eng_meta = engines.get(eng_id, {})
                eng_label = eng_meta.get("name") or eng_id.capitalize()
                
                # Format a distinct readable agent name
                if len(active_engine_keys) == 1:
                    def_name = f"{ctx['label'].split()[0]} Agent" if ctx.get("label") else f"{eng_label} Specialist"
                else:
                    def_name = f"{ctx['label'].split()[0]} {eng_label.split()[0]}" if ctx.get("label") else f"{eng_label} Agent"

                active_model = get_engine_active_model(eng_id, ctx["user"], agent_name=def_name)
                ov = overrides.get(f"{key.lower()}:{def_name.lower()}") or overrides.get(def_name.lower()) or overrides.get(eng_id.lower())
                role_str = f"Autonomous {eng_label} Specialist & Command Console"
                if isinstance(ov, dict):
                    if ov.get("model"):
                        active_model = ov["model"]
                    if ov.get("role"):
                        role_str = ov["role"]

                agents.append({
                    "name": def_name,
                    "role": role_str,
                    "model": active_model,
                    "fallback_model": None,
                    "workspace_dir": str(ctx["workspace"]),
                    "engine": eng_id
                })

        resolved_model = cfg.get("model", {}).get("default") or cfg.get("default_model")
        if not resolved_model and is_online:
            resolved_model = get_engine_active_model(primary_eng, ctx["user"])
        elif not resolved_model:
            resolved_model = "none"

        status[key] = {
            "key": key,
            "label": ctx["label"],
            "user": ctx["user"],
            "uid": ctx["uid"],
            "badge": ctx["badge"],
            "home": str(home),
            "agents_count": len(agents),
            "agents": agents,
            "cron_count": cron_count,
            "primary_model": resolved_model,
            "fallback_chain": cfg.get("fallback_providers", []),
            "engines": engines,
            "is_online": is_online
        }
    return status

@router.post("/api/fleet/initialize")
def initialize_fleet_workspace(request: Request, instance: Optional[str] = None):
    from core.config import resolve_instance_key, set_instance_perms
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)

    created_paths = []
    # 1. Ensure .hermes directory and default config.yaml exist
    home_dir = ctx["home"]
    if not home_dir.exists():
        home_dir.mkdir(parents=True, exist_ok=True)
        set_instance_perms(home_dir, inst_key)
        created_paths.append(str(home_dir))

    cfg_file = home_dir / "config.yaml"
    if not cfg_file.exists():
        default_cfg = {
            "model": {"default": "poolside/laguna-s-2.1:free", "provider": "abacus"},
            "fallback_providers": [],
            "agents": []
        }
        with open(cfg_file, "w") as f:
            yaml.dump(default_cfg, f, default_flow_style=False)
        set_instance_perms(cfg_file, inst_key)
        created_paths.append(str(cfg_file))

    # 2. Ensure root workspace and agent subdirectories exist
    ws_root = ctx["workspace"]
    if not ws_root.exists():
        ws_root.mkdir(parents=True, exist_ok=True)
        set_instance_perms(ws_root, inst_key)
        created_paths.append(str(ws_root))

    # Check agents in config or synthesize default agent
    try:
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}
    except Exception:
        cfg = {}

    agents = cfg.get("agents", [])
    if not agents:
        def_name = f"{ctx['label'].split()[0]} Agent" if ctx.get("label") else "Default Agent"
        agents = [{"name": def_name, "role": "Primary Autonomous Specialist & Command Console"}]

    for ag in agents:
        raw_name = ag.get("name", "agent")
        import re
        slug = re.sub(r'[^a-zA-Z0-9_\-]', '_', raw_name.lower().strip())
        ag_ws = ag.get("workspace_dir") or (ws_root / slug)
        ag_path = Path(ag_ws)
        if not ag_path.exists():
            ag_path.mkdir(parents=True, exist_ok=True)
            set_instance_perms(ag_path, inst_key)
            created_paths.append(str(ag_path))

        # Ensure starter memory
        mem_dir = ag_path / "memory"
        if not mem_dir.exists():
            mem_dir.mkdir(parents=True, exist_ok=True)
            set_instance_perms(mem_dir, inst_key)
        mem_file = mem_dir / "MEMORY.md"
        if not mem_file.exists():
            mem_file.write_text(f"# {raw_name} Memory\n\nRole: {ag.get('role', 'Autonomous Specialist')}\nInitialized via NexusDesk.\n", encoding="utf-8")
            set_instance_perms(mem_file, inst_key)
            created_paths.append(str(mem_file))

    return {
        "status": "initialized",
        "instance": inst_key,
        "user": ctx["user"],
        "workspace": str(ws_root),
        "created_paths": created_paths
    }

