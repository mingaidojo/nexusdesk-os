import json
import time
import uuid
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any
from fastapi import APIRouter, Request, HTTPException, Query
from core.config import (
    resolve_instance_key,
    get_instance_user_context,
    backup_file,
    set_instance_perms,
    broadcast_event
)
from services.cron_formatter import format_cron_schedule
from services.agent_runner import workflow_runner, load_dag_crons, save_dag_crons
from services.ai_architect import ai_architect
from schemas.models import CronUpdateRequest, CronCreateRequest

router = APIRouter(tags=["workflows_crons"])

DEFAULT_WORKFLOWS = [
    {
        "id": "content_pipeline",
        "name": "BibleStoryApp Daily Content Pipeline",
        "description": "Autonomous multi-agent research, storyboard crafting, and community publishing pipeline",
        "steps": [
            {"order": 1, "agent": "Solaris", "action": "Initiate daily pipeline, establish devotional theme, target scripture passage & audience"},
            {"order": 2, "agent": "Lore", "action": "Research scripture accuracy, theological cross-references & historical context"},
            {"order": 3, "agent": "Chroma", "action": "Generate 4-step story script, character cast locking & visual prompt boards"},
            {"order": 4, "agent": "Chorusius", "action": "Draft community discussion questions, Instagram carousel copy & engagement challenges"},
            {"order": 5, "agent": "Solaris", "action": "Quality assurance check, synthesize output & approve publishing payload"}
        ]
    },
    {
        "id": "support_escalation",
        "name": "Customer Support & Triage Escalation",
        "description": "Email inbox polling, ticket triage, and automated routing to target specialists",
        "steps": [
            {"order": 1, "agent": "Scribe", "action": "Fetch new incoming support emails and categorize (Vendor, Tech, Faith, Feedback)"},
            {"order": 2, "agent": "Pylon", "action": "Investigate server uptime / database logs if ticket relates to login or sync issues"},
            {"order": 3, "agent": "Lore", "action": "Verify theological accuracy if ticket disputes scripture interpretation"},
            {"order": 4, "agent": "Scribe", "action": "Compose empathetic bilingual response and dispatch Telegram alert to Min"}
        ]
    },
    {
        "id": "sysadmin_patrol",
        "name": "VPS Infrastructure Health Patrol",
        "description": "Continuous health monitoring of Docker containers, RAM RSS, mailcow & Supabase",
        "steps": [
            {"order": 1, "agent": "Pylon", "action": "Check docker service status (mailcow, supabase, postgres)"},
            {"order": 2, "agent": "Pylon", "action": "Monitor system RAM and disk consumption thresholds"},
            {"order": 3, "agent": "Solaris", "action": "Synthesize infrastructure report and alert Telegram on anomalies"}
        ]
    }
]

def _load_merged_cron_jobs(ctx: Dict[str, Any]):
    """Load and merge Hermes native crons (jobs.json) and NexusDesk DAG crons (dag_crons.json)."""
    hermes_jobs = []
    updated_at = None
    cron_file = ctx["home"] / "cron" / "jobs.json"
    if cron_file.exists():
        try:
            with open(cron_file, "r") as f:
                hdata = json.load(f)
            hermes_jobs = hdata.get("jobs", [])
            updated_at = hdata.get("updated_at")
        except Exception:
            pass

    dag_data = load_dag_crons(ctx)
    dag_jobs = dag_data.get("jobs", [])
    return hermes_jobs + dag_jobs, (dag_data.get("updated_at") or updated_at)


def _locate_cron_job_store(ctx: Dict[str, Any], job_id: str):
    """Return ('dag', dag_data, target_job) or ('hermes', hermes_data, target_job) or (None, None, None)."""
    dag_data = load_dag_crons(ctx)
    target = next((j for j in dag_data.get("jobs", []) if j.get("id") == job_id), None)
    if target is not None:
        return "dag", dag_data, target

    cron_file = ctx["home"] / "cron" / "jobs.json"
    if cron_file.exists():
        with open(cron_file, "r") as f:
            hdata = json.load(f)
        target = next((j for j in hdata.get("jobs", []) if j.get("id") == job_id), None)
        if target is not None:
            return "hermes", hdata, target
    return None, None, None


@router.get("/api/crons")
def get_crons(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    try:
        jobs, updated_at = _load_merged_cron_jobs(ctx)
        enriched = []
        for j in jobs:
            sched = j.get("schedule", {})
            timing = format_cron_schedule(sched if sched else j.get("schedule_display", ""))
            enriched_job = dict(j)
            enriched_job["schedule_human"] = timing["human_schedule"]
            enriched_job["next_execution"] = timing["next_execution"]
            enriched_job["next_countdown"] = timing["countdown"]
            enriched_job["computed_next_run"] = timing["next_run_iso"]

            # Engine classification
            is_dag = (j.get("target_type") == "workflow" or bool(j.get("workflow_id")))
            enriched_job["engine_type"] = "nexusdesk_dag" if is_dag else "hermes_native"
            enriched_job["engine_label"] = "NexusDesk Multi-Agent DAG" if is_dag else "Hermes Native Cron"
            enriched.append(enriched_job)

        # Tier 3: Unified Global Visibility across all War Room Schedulers
        try:
            from services.war_room.schedules import get_room_schedules, list_system_crontabs_readonly

            for wrs in get_room_schedules("all"):
                tgts = ", ".join(f"@{t}" for t in (wrs.get("targets") or [])) or "@room"
                enriched.append({
                    "id": wrs.get("id"),
                    "name": f"[#{wrs.get('room_name') or wrs.get('room_id')}] {wrs.get('title')}",
                    "title": wrs.get("title"),
                    "prompt": wrs.get("prompt"),
                    "agent": tgts,
                    "room_id": wrs.get("room_id"),
                    "room_name": wrs.get("room_name") or wrs.get("room_id"),
                    "mode": wrs.get("mode"),
                    "frequency": wrs.get("frequency"),
                    "created_by": wrs.get("created_by"),
                    "schedule": {"expr": wrs.get("frequency", "daily")},
                    "schedule_display": wrs.get("schedule_human"),
                    "schedule_human": wrs.get("schedule_human"),
                    "next_execution": wrs.get("next_run_display") or "Scheduled",
                    "next_run_at": wrs.get("next_run_iso"),
                    "computed_next_run": wrs.get("next_run_iso"),
                    "last_status": wrs.get("last_status") or ("SCHEDULED" if wrs.get("enabled", True) else "PAUSED"),
                    "enabled": wrs.get("enabled", True),
                    "engine_type": "war_room_schedule",
                    "engine_label": "War Room Scheduler",
                })

            # Tier 1: Strictly read-only VPS / Linux OS crontab audit
            enriched.extend(list_system_crontabs_readonly())
        except Exception as rollup_e:
            print(f"[CRONS_ROLLUP] Warning collecting War Room / VPS crons: {rollup_e}")

        return {"jobs": enriched, "updated_at": updated_at, "instance": inst_key}
    except Exception as e:
        return {"error": str(e), "jobs": [], "instance": inst_key}

@router.post("/api/crons/{job_id}/toggle")
def toggle_cron_job(job_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    try:
        store_type, data, target_job = _locate_cron_job_store(ctx, job_id)
        if target_job is None:
            raise HTTPException(status_code=404, detail="Job ID not found")

        target_job["enabled"] = not target_job.get("enabled", True)
        new_state = target_job["enabled"]

        if store_type == "dag":
            save_dag_crons(ctx, data, inst_key)
        else:
            cron_file = ctx["home"] / "cron" / "jobs.json"
            backup_file(cron_file)
            data["updated_at"] = datetime.now().isoformat()
            with open(cron_file, "w") as f:
                json.dump(data, f, indent=2)
            set_instance_perms(cron_file, inst_key)
        return {"status": "ok", "job_id": job_id, "enabled": new_state, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/crons/{job_id}/trigger")
async def trigger_cron_job(job_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    try:
        _, _, target_job = _locate_cron_job_store(ctx, job_id)
        if not target_job:
            raise HTTPException(status_code=404, detail="Job ID not found")
            
        job_name = target_job.get("name", "cron_job")
        
        # Broadcast trigger event
        await broadcast_event("cron_trigger", {"job_id": job_id, "name": job_name, "instance": inst_key})
        
        target_type = target_job.get("target_type")
        workflow_id = target_job.get("workflow_id")

        # If job is mapped to a DAG workflow, execute via WorkflowRunnerEngine
        if target_type == "workflow" and workflow_id:
            wf_file = ctx["workspace"] / "workflows.json"
            workflows = DEFAULT_WORKFLOWS
            if wf_file.exists():
                try:
                    with open(wf_file, "r") as wf_f:
                        wf_data = json.load(wf_f)
                        workflows = wf_data.get("workflows", DEFAULT_WORKFLOWS)
                except Exception:
                    pass
            target_wf = next((w for w in workflows if w.get("id") == workflow_id), None)
            if target_wf:
                run_id = await workflow_runner.start_workflow(
                    target_wf,
                    trigger_source=f"cron_{job_id}",
                    inst_key=inst_key
                )
                await broadcast_event("cron_complete", {"job_id": job_id, "name": job_name, "workflow_run_id": run_id, "returncode": 0, "instance": inst_key})
                return {"status": "triggered", "job_id": job_id, "name": job_name, "workflow_run_id": run_id, "instance": inst_key}

        # Otherwise run asynchronously via hermes cron run <job_id> followed by immediate tick
        async def _run():
            cmd = f"sudo -u {ctx['user']} XDG_RUNTIME_DIR={ctx['xdg_runtime']} /usr/local/bin/hermes cron run --accept-hooks {job_id} && sudo -u {ctx['user']} XDG_RUNTIME_DIR={ctx['xdg_runtime']} /usr/local/bin/hermes cron tick --accept-hooks"
            proc = await asyncio.create_subprocess_shell(cmd)
            await proc.wait()
            await broadcast_event("cron_complete", {"job_id": job_id, "name": job_name, "returncode": proc.returncode, "instance": inst_key})

        asyncio.create_task(_run())
        return {"status": "triggered", "job_id": job_id, "name": job_name, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/crons/{job_id}/update")
def update_cron_job(job_id: str, req: CronUpdateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    try:
        store_type, data, target_job = _locate_cron_job_store(ctx, job_id)
        if not target_job:
            raise HTTPException(status_code=404, detail="Job ID not found")
            
        if req.name is not None:
            target_job["name"] = req.name
        if req.prompt is not None:
            target_job["prompt"] = req.prompt
        if req.enabled is not None:
            target_job["enabled"] = req.enabled
        if req.target_type is not None:
            target_job["target_type"] = req.target_type
        if req.workflow_id is not None:
            target_job["workflow_id"] = req.workflow_id
        elif req.target_type == "prompt":
            target_job.pop("workflow_id", None)
        if req.schedule_expr is not None:
            if "schedule" not in target_job:
                target_job["schedule"] = {}
            target_job["schedule"]["expr"] = req.schedule_expr
            target_job["schedule"]["display"] = req.schedule_expr
            target_job["schedule_display"] = req.schedule_expr

        wants_dag = (target_job.get("target_type") == "workflow" or bool(target_job.get("workflow_id")))
        cron_file = ctx["home"] / "cron" / "jobs.json"

        if store_type == "hermes" and wants_dag:
            # Move from Hermes jobs.json to NexusDesk dag_crons.json so Hermes doesn't run it as raw prompt
            data["jobs"] = [j for j in data.get("jobs", []) if j.get("id") != job_id]
            backup_file(cron_file)
            data["updated_at"] = datetime.now().isoformat()
            with open(cron_file, "w") as f:
                json.dump(data, f, indent=2)
            set_instance_perms(cron_file, inst_key)

            dag_data = load_dag_crons(ctx)
            dag_data["jobs"].append(target_job)
            save_dag_crons(ctx, dag_data, inst_key)
        elif store_type == "dag" and not wants_dag:
            # Move from dag_crons.json back to Hermes jobs.json
            data["jobs"] = [j for j in data.get("jobs", []) if j.get("id") != job_id]
            save_dag_crons(ctx, data, inst_key)

            if cron_file.exists():
                backup_file(cron_file)
                with open(cron_file, "r") as f:
                    hdata = json.load(f)
            else:
                hdata = {"jobs": []}
            hdata.setdefault("jobs", []).append(target_job)
            hdata["updated_at"] = datetime.now().isoformat()
            with open(cron_file, "w") as f:
                json.dump(hdata, f, indent=2)
            set_instance_perms(cron_file, inst_key)
        elif store_type == "dag":
            save_dag_crons(ctx, data, inst_key)
        else:
            backup_file(cron_file)
            data["updated_at"] = datetime.now().isoformat()
            with open(cron_file, "w") as f:
                json.dump(data, f, indent=2)
            set_instance_perms(cron_file, inst_key)

        return {"status": "updated", "job": target_job, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/crons/create")
def create_cron_job(req: CronCreateRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    try:
        is_dag = (req.target_type == "workflow" or bool(req.workflow_id))
        job_id = str(uuid.uuid4())[:12]
        new_job = {
            "id": job_id,
            "name": req.name,
            "prompt": req.prompt,
            "enabled": req.enabled,
            "target_type": "workflow" if is_dag else "prompt",
            "workflow_id": req.workflow_id if is_dag else None,
            "schedule": {
                "kind": "cron",
                "expr": req.schedule_expr,
                "display": req.schedule_expr
            },
            "schedule_display": req.schedule_expr,
            "created_at": datetime.now().isoformat(),
            "last_status": "scheduled",
            "workdir": str(ctx["workspace"] / "orchestrator")
        }

        if is_dag:
            dag_data = load_dag_crons(ctx)
            dag_data["jobs"].append(new_job)
            save_dag_crons(ctx, dag_data, inst_key)
        else:
            cron_file = ctx["home"] / "cron" / "jobs.json"
            if not cron_file.exists():
                raise HTTPException(status_code=404, detail=f"jobs.json not found for instance {inst_key}")
            backup_file(cron_file)
            with open(cron_file, "r") as f:
                data = json.load(f)
            if "jobs" not in data:
                data["jobs"] = []
            data["jobs"].append(new_job)
            data["updated_at"] = datetime.now().isoformat()
            with open(cron_file, "w") as f:
                json.dump(data, f, indent=2)
            set_instance_perms(cron_file, inst_key)

        return {"status": "created", "job": new_job, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/crons/{job_id}")
def delete_cron_job(job_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    try:
        store_type, data, target_job = _locate_cron_job_store(ctx, job_id)
        if not target_job:
            raise HTTPException(status_code=404, detail="Job ID not found")

        data["jobs"] = [j for j in data.get("jobs", []) if j.get("id") != job_id]
        if store_type == "dag":
            save_dag_crons(ctx, data, inst_key)
        else:
            cron_file = ctx["home"] / "cron" / "jobs.json"
            backup_file(cron_file)
            data["updated_at"] = datetime.now().isoformat()
            with open(cron_file, "w") as f:
                json.dump(data, f, indent=2)
            set_instance_perms(cron_file, inst_key)
        return {"status": "deleted", "job_id": job_id, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/workflows")
def get_workflows(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    wf_file = ctx["workspace"] / "workflows.json"
    raw_workflows = DEFAULT_WORKFLOWS
    if wf_file.exists():
        try:
            with open(wf_file, "r") as f:
                wf_data = json.load(f)
                raw_workflows = wf_data.get("workflows", DEFAULT_WORKFLOWS)
        except Exception:
            raw_workflows = DEFAULT_WORKFLOWS

    # Find linked crons from both jobs.json and dag_crons.json to cross-reference pipelines
    linked_crons_map = {}
    try:
        merged_jobs, _ = _load_merged_cron_jobs(ctx)
        for j in merged_jobs:
            wf_target = j.get("workflow_id")
            if wf_target:
                sched = j.get("schedule", {})
                timing = format_cron_schedule(sched if sched else j.get("schedule_display", ""))
                linked_crons_map[wf_target] = {
                    "cron_id": j.get("id"),
                    "cron_name": j.get("name"),
                    "enabled": j.get("enabled", True),
                    "schedule_human": timing.get("human_schedule", ""),
                    "schedule_expr": sched.get("expr", j.get("schedule_display", ""))
                }
    except Exception:
        pass

    enriched_workflows = []
    for w in raw_workflows:
        w_dict = dict(w)
        w_dict["engine"] = "nexusdesk_dag"
        w_dict["engine_label"] = "NexusDesk Multi-Agent DAG"
        w_dict["linked_cron"] = linked_crons_map.get(w.get("id"))
        enriched_workflows.append(w_dict)

    return {"workflows": enriched_workflows, "instance": inst_key}

@router.post("/api/workflows")
def save_workflows(req: Dict[str, Any], request: Request):
    inst_key = resolve_instance_key(request, req.get("instance"))
    ctx = get_instance_user_context(inst_key)
    wf_file = ctx["workspace"] / "workflows.json"
    try:
        backup_file(wf_file)
        with open(wf_file, "w") as f:
            json.dump(req, f, indent=2)
        set_instance_perms(wf_file, inst_key)
        return {"status": "saved", "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/workflows/create")
def create_workflow(req: Dict[str, Any], request: Request):
    inst_key = resolve_instance_key(request, req.get("instance"))
    ctx = get_instance_user_context(inst_key)
    wf_file = ctx["workspace"] / "workflows.json"
    try:
        backup_file(wf_file)
        data = {"workflows": []}
        if wf_file.exists():
            with open(wf_file, "r") as f:
                data = json.load(f)
        
        workflows = data.get("workflows", [])
        new_id = req.get("id") or f"wf_{int(time.time())}"
        req["id"] = new_id
        workflows.append(req)
        data["workflows"] = workflows
        with open(wf_file, "w") as f:
            json.dump(data, f, indent=2)
        set_instance_perms(wf_file, inst_key)
        return {"status": "created", "workflow": req, "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/workflows/{wf_id}")
def update_workflow(wf_id: str, req: Dict[str, Any], request: Request):
    inst_key = resolve_instance_key(request, req.get("instance"))
    ctx = get_instance_user_context(inst_key)
    wf_file = ctx["workspace"] / "workflows.json"
    try:
        backup_file(wf_file)
        data = {"workflows": []}
        if wf_file.exists():
            with open(wf_file, "r") as f:
                data = json.load(f)
        
        workflows = data.get("workflows", [])
        found = False
        for i, wf in enumerate(workflows):
            if wf.get("id") == wf_id:
                req["id"] = wf_id
                workflows[i] = req
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Workflow not found")
            
        data["workflows"] = workflows
        with open(wf_file, "w") as f:
            json.dump(data, f, indent=2)
        set_instance_perms(wf_file, inst_key)
        return {"status": "updated", "workflow": req, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/workflows/{wf_id}")
def delete_workflow(wf_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    wf_file = ctx["workspace"] / "workflows.json"
    try:
        backup_file(wf_file)
        data = {"workflows": []}
        if wf_file.exists():
            with open(wf_file, "r") as f:
                data = json.load(f)
        
        workflows = data.get("workflows", [])
        initial_len = len(workflows)
        workflows = [wf for wf in workflows if wf.get("id") != wf_id]
        if len(workflows) == initial_len:
            raise HTTPException(status_code=404, detail="Workflow not found")
            
        data["workflows"] = workflows
        with open(wf_file, "w") as f:
            json.dump(data, f, indent=2)
        set_instance_perms(wf_file, inst_key)
        return {"status": "deleted", "id": wf_id, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/workflows/{wf_id}/trigger")
async def trigger_workflow(wf_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    wf_file = ctx["workspace"] / "workflows.json"
    
    workflows = DEFAULT_WORKFLOWS
    if wf_file.exists():
        try:
            with open(wf_file, "r") as f:
                data = json.load(f)
                workflows = data.get("workflows", DEFAULT_WORKFLOWS)
        except Exception:
            pass
            
    target_wf = next((w for w in workflows if w.get("id") == wf_id), None)
    if not target_wf:
        # Fallback check across all fleet instances before failing with 404
        for other_key in ["agents_bs", "myvirtualcoder", "freecoder", "thecodexer", "desktop"]:
            if other_key == inst_key:
                continue
            try:
                other_ctx = get_instance_user_context(other_key)
                other_file = other_ctx["workspace"] / "workflows.json"
                if other_file.exists():
                    other_data = json.loads(other_file.read_text(encoding="utf-8"))
                    other_wf = next((w for w in other_data.get("workflows", []) if w.get("id") == wf_id), None)
                    if other_wf:
                        target_wf = other_wf
                        inst_key = other_key
                        break
            except Exception:
                pass

    if not target_wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
        
    # Start actual asynchronous execution through WorkflowRunnerEngine
    run_id = await workflow_runner.start_workflow(target_wf, trigger_source="manual", inst_key=inst_key)
    steps_count = len(target_wf.get("steps", []))
    lead_agent = target_wf.get("steps", [{}])[0].get("agent", "Solaris")
    
    return {
        "status": "triggered",
        "run_id": run_id,
        "workflow_id": wf_id,
        "name": target_wf.get("name"),
        "steps_count": steps_count,
        "lead_agent": lead_agent,
        "message": f"Dispatched multi-agent execution pipeline for '{target_wf.get('name')}' with {steps_count} steps. Handover starting with {lead_agent}."
    }


@router.get("/api/workflows/runs")
def list_workflow_runs(request: Request, limit: int = Query(20), instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    runs = workflow_runner.get_runs(inst_key=inst_key, limit=limit)
    return {"runs": runs, "instance": inst_key}


@router.get("/api/workflows/runs/{run_id}")
def get_workflow_run_detail(run_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    run_record = workflow_runner.get_run(run_id, inst_key=inst_key)
    if not run_record:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return {"run": run_record, "instance": inst_key}


@router.post("/api/workflows/runs/{run_id}/approve")
async def approve_workflow_gate(run_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    approved = await workflow_runner.approve_run_gate(run_id)
    if not approved:
        raise HTTPException(status_code=400, detail="No active approval gate waiting for this run ID")
    return {"status": "approved", "run_id": run_id, "instance": inst_key}


@router.post("/api/workflows/runs/{run_id}/cancel")
async def cancel_workflow_run(run_id: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    cancelled = await workflow_runner.cancel_run(run_id, inst_key=inst_key)
    if not cancelled:
        raise HTTPException(status_code=400, detail="Cannot cancel: run is either not active or already finished")
    return {"status": "cancelled", "run_id": run_id, "instance": inst_key}


@router.post("/api/workflows/ai/draft")
async def ai_draft_workflow(req: Dict[str, Any], request: Request):
    inst_key = resolve_instance_key(request, req.get("instance"))
    directive = req.get("directive", "").strip()
    if not directive:
        raise HTTPException(status_code=400, detail="Directive prompt cannot be empty")
        
    ctx = get_instance_user_context(inst_key)
    # Collect fleet agent names
    agents_list = []
    cfg_file = ctx["home"] / "config.yaml"
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                agents_list = [a.get("name") for a in cfg.get("agents", []) if a.get("name")]
        except Exception:
            pass
            
    try:
        loop = asyncio.get_event_loop()
        draft = await loop.run_in_executor(
            None,
            lambda: ai_architect.draft_workflow(directive, available_agents=agents_list, inst_key=inst_key)
        )
        return {"status": "success", "workflow": draft, "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



