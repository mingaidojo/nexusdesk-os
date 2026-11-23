"""
NexusDesk War Room Conference Participants & Whitelisting Service
Handles cross-fleet agent discovery, participant whitelisting, special mentions, and room-scoped queries.
Part of BL-ARCH-32 modularization.
"""

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional
import yaml

from core.config import (
    DATA_DIR,
    AGENT_PALETTE,
    discover_instances,
    get_instance_user_context,
    get_specialist_overrides,
    get_engine_active_model
)

ROOMS_META_FILE = DATA_DIR / "war_room_rooms.json"
DEFAULT_WARROOM_PANEL = ["solaris", "claude", "agy"]

def safe_read_yaml_file(path: Path, user: Optional[str] = None) -> dict:
    try:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
    except PermissionError:
        cmd = ["sudo", "cat", str(path)]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=1.5)
        if res.returncode == 0 and res.stdout.strip():
            return yaml.safe_load(res.stdout) or {}
    except Exception:
        pass
    return {}

def get_all_rooms() -> List[Dict[str, Any]]:
    default_rooms = [
        {"id": "general", "name": "War Room: General", "type": "warroom", "created_at": 0, "is_default": True}
    ]
    if not ROOMS_META_FILE.exists():
        return default_rooms
    try:
        with open(ROOMS_META_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list) and data:
                return data
    except Exception:
        pass
    return default_rooms

def save_rooms(rooms: List[Dict[str, Any]]) -> None:
    try:
        with open(ROOMS_META_FILE, "w", encoding="utf-8") as f:
            json.dump(rooms, f, indent=2)
    except Exception as e:
        print(f"[WAR_ROOM_PARTICIPANTS] Warning saving rooms: {e}")

def clear_agent_room_overrides(agent_name: str, only_room_id: Optional[str] = None) -> int:
    """Removes per-room model_overrides for an agent across all (or a specific) War Room."""
    agent_key = (agent_name or "").lower().strip()
    if not agent_key:
        return 0
    rooms = get_all_rooms()
    cleared = 0
    for r in rooms:
        if only_room_id and r.get("id") != only_room_id:
            continue
        overrides = r.get("model_overrides")
        if isinstance(overrides, dict) and agent_key in overrides:
            del overrides[agent_key]
            cleared += 1
    if cleared:
        save_rooms(rooms)
    return cleared

def get_all_conference_participants() -> List[Dict[str, Any]]:
    participants = []
    seen_names = set()
    overrides = get_specialist_overrides()

    all_instances = discover_instances()
    for inst_key, inst_info in all_instances.items():
        ctx = get_instance_user_context(inst_key)
        cfg_file = ctx["home"] / "config.yaml"
        cfg = safe_read_yaml_file(cfg_file)
        
        cfg_agents = cfg.get("agents", [])
        for a in cfg_agents:
            name = a.get("name")
            if not name:
                continue
            normalized_name = name.strip()
            lower_name = normalized_name.lower()
            if lower_name in seen_names:
                continue
            seen_names.add(lower_name)

            engine = (a.get("engine") or "hermes").lower().strip()
            model_val = a.get("model") or ""
            role_val = a.get("role", "Specialist Agent")
            ov = overrides.get(f"{inst_key.lower()}:{lower_name}") or overrides.get(lower_name)
            if isinstance(ov, dict):
                if ov.get("model"):
                    model_val = ov["model"]
                if ov.get("engine"):
                    engine = ov["engine"].lower().strip()
                if ov.get("role"):
                    role_val = ov["role"]
            if not model_val:
                model_val = get_engine_active_model(engine, ctx["user"], agent_name=normalized_name)

            palette = AGENT_PALETTE.get(lower_name, {
                "color": "#06b6d4",
                "theme": "cyan",
                "voice": {"pitch": 1.0, "rate": 1.0, "gender": "neutral"}
            })

            participants.append({
                "id": lower_name,
                "name": normalized_name,
                "role": role_val,
                "engine": engine,
                "model": model_val,
                "fleet": inst_key,
                "user": ctx["user"],
                "color": palette["color"],
                "theme": palette["theme"],
                "voice": palette["voice"],
                "workspace_dir": a.get("workspace_dir") or str(ctx["workspace"])
            })

    specialists = [
        {
            "name": "Claude",
            "role": "Architect & Systems Engineering Specialist",
            "engine": "claude",
            "fleet": "freecoder",
            "user": "freecoder",
            "model": get_engine_active_model("claude", "freecoder", agent_name="claude")
        },
        {
            "name": "Agy",
            "role": "Research & Antigravity Autonomy Specialist",
            "engine": "agy",
            "fleet": "myvirtualcoder",
            "user": "myvirtualcoder",
            "model": get_engine_active_model("agy", "myvirtualcoder", agent_name="agy")
        },
        {
            "name": "OpenCode",
            "role": "Open-Source Multi-Model Code Specialist",
            "engine": "opencode",
            "fleet": "freecoder",
            "user": "freecoder",
            "model": get_engine_active_model("opencode", "freecoder", agent_name="opencode")
        },
        {
            "name": "Codex",
            "role": "OpenAI Codex Autonomous Engineering Specialist",
            "engine": "codex",
            "fleet": "thecodexer",
            "user": "thecodexer",
            "model": get_engine_active_model("codex", "thecodexer", agent_name="codex")
        },
        {
            "name": "Desktop",
            "role": "Local Workstation & GUI Automation Specialist",
            "engine": "hermes",
            "fleet": "desktop",
            "user": "desktop",
            "model": get_engine_active_model("hermes", "desktop", agent_name="desktop")
        }
    ]

    for sp in specialists:
        lower_name = sp["name"].lower()
        if lower_name in overrides and isinstance(overrides[lower_name], dict):
            sp.update({k: v for k, v in overrides[lower_name].items() if v})

        if lower_name not in seen_names:
            palette = AGENT_PALETTE.get(lower_name, {
                "color": "#38bdf8",
                "theme": "sky",
                "voice": {"pitch": 1.0, "rate": 1.0, "gender": "neutral"}
            })
            ctx = get_instance_user_context(sp["fleet"])
            participants.append({
                "id": lower_name,
                "name": sp["name"],
                "role": sp["role"],
                "engine": sp["engine"],
                "model": sp.get("model") or get_engine_active_model(sp["engine"], sp["user"], agent_name=sp["name"]),
                "fleet": sp["fleet"],
                "user": sp["user"],
                "color": palette["color"],
                "theme": palette["theme"],
                "voice": palette["voice"],
                "workspace_dir": str(ctx["workspace"])
            })
            seen_names.add(lower_name)

    return participants

def get_room_participants(room_id: str) -> List[Dict[str, Any]]:
    all_participants = get_all_conference_participants()
    rid = (room_id or "general").strip()
    rooms = get_all_rooms()
    matched_room = next((r for r in rooms if r.get("id") == rid), None) if rid != "general" else None
    
    if rid == "general" or not matched_room:
        res = all_participants
    else:
        allowed_names = matched_room.get("participants")
        if allowed_names is None or not isinstance(allowed_names, list) or len(allowed_names) == 0:
            allowed_names = DEFAULT_WARROOM_PANEL
        allowed_set = {n.lower().strip() for n in allowed_names}
        filtered = [p for p in all_participants if p["name"].lower().strip() in allowed_set or p["id"].lower().strip() in allowed_set]
        res = filtered if filtered else [p for p in all_participants if p["id"] in DEFAULT_WARROOM_PANEL]

    if matched_room and isinstance(matched_room.get("model_overrides"), dict):
        room_models = matched_room["model_overrides"]
        copied = []
        for p in res:
            p_copy = dict(p)
            p_name_lower = p_copy["name"].lower().strip()
            p_id_lower = p_copy["id"].lower().strip()
            override_model = room_models.get(p_name_lower) or room_models.get(p_id_lower)
            if override_model:
                p_copy["model"] = override_model
                p_copy["is_room_model"] = True
            copied.append(p_copy)
        return copied

    return res

def resolve_participant(query: str, participants: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    q = query.lower().strip().lstrip("@")
    if not q:
        return None
    for p in participants:
        if p["id"] == q or p["name"].lower() == q:
            return p
    for p in participants:
        if p["engine"].lower() == q:
            return p
    for p in participants:
        if p["id"].startswith(q) or p["name"].lower().startswith(q):
            return p
    return None

def parse_special_mentions(text: str) -> Dict[str, bool]:
    if not text:
        return {"is_broadcast": False, "mentions_user": False}
    is_broadcast = bool(re.search(r'@(everyone|everyagents|all)\b', text, re.IGNORECASE))
    mentions_user = bool(re.search(r'@(user|min|operator|human)\b', text, re.IGNORECASE))
    return {"is_broadcast": is_broadcast, "mentions_user": mentions_user}

def parse_all_mentions(text: str, participants: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    matches = re.findall(r'@([a-zA-Z0-9_\-]+)', text)
    found = []
    seen = set()
    for m in matches:
        ml = m.lower()
        if ml in ("everyone", "everyagents", "all", "user", "min", "operator", "human"):
            continue
        p = resolve_participant(m, participants)
        if p and p["id"] not in seen:
            found.append(p)
            seen.add(p["id"])
    return found

def find_unroped_mentions(text: str, room_participants: List[Dict[str, Any]], all_participants: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    matches = re.findall(r'@([a-zA-Z0-9_\-]+)', text)
    unroped = []
    seen = set()
    room_ids = {p["id"] for p in room_participants}
    room_names = {p["name"].lower() for p in room_participants}
    for m in matches:
        ml = m.lower()
        if ml in ("everyone", "everyagents", "all", "all-agents", "room", "user", "min", "operator", "human", "admin"):
            continue
        if ml in room_names or ml in room_ids:
            continue
        p = resolve_participant(m, all_participants)
        if p and p["id"] not in seen and p["id"] not in room_ids:
            unroped.append(p)
            seen.add(p["id"])
    return unroped

def get_broadcast_panelists(participants: List[Dict[str, Any]], exclude_id: Optional[str] = None) -> List[Dict[str, Any]]:
    selected = []
    seen = set()
    for p in participants:
        pid = p["id"]
        if pid != exclude_id and pid not in seen:
            selected.append(p)
            seen.add(pid)
        if len(selected) >= 5:
            break
    return selected[:4]
