"""
NexusDesk Unified Multi-Engine CLI Execution Service
Consolidates subprocess execution for `hermes`, `claude`, `opencode`, `codex`, and `agy`
with standardized timeouts, fallbacks, output sanitization, and error telemetry.
Part of BL-ARCH-32 full-stack modularization.
"""

import asyncio
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

from core.config import AGENT_SUBPROCESS_TIMEOUT, safe_path_exists, broadcast_event

# Registry of active child subprocesses by room/session key for real-time operator interruption (BL-WAR-38)
ACTIVE_AGENT_PROCS: Dict[str, asyncio.subprocess.Process] = {}

_PROC_SEQ = 0

def _force_kill_proc(proc: asyncio.subprocess.Process) -> None:
    """SIGKILL escalation for children that ignored SIGTERM."""
    if proc.returncode is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), 9)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

def _terminate_proc(proc: asyncio.subprocess.Process) -> bool:
    """SIGTERM the child's process group, then escalate to SIGKILL after a short grace period."""
    if proc.returncode is not None:
        return False
    try:
        os.killpg(os.getpgid(proc.pid), 15)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    try:
        asyncio.get_running_loop().call_later(3.0, _force_kill_proc, proc)
    except RuntimeError:
        pass
    return True

def kill_room_agent_proc(room_or_session_key: str) -> bool:
    """
    Terminates EVERY active child subprocess registered under the given room/session key.
    (Multiple agents can run concurrently in one room, e.g. a chain turn plus a background return turn.)
    """
    killed = False
    prefix = f"{room_or_session_key}#"
    for reg_key, proc in list(ACTIVE_AGENT_PROCS.items()):
        if reg_key == room_or_session_key or reg_key.startswith(prefix):
            if _terminate_proc(proc):
                killed = True
    return killed

def has_active_room_proc(room_or_session_key: str) -> bool:
    """True if any child subprocess is still running for this room/session key."""
    prefix = f"{room_or_session_key}#"
    return any(
        (k == room_or_session_key or k.startswith(prefix)) and p.returncode is None
        for k, p in ACTIVE_AGENT_PROCS.items()
    )

def list_active_room_procs() -> List[Dict[str, Any]]:
    """Returns metadata for all live agent subprocesses across all rooms for concurrency monitoring."""
    active = []
    for reg_key, p in list(ACTIVE_AGENT_PROCS.items()):
        if p.returncode is None:
            # Parse room from key formatted as "{room_id}#{seq}"
            room_id = reg_key.split("#")[0] if "#" in reg_key else reg_key
            active.append({
                "key": reg_key,
                "room_id": room_id,
                "pid": p.pid,
                "running": True
            })
    return active

def _inspect_proc_group_activity(pgid: int, room_id: Optional[str], start_ts: float) -> Tuple[Optional[str], bool]:
    """
    BL-EVO-25: Inspects /proc for active child tool processes in the agent's process group (pgid)
    and checks sandbox scratch/deliverables for modified files since turn start.
    Returns: (human_readable_activity, has_real_activity)
    """
    latest_file_activity = None
    if room_id:
        for sub in ("deliverables", "scratch"):
            sdir = Path(f"/home/nexus_shared/sandboxes/{room_id}/{sub}")
            if sdir.exists():
                try:
                    for fp in sdir.iterdir():
                        if fp.name in ("search_web.py", "fuzzy_match_helper.py") or fp.name.startswith("error_"):
                            continue
                        mtime = fp.stat().st_mtime
                        if mtime >= start_ts - 0.5:
                            latest_file_activity = f"Writing {sub}/{fp.name}"
                except Exception:
                    pass

    child_cmds = []
    try:
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            pid = int(entry)
            if pid == pgid:
                continue
            try:
                with open(f"/proc/{pid}/stat", "r") as sf:
                    stat_str = sf.read()
                rpar = stat_str.rfind(")")
                fields = stat_str[rpar+2:].split()
                if len(fields) >= 3 and int(fields[2]) == pgid:
                    with open(f"/proc/{pid}/cmdline", "rb") as cf:
                        raw = cf.read().replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
                    if raw:
                        child_cmds.append((pid, raw))
            except Exception:
                continue
    except Exception:
        pass

    # Filter out wrapper commands (sudo, hermes chat, claude -p, codex exec, agy -p, opencode run)
    tool_cmds = []
    for pid, cmd_str in child_cmds:
        lower = cmd_str.lower()
        if any(w in lower for w in ("sudo -u", "hermes chat", "/claude -p", "codex exec", "/agy -p", "opencode run")):
            continue
        # Clean up long inline scripts for concise UI display
        short_cmd = re.sub(r'\s+', ' ', cmd_str).strip()
        if "python3 -c" in short_cmd or "python -c" in short_cmd:
            short_cmd = "Running inline Python analysis script..."
        elif "/bin/bash -c" in short_cmd or "sh -c" in short_cmd:
            inner = short_cmd.split("-c", 1)[-1].strip()
            short_cmd = f"Running shell: {inner[:65]}..." if len(inner) > 65 else f"Running shell: {inner}"
        elif len(short_cmd) > 70:
            short_cmd = short_cmd[:67] + "..."
        tool_cmds.append((pid, short_cmd))

    if tool_cmds:
        tool_cmds.sort(key=lambda x: x[0], reverse=True)
        return f"⚙️ {tool_cmds[0][1]}", True

    if latest_file_activity:
        return f"📝 {latest_file_activity}", True

    return None, False

def _inspect_proc_group_io_rchar(pgid: int) -> int:
    """
    BL-EVO-28: Sums /proc/<pid>/io 'rchar' (read character bytes) across all processes
    belonging to the agent's process group (pgid) to detect live network socket or file read throughput.
    """
    total_rchar = 0
    try:
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            pid = int(entry)
            try:
                with open(f"/proc/{pid}/stat", "r") as sf:
                    stat_str = sf.read()
                rpar = stat_str.rfind(")")
                fields = stat_str[rpar+2:].split()
                if len(fields) >= 3 and int(fields[2]) == pgid:
                    with open(f"/proc/{pid}/io", "r") as iof:
                        for line in iof:
                            if line.startswith("rchar:"):
                                total_rchar += int(line.split(":")[1].strip())
                                break
            except Exception:
                continue
    except Exception:
        pass
    return total_rchar

async def _run_tracked_proc(
    cmd: List[str],
    cwd: str,
    proc_key: str,
    timeout_seconds: float,
    soft_timeout_seconds: Optional[float] = None,
    room_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    agent_engine: Optional[str] = None,
    agent_model: Optional[str] = None
) -> Tuple[bytes, bytes, bool]:
    """
    Spawns a child, registers it under a unique per-process key (so concurrent agents in the same room
    never overwrite each other), waits for completion and kills the whole process group on timeout or
    cancellation.
    BL-WAR-47 Pillar 3: Supports graceful soft-timeout interception (sends SIGINT at soft_timeout_seconds
    to allow child CLI processes to flush stdout/stderr buffers before hard termination).
    BL-EVO-25: Streams live agent subprocess telemetry (`war_room_speaker_activity`) every 2.5s and
    aborts dead upstream LLM streams after 75s of zero activity.
    Returns: (stdout_bytes, stderr_bytes, was_soft_intercepted)
    """
    global _PROC_SEQ
    _PROC_SEQ += 1
    reg_key = f"{proc_key}#{_PROC_SEQ}"
    start_ts = time.time()
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
        start_new_session=True
    )
    ACTIVE_AGENT_PROCS[reg_key] = proc

    stdout_chunks: List[bytes] = []
    stderr_chunks: List[bytes] = []

    async def _read_stream(stream: Optional[asyncio.StreamReader], chunks: List[bytes]):
        if not stream:
            return
        try:
            while True:
                data = await stream.read(4096)
                if not data:
                    break
                chunks.append(data)
        except Exception:
            pass

    stdout_reader = asyncio.create_task(_read_stream(proc.stdout, stdout_chunks))
    stderr_reader = asyncio.create_task(_read_stream(proc.stderr, stderr_chunks))

    was_soft_intercepted = False
    dead_provider_stalled = False
    soft_limit = soft_timeout_seconds if (soft_timeout_seconds and soft_timeout_seconds < timeout_seconds) else None

    async def _soft_interceptor():
        nonlocal was_soft_intercepted
        if not soft_limit:
            return
        try:
            await asyncio.sleep(soft_limit)
            if proc.returncode is None:
                was_soft_intercepted = True
                print(f"[CLI_EXECUTOR] 🛡️ BL-WAR-47 Soft-Timeout Interceptor triggered at {int(soft_limit)}s for {reg_key} (PID {proc.pid}). Sending SIGINT to flush buffers...")
                try:
                    os.killpg(os.getpgid(proc.pid), 2)  # SIGINT (Ctrl+C)
                except Exception:
                    pass
                await asyncio.sleep(5.0)
                if proc.returncode is None:
                    _terminate_proc(proc)
        except asyncio.CancelledError:
            pass

    async def _telemetry_and_stall_poller():
        nonlocal was_soft_intercepted, dead_provider_stalled
        if not room_id or not agent_name:
            return
        ever_had_real_activity = False
        last_io_rchar = _inspect_proc_group_io_rchar(proc.pid)
        last_io_advance_time = start_ts
        eng_lower = (agent_engine or "").lower().strip()
        # BL-EVO-28: Streaming engines (hermes, codex, opencode) expect early tokens (75s).
        # Buffered non-streaming CLI engines (agy, claude text mode) receive data over sockets while generating (150s).
        stall_threshold_sec = 150.0 if eng_lower in ("agy", "claude") else 75.0

        try:
            while proc.returncode is None:
                await asyncio.sleep(2.5)
                if proc.returncode is not None:
                    break
                elapsed = time.time() - start_ts
                proc_activity, has_proc_or_file = _inspect_proc_group_activity(proc.pid, room_id, start_ts)
                if has_proc_or_file:
                    ever_had_real_activity = True

                # Inspect /proc/<pid>/io read character throughput to detect active incoming data
                curr_io_rchar = _inspect_proc_group_io_rchar(proc.pid)
                if curr_io_rchar > last_io_rchar + 1024:  # At least 1KB data advance
                    last_io_rchar = curr_io_rchar
                    last_io_advance_time = time.time()
                    ever_had_real_activity = True

                # Inspect stdout/stderr stream progress beyond initial CLI banner lines
                out_raw = b"".join(stdout_chunks).decode("utf-8", errors="replace")
                clean_lines = [
                    l.strip() for l in out_raw.splitlines()
                    if l.strip()
                    and not l.strip().startswith("Normalized model")
                    and not l.strip().startswith("↻ Resumed session")
                    and not l.strip().startswith("Session ")
                    and not l.strip().startswith("OpenAI Codex")
                    and not l.strip().startswith("--------")
                    and not l.strip().startswith("workdir:")
                    and not l.strip().startswith("model:")
                    and not l.strip().startswith("provider:")
                ]
                if clean_lines:
                    ever_had_real_activity = True

                if proc_activity:
                    activity_label = proc_activity
                elif clean_lines:
                    last_line = re.sub(r'[#*`<>\[\]]+', '', clean_lines[-1]).strip()
                    if len(last_line) > 68:
                        last_line = last_line[:65] + "..."
                    activity_label = f"✍️ {last_line}" if last_line else "✍️ Generating response..."
                elif elapsed < 12:
                    activity_label = f"🧠 Initializing {agent_engine.upper() if agent_engine else 'CLI'} context & analyzing transcript..."
                elif elapsed < 35:
                    activity_label = "🔎 Evaluating data schema & formulating response..."
                else:
                    activity_label = "⏳ Processing reasoning stream..."

                if room_id:
                    try:
                        # BL-EVO-27: Stream live activity without exposing model name
                        await broadcast_event("war_room_speaker_activity", {
                            "room_id": room_id,
                            "agent": agent_name,
                            "engine": (agent_engine or "").upper(),
                            "elapsed": int(elapsed),
                            "activity": activity_label
                        })
                    except Exception:
                        pass

                # BL-EVO-25 & BL-EVO-28: Per-Engine, Data-Flow Aware Dead-Provider Stall Guard
                # Aborts ONLY if there is zero stdout, zero child tool procs, zero file writes AND zero I/O throughput for stall_threshold_sec
                io_stalled_duration = time.time() - last_io_advance_time
                if elapsed >= stall_threshold_sec and not ever_had_real_activity and io_stalled_duration >= stall_threshold_sec:
                    dead_provider_stalled = True
                    was_soft_intercepted = True
                    print(f"[CLI_EXECUTOR] ⚡ BL-EVO-28 Dead-Provider Stall Guard triggered at {int(elapsed)}s for {agent_name} [{agent_engine}] in {room_id or 'workflow'}. Aborting for failover...")
                    _terminate_proc(proc)
                    break
        except asyncio.CancelledError:
            pass

    soft_task = asyncio.create_task(_soft_interceptor()) if soft_limit else None
    telemetry_task = asyncio.create_task(_telemetry_and_stall_poller()) if agent_name else None

    try:
        await asyncio.wait_for(proc.wait(), timeout=timeout_seconds)
        await asyncio.gather(stdout_reader, stderr_reader, return_exceptions=True)
        return b"".join(stdout_chunks), b"".join(stderr_chunks), was_soft_intercepted
    except asyncio.TimeoutError:
        _terminate_proc(proc)
        await asyncio.sleep(0.5)
        stdout_reader.cancel()
        stderr_reader.cancel()
        out_b = b"".join(stdout_chunks)
        err_b = b"".join(stderr_chunks)
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=timeout_seconds, output=out_b, stderr=err_b)
    except asyncio.CancelledError:
        _terminate_proc(proc)
        stdout_reader.cancel()
        stderr_reader.cancel()
        raise
    finally:
        if soft_task:
            soft_task.cancel()
        if telemetry_task:
            telemetry_task.cancel()
        ACTIVE_AGENT_PROCS.pop(reg_key, None)

def find_engine_binary(engine: str, user: str) -> Optional[str]:
    """Locate the executable path for a given agent CLI engine."""
    candidates = []
    if engine == "claude":
        candidates = [
            Path(f"/home/{user}/.local/bin/claude"),
            Path("/usr/local/bin/claude"),
            Path("/usr/bin/claude"),
            Path("/home/freecoder/.local/bin/claude")
        ]
    elif engine == "agy":
        candidates = [
            Path(f"/home/{user}/.local/bin/agy"),
            Path("/usr/local/bin/agy"),
            Path("/usr/bin/agy"),
            Path("/home/myvirtualcoder/.local/bin/agy")
        ]
    elif engine == "opencode":
        candidates = [
            Path(f"/home/{user}/.opencode/bin/opencode"),
            Path(f"/home/{user}/.local/bin/opencode"),
            Path("/usr/local/bin/opencode"),
            Path("/usr/bin/opencode"),
            Path("/home/freecoder/.opencode/bin/opencode")
        ]
    elif engine == "codex":
        candidates = [
            Path(f"/home/{user}/.local/bin/codex"),
            Path("/usr/local/bin/codex"),
            Path("/usr/bin/codex")
        ]
    elif engine == "hermes":
        candidates = [
            Path(f"/home/{user}/.local/bin/hermes"),
            Path("/usr/local/bin/hermes"),
            Path("/usr/bin/hermes")
        ]

    for p in candidates:
        if safe_path_exists(p):
            return str(p)

    which_val = shutil.which(engine)
    if which_val:
        return which_val

    # Default fallbacks
    if engine == "claude":
        return "/home/freecoder/.local/bin/claude"
    if engine == "agy":
        return "/home/myvirtualcoder/.local/bin/agy"
    if engine == "opencode":
        return "/home/freecoder/.opencode/bin/opencode"
    return None

def sanitize_engine_output(raw_output: str, engine: str, agent_name: str) -> str:
    """Strip CLI banners, telemetry lines, session IDs, and extract true assistant replies."""
    lines: List[str] = []
    if engine == "codex":
        # Extract everything after the final 'codex' output delimiter if present
        codex_blocks = re.findall(r'(?:^|\n)codex\s*\n(.*?)(?=\n(?:codex|tokens used|\Z))', raw_output, re.DOTALL | re.IGNORECASE)
        if codex_blocks:
            # Pick the last codex conversational block (excluding internal 'exec' blocks)
            for block in reversed(codex_blocks):
                clean_b = block.strip()
                if clean_b and not clean_b.startswith("exec\n") and not clean_b.startswith("/bin/bash"):
                    # Strip any inline exec telemetry inside the block
                    clean_b = re.sub(r'exec\s*\n[^\n]+\s*in\s+[^\n]+\s*succeeded in \d+ms:.*?(?=\n\n|\Z)', '', clean_b, flags=re.DOTALL)
                    return clean_b.strip()

        # Fallback line-by-line filtering
        for l in raw_output.split("\n"):
            line_str = l.strip()
            if (line_str.startswith("OpenAI Codex") or
                line_str.startswith("--------") or
                line_str.startswith("workdir:") or
                line_str.startswith("model:") or
                line_str.startswith("provider:") or
                line_str.startswith("approval:") or
                line_str.startswith("sandbox:") or
                line_str.startswith("reasoning ") or
                line_str.startswith("session id:") or
                line_str.startswith("warning:") or
                line_str.startswith("Reading additional input from stdin") or
                line_str.startswith("tokens used") or
                line_str.startswith("exec") or
                line_str.startswith("/bin/bash") or
                line_str.startswith("succeeded in ")):
                continue
            lines.append(l)
        return "\n".join(lines).strip() or f"Directive processed by {agent_name} [CODEX]."
    else:
        for l in raw_output.split("\n"):
            line_str = l.strip()
            if (line_str.startswith("CLI exposure failed:") or
                line_str.startswith("Hermes Agent, by Nous Research.") or
                "Normalized model" in line_str or
                line_str.startswith("⚠️ Warning: config file") or
                line_str.endswith("for nvidia.") or
                line_str.endswith("for nous.") or
                line_str.startswith("Session ") or
                line_str.startswith("session_id:") or
                line_str.startswith("↻ Resumed session")):
                continue
            lines.append(l)
        return "\n".join(lines).strip() or f"Directive processed by {agent_name} [{engine.upper()}]."

EXHAUSTION_PATTERNS = [
    r"rate_limit_error",
    r"ratelimiterror",
    r"rate limit exceeded",
    r"429\s+too\s+many\s+requests",
    r"credit_balance_too_low",
    r"credit balance is too low",
    r"insufficient_quota",
    r"you exceeded your current quota",
    r"resource_exhausted",
    r"quota_exceeded",
    r"out of credits",
    r"billing_hard_limit_reached",
    r"payment_required",
    r"context_length_exceeded",
    r"maximum context length",
    r"cuda out of memory",
]

def is_token_or_quota_exhausted(text: str) -> bool:
    """BL-WAR-47 Pillar 4: Universal AI Token / Credit / Rate-Limit Exhaustion detector across all engines."""
    if not text:
        return False
    lower = text.lower()
    for pat in EXHAUSTION_PATTERNS:
        if re.search(pat, lower):
            return True
    return False

async def run_agent_cli(
    agent_name: str,
    agent_engine: str,
    agent_model: Optional[str],
    prompt: str,
    ctx: Dict[str, Any],
    workspace_dir: str,
    session_name: Optional[str] = None,
    extra_env: Optional[Dict[str, str]] = None,
    timeout_seconds: float = AGENT_SUBPROCESS_TIMEOUT,
    fallback_claude_model: Optional[str] = "claude-sonnet-5-5",
    room_id: Optional[str] = None,
    soft_timeout_seconds: Optional[float] = 1800.0
) -> Tuple[str, Optional[str]]:
    """
    Executes an agent CLI invocation under the target Linux user context with timeout and fallbacks.
    Returns: (sanitized_reply, error_message_if_any)
    """
    exec_cwd = str(workspace_dir)
    extra_env = extra_env or {}
    env_args = [f"{k}={v}" for k, v in extra_env.items()]

    if agent_engine == "claude":
        claude_bin = find_engine_binary("claude", ctx["user"])
        cmd = ["sudo", "-u", ctx["user"], "-H"] + env_args + [
            "--",
            claude_bin,
            "-p", prompt,
            "--dangerously-skip-permissions",
            "--output-format", "text"
        ]
        if agent_model and agent_model not in ("default", "none"):
            cmd.extend(["--model", agent_model])

    elif agent_engine == "agy":
        from core.config import normalize_agy_model_slug
        agy_bin = find_engine_binary("agy", ctx["user"])
        cmd = ["sudo", "-u", ctx["user"], "-H"] + env_args + [
            "--",
            agy_bin,
            "-p", prompt,
            "--dangerously-skip-permissions",
            "--disable-slash-commands",
            "--output-format", "text"
        ]
        chosen_m = normalize_agy_model_slug(agent_model) if agent_model and agent_model not in ("default", "none") else "gemini-3.8-flash-medium"
        cmd.extend(["--model", chosen_m])

    elif agent_engine == "opencode":
        opencode_bin = find_engine_binary("opencode", ctx["user"])
        cmd = ["sudo", "-u", ctx["user"], "-H"] + env_args + [
            "--",
            opencode_bin,
            "run",
            "--auto",
            prompt
        ]
        if agent_model and agent_model not in ("default", "none"):
            cmd.extend(["-m", agent_model])

    elif agent_engine == "codex":
        codex_bin = find_engine_binary("codex", ctx["user"])
        if not codex_bin:
            return "", f"⚠️ [CODEX] Engine binary not currently installed for {agent_name}."
        cmd = ["sudo", "-u", ctx["user"], "-H"] + env_args + [
            "--",
            codex_bin,
            "exec",
            "--dangerously-bypass-approvals-and-sandbox",
            "--skip-git-repo-check",
            "--color", "never",
            "--add-dir", "/home/nexus_shared"
        ]
        # Only pass explicit -m if not default or placeholder
        if agent_model and agent_model not in ("default", "none", "gpt-5.3-codex"):
            cmd.extend(["-m", agent_model])
        cmd.append(prompt)

    else:  # hermes (default)
        is_stateless = (session_name == "__stateless__")
        s_name = session_name or f"nexusdesk_{re.sub(r'[^a-zA-Z0-9_-]', '_', agent_name.lower())}"
        cmd = [
            "sudo", "-u", ctx["user"], "-H",
            f"XDG_RUNTIME_DIR={ctx['xdg_runtime']}"
        ] + env_args + [
            "hermes", "chat",
            "--in", workspace_dir,
        ]
        if is_stateless:
            cmd.extend(["--max-turns", "3", "-Q"])
        else:
            cmd.extend(["-c", s_name, "--create-if-missing", "-Q"])
        if agent_model and agent_model not in ("default", "none"):
            _h_model = str(agent_model).strip()
            _h_prov = None
            for _p in ("abacus", "groq", "openrouter", "cloudflare", "nous"):
                if _h_model.startswith(f"{_p}/"):
                    _h_prov = _p
                    _h_model = _h_model[len(_p) + 1:]
                    break
            if not _h_prov and _h_model.startswith("nvidia/"):
                _h_prov = "nvidia"
            if _h_prov:
                cmd.extend(["--provider", _h_prov])
            cmd.extend(["-m", _h_model])
        cmd.extend(["-q", prompt])

    proc_key = str(room_id or session_name or f"{agent_name}_{ctx['user']}").strip()
    effective_soft_timeout = soft_timeout_seconds if (soft_timeout_seconds and soft_timeout_seconds < timeout_seconds) else None
    try:
        stdout_bytes, stderr_bytes, was_soft_intercepted = await _run_tracked_proc(
            cmd, exec_cwd, proc_key, timeout_seconds,
            soft_timeout_seconds=effective_soft_timeout,
            room_id=room_id,
            agent_name=agent_name,
            agent_engine=agent_engine,
            agent_model=agent_model
        )

        stdout_text = stdout_bytes.decode("utf-8", errors="replace")
        stderr_text = stderr_bytes.decode("utf-8", errors="replace")

        if was_soft_intercepted:
            partial_out = ""
            if stdout_text.strip():
                partial_out += stdout_text.strip()
            if stderr_text.strip():
                partial_out += ("\n--- STDERR ---\n" + stderr_text.strip())
            # If the agent actually managed to emit <async_task> before SIGINT, treat it as a valid reply!
            if "<async_task>" in stdout_text.lower():
                reply = sanitize_engine_output(stdout_text, agent_engine, agent_name)
                return reply, None
            # BL-EVO-28: Accurate error description distinguishing 75s/150s dead-provider stall guard from soft-timeout
            if getattr(globals(), "dead_provider_stalled", False):
                err_msg = f"{agent_name} [{agent_engine.upper()}] dead-provider stall guard triggered (no network I/O, tokens, or tool activity)"
            else:
                err_msg = f"{agent_name} [{agent_engine.upper()}] subprocess soft-intercepted at {int(effective_soft_timeout or 1800)}s (before {int(timeout_seconds)}s hard kill)"
            if partial_out.strip():
                err_msg += f"\n\n--- PARTIAL OUTPUT BEFORE TIMEOUT ---\n{partial_out.strip()}"
            return "", err_msg

        # For Codex, stdout holds the clean agent response, while stderr contains dumped transcripts and CLI traces
        if agent_engine == "codex":
            stdout_clean = stdout_text.strip()
            stderr_clean = stderr_text.strip()

            # Resilient fallback: if selected model is rejected on ChatGPT account, retry with native default model
            if not stdout_clean and ("model is not supported" in stderr_clean or "model_not_found" in stderr_clean or "bwrap" in stderr_clean):
                retry_cmd = ["sudo", "-u", ctx["user"], "-H"] + env_args + [
                    "--",
                    codex_bin,
                    "exec",
                    "--dangerously-bypass-approvals-and-sandbox",
                    "--skip-git-repo-check",
                    "--color", "never",
                    "--add-dir", "/home/nexus_shared",
                    prompt
                ]
                try:
                    stdout_bytes_r, stderr_bytes_r, _ = await _run_tracked_proc(
                        retry_cmd, exec_cwd, proc_key, timeout_seconds, soft_timeout_seconds=effective_soft_timeout
                    )
                    stdout_clean = stdout_bytes_r.decode("utf-8", errors="replace").strip()
                    stderr_clean = stderr_bytes_r.decode("utf-8", errors="replace").strip()
                except (asyncio.TimeoutError, subprocess.TimeoutExpired):
                    pass

            if stdout_clean:
                if is_token_or_quota_exhausted(stdout_clean) or is_token_or_quota_exhausted(stderr_clean):
                    return "", f"TOKEN_EXHAUSTED: {agent_name} [CODEX] hit AI token/quota/rate limit: {stdout_clean[:300] or stderr_clean[:300]}"
                reply = sanitize_engine_output(stdout_clean, agent_engine, agent_name)
                return reply, None
            else:
                if is_token_or_quota_exhausted(stderr_clean):
                    return "", f"TOKEN_EXHAUSTED: {agent_name} [CODEX] hit AI token/quota/rate limit: {stderr_clean[:300]}"
                # If stdout is empty, extract ONLY the error message from stderr (never dump the whole transcript!)
                err_lines = [l.strip() for l in stderr_clean.split("\n") if l.strip().startswith("ERROR:") or "error" in l.lower()]
                clean_err = "; ".join(err_lines[:2]) if err_lines else "Codex CLI produced no response."
                return "", f"Codex execution failed: {clean_err}"

        raw_output = stdout_text.strip() or stderr_text.strip()

        # Resilient fallback retry if Hermes reports SESSION_NOT_OWNED
        if agent_engine == "hermes" and "SESSION_NOT_OWNED" in stderr_text:
            fresh_sname = f"{s_name}_{int(time.time())}"
            fb_hermes_cmd = [
                "sudo", "-u", ctx["user"], "-H",
                f"XDG_RUNTIME_DIR={ctx['xdg_runtime']}"
            ] + env_args + [
                "hermes", "chat",
                "--in", workspace_dir,
                "-c", fresh_sname,
                "--create-if-missing",
                "-Q"
            ]
            if agent_model and agent_model not in ("default", "none"):
                _h_model = str(agent_model).strip()
                _h_prov = None
                for _p in ("abacus", "groq", "openrouter", "cloudflare", "nous"):
                    if _h_model.startswith(f"{_p}/"):
                        _h_prov = _p
                        _h_model = _h_model[len(_p) + 1:]
                        break
                if not _h_prov and _h_model.startswith("nvidia/"):
                    _h_prov = "nvidia"
                if _h_prov:
                    fb_hermes_cmd.extend(["--provider", _h_prov])
                fb_hermes_cmd.extend(["-m", _h_model])
            fb_hermes_cmd.extend(["-q", prompt])

            try:
                stdout_bytes_h, stderr_bytes_h, _ = await _run_tracked_proc(
                    fb_hermes_cmd, exec_cwd, proc_key, timeout_seconds, soft_timeout_seconds=effective_soft_timeout
                )
                raw_output = stdout_bytes_h.decode("utf-8", errors="replace").strip() or stderr_bytes_h.decode("utf-8", errors="replace").strip()
            except (asyncio.TimeoutError, subprocess.TimeoutExpired):
                pass

        # Resilient fallback retry if Claude CLI reports model access or existence error
        if agent_engine == "claude" and ("issue with the selected model" in raw_output or "may not exist or you may not have access" in raw_output):
            fb_model = "sonnet" if agent_model == "claude-sonnet-5-5" else (fallback_claude_model or "claude-sonnet-5-5")
            fb_cmd = ["sudo", "-u", ctx["user"], "-H"] + env_args + [
                "--",
                find_engine_binary("claude", ctx["user"]),
                "-p", prompt,
                "--dangerously-skip-permissions",
                "--output-format", "text",
                "--model", fb_model
            ]
            try:
                stdout_bytes_c, stderr_bytes_c, _ = await _run_tracked_proc(
                    fb_cmd, exec_cwd, proc_key, timeout_seconds, soft_timeout_seconds=effective_soft_timeout
                )
                raw_output = stdout_bytes_c.decode("utf-8", errors="replace").strip() or stderr_bytes_c.decode("utf-8", errors="replace").strip()
            except (asyncio.TimeoutError, subprocess.TimeoutExpired):
                pass

        if is_token_or_quota_exhausted(raw_output) or is_token_or_quota_exhausted(stderr_text):
            return "", f"TOKEN_EXHAUSTED: {agent_name} [{agent_engine.upper()}] hit AI token/quota/rate limit: {(raw_output or stderr_text)[:300]}"

        reply = sanitize_engine_output(raw_output, agent_engine, agent_name)
        return reply, None

    except subprocess.TimeoutExpired as e:
        partial_out = ""
        if e.stdout:
            partial_out += (e.stdout.decode("utf-8", errors="replace") if isinstance(e.stdout, bytes) else str(e.stdout))
        if e.stderr:
            partial_out += ("\n--- STDERR ---\n" + (e.stderr.decode("utf-8", errors="replace") if isinstance(e.stderr, bytes) else str(e.stderr)))
        err_msg = f"{agent_name} [{agent_engine.upper()}] subprocess timed out after {timeout_seconds}s"
        if partial_out.strip():
            err_msg += f"\n\n--- PARTIAL OUTPUT BEFORE TIMEOUT ---\n{partial_out.strip()}"
        return "", err_msg
    except Exception as e:
        return "", f"Execution error in {agent_name}: {str(e)}"
