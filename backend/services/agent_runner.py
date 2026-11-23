import json
import time
import uuid
import asyncio
import subprocess
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from core.config import (
    discover_instances,
    get_instance_user_context,
    backup_file,
    set_instance_perms,
    broadcast_event,
    safe_path_exists
)

AGENT_STEP_TIMEOUT = 300  # Default 5 mins per step ceiling

# Cascading model profiles for DAG workflow steps:
# free_fast -> economical -> agent_default
DAG_MODEL_PROFILES: Dict[str, List[str]] = {
    "free_fast": [
        "groq/openai/gpt-oss-120b",
        "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "abacus/gemini-3.8-flash",
        "abacus/gpt-4.1-mini",
    ],
    "economical": [
        "abacus/gemini-3.8-flash",
        "abacus/gpt-4.1-mini",
    ],
    "strict_json": [
        "abacus/gpt-4.1-mini",
        "abacus/gemini-3.8-flash",
    ],
}


def resolve_step_model_candidates(
    model_profile: str,
    step_model: Optional[str],
    fleet_model: Optional[str],
) -> List[Optional[str]]:
    """Return ordered, deduplicated model candidates implementing free_fast -> economical -> agent_default."""
    profile = (model_profile or "agent_default").strip().lower()
    raw: List[Optional[str]] = []
    if step_model:
        raw.append(step_model)
    if profile in DAG_MODEL_PROFILES:
        raw.extend(DAG_MODEL_PROFILES[profile])
        if fleet_model:
            raw.append(fleet_model)
    else:
        if fleet_model:
            raw.append(fleet_model)
        raw.append("abacus/gemini-3.8-flash")

    seen = set()
    ordered: List[Optional[str]] = []
    for m in raw:
        if m and m not in seen:
            seen.add(m)
            ordered.append(m)
    return ordered or [None]

class WorkflowRunnerEngine:
    def __init__(self):
        self._active_runs: Dict[str, asyncio.Task] = {}
        self._approval_events: Dict[str, asyncio.Event] = {}

    def _get_runs_file(self, inst_key: str = "agents_bs") -> Path:
        ctx = get_instance_user_context(inst_key)
        return ctx["workspace"] / "workflow_runs.json"

    def get_runs(self, inst_key: str = "agents_bs", limit: int = 20) -> List[Dict[str, Any]]:
        runs_file = self._get_runs_file(inst_key)
        if not runs_file.exists():
            return []
        try:
            with open(runs_file, "r") as f:
                data = json.load(f)
            runs = data.get("runs", [])
            runs.sort(key=lambda r: r.get("started_at", ""), reverse=True)
            return runs[:limit]
        except Exception:
            return []

    def get_run(self, run_id: str, inst_key: str = "agents_bs") -> Optional[Dict[str, Any]]:
        runs = self.get_runs(inst_key, limit=100)
        return next((r for r in runs if r.get("run_id") == run_id), None)

    def _save_run_record(self, run_record: Dict[str, Any], inst_key: str = "agents_bs"):
        runs_file = self._get_runs_file(inst_key)
        try:
            runs_data = {"runs": []}
            if runs_file.exists():
                with open(runs_file, "r") as f:
                    runs_data = json.load(f)
            
            existing = runs_data.get("runs", [])
            idx = next((i for i, r in enumerate(existing) if r.get("run_id") == run_record.get("run_id")), None)
            if idx is not None:
                existing[idx] = run_record
            else:
                existing.insert(0, run_record)
            
            # Keep max 50 historical runs
            runs_data["runs"] = existing[:50]
            with open(runs_file, "w") as f:
                json.dump(runs_data, f, indent=2)
            set_instance_perms(runs_file, inst_key)
        except Exception as e:
            print(f"[WORKFLOW_RUNNER] Error persisting run record: {e}")

    async def start_workflow(self, workflow: Dict[str, Any], trigger_source: str = "manual", inst_key: str = "agents_bs") -> str:
        run_id = f"run_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        steps = workflow.get("steps", [])
        
        run_record = {
            "run_id": run_id,
            "workflow_id": workflow.get("id"),
            "workflow_name": workflow.get("name"),
            "status": "running",
            "execution_engine": "nexusdesk_dag",
            "execution_engine_label": "NexusDesk Multi-Agent DAG",
            "trigger_source": trigger_source,
            "engine_bridge": f"hermes_cron_{trigger_source}" if str(trigger_source).startswith("cron_") else "manual_ui",
            "started_at": datetime.now().isoformat(),
            "completed_at": None,
            "duration_seconds": 0.0,
            "current_step_order": 1,
            "total_steps": len(steps),
            "artifacts": {},
            "steps_history": [],
            "error": None
        }
        self._save_run_record(run_record, inst_key)

        # Launch background task
        task = asyncio.create_task(self._execute_workflow_task(run_id, workflow, inst_key))
        self._active_runs[run_id] = task
        return run_id

    async def approve_run_gate(self, run_id: str) -> bool:
        event = self._approval_events.get(run_id)
        if event:
            event.set()
            return True
        return False

    async def cancel_run(self, run_id: str, inst_key: str = "agents_bs") -> bool:
        task = self._active_runs.get(run_id)
        if task and not task.done():
            task.cancel()
            self._active_runs.pop(run_id, None)
            run_record = self.get_run(run_id, inst_key)
            if run_record:
                run_record["status"] = "cancelled"
                run_record["completed_at"] = datetime.now().isoformat()
                self._save_run_record(run_record, inst_key)
                await broadcast_event("workflow_step_status", {
                    "run_id": run_id,
                    "workflow_id": run_record["workflow_id"],
                    "status": "cancelled",
                    "instance": inst_key
                })
            return True
        return False

    async def _execute_workflow_task(self, run_id: str, workflow: Dict[str, Any], inst_key: str):
        ctx = get_instance_user_context(inst_key)
        start_time = time.time()
        steps = workflow.get("steps", [])
        wf_id = workflow.get("id")
        wf_name = workflow.get("name")

        wf_default_timeout = int(workflow.get("timeout_seconds") or AGENT_STEP_TIMEOUT)
        wf_model_profile = (workflow.get("model_profile") or "agent_default").strip().lower()

        await broadcast_event("workflow_run_started", {
            "run_id": run_id,
            "workflow_id": wf_id,
            "workflow_name": wf_name,
            "total_steps": len(steps),
            "default_timeout_seconds": wf_default_timeout,
            "model_profile": wf_model_profile,
            "instance": inst_key
        })

        run_record = self.get_run(run_id, inst_key) or {}
        accumulated_artifacts: Dict[str, Any] = {}

        try:
            for s in steps:
                order = s.get("order", 1)
                agent_name = s.get("agent", "Solaris")
                action_text = s.get("action", "")
                bound_skill = s.get("skill")
                approval_required = s.get("approval_required", False)
                step_timeout = int(s.get("timeout_seconds") or wf_default_timeout)
                step_model = (s.get("model") or "").strip() or None

                run_record["current_step_order"] = order
                self._save_run_record(run_record, inst_key)

                # Broadcast Step Starting
                await broadcast_event("workflow_step_status", {
                    "run_id": run_id,
                    "workflow_id": wf_id,
                    "step_order": order,
                    "agent": agent_name,
                    "status": "active",
                    "action": action_text,
                    "instance": inst_key
                })

                # Check Approval Gate before executing step if flagged
                if approval_required:
                    run_record["status"] = "paused_for_approval"
                    self._save_run_record(run_record, inst_key)
                    
                    approval_evt = asyncio.Event()
                    self._approval_events[run_id] = approval_evt

                    await broadcast_event("workflow_approval_gate", {
                        "run_id": run_id,
                        "workflow_id": wf_id,
                        "step_order": order,
                        "agent": agent_name,
                        "action": action_text,
                        "prompt": f"Approval required before {agent_name} executes: {action_text}",
                        "instance": inst_key
                    })

                    try:
                        # Wait up to 10 minutes for human approval
                        await asyncio.wait_for(approval_evt.wait(), timeout=600)
                    except asyncio.TimeoutError:
                        raise RuntimeError(f"Approval gate timed out after 10 minutes on Step {order}")
                    finally:
                        self._approval_events.pop(run_id, None)

                    run_record["status"] = "running"
                    self._save_run_record(run_record, inst_key)

                # Execute Step Agent Turn (fail-fast if step fails so downstream steps abort)
                step_start = time.time()
                try:
                    step_output = await self._run_agent_step(
                        agent_name=agent_name,
                        action_text=action_text,
                        bound_skill=bound_skill,
                        accumulated_artifacts=accumulated_artifacts,
                        workflow_name=wf_name,
                        step_order=order,
                        total_steps=len(steps),
                        ctx=ctx,
                        timeout_seconds=step_timeout,
                        model_profile=wf_model_profile,
                        step_model=step_model,
                    )
                except Exception as step_err:
                    step_duration = round(time.time() - step_start, 2)
                    err_str = str(step_err)
                    run_record["steps_history"].append({
                        "order": order,
                        "agent": agent_name,
                        "action": action_text,
                        "skill": bound_skill,
                        "timeout_seconds": step_timeout,
                        "status": "failed",
                        "duration_seconds": step_duration,
                        "output_preview": f"⚠️ {err_str[:380]}",
                        "completed_at": datetime.now().isoformat()
                    })
                    self._save_run_record(run_record, inst_key)
                    await broadcast_event("workflow_step_status", {
                        "run_id": run_id,
                        "workflow_id": wf_id,
                        "step_order": order,
                        "agent": agent_name,
                        "status": "failed",
                        "duration": step_duration,
                        "output_preview": err_str[:300],
                        "instance": inst_key
                    })
                    raise
                step_duration = round(time.time() - step_start, 2)

                # Store artifact
                accumulated_artifacts[f"step_{order}_{agent_name}"] = {
                    "agent": agent_name,
                    "action": action_text,
                    "output": step_output[:1000],
                    "completed_at": datetime.now().isoformat()
                }

                step_history_entry = {
                    "order": order,
                    "agent": agent_name,
                    "action": action_text,
                    "skill": bound_skill,
                    "timeout_seconds": step_timeout,
                    "status": "completed",
                    "duration_seconds": step_duration,
                    "output_preview": step_output[:400],
                    "completed_at": datetime.now().isoformat()
                }
                run_record["steps_history"].append(step_history_entry)
                run_record["artifacts"] = accumulated_artifacts
                self._save_run_record(run_record, inst_key)

                # Broadcast Step Complete
                await broadcast_event("workflow_step_status", {
                    "run_id": run_id,
                    "workflow_id": wf_id,
                    "step_order": order,
                    "agent": agent_name,
                    "status": "completed",
                    "duration": step_duration,
                    "output_preview": step_output[:300],
                    "instance": inst_key
                })

            # Pipeline Completed Successfully
            total_duration = round(time.time() - start_time, 2)
            run_record["status"] = "completed"
            run_record["completed_at"] = datetime.now().isoformat()
            run_record["duration_seconds"] = total_duration
            self._save_run_record(run_record, inst_key)
            _update_dag_cron_status(ctx, inst_key, run_record.get("trigger_source", ""), "ok")

            await broadcast_event("workflow_run_completed", {
                "run_id": run_id,
                "workflow_id": wf_id,
                "workflow_name": wf_name,
                "total_duration": total_duration,
                "steps_completed": len(steps),
                "instance": inst_key
            })

        except asyncio.CancelledError:
            run_record["status"] = "cancelled"
            run_record["completed_at"] = datetime.now().isoformat()
            self._save_run_record(run_record, inst_key)
        except Exception as e:
            err_msg = str(e)
            try:
                from routers.self_evolving import record_telemetry_event
                record_telemetry_event(
                    category="Engine & Timeouts",
                    pillar="workflows",
                    source="workflows",
                    summary=f"Workflow '{wf_name}' step {run_record.get('current_step_order', 1)} failed: {err_msg[:120]}",
                    details=err_msg,
                    affected_files=["backend/services/agent_runner.py"],
                    instance=inst_key
                )
            except Exception:
                pass
            run_record["status"] = "failed"
            run_record["error"] = err_msg
            run_record["completed_at"] = datetime.now().isoformat()
            self._save_run_record(run_record, inst_key)
            _update_dag_cron_status(ctx, inst_key, run_record.get("trigger_source", ""), "error", err_msg[:300])

            await broadcast_event("workflow_run_failed", {
                "run_id": run_id,
                "workflow_id": wf_id,
                "error": err_msg,
                "failed_step": run_record.get("current_step_order", 1),
                "instance": inst_key
            })

            # Notify operator on Telegram if a scheduled cron-triggered DAG run fails
            if str(run_record.get("trigger_source", "")).startswith("cron_"):
                try:
                    failed_step = run_record.get("current_step_order", 1)
                    alert_msg = (
                        f"⚠️ Scheduled DAG Workflow Failed\n"
                        f"• Workflow: {wf_name} ({wf_id})\n"
                        f"• Run ID: {run_id}\n"
                        f"• Failed Step: {failed_step}/{len(steps)}\n"
                        f"• Error: {err_msg[:300]}"
                    )
                    proc = await asyncio.create_subprocess_exec(
                        "/usr/local/bin/send_telegram", "-a", "WorkflowRunner", "-m", alert_msg
                    )
                    await asyncio.wait_for(proc.wait(), timeout=20)
                except Exception as notify_err:
                    print(f"[WORKFLOW_RUNNER] Failed to send Telegram failure alert: {notify_err}")
        finally:
            self._active_runs.pop(run_id, None)

    async def _run_agent_step(
        self,
        agent_name: str,
        action_text: str,
        bound_skill: Optional[str],
        accumulated_artifacts: Dict[str, Any],
        workflow_name: str,
        step_order: int,
        total_steps: int,
        ctx: Dict[str, Any],
        timeout_seconds: Optional[int] = None,
        model_profile: str = "agent_default",
        step_model: Optional[str] = None,
    ) -> str:
        # Load skill text dynamically from disk if bound
        skill_context = ""
        if bound_skill:
            skill_paths = [
                ctx["home"] / "skills" / bound_skill / "SKILL.md",
                ctx["home"] / "skills" / f"{bound_skill}.md",
                ctx["home"] / "profiles" / agent_name.lower() / "skills" / bound_skill / "SKILL.md"
            ]
            for sp in skill_paths:
                if sp.exists():
                    try:
                        skill_context = f"\n\n--- OPERATIONAL SKILL INSTRUCTIONS ({bound_skill}) ---\n{sp.read_text()[:4000]}\n--------------------------------------------------"
                        break
                    except Exception:
                        pass

        # Build handover payload context
        handover_text = ""
        if accumulated_artifacts:
            handover_blocks = []
            for k, v in accumulated_artifacts.items():
                handover_blocks.append(f"[{v['agent']} - {v['action']}]: {v['output'][:350]}")
            handover_text = "\n\n--- PRIOR WORKFLOW STEP OUTPUTS & ARTIFACTS ---\n" + "\n".join(handover_blocks) + "\n-----------------------------------------------"

        directive = (
            f"You are {agent_name}. You are executing Step {step_order} of {total_steps} in the multi-agent workflow: '{workflow_name}'.\n"
            f"NexusDesk Platform Environment:\n"
            f"- Workspace & Sandboxes: Host REST API active at http://127.0.0.1:9200.\n"
            f"- WhatsApp Outbound Dispatch: To send a WhatsApp message or file to operator Min, execute: `send_whatsapp -m \"<message text>\" [-f \"/path/to/media\"]`.\n"
            f"- Telegram Outbound Dispatch: To send a Telegram message or file to operator Min, execute: `send_telegram -m \"<message text>\" [-f \"/path/to/media\"]`.\n"
            f"- Ambiguity Clarification Protocol (BL-EVO-35): If your assigned task is underspecified, ambiguous, or lacks essential content/recipient details, "
            f"DO NOT send empty test messages, fake placeholders, or unbacked compliance pings. "
            f"State clearly what is missing, what options exist, and what clarification is needed before proceeding.\n\n"
            f"Your Assigned Task:\n{action_text}\n"
            f"{handover_text}"
            f"{skill_context}\n\n"
            f"Instructions:\n"
            f"1. Execute your step concisely and deterministically.\n"
            f"2. Summarize what you performed, the artifacts produced, and hand off clearly for Step {step_order + 1}."
        )

        # Look up agent participant metadata (engine, model, user context) across the fleet
        agent_engine = "hermes"
        agent_model = None
        target_ctx = ctx

        try:
            from services.war_room.participants import get_all_conference_participants
            all_participants = get_all_conference_participants()
            matched_agent = next((a for a in all_participants if a.get("name", "").lower() == agent_name.lower()), None)
            if matched_agent:
                agent_engine = matched_agent.get("engine", "hermes")
                agent_model = matched_agent.get("model")
                agent_user = matched_agent.get("user")
                if agent_user and agent_user != ctx.get("user"):
                    target_ctx = get_instance_user_context(agent_user)
        except Exception as e:
            print(f"[WORKFLOW_RUNNER] Warning resolving agent metadata for {agent_name}: {e}")

        ws_dir = str(target_ctx["workspace"] / agent_name.lower())
        Path(ws_dir).mkdir(parents=True, exist_ok=True)
        set_instance_perms(Path(ws_dir), target_ctx.get("instance_key", "agents_bs"))

        session_name = f"wf_step_{agent_name.lower()}_{int(time.time())}"

        effective_timeout = float(timeout_seconds if timeout_seconds is not None else AGENT_STEP_TIMEOUT)
        candidates = (
            resolve_step_model_candidates(model_profile, step_model, agent_model)
            if agent_engine == "hermes"
            else [step_model or agent_model]
        )

        from services.cli_executor import run_agent_cli
        reply = None
        err = None
        for idx, chosen_model in enumerate(candidates[:4]):
            sess = session_name if idx == 0 else f"{session_name}_fb{idx}"
            reply, err = await run_agent_cli(
                agent_name=agent_name,
                agent_engine=agent_engine,
                agent_model=chosen_model,
                prompt=directive,
                ctx=target_ctx,
                workspace_dir=ws_dir,
                session_name=sess,
                timeout_seconds=effective_timeout
            )
            if reply or not err:
                break
            if idx + 1 < len(candidates[:4]):
                next_model = candidates[idx + 1]
                print(
                    f"[WORKFLOW_RUNNER] ⚡ Model '{chosen_model}' failed ({err[:80]}). "
                    f"Falling back to '{next_model}' for {agent_name} step {step_order}..."
                )

        if err and not reply:
            raise RuntimeError(f"{agent_name} step {step_order} failed: {err}")
        return reply or f"{agent_name} executed step successfully."

# Global Singleton Runner
workflow_runner = WorkflowRunnerEngine()


def load_dag_crons(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Load NexusDesk-managed DAG cron schedules from workspace/dag_crons.json."""
    dag_file = ctx["workspace"] / "dag_crons.json"
    if not dag_file.exists():
        return {"jobs": [], "updated_at": None}
    try:
        with open(dag_file, "r") as f:
            data = json.load(f)
        if "jobs" not in data:
            data["jobs"] = []
        return data
    except Exception:
        return {"jobs": [], "updated_at": None}


def save_dag_crons(ctx: Dict[str, Any], data: Dict[str, Any], inst_key: str):
    """Persist NexusDesk-managed DAG cron schedules to workspace/dag_crons.json."""
    dag_file = ctx["workspace"] / "dag_crons.json"
    dag_file.parent.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.now().isoformat()
    with open(dag_file, "w") as f:
        json.dump(data, f, indent=2)
    set_instance_perms(dag_file, inst_key)


def _update_dag_cron_status(
    ctx: Dict[str, Any],
    inst_key: str,
    trigger_source: str,
    status: str,
    error: Optional[str] = None,
):
    """Update dag_crons.json last_status, last_error, and failure_streak on run completion/failure."""
    if not str(trigger_source).startswith("cron_"):
        return
    job_id = str(trigger_source)[len("cron_"):]
    try:
        data = load_dag_crons(ctx)
        for job in data.get("jobs", []):
            if job.get("id") == job_id:
                job["last_status"] = status
                job["last_error"] = error
                job["failure_streak"] = 0 if status == "ok" else int(job.get("failure_streak") or 0) + 1
                save_dag_crons(ctx, data, inst_key)
                break
    except Exception as e:
        print(f"[WORKFLOW_CRON] Failed to update status for {job_id}: {e}")


def reconcile_interrupted_runs():
    """
    On startup, mark any orphaned 'running' or 'paused_for_approval' workflow runs
    in workflow_runs.json as 'interrupted' so the Run Monitor never shows zombie runs.
    """
    try:
        instances = discover_instances()
        for inst_key in instances.keys():
            ctx = get_instance_user_context(inst_key)
            runs_file = ctx["workspace"] / "workflow_runs.json"
            if not runs_file.exists():
                continue
            try:
                with open(runs_file, "r") as f:
                    runs_data = json.load(f)
                changed = False
                for r in runs_data.get("runs", []):
                    if r.get("status") in ("running", "paused_for_approval"):
                        r["status"] = "interrupted"
                        r["error"] = "Interrupted by NexusDesk service restart"
                        r["completed_at"] = datetime.now().isoformat()
                        changed = True
                if changed:
                    with open(runs_file, "w") as f:
                        json.dump(runs_data, f, indent=2)
                    set_instance_perms(runs_file, inst_key)
                    print(f"🧹 [WORKFLOW_RUNNER] Reconciled orphaned workflow runs for '{inst_key}'.")
            except Exception as inst_err:
                print(f"[WORKFLOW_RUNNER] Failed reconciling runs for {inst_key}: {inst_err}")
    except Exception as e:
        print(f"[WORKFLOW_RUNNER] Startup run reconciliation error: {e}")


async def workflow_cron_watcher():
    """
    Background scheduler that evaluates NexusDesk DAG crons (workspace/dag_crons.json)
    every 20 seconds using croniter (with 15-min catch-up window) and dispatches due workflows.
    """
    reconcile_interrupted_runs()

    try:
        from croniter import croniter
    except ImportError:
        print("[WORKFLOW_CRON] croniter not installed; DAG cron watcher disabled.")
        return

    print("⏰ [WORKFLOW_CRON] NexusDesk DAG Cron Watcher started (20s poll, 15m catch-up).")
    while True:
        try:
            now = datetime.now()
            instances = discover_instances()
            for inst_key in instances.keys():
                try:
                    ctx = get_instance_user_context(inst_key)
                    data = load_dag_crons(ctx)
                    jobs = data.get("jobs", [])
                    if not jobs:
                        continue

                    modified = False
                    workflows_cache: Optional[List[Dict[str, Any]]] = None

                    for job in jobs:
                        if job.get("enabled", True) is False:
                            continue
                        wf_id = job.get("workflow_id")
                        expr = (job.get("schedule") or {}).get("expr") or job.get("schedule_display")
                        if not wf_id or not expr:
                            continue

                        try:
                            itr = croniter(expr, now + timedelta(seconds=1))
                            prev_fire = itr.get_prev(datetime)
                            slot_key = prev_fire.strftime("%Y-%m-%dT%H:%M")
                            age_sec = (now - prev_fire).total_seconds()
                        except Exception as e:
                            print(f"[WORKFLOW_CRON] Invalid cron expr '{expr}' for {job.get('id')}: {e}")
                            continue

                        if 0 <= age_sec <= 900 and job.get("last_dispatched_slot") != slot_key:
                            if workflows_cache is None:
                                wf_file = ctx["workspace"] / "workflows.json"
                                workflows_cache = []
                                if wf_file.exists():
                                    try:
                                        with open(wf_file, "r") as wf_f:
                                            workflows_cache = json.load(wf_f).get("workflows", [])
                                    except Exception:
                                        workflows_cache = []

                            target_wf = next((w for w in workflows_cache if w.get("id") == wf_id), None)
                            if not target_wf:
                                job["last_status"] = "error"
                                job["last_error"] = f"Workflow '{wf_id}' not found"
                                job["last_dispatched_slot"] = slot_key
                                modified = True
                                continue

                            # Stamp dispatch BEFORE launching to prevent double-fire
                            job["last_dispatched_slot"] = slot_key
                            job["last_run_at"] = now.isoformat()
                            job["last_status"] = "ok"
                            job["last_error"] = None
                            try:
                                next_dt = croniter(expr, now + timedelta(seconds=61)).get_next(datetime)
                                job["next_run_at"] = next_dt.astimezone().isoformat()
                            except Exception:
                                pass
                            modified = True

                            job_id = job.get("id", "dag_cron")
                            job_name = job.get("name", wf_id)
                            print(f"⏰ [WORKFLOW_CRON] Firing DAG cron '{job_name}' ({job_id}) -> workflow '{wf_id}' [slot {slot_key}]")
                            await broadcast_event("cron_trigger", {"job_id": job_id, "name": job_name, "workflow_id": wf_id, "instance": inst_key})
                            await workflow_runner.start_workflow(
                                target_wf,
                                trigger_source=f"cron_{job_id}",
                                inst_key=inst_key
                            )

                    if modified:
                        save_dag_crons(ctx, data, inst_key)
                except Exception as inst_err:
                    print(f"[WORKFLOW_CRON] Error checking instance {inst_key}: {inst_err}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[WORKFLOW_CRON] Loop error: {e}")

        await asyncio.sleep(20)
