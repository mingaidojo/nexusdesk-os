import os
import secrets
from pathlib import Path
from typing import Tuple, List, Dict, Any, Optional
import shutil
import pwd
import json
import time
import subprocess
import re
from fastapi import WebSocket, Request

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ENV_FILE = BASE_DIR / ".env"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
VERSION_FILE = BASE_DIR / "VERSION"
BUILD_VERSION_FILE = BASE_DIR / "frontend" / ".build_version.json"


def get_app_version() -> str:
    """Read the canonical semantic version from the repository VERSION file."""
    try:
        if VERSION_FILE.exists():
            ver = VERSION_FILE.read_text(encoding="utf-8").strip()
            if ver:
                return ver
    except Exception:
        pass
    return "2.0.0"


def get_build_id() -> str:
    """Read the current frontend build identifier (YYYYMMDD-NN)."""
    try:
        if BUILD_VERSION_FILE.exists():
            data = json.loads(BUILD_VERSION_FILE.read_text(encoding="utf-8"))
            date_str = str(data.get("date", "")).strip()
            batch = int(data.get("batch", 0))
            if date_str and batch > 0:
                return f"{date_str}-{batch:02d}"
    except Exception:
        pass
    return "dev"


APP_VERSION = get_app_version()


def get_env_value(key: str, default: str = "") -> str:
    """Read a config value from os.environ first, falling back to .env."""
    val = os.environ.get(key)
    if val is not None and val != "":
        return val.strip()
    if ENV_FILE.exists():
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    if k.strip() == key:
                        return v.strip().strip('"\'')
        except Exception:
            pass
    return default


NEXUSDESK_HOST = get_env_value("NEXUSDESK_HOST", "127.0.0.1")
try:
    NEXUSDESK_PORT = int(get_env_value("NEXUSDESK_PORT", "9200"))
except ValueError:
    NEXUSDESK_PORT = 9200

# Edition & War-Room OSS limits (0 = unlimited)
_has_pro_modules = (Path(__file__).resolve().parent.parent / "routers" / "chat_agents.py").exists()
NEXUSDESK_EDITION = get_env_value("NEXUSDESK_EDITION", "pro" if _has_pro_modules else "oss").lower()
_default_room_cap = "0" if NEXUSDESK_EDITION == "pro" else "3"
_default_agent_cap = "0" if NEXUSDESK_EDITION == "pro" else "3"
try:
    NEXUSDESK_MAX_CUSTOM_WAR_ROOMS = int(get_env_value("NEXUSDESK_MAX_CUSTOM_WAR_ROOMS", _default_room_cap))
except ValueError:
    NEXUSDESK_MAX_CUSTOM_WAR_ROOMS = 0 if NEXUSDESK_EDITION == "pro" else 3
try:
    NEXUSDESK_MAX_WAR_ROOM_AGENTS = int(get_env_value("NEXUSDESK_MAX_WAR_ROOM_AGENTS", _default_agent_cap))
except ValueError:
    NEXUSDESK_MAX_WAR_ROOM_AGENTS = 0 if NEXUSDESK_EDITION == "pro" else 3

def load_or_create_secret_key() -> Tuple[str, bool]:
    env_key = os.environ.get("NEXUSDESK_SECRET_KEY")
    auth_enabled_str = os.environ.get("NEXUSDESK_AUTH_ENABLED", "").lower()
    auth_enabled = auth_enabled_str in ("true", "1", "yes", "on")

    if env_key:
        return env_key.strip(), auth_enabled

    if ENV_FILE.exists():
        try:
            with open(ENV_FILE, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("#") or not line:
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip('"\'')
                        if k == "NEXUSDESK_SECRET_KEY" and v:
                            env_key = v
                        elif k == "NEXUSDESK_AUTH_ENABLED":
                            auth_enabled = v.lower() in ("true", "1", "yes", "on")
            if env_key:
                return env_key, auth_enabled
        except Exception as e:
            print(f"[SECURITY] Warning reading .env: {e}")

    # Generate cryptographic 32-byte secret key
    generated_key = secrets.token_hex(32)
    try:
        with open(ENV_FILE, "w") as f:
            f.write("# NexusDesk Master Security Configuration\n")
            f.write("# Generated automatically on boot. Keep confidential.\n")
            f.write("NEXUSDESK_AUTH_ENABLED=false\n")
            f.write(f"NEXUSDESK_SECRET_KEY={generated_key}\n")
        ENV_FILE.chmod(0o600)
    except Exception as e:
        print(f"[SECURITY] Warning writing .env: {e}")

    return generated_key, False


USER_PROFILE_FILE = DATA_DIR / "user_profile.json"


def _format_tz_label(offset_hours: float) -> str:
    if offset_hours == int(offset_hours):
        n = int(offset_hours)
        return f"GMT+{n}" if n >= 0 else f"GMT{n}"
    sign = "+" if offset_hours >= 0 else "-"
    abs_h = abs(offset_hours)
    hrs = int(abs_h)
    mins = int(round((abs_h - hrs) * 60))
    return f"GMT{sign}{hrs}:{mins:02d}"


def get_user_profile() -> Dict[str, Any]:
    """Returns the configured NexusDesk user profile (display_name, tz_offset, tz_label)."""
    default_name = os.environ.get("NEXUSDESK_USER_NAME", "").strip() or "User"
    profile: Dict[str, Any] = {
        "display_name": default_name,
        "tz_offset": 7.0,
        "tz_label": "GMT+7",
    }
    try:
        if USER_PROFILE_FILE.exists():
            data = json.loads(USER_PROFILE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                name = str(data.get("display_name") or "").strip()
                if name:
                    profile["display_name"] = name
                if data.get("tz_offset") is not None:
                    try:
                        profile["tz_offset"] = float(data["tz_offset"])
                    except Exception:
                        pass
                lbl = str(data.get("tz_label") or "").strip()
                profile["tz_label"] = lbl or _format_tz_label(profile["tz_offset"])
    except Exception:
        pass
    return profile


def save_user_profile(
    display_name: Optional[str] = None,
    tz_offset: Optional[float] = None,
    tz_label: Optional[str] = None,
) -> Dict[str, Any]:
    """Persists the NexusDesk user profile to backend/data/user_profile.json."""
    cur = get_user_profile()
    if display_name is not None:
        cur["display_name"] = (str(display_name).strip()[:40]) or "User"
    if tz_offset is not None:
        try:
            cur["tz_offset"] = max(-12.0, min(14.0, float(tz_offset)))
        except Exception:
            pass
    if tz_label is not None and str(tz_label).strip():
        cur["tz_label"] = str(tz_label).strip()[:48]
    elif tz_offset is not None:
        cur["tz_label"] = _format_tz_label(cur["tz_offset"])

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_PROFILE_FILE.write_text(json.dumps(cur, indent=2), encoding="utf-8")
    return cur


def get_user_timezone():
    """Returns a datetime.timezone object for the configured user profile timezone."""
    from datetime import timezone, timedelta
    prof = get_user_profile()
    return timezone(timedelta(hours=float(prof.get("tz_offset", 7.0))))


def get_operator_name() -> str:
    """Returns the configured NexusDesk user/operator display name (defaults to 'User' for portability)."""
    return get_user_profile()["display_name"]


def save_operator_name(display_name: str) -> str:
    """Persists the NexusDesk user/operator display name to backend/data/user_profile.json."""
    return save_user_profile(display_name=display_name)["display_name"]

NEXUSDESK_SECRET_KEY, NEXUSDESK_AUTH_ENABLED = load_or_create_secret_key()

def set_auth_config(enabled: bool, key: Optional[str] = None):
    global NEXUSDESK_AUTH_ENABLED, NEXUSDESK_SECRET_KEY
    NEXUSDESK_AUTH_ENABLED = enabled
    if key:
        NEXUSDESK_SECRET_KEY = key
    try:
        with open(ENV_FILE, "w") as f:
            f.write("# NexusDesk Master Security Configuration\n")
            f.write("# Updated via Mission Control Settings Menu\n")
            f.write(f"NEXUSDESK_AUTH_ENABLED={'true' if NEXUSDESK_AUTH_ENABLED else 'false'}\n")
            f.write(f"NEXUSDESK_SECRET_KEY={NEXUSDESK_SECRET_KEY}\n")
        ENV_FILE.chmod(0o600)
    except Exception as e:
        print(f"[SECURITY] Warning updating .env: {e}")

def verify_token(raw_token: Optional[str]) -> bool:
    if not NEXUSDESK_AUTH_ENABLED:
        return True
    if not raw_token:
        return False
    return secrets.compare_digest(raw_token.strip(), NEXUSDESK_SECRET_KEY.strip())

# Multi-instance discovery - Locked strictly to approved fleets
APPROVED_FLEETS = ["agents_bs", "myvirtualcoder", "freecoder", "desktop"]

# Subprocess execution timeout ceiling for agent directives in War Room & Chat (seconds) - 2700s (45 mins)
AGENT_SUBPROCESS_TIMEOUT = int(os.environ.get("AGENT_SUBPROCESS_TIMEOUT", 2700))

BASE_INSTANCES = {
    "agents_bs": {
        "user": "agents_bs",
        "home": Path("/home/agents_bs/.hermes"),
        "workspace": Path("/home/agents_bs/workspace"),
        "label": "biblestoryapp",
        "badge": "PROD",
        "color": "emerald"
    },
    "myvirtualcoder": {
        "user": "myvirtualcoder",
        "home": Path("/home/myvirtualcoder/.hermes"),
        "workspace": Path("/home/myvirtualcoder"),
        "label": "Developer",
        "badge": "DEV",
        "color": "sky"
    },
    "freecoder": {
        "user": "freecoder",
        "home": Path("/home/freecoder/.hermes"),
        "workspace": Path("/home/freecoder"),
        "label": "Autonomous",
        "badge": "ACTIVE",
        "color": "purple"
    },
    "desktop": {
        "user": "desktop",
        "home": Path("/home/desktop/.hermes"),
        "workspace": Path("/home/desktop"),
        "label": "Desktop",
        "badge": "LOCAL",
        "color": "amber"
    }
}

def safe_path_exists(p: Any) -> bool:
    if not p:
        return False
    path_obj = Path(p)
    try:
        return path_obj.exists()
    except PermissionError:
        try:
            parts = path_obj.parts
            target_user = parts[2] if len(parts) > 2 and parts[1] == "home" else None
            cmd = ["sudo", "-n"]
            if target_user:
                cmd.extend(["-u", target_user])
            cmd.extend(["test", "-e", str(path_obj)])
            res = subprocess.run(cmd, capture_output=True, timeout=1)
            return res.returncode == 0
        except Exception:
            return False
    except Exception:
        return False

def detect_user_engines(username: str) -> Dict[str, Dict[str, Any]]:
    user_home = Path(f"/home/{username}")
    active_daemons = {}
    curr_pid = os.getpid()
    try:
        ps_out = subprocess.run(["ps", "-u", username, "-o", "pid,args"], capture_output=True, text=True, timeout=5).stdout
        for line in ps_out.splitlines()[1:]:
            parts = line.strip().split(None, 1)
            if len(parts) > 1:
                pid = int(parts[0])
                if pid == curr_pid:
                    continue
                cmd = parts[1]
                if any(x in cmd for x in ["--help", "--version", "grep ", "ps -u"]):
                    continue
                if re.search(r"\bhermes\b|gateway run", cmd):
                    active_daemons["hermes"] = pid
                if re.search(r"\bagy\b|antigravity", cmd):
                    active_daemons["agy"] = pid
                if re.search(r"\bclaude\b|claude-code|/claude/", cmd):
                    active_daemons["claude"] = pid
                if re.search(r"\bopencode\b", cmd):
                    active_daemons["opencode"] = pid
                if re.search(r"\bcodex\b", cmd):
                    active_daemons["codex"] = pid
    except Exception:
        pass

    engine_definitions = [
        (
            "hermes",
            "Hermes Agent",
            [
                user_home / ".local/bin/hermes",
                user_home / ".hermes/bin/hermes",
                Path("/usr/local/bin/hermes"),
                Path("/usr/bin/hermes")
            ],
            user_home / ".hermes/config.yaml",
            "autonomous-gateway"
        ),
        (
            "agy",
            "Antigravity AGY",
            [
                user_home / ".local/bin/agy",
                Path("/usr/local/bin/agy"),
                Path("/usr/bin/agy")
            ],
            user_home / ".gemini/antigravity-cli",
            "coding-agent"
        ),
        (
            "claude",
            "Claude Code",
            [
                user_home / ".local/bin/claude",
                Path("/usr/local/bin/claude"),
                Path("/usr/bin/claude")
            ],
            user_home / ".claude.json",
            "cli-orchestrator"
        ),
        (
            "opencode",
            "OpenCode",
            [
                user_home / ".opencode/bin/opencode",
                user_home / ".local/bin/opencode",
                Path("/usr/local/bin/opencode"),
                Path("/usr/bin/opencode")
            ],
            user_home / ".config/opencode/opencode.json",
            "open-source-agent"
        ),
        (
            "codex",
            "OpenAI Codex",
            [
                user_home / ".local/bin/codex",
                Path("/usr/local/bin/codex"),
                Path("/usr/bin/codex")
            ],
            user_home / ".config/openai/codex.json",
            "llm-execution"
        )
    ]

    engines = {}
    for eng_id, name, bin_candidates, cfg_path, category in engine_definitions:
        found_bin = None
        for cand in bin_candidates:
            if safe_path_exists(cand):
                found_bin = str(cand)
                break
        if not found_bin and shutil.which(eng_id):
            found_bin = shutil.which(eng_id)

        cfg_found = safe_path_exists(cfg_path)
        is_running = eng_id in active_daemons
        pid = active_daemons.get(eng_id)

        engines[eng_id] = {
            "id": eng_id,
            "name": name,
            "category": category,
            "installed": bool(found_bin),
            "binary_path": found_bin,
            "config_found": cfg_found,
            "config_path": str(cfg_path) if cfg_found else None,
            "daemon_running": is_running,
            "pid": pid,
            "status": "online" if is_running else ("ready" if (found_bin or cfg_found) else "offline")
        }

    return engines

ENGINE_DEFAULTS = {
    "hermes": {"color": "#10b981", "theme": "orchestrator", "default_model": "nvidia/nemotron-3-ultra-550b-a55b"},
    "agy": {"color": "#38bdf8", "theme": "developer", "default_model": "gemini-3.8-flash-medium"},
    "claude": {"color": "#f59e0b", "theme": "developer", "default_model": "claude-sonnet-5-5"},
    "opencode": {"color": "#a855f7", "theme": "developer", "default_model": "opencode/deepseek-v4.1-flash-free"},
    "codex": {"color": "#14b8a6", "theme": "developer", "default_model": "gpt-6-luna"}
}

SPECIALISTS_OVERRIDE_FILE = BASE_DIR / "backend" / "data" / "specialists_override.json"
CUSTOM_MODELS_FILE = BASE_DIR / "backend" / "data" / "custom_models.json"


def get_custom_models() -> Dict[str, List[Dict[str, str]]]:
    """Loads persisted user-entered custom models grouped by engine."""
    if CUSTOM_MODELS_FILE.exists():
        try:
            with open(CUSTOM_MODELS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}


def register_custom_model(engine: Optional[str], model_id: Optional[str]) -> bool:
    """Persists a custom model ID under its engine catalog if not already in static catalog."""
    eng = (engine or "hermes").lower().strip()
    clean_id = (model_id or "").strip()
    if not clean_id or clean_id.lower() in ("default", "none", "null"):
        return False

    static_ids = {m["id"].lower() for m in ENGINE_MODEL_CATALOG_STATIC.get(eng, [])}
    if clean_id.lower() in static_ids:
        return False

    data = get_custom_models()
    eng_list = data.get(eng, [])
    if not isinstance(eng_list, list):
        eng_list = []

    if any(str(m.get("id", "")).lower() == clean_id.lower() for m in eng_list if isinstance(m, dict)):
        return False

    eng_list.append({
        "id": clean_id,
        "label": clean_id,
        "provider": "Custom",
        "badge": "CUSTOM"
    })
    data[eng] = eng_list
    try:
        CUSTOM_MODELS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CUSTOM_MODELS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        _ENGINE_CATALOG_CACHE["data"] = None
        _ENGINE_CATALOG_CACHE["ts"] = 0.0
        return True
    except Exception as e:
        print(f"[CONFIG] Warning saving custom model: {e}")
    return False

def get_specialist_overrides() -> Dict[str, Any]:
    if SPECIALISTS_OVERRIDE_FILE.exists():
        try:
            with open(SPECIALISTS_OVERRIDE_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except Exception:
            pass
    return {}

def save_specialist_override(agent_name: str, overrides: Dict[str, Any], instance_key: Optional[str] = None):
    data = get_specialist_overrides()
    clean_key = agent_name.lower().strip()
    existing = data.get(clean_key, {}) if isinstance(data.get(clean_key), dict) else {}
    merged = {**existing, **overrides}
    if instance_key:
        merged["instance"] = instance_key
    data[clean_key] = merged
    if instance_key:
        scoped_key = f"{instance_key.lower().strip()}:{clean_key}"
        scoped_existing = data.get(scoped_key, {}) if isinstance(data.get(scoped_key), dict) else {}
        data[scoped_key] = {**scoped_existing, **overrides, "instance": instance_key}
    try:
        SPECIALISTS_OVERRIDE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SPECIALISTS_OVERRIDE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[CONFIG] Warning saving specialist override: {e}")

def get_agent_override_model(agent_name: Optional[str], username: Optional[str] = None, eng_id: Optional[str] = None) -> Optional[str]:
    overrides = get_specialist_overrides()
    if not overrides:
        return None
    if agent_name:
        clean_name = agent_name.lower().strip()
        if username:
            scoped = overrides.get(f"{username.lower().strip()}:{clean_name}")
            if isinstance(scoped, dict) and scoped.get("model"):
                return str(scoped["model"]).strip()
        direct = overrides.get(clean_name)
        if isinstance(direct, dict) and direct.get("model"):
            return str(direct["model"]).strip()
    if eng_id:
        eng_clean = eng_id.lower().strip()
        if username:
            eng_scoped = overrides.get(f"{username.lower().strip()}:{eng_clean}")
            if isinstance(eng_scoped, dict) and eng_scoped.get("model"):
                return str(eng_scoped["model"]).strip()
        eng_direct = overrides.get(eng_clean)
        if isinstance(eng_direct, dict) and eng_direct.get("model"):
            return str(eng_direct["model"]).strip()
    return None

def normalize_agy_model_slug(raw_model: str) -> str:
    if not raw_model:
        return "gemini-3.8-flash-medium"
    m_str = str(raw_model).strip()
    lower = m_str.lower()
    # Already a valid CLI slug
    valid_prefixes = (
        "gemini-4-neon-",
        "gemini-4-hydrogen-",
        "gemini-4-argon-",
        "gemini-pro-orchestrator-",
        "gemini-3.8-flash-",
        "claude-opus-5-5-",
        "claude-sonnet-5-5-",
        "gpt-oss-",
    )
    if lower.startswith(valid_prefixes):
        return lower
    tier = "medium"
    if "xhigh" in lower:
        tier = "xhigh"
    elif "high" in lower:
        tier = "high"
    elif "low" in lower:
        tier = "low"
    if "neon" in lower:
        return f"gemini-4-neon-{tier}"
    if "hydrogen" in lower:
        return f"gemini-4-hydrogen-{tier}"
    if "4" in lower or "argon" in lower:
        return f"gemini-4-argon-{tier}"
    if "3.8" in lower or "flash" in lower:
        return f"gemini-3.8-flash-{tier}"
    if "opus" in lower:
        return f"claude-opus-5-5-{tier}"
    if "sonnet" in lower:
        return f"claude-sonnet-5-5-{tier}"
    if "gpt-oss" in lower or "120b" in lower:
        return "gpt-oss-120b-medium"
    if lower == "gemini-3.8-flash":
        return "gemini-3.8-flash-medium"
    if lower in ("gemini-4.0", "gemini-4-argon"):
        return "gemini-4-argon-medium"
    return m_str

_ENGINE_CATALOG_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}

ENGINE_MODEL_CATALOG_STATIC: Dict[str, List[Dict[str, str]]] = {
    "agy": [
        {"id": "gemini-3.8-flash-medium", "label": "Gemini 3.8 Flash (Medium) — Fast & Balanced", "provider": "Google DeepMind", "badge": "DEFAULT"},
        {"id": "gemini-3.8-flash-high", "label": "Gemini 3.8 Flash (High) — Deep Thinking", "provider": "Google DeepMind", "badge": "REASONING"},
        {"id": "gemini-3.8-flash-low", "label": "Gemini 3.8 Flash (Low) — Ultra Low Latency", "provider": "Google DeepMind", "badge": "SPEED"},
        {"id": "gemini-4-argon-medium", "label": "Gemini 4 Argon (Medium) — Frontier Flagship", "provider": "Google DeepMind", "badge": "FRONTIER"},
        {"id": "gemini-4-argon-high", "label": "Gemini 4 Argon (High) — Max Reasoning", "provider": "Google DeepMind", "badge": "FRONTIER"},
        {"id": "gemini-4-argon-low", "label": "Gemini 4 Argon (Low) — Fast Flagship", "provider": "Google DeepMind", "badge": "FAST"},
        {"id": "gemini-4-hydrogen-medium", "label": "Gemini 4 Hydrogen (Medium)", "provider": "Google DeepMind", "badge": "FRONTIER"},
        {"id": "gemini-4-hydrogen-high", "label": "Gemini 4 Hydrogen (High)", "provider": "Google DeepMind", "badge": "REASONING"},
        {"id": "gemini-4-hydrogen-xhigh", "label": "Gemini 4 Hydrogen (XHigh)", "provider": "Google DeepMind", "badge": "HEAVY"},
        {"id": "gemini-4-hydrogen-low", "label": "Gemini 4 Hydrogen (Low)", "provider": "Google DeepMind", "badge": "FAST"},
        {"id": "claude-sonnet-5-5-medium", "label": "Claude Sonnet 5.5 (Medium via AGY)", "provider": "Anthropic (Vertex)", "badge": "CODING"},
        {"id": "claude-sonnet-5-5-high", "label": "Claude Sonnet 5.5 (High via AGY)", "provider": "Anthropic (Vertex)", "badge": "REASONING"},
        {"id": "claude-opus-5-5-medium", "label": "Claude Opus 5.5 (Medium via AGY)", "provider": "Anthropic (Vertex)", "badge": "HEAVY"},
        {"id": "claude-opus-5-5-high", "label": "Claude Opus 5.5 (High via AGY)", "provider": "Anthropic (Vertex)", "badge": "HEAVY"},
        {"id": "gpt-oss-120b-medium", "label": "GPT-OSS 120B (Medium)", "provider": "Open-Weights", "badge": "OPEN"},
    ],
    "claude": [
        {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5 — Primary Coding & Architecture", "provider": "Anthropic", "badge": "DEFAULT"},
        {"id": "sonnet", "label": "Claude Sonnet (Latest Alias)", "provider": "Anthropic", "badge": "ALIAS"},
        {"id": "opus", "label": "Claude Opus (Latest Frontier Alias)", "provider": "Anthropic", "badge": "FRONTIER"},
        {"id": "claude-opus-5-5", "label": "Claude Opus 5.5 — Deep Systems Architecture", "provider": "Anthropic", "badge": "HEAVY"},
        {"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5 — High-Speed Lightweight", "provider": "Anthropic", "badge": "SPEED"},
    ],
    "opencode": [
        {"id": "opencode/deepseek-v4.1-flash-free", "label": "DeepSeek V4.1 Flash Free", "provider": "OpenCode", "badge": "DEFAULT"},
        {"id": "opencode/big-pickle", "label": "Big Pickle", "provider": "OpenCode", "badge": "FREE"},
        {"id": "opencode/flint-40b-free", "label": "Flint 40B Free", "provider": "OpenCode", "badge": "FREE"},
        {"id": "opencode/glm-5.3-flash-free", "label": "GLM - 5.3 - Flash Free", "provider": "OpenCode", "badge": "FREE"},
        {"id": "opencode/mimo-v2.6-flash-free", "label": "MiMo - V2.6 - Flash Free", "provider": "OpenCode", "badge": "FREE"},
        {"id": "opencode/nemotron-3-ultra-free", "label": "Nemotron 3 Ultra Free", "provider": "OpenCode", "badge": "FREE"},
        {"id": "opencode/nemotron-3.5-lightning-free", "label": "Nemotron 3.5 Lightning Free", "provider": "OpenCode", "badge": "FREE"},
        {"id": "opencode/nemotron-3.5-super-vl-free", "label": "Nemotron 3.5 Super VL Free", "provider": "OpenCode", "badge": "FREE"},
        {"id": "opencode/beam-free", "label": "Beam Free", "provider": "OpenCode", "badge": "FREE"},
    ],
    "codex": [
        {"id": "gpt-6-luna", "label": "GPT-6 Luna (ChatGPT Subscription Default)", "provider": "OpenAI", "badge": "DEFAULT"},
        {"id": "o3", "label": "OpenAI o3 — Deep Analytical Reasoning", "provider": "OpenAI", "badge": "REASONING"},
        {"id": "o4-mini", "label": "OpenAI o4-mini — Fast Reasoning", "provider": "OpenAI", "badge": "REASONING"},
        {"id": "gpt-4.1", "label": "GPT-4.1 — Long-Context Engineering", "provider": "OpenAI", "badge": "STABLE"},
        {"id": "gpt-4o", "label": "GPT-4o — Multimodal Versatile", "provider": "OpenAI", "badge": "STABLE"},
    ],
    "hermes": [
        {"id": "nvidia/nemotron-3-ultra-550b-a55b", "label": "NVIDIA Nemotron 3 Ultra 550B (Config Default)", "provider": "NVIDIA", "badge": "DEFAULT"},
        {"id": "deepseek-ai/deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash", "provider": "DeepSeek / NVIDIA", "badge": "FAST"},
        {"id": "nvidia/nemotron-3-super-120b-a12b", "label": "NVIDIA Nemotron 3 Super 120B", "provider": "NVIDIA", "badge": "BALANCED"},
        {"id": "abacus/gemini-3.8-flash", "label": "Gemini 3.8 Flash (Abacus)", "provider": "Abacus / Google", "badge": "FAST"},
        {"id": "abacus/claude-sonnet-5", "label": "Claude Sonnet 5 (Abacus)", "provider": "Abacus / Anthropic", "badge": "CODING"},
        {"id": "abacus/gpt-5.4", "label": "GPT-5.4 (Abacus)", "provider": "Abacus / OpenAI", "badge": "FRONTIER"},
        {"id": "abacus/qwen3.8-max", "label": "Qwen 3.8 Max (Abacus)", "provider": "Abacus / Qwen", "badge": "CODING"},
        {"id": "openrouter/auto", "label": "OpenRouter Auto Router", "provider": "OpenRouter", "badge": "AUTO"},
        {"id": "poolside/laguna-s-2.1:free", "label": "Poolside Laguna S 2.1 (Free)", "provider": "OpenRouter / Poolside", "badge": "FREE"},
    ]
}

def get_engine_models_catalog(force_refresh: bool = False) -> Dict[str, Any]:
    now = time.time()
    if not force_refresh and _ENGINE_CATALOG_CACHE["data"] and (now - _ENGINE_CATALOG_CACHE["ts"] < 180):
        return _ENGINE_CATALOG_CACHE["data"]

    from concurrent.futures import ThreadPoolExecutor

    def _fetch_agy_live() -> List[Dict[str, str]]:
        agy_bin = Path("/home/myvirtualcoder/.local/bin/agy")
        if not safe_path_exists(agy_bin):
            return []
        try:
            cmd = (
                ["su", "-", "myvirtualcoder", "-c", f"{agy_bin} models"]
                if os.geteuid() == 0
                else [str(agy_bin), "models"]
            )
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
            if res.returncode != 0 or not res.stdout:
                return []
            found: List[Dict[str, str]] = []
            for raw_line in res.stdout.splitlines():
                line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw_line.split('\r')[-1]).strip()
                if not line:
                    continue
                m = re.match(r'^([a-z0-9][a-z0-9.\-_]+)(?:\t|\s{2,})(.+?)(?:\s+\*)?$', line)
                if m:
                    slug, label_str = m.group(1).strip(), m.group(2).strip()
                    if slug != "auto":
                        found.append({
                            "id": slug,
                            "label": label_str,
                            "provider": "Google DeepMind / AGY" if "gemini" in slug else ("Anthropic via AGY" if "claude" in slug else "AGY Runtime"),
                            "endpoint": "agy models",
                            "source": "live",
                            "badge": "FRONTIER" if ("neon" in slug or "argon" in slug) else "LIVE"
                        })
            return found
        except Exception:
            return []

    def _fetch_opencode_live() -> List[Dict[str, str]]:
        oc_bin = Path("/home/freecoder/.opencode/bin/opencode")
        if not safe_path_exists(oc_bin):
            return []
        try:
            cmd = (
                ["su", "-", "freecoder", "-c", f"{oc_bin} models"]
                if os.geteuid() == 0
                else [str(oc_bin), "models"]
            )
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
            if res.returncode != 0 or not res.stdout:
                return []
            found: List[Dict[str, str]] = []
            for raw_line in res.stdout.splitlines():
                slug = raw_line.strip()
                if not slug or "/" not in slug:
                    continue
                if slug.startswith(("opencode/", "abacus/")):
                    prov, short_name = slug.split("/", 1)
                    found.append({
                        "id": slug,
                        "label": short_name,
                        "provider": "OpenCode" if prov == "opencode" else "Abacus",
                        "endpoint": "opencode models",
                        "source": "live",
                        "badge": "FREE" if slug.endswith("-free") else "LIVE"
                    })
            return found
        except Exception:
            return []

    def _fetch_codex_live() -> List[Dict[str, str]]:
        found: List[Dict[str, str]] = []
        seen: set = set()
        active_slug = ""
        cfg_toml = Path("/home/thecodexer/.codex/config.toml")
        if safe_path_exists(cfg_toml):
            try:
                txt = cfg_toml.read_text(encoding="utf-8", errors="ignore")
                m_act = re.search(r'^\s*model\s*=\s*"([^"]+)"', txt, re.M)
                if m_act:
                    active_slug = m_act.group(1).strip()
            except Exception:
                pass
        cache_file = Path("/home/thecodexer/.codex/models_cache.json")
        if safe_path_exists(cache_file):
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8", errors="ignore"))
                models = data.get("models", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                for m in models:
                    if not isinstance(m, dict):
                        continue
                    slug = str(m.get("slug") or m.get("id") or "").strip()
                    vis = str(m.get("visibility") or "list").lower()
                    if not slug or (vis == "hide" and slug != active_slug):
                        continue
                    if slug.lower() in seen:
                        continue
                    seen.add(slug.lower())
                    label = str(m.get("display_name") or m.get("name") or slug).strip()
                    found.append({
                        "id": slug,
                        "label": label,
                        "provider": "OpenAI / Codex",
                        "endpoint": "codex models_cache.json",
                        "source": "live",
                        "badge": "ACTIVE" if slug == active_slug else "LIVE"
                    })
            except Exception:
                pass
        if active_slug and active_slug.lower() not in seen:
            found.insert(0, {
                "id": active_slug,
                "label": active_slug,
                "provider": "OpenAI / Codex",
                "endpoint": "codex config.toml",
                "source": "live",
                "badge": "ACTIVE"
            })
        return found

    def _fetch_claude_live() -> List[Dict[str, str]]:
        found: List[Dict[str, str]] = []
        seen: set = set()
        claude_json = Path("/home/freecoder/.claude.json")
        if safe_path_exists(claude_json):
            try:
                data = json.loads(claude_json.read_text(encoding="utf-8", errors="ignore"))
                for item in data.get("additionalModelOptionsCache") or []:
                    if not isinstance(item, dict):
                        continue
                    val = str(item.get("value") or "").strip()
                    if not val or val.lower() in seen:
                        continue
                    seen.add(val.lower())
                    lbl = str(item.get("label") or val).strip()
                    desc = str(item.get("description") or "").strip()
                    found.append({
                        "id": val,
                        "label": f"{lbl} — {desc}" if desc else lbl,
                        "provider": "Anthropic / Claude CLI",
                        "endpoint": "claude.json",
                        "source": "live",
                        "badge": "LIVE"
                    })
                for k in (data.get("additionalModelCostsCache") or {}).keys():
                    val = str(k).strip()
                    if val and val.lower() not in seen:
                        seen.add(val.lower())
                        found.append({
                            "id": val,
                            "label": val,
                            "provider": "Anthropic / Claude CLI",
                            "endpoint": "claude.json",
                            "source": "live",
                            "badge": "LIVE"
                        })
            except Exception:
                pass
        for item in ENGINE_MODEL_CATALOG_STATIC.get("claude", []):
            mid = str(item.get("id") or "").strip()
            if mid and mid.lower() not in seen:
                seen.add(mid.lower())
                entry = dict(item)
                entry.setdefault("endpoint", "claude-cli")
                entry.setdefault("source", "live")
                found.append(entry)
        return found

    def _fetch_hermes_live() -> List[Dict[str, str]]:
        import yaml
        found: List[Dict[str, str]] = []
        seen: set = set()
        hermes_home = Path("/home/agents_bs/.hermes")
        cfg_file = hermes_home / "config.yaml"
        cache_file = hermes_home / "provider_models_cache.json"

        provider_urls: Dict[str, str] = {}
        active_default = ""
        if safe_path_exists(cfg_file):
            try:
                cfg = yaml.safe_load(cfg_file.read_text(encoding="utf-8", errors="ignore")) or {}
                for p_name, p_val in (cfg.get("providers") or {}).items():
                    if isinstance(p_val, dict) and p_val.get("base_url"):
                        provider_urls[str(p_name).strip().lower()] = str(p_val["base_url"]).strip()

                m_sec = cfg.get("model")
                if isinstance(m_sec, dict) and m_sec.get("default"):
                    active_default = str(m_sec["default"]).strip()
                    act_prov = str(m_sec.get("provider") or "nvidia").strip().lower()
                    act_url = str(m_sec.get("base_url") or provider_urls.get(act_prov, "")).strip()
                    full_id = active_default if ("/" in active_default and active_default.split("/")[0] == act_prov) or act_prov == "nvidia" else f"{act_prov}/{active_default}"
                    seen.add(full_id.lower())
                    found.append({
                        "id": full_id,
                        "label": active_default,
                        "provider": f"Hermes / {act_prov.upper()}",
                        "endpoint": act_url or act_prov,
                        "source": "live",
                        "badge": "ACTIVE"
                    })

                for ag in cfg.get("agents") or []:
                    if not isinstance(ag, dict) or not ag.get("model"):
                        continue
                    m_id = str(ag["model"]).strip()
                    if m_id.lower() in seen:
                        continue
                    seen.add(m_id.lower())
                    prov = m_id.split("/")[0].lower() if "/" in m_id else "hermes"
                    found.append({
                        "id": m_id,
                        "label": f"{m_id} ({ag.get('name', 'Agent')})",
                        "provider": f"Hermes / {prov.upper()}",
                        "endpoint": provider_urls.get(prov, prov),
                        "source": "live",
                        "badge": "CONFIG"
                    })

                for fb in cfg.get("fallback_providers") or []:
                    if not isinstance(fb, dict) or not fb.get("model"):
                        continue
                    prov = str(fb.get("provider") or "").strip().lower()
                    raw_m = str(fb["model"]).strip()
                    full_id = raw_m if (not prov or prov == "nvidia" or raw_m.startswith(f"{prov}/")) else f"{prov}/{raw_m}"
                    if full_id.lower() in seen:
                        continue
                    seen.add(full_id.lower())
                    found.append({
                        "id": full_id,
                        "label": raw_m,
                        "provider": f"Hermes / {prov.upper() or 'FALLBACK'}",
                        "endpoint": str(fb.get("base_url") or provider_urls.get(prov, prov)),
                        "source": "live",
                        "badge": "FALLBACK"
                    })
            except Exception:
                pass

        if safe_path_exists(cache_file):
            try:
                cdata = json.loads(cache_file.read_text(encoding="utf-8", errors="ignore"))
                if isinstance(cdata, dict):
                    # Map cache keys cleanly to configured provider names
                    key_order = [
                        ("nvidia", "nvidia", "integrate.api.nvidia.com", 25),
                        ("custom:https://routellm.abacus.ai/v1", "abacus", "routellm.abacus.ai", 30),
                        ("custom:https://api.groq.com/openai/v1", "groq", "api.groq.com", 15),
                        ("openrouter", "openrouter", "openrouter.ai", 25),
                        ("opencode-free", "opencode-free", "opencode-free", 10),
                    ]
                    for prefix, prov_name, host_label, cap in key_order:
                        matched_keys = [k for k in cdata.keys() if k == prefix or k.startswith(prefix)]
                        count = 0
                        for ck in matched_keys:
                            entry_obj = cdata.get(ck)
                            m_list = entry_obj.get("models", []) if isinstance(entry_obj, dict) else (entry_obj if isinstance(entry_obj, list) else [])
                            for m in m_list:
                                if count >= cap:
                                    break
                                raw_id = str(m.get("id") if isinstance(m, dict) else m).strip()
                                if not raw_id:
                                    continue
                                full_id = raw_id if (prov_name in ("nvidia", "opencode-free") or raw_id.startswith(f"{prov_name}/")) else f"{prov_name}/{raw_id}"
                                if full_id.lower() in seen:
                                    continue
                                seen.add(full_id.lower())
                                found.append({
                                    "id": full_id,
                                    "label": raw_id,
                                    "provider": f"Hermes / {prov_name.upper()}",
                                    "endpoint": provider_urls.get(prov_name, host_label),
                                    "source": "live",
                                    "badge": "FREE" if "free" in raw_id.lower() or prov_name == "opencode-free" else "LIVE"
                                })
                                count += 1
            except Exception:
                pass
        return found

    with ThreadPoolExecutor(max_workers=5) as pool:
        fut_agy = pool.submit(_fetch_agy_live)
        fut_oc = pool.submit(_fetch_opencode_live)
        fut_codex = pool.submit(_fetch_codex_live)
        fut_claude = pool.submit(_fetch_claude_live)
        fut_hermes = pool.submit(_fetch_hermes_live)

        live_map = {
            "agy": fut_agy.result(),
            "opencode": fut_oc.result(),
            "codex": fut_codex.result(),
            "claude": fut_claude.result(),
            "hermes": fut_hermes.result(),
        }

    catalog: Dict[str, List[Dict[str, str]]] = {}
    sources: Dict[str, Dict[str, Any]] = {}
    for eng, static_items in ENGINE_MODEL_CATALOG_STATIC.items():
        live_items = live_map.get(eng) or []
        if live_items:
            catalog[eng] = list(live_items)
            sources[eng] = {"mode": "live", "count": len(live_items)}
        else:
            catalog[eng] = [dict(x, source="static") for x in static_items]
            sources[eng] = {"mode": "static", "count": len(static_items)}

    # Merge persisted user-entered custom models per engine
    custom_models = get_custom_models()
    for eng_key, custom_items in custom_models.items():
        if not isinstance(custom_items, list):
            continue
        target_list = catalog.setdefault(eng_key, [])
        seen_ids = {str(m.get("id", "")).lower() for m in target_list}
        for cm in custom_items:
            if not isinstance(cm, dict) or not cm.get("id"):
                continue
            cm_id = str(cm["id"]).strip()
            if cm_id.lower() not in seen_ids:
                target_list.append({
                    "id": cm_id,
                    "label": cm.get("label") or cm_id,
                    "provider": cm.get("provider") or "Custom",
                    "endpoint": "custom",
                    "source": "custom",
                    "badge": cm.get("badge") or "CUSTOM"
                })
                seen_ids.add(cm_id.lower())

    result = {
        "engines": catalog,
        "defaults": {k: v["default_model"] for k, v in ENGINE_DEFAULTS.items()},
        "sources": sources,
        "cached_at": int(now)
    }
    _ENGINE_CATALOG_CACHE["ts"] = now
    _ENGINE_CATALOG_CACHE["data"] = result
    return result

def get_engine_active_model(eng_id: str, username: str, agent_name: Optional[str] = None) -> str:
    # 1. Check specialist / agent overrides first
    override_model = get_agent_override_model(agent_name, username=username, eng_id=eng_id)
    if override_model:
        if eng_id == "agy":
            return normalize_agy_model_slug(override_model)
        return override_model

    user_home = Path(f"/home/{username}")
    if eng_id == "claude":
        cfg_path = user_home / ".claude.json"
        if cfg_path.exists():
            try:
                with open(cfg_path, "r") as f:
                    data = json.load(f)
                    ws_key = f"/home/{username}"
                    last_usage = data.get("projects", {}).get(ws_key, {}).get("lastModelUsage", {})
                    if last_usage:
                        last_m = list(last_usage.keys())[-1]
                        if not any(k in last_m for k in ("claude-3", "sonnet-3", "haiku-3")):
                            return last_m
            except Exception:
                pass
        return ENGINE_DEFAULTS.get("claude", {}).get("default_model", "claude-sonnet-5-5")

    elif eng_id == "agy":
        cfg_path = user_home / ".gemini/antigravity-cli/settings.json"
        if cfg_path.exists():
            try:
                with open(cfg_path, "r") as f:
                    data = json.load(f)
                    m = data.get("model")
                    if m:
                        return normalize_agy_model_slug(str(m))
            except Exception:
                pass
        return ENGINE_DEFAULTS.get("agy", {}).get("default_model", "gemini-3.8-flash-medium")

    elif eng_id == "opencode":
        return ENGINE_DEFAULTS.get("opencode", {}).get("default_model", "opencode/mimo-v2.6-flash-free")

    elif eng_id == "codex":
        return ENGINE_DEFAULTS.get("codex", {}).get("default_model", "gpt-6-luna")

    else:  # hermes
        # Check user's specific agent definition in home config.yaml first
        inst_cfg = user_home / "config.yaml"
        try:
            if inst_cfg.exists() and agent_name:
                with open(inst_cfg, "r") as f:
                    cfg = yaml.safe_load(f) or {}
                    for a in cfg.get("agents", []):
                        if a.get("name", "").lower() == agent_name.lower() and a.get("model"):
                            return a["model"].strip()
        except Exception:
            pass

        # Then check user's .hermes/config.yaml
        cfg_path = user_home / ".hermes/config.yaml"
        try:
            if cfg_path.exists():
                with open(cfg_path, "r") as f:
                    cfg = yaml.safe_load(f) or {}
                    if agent_name:
                        for a in cfg.get("agents", []):
                            if a.get("name", "").lower() == agent_name.lower() and a.get("model"):
                                return a["model"].strip()
                    m = cfg.get("model", {}).get("default") or cfg.get("default_model")
                    if m:
                        return m
        except Exception:
            pass
        return ENGINE_DEFAULTS.get("hermes", {}).get("default_model", "nvidia/nemotron-3-ultra-550b-a55b")

def resolve_fleet_primary_engine(username: str) -> Tuple[str, str, str]:
    """
    Returns (engine_id, color, theme) for the fleet based on runtime detection:
    1. First priority: any daemon actively running for this user
    2. Second priority: any installed/configured engine
    3. Fallback: ('hermes', '#10b981', 'custom')
    """
    engines = detect_user_engines(username)
    # Check for active running daemons
    for eng_id in ["agy", "claude", "opencode", "codex", "hermes"]:
        if engines.get(eng_id, {}).get("daemon_running"):
            meta = ENGINE_DEFAULTS.get(eng_id, {"color": "#10b981", "theme": "custom"})
            return eng_id, meta["color"], meta["theme"]
    # Check for installed engines
    for eng_id in ["agy", "claude", "opencode", "codex", "hermes"]:
        if engines.get(eng_id, {}).get("installed"):
            meta = ENGINE_DEFAULTS.get(eng_id, {"color": "#10b981", "theme": "custom"})
            return eng_id, meta["color"], meta["theme"]
    return "hermes", "#10b981", "custom"

def discover_instances() -> Dict[str, Dict[str, Any]]:
    """
    BL-SYS-24: Autonomous Dynamic Linux User & Fleet Instance Discovery.
    Discovers all approved base fleets as well as any Linux system users with UID >= 1000
    who have an active AI daemon, a .hermes folder, or an agent workspace directory.
    """
    instances = {}

    # 1. First populate registered base instances
    for fleet_key in APPROVED_FLEETS:
        if fleet_key in BASE_INSTANCES:
            cfg = dict(BASE_INSTANCES[fleet_key])
            user_dir = Path(f"/home/{fleet_key}")
            ws_dir = user_dir / "workspace"
            if safe_path_exists(ws_dir):
                cfg["workspace"] = ws_dir
            instances[fleet_key] = cfg

    # 2. Dynamically scan all system users (UID >= 1000) for agent environments or daemons
    try:
        for entry in pwd.getpwall():
            uname = entry.pw_name
            if entry.pw_uid < 1000 or uname == "nobody" or uname in instances:
                continue
            
            home_dir = Path(entry.pw_dir)
            if not home_dir.is_absolute() or not str(home_dir).startswith("/home/"):
                continue

            has_hermes = safe_path_exists(home_dir / ".hermes")
            has_workspace = safe_path_exists(home_dir / "workspace")
            
            # Check if any user-owned engine is actively running or configured
            engines = detect_user_engines(uname)
            has_running_engine = any(e.get("daemon_running") for e in engines.values())
            has_configured_engine = any(e.get("config_found") for e in engines.values())

            if has_hermes or has_workspace or has_running_engine or has_configured_engine:
                engine_id, color, theme = resolve_fleet_primary_engine(uname)
                ws_path = home_dir / "workspace" if has_workspace else home_dir
                instances[uname] = {
                    "user": uname,
                    "home": home_dir / ".hermes" if has_hermes else home_dir,
                    "workspace": ws_path,
                    "label": uname.capitalize(),
                    "badge": engine_id.upper() if has_running_engine else "FLEET",
                    "color": "cyan" if engine_id == "codex" else ("emerald" if color == "#10b981" else "indigo")
                }
    except Exception as e:
        print(f"[DISCOVERY] Warning during dynamic user scan: {e}")

    return instances

def get_instance_user_context(inst_key: Optional[str] = None) -> Dict[str, Any]:
    all_instances = discover_instances()
    if not inst_key or inst_key not in all_instances:
        inst_key = "agents_bs" if "agents_bs" in all_instances else list(all_instances.keys())[0]
    inst = all_instances[inst_key]
    user = inst["user"]
    try:
        pw = pwd.getpwnam(user)
        uid = pw.pw_uid
        gid = pw.pw_gid
    except KeyError:
        uid, gid = 1000, 1000

    xdg_runtime = f"/run/user/{uid}" if Path(f"/run/user/{uid}").exists() else "/tmp"

    return {
        "key": inst_key,
        "user": user,
        "uid": uid,
        "gid": gid,
        "xdg_runtime": xdg_runtime,
        "home": Path(inst["home"]),
        "workspace": Path(inst["workspace"]),
        "label": inst.get("label", user),
        "badge": inst.get("badge", "FLEET"),
        "color": inst.get("color", "emerald")
    }

def resolve_instance_key(request: Optional[Request] = None, inst_param: Optional[str] = None) -> str:
    if inst_param and str(inst_param).strip():
        return str(inst_param).strip()
    if request:
        hdr = request.headers.get("X-NexusDesk-Instance")
        if hdr and hdr.strip():
            return hdr.strip()
        qp = request.query_params.get("instance")
        if qp and qp.strip():
            return qp.strip()
    return "agents_bs"

def set_instance_perms(path: Path, inst_key: str = "agents_bs"):
    ctx = get_instance_user_context(inst_key)
    try:
        shutil.chown(path, user=ctx["user"], group=ctx["user"])
        os.chmod(path, 0o775 if path.is_dir() else 0o664)
    except Exception:
        pass

def backup_file(file_path: Path):
    if file_path.exists():
        backup_path = file_path.with_name(f"{file_path.name}.bak.{int(time.time())}")
        try:
            shutil.copy2(file_path, backup_path)
        except Exception:
            pass

# Unified agent themes, palettes and voices (BL-TTS-15 Personalized Profiles)
AGENT_PALETTE: Dict[str, Dict[str, Any]] = {
    "solaris": {"color": "#10b981", "theme": "emerald", "voice": {"voiceName": "en-US-EricNeural", "pitch": 1.0, "rate": 1.0, "gender": "male"}},
    "scribe": {"color": "#3b82f6", "theme": "blue", "voice": {"voiceName": "en-US-JennyNeural", "pitch": 1.05, "rate": 1.0, "gender": "female"}},
    "pylon": {"color": "#ef4444", "theme": "red", "voice": {"voiceName": "en-GB-RyanNeural", "pitch": 0.9, "rate": 0.95, "gender": "male"}},
    "lore": {"color": "#8b5cf6", "theme": "purple", "voice": {"voiceName": "en-GB-SoniaNeural", "pitch": 0.95, "rate": 0.95, "gender": "female"}},
    "chroma": {"color": "#ec4899", "theme": "pink", "voice": {"voiceName": "en-US-AnaNeural", "pitch": 1.1, "rate": 1.05, "gender": "female"}},
    "chorusius": {"color": "#14b8a6", "theme": "teal", "voice": {"voiceName": "en-US-BrianNeural", "pitch": 1.0, "rate": 1.0, "gender": "male"}},
    "claude": {"color": "#f59e0b", "theme": "amber", "voice": {"voiceName": "en-US-ChristopherNeural", "pitch": 1.0, "rate": 1.0, "gender": "male"}},
    "agy": {"color": "#0284c7", "theme": "sky", "voice": {"voiceName": "en-US-AriaNeural", "pitch": 1.0, "rate": 1.05, "gender": "female"}},
    "opencode": {"color": "#a855f7", "theme": "violet", "voice": {"voiceName": "en-US-SteffanNeural", "pitch": 0.95, "rate": 1.0, "gender": "male"}},
    "codex": {"color": "#06b6d4", "theme": "cyan", "voice": {"voiceName": "en-US-GuyNeural", "pitch": 0.95, "rate": 1.0, "gender": "male"}},
    "thecodexer": {"color": "#06b6d4", "theme": "cyan", "voice": {"voiceName": "en-US-GuyNeural", "pitch": 0.95, "rate": 1.0, "gender": "male"}},
    "desktop": {"color": "#eab308", "theme": "yellow", "voice": {"voiceName": "en-US-RogerNeural", "pitch": 0.95, "rate": 1.0, "gender": "male"}},
}

# Shared WebSocket connection list & Event broadcaster
connected_websockets: List[WebSocket] = []
chat_history: Dict[str, List[Dict[str, Any]]] = {}

async def broadcast_event(event_type: str, data: Dict[str, Any]):
    message = json.dumps({"type": event_type, "data": data, "timestamp": time.time()})
    disconnected = []
    for ws in connected_websockets:
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in connected_websockets:
            connected_websockets.remove(ws)

    # BL-SYS-01 & BL-EVO-19: escalate selected events to the operator's outbound gateways (Telegram/WhatsApp/Email/Webhook)
    if event_type in ("war_room_user_mentioned", "war_room_task_failed", "war_room_task_completed"):
        try:
            import asyncio
            from services.gateways import escalate_event
            asyncio.get_running_loop().create_task(escalate_event(event_type, data, len(connected_websockets)))
        except Exception:
            pass
