"""
NexusDesk War Room Dispatcher & Routing Orchestrator (BL-WAR-41)
Two-Stage Intelligent Dispatcher:
  Stage 1: Fast LLM Semantic Router (Sub-second routing using active providers e.g. Gemini 2.5 Flash / OpenRouter)
  Stage 2: Deterministic Rule Engine Fallback (Recency, Q&A question cues, Inquiries, Cold fallback)
With dynamically editable configuration persisted to backend/data/war_room_routing_rules.json.
"""

import os
import re
import json
import time
import urllib.request
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from core.config import DATA_DIR, get_instance_user_context

DISPATCHER_CONFIG_FILE = DATA_DIR / "war_room_routing_rules.json"

DEFAULT_DISPATCHER_CONFIG: Dict[str, Any] = {
    "llm_router_enabled": True,
    "llm_source": "agent",               # "agent" or "custom"
    "llm_agent_name": "Chroma",          # Agent whose model credentials to borrow (e.g. Chroma=gemini-3.8-flash, Solaris=nemotron-3-ultra)
    "llm_provider": "abacus",            # Fallback/dedicated provider: "abacus", "openrouter", "nvidia"
    "llm_model": "gemini-2.5-flash",     # or "gemini-3.8-flash", "google/gemini-2.5-flash", "gpt-4o-mini"
    "llm_timeout_seconds": 2.0,
    "confidence_threshold": 0.70,
    "fixed_rules": {
        "check_plain_text_names": True,
        "check_last_speaker_question": True,
        "check_pending_inquiries": True,
        "check_recent_user_mention": True,
        "check_last_healthy_speaker": True,
        "default_fallback_agent": "Solaris",
        "skip_failed_agents": True,
        "inquiry_recency_max_turns": 4
    }
}

def load_dispatcher_config() -> Dict[str, Any]:
    """Loads dispatcher settings from disk, falling back to defaults."""
    if DISPATCHER_CONFIG_FILE.exists():
        try:
            with open(DISPATCHER_CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                merged = dict(DEFAULT_DISPATCHER_CONFIG)
                merged.update(saved)
                # Ensure nested fixed_rules is merged
                if "fixed_rules" in saved and isinstance(saved["fixed_rules"], dict):
                    merged_rules = dict(DEFAULT_DISPATCHER_CONFIG["fixed_rules"])
                    merged_rules.update(saved["fixed_rules"])
                    merged["fixed_rules"] = merged_rules
                return merged
        except Exception as e:
            print(f"[WAR_ROOM_DISPATCHER] Warning loading config: {e}")
    return dict(DEFAULT_DISPATCHER_CONFIG)

def save_dispatcher_config(config_data: Dict[str, Any]) -> bool:
    """Saves updated dispatcher settings to disk."""
    try:
        current = load_dispatcher_config()
        current.update(config_data)
        if "fixed_rules" in config_data and isinstance(config_data["fixed_rules"], dict):
            current["fixed_rules"].update(config_data["fixed_rules"])
        with open(DISPATCHER_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[WAR_ROOM_DISPATCHER] Error saving config: {e}")
        return False

def get_llm_provider_creds(provider_name: str = "abacus", inst_key: str = "agents_bs") -> Optional[Dict[str, str]]:
    """Retrieves API key and base_url for the selected provider from hermes config."""
    try:
        import yaml
        ctx = get_instance_user_context(inst_key)
        cfg_file = ctx["home"] / "config.yaml"
        if not cfg_file.exists():
            return None
        with open(cfg_file, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        providers = cfg.get("providers", {})
        
        # 1. Direct match
        if provider_name in providers and providers[provider_name].get("api_key"):
            p = providers[provider_name]
            return {"api_key": p.get("api_key"), "base_url": p.get("base_url", "")}
            
        # 2. Fallbacks: abacus -> openrouter -> nvidia
        for fallback in ["abacus", "openrouter", "nvidia"]:
            if fallback in providers and providers[fallback].get("api_key"):
                p = providers[fallback]
                return {"api_key": p.get("api_key"), "base_url": p.get("base_url", "")}
    except Exception as e:
        print(f"[WAR_ROOM_DISPATCHER] Provider creds lookup failed: {e}")
    return None

def get_available_dispatcher_agents() -> List[Dict[str, Any]]:
    """
    Dynamically auto-detects all available conference and fleet agents (Solaris, Claude, Agy,
    OpenCode, Codex, Chroma, Pylon, etc.) and provides verbose metadata on their available LLMs,
    latency tiers, provider pathways, and custom model choices without artificial limits.
    """
    from services.war_room.participants import get_all_conference_participants
    from core.config import ENGINE_MODEL_CATALOG_STATIC
    import yaml
    
    providers = {}
    try:
        ctx = get_instance_user_context("agents_bs")
        cfg_file = ctx["home"] / "config.yaml"
        if cfg_file.exists():
            with open(cfg_file, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            providers = cfg.get("providers", {})
    except Exception:
        pass

    all_agents = get_all_conference_participants()
    results = []

    # Rich model options per engine without limiting choices
    common_frontier_models = [
        {"id": "gemini-2.5-flash", "label": "Google Gemini 2.5 Flash (~0.9s)", "provider": "abacus", "tier": "Sub-Second Ultra Fast"},
        {"id": "gemini-3.8-flash", "label": "Google Gemini 3.8 Flash (~1.5s)", "provider": "abacus", "tier": "Fast Multimodal"},
        {"id": "claude-sonnet-5", "label": "Anthropic Claude Sonnet 5 (~1.8s)", "provider": "abacus", "tier": "Frontier Architecture"},
        {"id": "claude-3-5-haiku", "label": "Anthropic Claude 3.5 Haiku (~1.1s)", "provider": "abacus", "tier": "Sub-Second Fast"},
        {"id": "gpt-4o", "label": "OpenAI GPT-4o (~1.3s)", "provider": "abacus", "tier": "OpenAI Analytical"},
        {"id": "gpt-4o-mini", "label": "OpenAI GPT-4o Mini (~1.0s)", "provider": "abacus", "tier": "Sub-Second Fast"},
        {"id": "deepseek/deepseek-chat", "label": "DeepSeek V3 Reasoning (~1.5s)", "provider": "openrouter", "tier": "Open-Source Fast"},
        {"id": "meta-llama/llama-3.3-70b-instruct", "label": "Llama 3.3 70B Instruct (~1.4s)", "provider": "openrouter", "tier": "Open-Weights Fast"},
        {"id": "nvidia/nemotron-3-ultra-550b-a55b", "label": "NVIDIA Nemotron 3 Ultra 550B (~3s)", "provider": "nvidia", "tier": "Frontier Heavy"}
    ]

    for a in all_agents:
        name = a.get("name", "")
        engine = a.get("engine", "hermes")
        model = a.get("model", "")
        role = a.get("role", "")
        fleet = a.get("fleet", "")

        resolved_model = model
        resolved_provider = "unknown"
        latency_tier = "Standard (~1.5-2.5s)"
        is_supported = False
        verbose_desc = ""

        # Pattern 1: Direct provider in model string (e.g. abacus/gemini-3.8-flash, nvidia/nemotron-3-ultra)
        if "/" in model:
            parts = model.split("/", 1)
            p_cand = parts[0]
            if p_cand in providers and providers[p_cand].get("api_key"):
                resolved_provider = p_cand
                resolved_model = parts[1]
                is_supported = True

        # Pattern 2: Engine-specific frontier mappings for claude, agy, opencode, codex
        if not is_supported:
            if engine == "claude":
                resolved_provider = "abacus"
                resolved_model = "claude-sonnet-5"
                is_supported = bool(providers.get("abacus", {}).get("api_key"))
                latency_tier = "Frontier Architecture (~1.8s)"
                verbose_desc = "Anthropic Claude Sonnet 5 via Abacus Routellm"
            elif engine == "agy":
                resolved_provider = "abacus"
                resolved_model = "gemini-2.5-flash"
                is_supported = bool(providers.get("abacus", {}).get("api_key"))
                latency_tier = "Ultra-Fast DeepMind (~0.9s)"
                verbose_desc = "Google DeepMind Gemini Flash via Abacus Routellm"
            elif engine == "opencode":
                resolved_provider = "openrouter"
                resolved_model = "deepseek/deepseek-chat"
                is_supported = bool(providers.get("openrouter", {}).get("api_key"))
                latency_tier = "Open-Source Fast (~1.5s)"
                verbose_desc = "DeepSeek V3 / OpenCode via OpenRouter"
            elif engine == "codex":
                resolved_provider = "abacus"
                resolved_model = "gpt-4o"
                is_supported = bool(providers.get("abacus", {}).get("api_key"))
                latency_tier = "OpenAI Analytical (~1.3s)"
                verbose_desc = "OpenAI GPT-4o via Abacus Routellm"
            elif engine == "hermes":
                if providers.get("nvidia", {}).get("api_key"):
                    resolved_provider = "nvidia"
                    resolved_model = "nvidia/nemotron-3-ultra-550b-a55b"
                    is_supported = True

        if not verbose_desc:
            verbose_desc = f"{resolved_provider.upper()} • {resolved_model}"
        if "flash" in resolved_model.lower() or "mini" in resolved_model.lower():
            latency_tier = "Sub-Second Ultra Fast (~0.9-1.2s)"

        # Assemble available models for this specific agent without limiting choice
        catalog_models = ENGINE_MODEL_CATALOG_STATIC.get(engine, [])
        agent_models = []
        # First priority: the agent's current configured model
        agent_models.append({
            "id": resolved_model,
            "label": f"Default Active: {resolved_model} ({verbose_desc})",
            "provider": resolved_provider,
            "tier": latency_tier
        })
        # Next: engine catalog models
        for m in catalog_models:
            mid = m.get("id", "")
            if mid and mid != resolved_model:
                agent_models.append({
                    "id": mid,
                    "label": f"{m.get('label', mid)}",
                    "provider": resolved_provider if resolved_provider != "unknown" else "abacus",
                    "tier": "Catalog Option"
                })
        # Next: add all common frontier models without limiting
        for m in common_frontier_models:
            if not any(x["id"] == m["id"] for x in agent_models):
                agent_models.append(m)

        results.append({
            "id": a.get("id"),
            "name": name,
            "engine": engine,
            "role": role,
            "fleet": fleet,
            "model_configured": model,
            "resolved_model": resolved_model,
            "resolved_provider": resolved_provider,
            "latency_tier": latency_tier,
            "verbose_desc": verbose_desc,
            "supported": is_supported,
            "available_models": agent_models
        })

    return results

def resolve_agent_model_creds(agent_name: str, model_override: Optional[str] = None, inst_key: str = "agents_bs") -> Optional[Dict[str, Any]]:
    """
    BL-WAR-41: Utilizes an agent's configured LLM credentials for the dispatcher.
    Dynamically maps any fleet agent (Solaris, Claude, Agy, OpenCode, Codex, Chroma, Pylon, etc.)
    and optional custom model override to its active endpoint.
    """
    try:
        available_list = get_available_dispatcher_agents()
        matched = next((a for a in available_list if a["name"].lower() == agent_name.lower() or a["id"].lower() == agent_name.lower()), None)
        if not matched or not matched.get("supported"):
            return None

        import yaml
        ctx = get_instance_user_context(inst_key)
        cfg_file = ctx["home"] / "config.yaml"
        if not cfg_file.exists():
            return None
        with open(cfg_file, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        providers = cfg.get("providers", {})

        target_model = model_override.strip() if model_override and model_override.strip() else matched["resolved_model"]
        p_name = matched["resolved_provider"]

        # Check if overridden model specifies provider prefix like "openrouter/..." or "abacus/..."
        if "/" in target_model:
            cand_p = target_model.split("/")[0]
            if cand_p in providers:
                p_name = cand_p
                target_model = target_model.split("/", 1)[1]

        # Check if selected model exists in available_models with custom provider
        for am in matched.get("available_models", []):
            if am["id"] == target_model and am.get("provider") and am["provider"] in providers:
                p_name = am["provider"]
                break

        p_cfg = providers.get(p_name, {})
        # If preferred provider missing key, fallback across abacus / openrouter / nvidia
        if not p_cfg.get("api_key"):
            for fb in ["abacus", "openrouter", "nvidia"]:
                if providers.get(fb, {}).get("api_key"):
                    p_name = fb
                    p_cfg = providers[fb]
                    break

        if p_cfg.get("api_key"):
            tier = "Custom LLM"
            if "flash" in target_model.lower() or "mini" in target_model.lower():
                tier = "Sub-Second Ultra Fast (~0.9-1.2s)"
            return {
                "source": f"agent:{matched['name']}",
                "agent_name": matched["name"],
                "engine": matched["engine"],
                "provider": p_name,
                "model": target_model,
                "api_key": p_cfg.get("api_key"),
                "base_url": p_cfg.get("base_url", ""),
                "latency_tier": tier,
                "verbose_desc": f"{p_name.upper()} • {target_model}"
            }
    except Exception as e:
        print(f"[WAR_ROOM_DISPATCHER] resolve_agent_model_creds failed for {agent_name}: {e}")
    return None

def detect_question_or_call_to_action(text: str) -> bool:
    """Checks if a message text poses a question, choice, or prompt to the user."""
    if not text:
        return False
    # Strip executive summary if present for cleaner inspection
    clean = re.sub(r'<executive_summary>.*?</executive_summary>', '', text, flags=re.DOTALL).strip()
    if not clean:
        clean = text
    
    # Direct question mark in trailing sentences
    if "?" in clean[-350:]:
        return True
        
    # Heuristic prompt cues
    cues = [
        r'\btell\s+me\s+(?:which|what|how|if|whether)\b',
        r'\blet\s+me\s+know\b',
        r'\bwhich\s+(?:one|option|version|file|deck)\b',
        r'\bshould\s+i\s+(?:proceed|continue|run|start|generate)\b',
        r'\bdo\s+you\s+(?:want|prefer|approve)\b',
        r'\bconfirm\s+if\b',
        r'\bwaiting\s+for\s+(?:your|min|user)\b',
        r'\bwaiting\s+on\b'
    ]
    lower = clean.lower()
    for pattern in cues:
        if re.search(pattern, lower):
            return True
    return False

def call_llm_router(
    user_msg: str,
    recent_history: List[Dict[str, Any]],
    participants: List[Dict[str, Any]],
    config: Dict[str, Any]
) -> Optional[Tuple[Dict[str, Any], str]]:
    """
    Stage 1: Fast LLM Semantic Router.
    Analyzes conversation context and operator response to pick the target agent.
    Supports borrowing configured LLM from an agent (e.g. Chroma, Solaris) or dedicated provider.
    Returns (target_agent_dict, reason_string) or None if bypassed/failed.
    """
    if not config.get("llm_router_enabled", True):
        return None

    llm_source = config.get("llm_source", "agent")
    creds = None
    model = config.get("llm_model", "gemini-2.5-flash")
    source_label = ""

    # Option A: Borrow Agent's Configured LLM (Requirement 2 & 3: 2-level dropdown agent + model override)
    if llm_source == "agent":
        agent_name = config.get("llm_agent_name", "Agy")
        model_override = config.get("llm_agent_model", "")
        agent_creds = resolve_agent_model_creds(agent_name, model_override=model_override)
        if agent_creds and agent_creds.get("api_key"):
            creds = agent_creds
            model = agent_creds.get("model", model)
            source_label = f"Agent @{agent_name} ({model})"

    # Option B: Dedicated Gateway Provider (or fallback if agent model resolution failed)
    if not creds or not creds.get("api_key"):
        provider_name = config.get("llm_provider", "abacus")
        creds = get_llm_provider_creds(provider_name)
        source_label = f"{provider_name}:{model}"

    if not creds or not creds.get("api_key"):
        return None

    base_url = creds.get("base_url", "https://routellm.abacus.ai/v1").rstrip("/")
    url = f"{base_url}/chat/completions"
    timeout_sec = float(config.get("llm_timeout_seconds", 2.0))
    min_confidence = float(config.get("confidence_threshold", 0.70))

    # Format recent context (last 3-5 messages)
    context_lines = []
    for msg in recent_history[-5:]:
        sender = msg.get("sender", "Unknown")
        stype = msg.get("sender_type", "")
        # Shorten text to 160 chars per turn to keep prompt ultra-compact & fast
        txt = (msg.get("text") or "").strip().replace("\n", " ")
        if len(txt) > 200:
            txt = txt[:200] + "..."
        if stype == "user":
            context_lines.append(f"Operator: {txt}")
        elif stype == "agent":
            context_lines.append(f"Agent @{sender}: {txt}")

    context_str = "\n".join(context_lines) if context_lines else "No previous messages."

    # Format active participants
    p_roster = []
    p_map = {}
    for p in participants:
        name = p.get("name", "")
        role = p.get("role", "")
        p_roster.append(f"- @{name} ({role})")
        p_map[name.lower()] = p
        p_map[p.get("id", "").lower()] = p

    participants_str = "\n".join(p_roster)

    system_prompt = (
        "You are the War Room Dispatcher for NexusDesk. Decide which agent in the room the operator is replying to or addressing.\n"
        "Rules:\n"
        "1. If the operator is answering a question or agreeing/disagreeing with an agent's recent offer/proposal, pick that agent.\n"
        "2. If the operator's message is a follow-up directive continuing a previous agent's discussion, pick that agent.\n"
        "3. Output MUST be ONLY valid JSON with keys: \"target_agent\" (string name), \"confidence\" (float 0.0 to 1.0), and \"reasoning\" (brief string).\n"
        "Do NOT include markdown backticks or any other text."
    )

    user_prompt = (
        f"Active Room Agents:\n{participants_str}\n\n"
        f"Recent Transcript Dialogue:\n{context_str}\n\n"
        f"Incoming Untagged Operator Message:\n\"{user_msg}\"\n\n"
        f"JSON output:"
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 250
    }

    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {creds['api_key']}",
            "Content-Type": "application/json"
        },
        data=json.dumps(payload).encode("utf-8")
    )

    try:
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            elapsed = time.time() - t0
            raw_text = resp.read().decode("utf-8")
            data = json.loads(raw_text)
            content = data["choices"][0]["message"]["content"].strip()
            # Clean markdown codeblocks if model included them
            clean_json = re.sub(r'^```(?:json)?\s*', '', content)
            clean_json = re.sub(r'\s*```$', '', clean_json).strip()
            parsed = json.loads(clean_json)

            target_name = (parsed.get("target_agent") or "").strip().lstrip("@")
            confidence = float(parsed.get("confidence", 0.0))
            reasoning = parsed.get("reasoning", "")

            matched_p = p_map.get(target_name.lower())
            if matched_p and confidence >= min_confidence:
                label_info = f"{source_label}, " if source_label else ""
                return (
                    matched_p,
                    f"🧠 **LLM Semantic Router** ({label_info}{elapsed:.2f}s, {int(confidence*100)}% conf): Routing to **@{matched_p['name']}** — {reasoning}"
                )
    except Exception as e:
        print(f"[WAR_ROOM_DISPATCHER] LLM router fallback triggered: {e}")

    return None

def clean_stt_transcript_with_dispatcher(
    raw_transcript: str,
    participants: List[Dict[str, Any]],
    room_title: str = "General",
    recent_history: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    BL-VOICE-25: Normalizes and contextually corrects raw browser STT output
    using the active War Room Dispatcher LLM without requiring extra API setup.
    Phonetically repairs agent names (@Codex, @Solaris) and technical terms.
    """
    if not raw_transcript or not raw_transcript.strip():
        return ""

    raw_text = raw_transcript.strip()
    config = load_dispatcher_config()
    llm_source = config.get("llm_source", "agent")
    creds = None
    model = config.get("llm_model", "gemini-2.5-flash")

    if llm_source == "agent":
        agent_name = config.get("llm_agent_name", "Codex")
        model_override = config.get("llm_agent_model", "")
        agent_creds = resolve_agent_model_creds(agent_name, model_override=model_override)
        if agent_creds and agent_creds.get("api_key"):
            creds = agent_creds
            model = agent_creds.get("model", model)

    if not creds or not creds.get("api_key"):
        provider_name = config.get("llm_provider", "abacus")
        creds = get_llm_provider_creds(provider_name)

    if not creds or not creds.get("api_key"):
        return raw_text

    base_url = creds.get("base_url", "https://routellm.abacus.ai/v1").rstrip("/")
    url = f"{base_url}/chat/completions"
    timeout_sec = min(float(config.get("llm_timeout_seconds", 3.0)), 4.0)

    # Active agent roster
    agent_names = [f"@{p.get('name')}" for p in participants if p.get("name")]
    roster_str = ", ".join(agent_names) if agent_names else "@Solaris, @Codex, @Pylon, @Chroma, @Lore, @Scribe, @Chorusius"

    system_prompt = (
        "You are an AI Speech-to-Text Post-Processor and Phonetic Normalizer for NexusDesk.\n"
        "Your sole task is to correct raw browser speech recognition transcript into the clean intended user command.\n"
        "Rules:\n"
        f"1. Available Agents in this War Room: {roster_str}, @everyone.\n"
        f"2. Active Room Context/Topic: \"{room_title}\".\n"
        "3. Correct phonetic slips into the exact agent mention (e.g. 'cold eggs' -> '@Codex', 'pie lawn' -> '@Pylon', 'soul are is' -> '@Solaris', 'chroma' -> '@Chroma').\n"
        "4. Fix technical terms and acronyms relevant to programming, system administration, and this room's context.\n"
        "5. ACOUSTIC ECHO FILTER: If the raw transcript is simply a mechanical echo, partial repetition, or playback reflection of what the agents just said in Recent Dialogue Context without any new user directive, output EMPTY (blank) to prevent echoing.\n"
        "6. Keep the exact intent and wording otherwise. Do not add explanations or conversational replies.\n"
        "7. Output ONLY the cleaned command text with no markdown quotes, backticks, or commentary."
    )

    context_snip = ""
    if recent_history:
        recent_snips = []
        for msg in recent_history[-2:]:
            s = msg.get("sender", "Agent")
            t = (msg.get("text") or "").strip().replace("\n", " ")[:120]
            recent_snips.append(f"{s}: {t}")
        if recent_snips:
            context_snip = f"Recent Dialogue Context:\n" + "\n".join(recent_snips) + "\n\n"

    user_prompt = f"{context_snip}Raw Speech Transcript:\n\"{raw_text}\"\n\nCleaned Command:"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 150
    }

    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {creds['api_key']}",
            "Content-Type": "application/json"
        },
        data=json.dumps(payload).encode("utf-8")
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            cleaned = data["choices"][0]["message"]["content"].strip()
            # Strip quotes or backticks if LLM enclosed them
            cleaned = re.sub(r'^["`\']+|["`\']+$', '', cleaned).strip()
            if cleaned:
                return cleaned
    except Exception as e:
        print(f"[WAR_ROOM_DISPATCHER] STT clean fallback to raw text: {e}")

    return raw_text


def _get_all_fast_llm_candidates(cfg: Dict[str, Any], inst_key: str = "agents_bs") -> List[Dict[str, str]]:
    """Builds an ordered multi-provider candidate list so credit exhaustion on one provider fails over automatically."""
    candidates: List[Dict[str, str]] = []
    seen = set()

    def _add(provider: str, model: str, api_key: str, base_url: str):
        if not api_key:
            return
        b_url = (base_url or "https://routellm.abacus.ai/v1").rstrip("/")
        key = (b_url, model)
        if key not in seen:
            seen.add(key)
            candidates.append({
                "provider": provider,
                "model": model,
                "api_key": api_key,
                "base_url": b_url,
            })

    # 1. Configured primary (agent or provider)
    pref_model = cfg.get("llm_model", "gemini-2.5-flash")
    if cfg.get("llm_source", "agent") == "agent":
        agent_creds = resolve_agent_model_creds(
            cfg.get("llm_agent_name", "Agy"),
            model_override=cfg.get("llm_agent_model", ""),
        )
        if agent_creds and agent_creds.get("api_key"):
            _add(
                agent_creds.get("provider", "abacus"),
                agent_creds.get("model", pref_model),
                agent_creds["api_key"],
                agent_creds.get("base_url", ""),
            )

    pref_prov = cfg.get("llm_provider", "abacus")
    p_creds = get_llm_provider_creds(pref_prov, inst_key=inst_key)
    if p_creds and p_creds.get("api_key"):
        _add(pref_prov, pref_model, p_creds["api_key"], p_creds.get("base_url", ""))

    # 2. Multi-provider failover from hermes config.yaml (openrouter -> nvidia -> abacus)
    try:
        import yaml
        ctx = get_instance_user_context(inst_key)
        cfg_file = ctx["home"] / "config.yaml"
        if cfg_file.exists():
            with open(cfg_file, "r", encoding="utf-8") as f:
                h_cfg = yaml.safe_load(f) or {}
            providers = h_cfg.get("providers", {}) or {}
            fallback_specs = [
                ("openrouter", "deepseek/deepseek-chat", "https://openrouter.ai/api/v1"),
                ("openrouter", "google/gemini-2.5-flash", "https://openrouter.ai/api/v1"),
                ("nvidia", "nvidia/nemotron-3-ultra-550b-a55b", "https://integrate.api.nvidia.com/v1"),
                ("abacus", "gemini-2.5-flash", "https://routellm.abacus.ai/v1"),
            ]
            for p_name, f_model, default_url in fallback_specs:
                p_info = providers.get(p_name) or {}
                if p_info.get("api_key"):
                    _add(p_name, f_model, p_info["api_key"], p_info.get("base_url") or default_url)
    except Exception:
        pass

    return candidates


def _call_fast_dispatcher_llm(
    sys_prompt: str,
    user_prompt: str,
    max_tokens: int = 120,
    timeout: float = 4.5,
    temperature: float = 0.15,
) -> Optional[str]:
    """Shared lightweight OpenAI-compatible completion call with automatic multi-provider failover."""
    try:
        cfg = load_dispatcher_config()
        candidates = _get_all_fast_llm_candidates(cfg)
        if not candidates:
            return None

        per_try_timeout = min(max(timeout, 2.0), 4.0)
        for cand in candidates:
            try:
                url = f"{cand['base_url']}/chat/completions"
                payload = {
                    "model": cand["model"],
                    "messages": [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }
                req = urllib.request.Request(
                    url,
                    headers={
                        "Authorization": f"Bearer {cand['api_key']}",
                        "Content-Type": "application/json",
                    },
                    data=json.dumps(payload).encode("utf-8"),
                )
                with urllib.request.urlopen(req, timeout=per_try_timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    content = (data["choices"][0]["message"]["content"] or "").strip()
                    if content:
                        return content
            except Exception:
                continue
        return None
    except Exception:
        return None


def _looks_like_phase1_already_completed(phase1_reply: str) -> bool:
    """Heuristic safety net when fast LLM is unavailable: detects if Phase 1 already executed/resolved the task."""
    if not phase1_reply:
        return False
    low = phase1_reply.lower()
    completion_cues = (
        "already live", "is now live", "verified published", "status: published",
        "audit selesai", "selesai ", "sudah selesai", "berhasil di", "telah selesai",
        "delegating ", "✓ [set ", "pipeline paused", "created a one-time war room schedule",
        "✅ done", "nothing to approve", "no further action needed",
    )
    if any(cue in low for cue in completion_cues):
        # Make sure it wasn't just saying "belum dijalankan / ini baru rencana"
        plan_only_cues = ("belum ada yang dijalankan", "ini baru rencana", "not yet executed", "plan only", "proposed plan")
        if not any(pc in low for pc in plan_only_cues):
            return True
    return False


def coordinate_swarm_dispatch(
    directive_text: str,
    worker_candidates: List[Dict[str, Any]],
    phase1_reply: str = "",
    recent_history: Optional[List[Dict[str, Any]]] = None,
    mode: str = "plan_fallback",
) -> Dict[str, Any]:
    """
    Anti-duplication Swarm coordinator (~1-3s fast LLM with deterministic fallback).
    - mode='plan_fallback': Called when Phase 1 Lead omitted `<swarm_dispatch>`. Determines whether Phase 1
      already resolved/executed the directive (`action='complete'`, skipping redundant Phase 2) or extracts
      strictly non-overlapping per-agent sub-tasks for remaining work (`action='dispatch'`).
    - mode='swarm_split': Called in pure Swarm mode (`parallel`) when >=2 workers have no explicit per-agent
      tasks. Partitions the work into distinct role-scoped assignments, or narrows single-shot external
      side-effects (e.g., publishing a post, sending a broadcast) to 1 primary owner so peers never duplicate it.
    """
    if not worker_candidates:
        return {"action": "complete", "reason": "No worker candidates available", "tasks": []}

    roster_lines = [
        f"- {w['name']} (engine={w.get('engine', 'hermes')}, role={w.get('role', 'Specialist')})"
        for w in worker_candidates
    ]
    roster_str = "\n".join(roster_lines)
    valid_names = {w["name"].lower(): w["name"] for w in worker_candidates}
    clean_dir = re.sub(r"\s+", " ", (directive_text or "")).strip()[:1200]
    clean_p1 = (phase1_reply or "").strip()[:2400]

    recent_ctx = ""
    if recent_history:
        r_lines = []
        for m in recent_history[-4:]:
            t = (m.get("text") or "").strip().replace("\n", " ")[:180]
            if t:
                r_lines.append(f"{m.get('sender', 'User')}: {t}")
        if r_lines:
            recent_ctx = "Recent messages:\n" + "\n".join(r_lines) + "\n\n"

    if mode == "plan_fallback":
        sys_p = (
            "You are the NexusDesk Swarm Anti-Duplication Coordinator.\n"
            "Phase 1 Lead replied WITHOUT emitting a `<swarm_dispatch>` tag.\n"
            "Inspect the Operator Directive and Phase 1 Reply carefully.\n"
            "Rules:\n"
            "1. If Phase 1 ALREADY answered the question, completed the audit/fix, published the post, or ran sub-agents to finish the work, "
            "output `{\"action\": \"complete\", \"reason\": \"<short reason>\", \"tasks\": []}` so Phase 2 does NOT wake up redundant workers to repeat Phase 1.\n"
            "2. ONLY if concrete, distinct work still remains unexecuted, output `{\"action\": \"dispatch\", \"reason\": \"<short reason>\", \"tasks\": [{\"agent\": \"<Name>\", \"task\": \"<unique non-overlapping scoped assignment>\"}]}`.\n"
            "3. Never assign two agents the same task or the same external side-effect (publishing, deploying, broadcasting). Only pick the agents genuinely needed from the roster.\n"
            "Return ONLY valid JSON."
        )
        usr_p = (
            f"Available Workers:\n{roster_str}\n\n"
            f"Operator Directive:\n{clean_dir}\n\n"
            f"Phase 1 Lead Reply:\n{clean_p1}\n\n"
            "JSON decision:"
        )
    else:
        sys_p = (
            "You are the NexusDesk Parallel Swarm Work Partitioner.\n"
            "Multiple agents are about to run in parallel on the Operator Directive below.\n"
            "Prevent duplicate work and repeated replies:\n"
            "1. If the directive is a single-shot external action (e.g. publish 1 social post, send 1 WhatsApp/email, run 1 single command) or a single-fact check already answered in recent messages, "
            "assign ONLY the 1 best-suited agent (do NOT assign 3 agents to post or check the same thing!).\n"
            "2. If the directive has multiple distinct angles (e.g. code/backend, UI/frontend, QA/testing, research/analysis), split it into strictly NON-OVERLAPPING per-agent `task` instructions matched to each agent's role.\n"
            "3. Every assigned `task` MUST specify the exact distinct scope and forbid repeating peers' work.\n"
            "Return ONLY valid JSON: `{\"action\": \"dispatch\", \"reason\": \"<short reason>\", \"tasks\": [{\"agent\": \"<Name>\", \"task\": \"<unique scoped sub-task>\"}]}`."
        )
        usr_p = (
            f"Selected Swarm Agents:\n{roster_str}\n\n"
            f"{recent_ctx}"
            f"Operator Directive:\n{clean_dir}\n\n"
            "JSON task split:"
        )

    raw = _call_fast_dispatcher_llm(sys_p, usr_p, max_tokens=450, timeout=6.0, temperature=0.1)
    if raw:
        try:
            cleaned_json = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.IGNORECASE).strip()
            m_obj = re.search(r"\{[\s\S]*\}", cleaned_json)
            parsed = json.loads(m_obj.group(0) if m_obj else cleaned_json)
            if isinstance(parsed, dict):
                act = str(parsed.get("action") or "dispatch").strip().lower()
                reason = str(parsed.get("reason") or "").strip()
                raw_tasks = parsed.get("tasks") or []
                clean_tasks: List[Dict[str, str]] = []
                seen = set()
                if isinstance(raw_tasks, list):
                    for t in raw_tasks:
                        if not isinstance(t, dict):
                            continue
                        ag_raw = str(t.get("agent") or t.get("name") or "").strip().lstrip("@").lower()
                        task_txt = str(t.get("task") or t.get("assignment") or "").strip()
                        canon = valid_names.get(ag_raw)
                        if canon and canon.lower() not in seen and task_txt:
                            seen.add(canon.lower())
                            clean_tasks.append({"agent": canon, "task": task_txt})
                if act == "complete" or (mode == "plan_fallback" and not clean_tasks):
                    return {"action": "complete", "reason": reason or "Phase 1 already resolved the directive", "tasks": []}
                if clean_tasks:
                    return {"action": "dispatch", "reason": reason or "Non-overlapping sub-tasks assigned", "tasks": clean_tasks}
        except Exception as e:
            print(f"[WAR_ROOM_SWARM] Coordinator JSON parse warning ({mode}): {e}")

    # Deterministic fallback when fast LLM is unreachable or fails JSON parse
    if mode == "plan_fallback":
        if _looks_like_phase1_already_completed(phase1_reply):
            return {
                "action": "complete",
                "reason": "Phase 1 already completed or answered the directive (no <swarm_dispatch> emitted)",
                "tasks": [],
            }
        # Avoid blasting all agents with identical blank tasks: pick up to 2 complementary specialists with distinct angles
        fallback_tasks = []
        for idx, w in enumerate(worker_candidates[:2]):
            role_lbl = w.get("role", "Specialist")
            angle = (
                f"Execute the primary implementation/action strictly within your {role_lbl} scope based on the Lead's plan above. Do not duplicate work already completed in Phase 1."
                if idx == 0
                else f"Perform independent QA verification, edge-case audit, and documentation strictly within your {role_lbl} scope without modifying files owned by @{worker_candidates[0]['name']}."
            )
            fallback_tasks.append({"agent": w["name"], "task": angle})
        return {"action": "dispatch", "reason": "Fallback role-scoped split", "tasks": fallback_tasks}

    # Pure swarm_split deterministic fallback: assign explicit distinct role-angles
    split_tasks = []
    for w in worker_candidates:
        role_lbl = w.get("role", "Specialist")
        split_tasks.append({
            "agent": w["name"],
            "task": (
                f"Contribute strictly from your unique specialty ({role_lbl}). "
                f"Do NOT duplicate peer work or repeat actions/posts already completed in recent messages; emit <no_op>reason</no_op> if nothing distinct remains for your role."
            ),
        })
    return {"action": "dispatch", "reason": "Role-scoped parallel angles", "tasks": split_tasks}


def _build_deterministic_preflight_brief(
    agent_name: str,
    agent_role: str,
    directive_text: str,
    swarm_phase: str = "",
) -> Dict[str, Any]:
    """
    Deterministic requirement analyzer that produces a structured pre-flight
    Understanding + Action Plan without parroting the raw user prompt.
    """
    raw = re.sub(r"\s+", " ", (directive_text or "")).strip()
    clean_no_mentions = re.sub(r"@[a-zA-Z0-9_\-]+\s*", "", raw).strip()
    low = clean_no_mentions.lower()

    # Extract referenced filenames or paths
    file_matches = re.findall(
        r"\b(?:[a-zA-Z0-9_\-./]+\.(?:osm\.pbf|pbf|py|js|ts|csv|tsv|json|html|md|xlsx|sh|sql|log))\b",
        clean_no_mentions,
        re.IGNORECASE,
    )
    unique_files = list(dict.fromkeys(file_matches))[:3]
    files_lbl = ", ".join(f"`{os.path.basename(f)}`" for f in unique_files)

    has_timeout_retry = bool(re.search(r"\b(timed?[-_\s]?out|redo|re-?run|retry|enough\s+time|longer\s+timeout)\b", low))
    has_async_monitor = bool(re.search(r"\b(async|background\s+job|regular\s+check|monitor|poll|watch)\b", low))
    has_whatsapp = bool(re.search(r"\b(whatsapp|wa|keep\s+me\s+posted|milestone|notify)\b", low))
    has_telegram = bool(re.search(r"\b(telegram|tg)\b", low))
    has_updated_file = bool(re.search(r"\b(updated\s+the\s+file|just\s+updated|new\s+file|uploaded)\b", low))
    has_fix_debug = bool(re.search(r"\b(fix|bug|error|broken|fail|crash|diagnose|why)\b", low))
    has_build_update = bool(re.search(r"\b(update|score|scoring|extract|merge|build|encrypt|filter|generate)\b", low))

    understanding_parts: List[str] = []
    steps: List[str] = []

    if swarm_phase == "plan":
        understanding_parts.append(
            f"Decompose the assignment into non-overlapping parallel worker tasks"
            + (f" targeting {files_lbl}" if files_lbl else "")
        )
        steps.append("Analyze current room transcript and sandbox state to identify required specialist roles")
        steps.append("Formulate distinct, non-overlapping sub-tasks and emit `<swarm_dispatch>` assignments")
    elif swarm_phase == "synthesis":
        understanding_parts.append("Synthesize all parallel worker outputs into a unified executive conclusion with verified deliverables")
        steps.append("Cross-check parallel worker findings and resolve any discrepancies")
        steps.append("Present consolidated metrics, deliverable links, and recommended next actions")
    else:
        if has_timeout_retry:
            understanding_parts.append(
                "Resolve the previous execution timeout by optimizing and re-running the job with a sufficient timeout budget"
                + (f" on {files_lbl}" if files_lbl else "")
            )
            steps.append(
                f"Inspect previous partial log and optimize execution"
                + (f" against updated {files_lbl}" if (has_updated_file and files_lbl) else (f" for {files_lbl}" if files_lbl else ""))
            )
            steps.append("Launch the job with an extended timeout and incremental progress checkpoints")
        elif has_fix_debug:
            understanding_parts.append(
                f"Diagnose the root cause and implement a verified fix"
                + (f" in {files_lbl}" if files_lbl else "")
            )
            steps.append(f"Inspect logs and source files{f' ({files_lbl})' if files_lbl else ''} to confirm the root cause")
            steps.append("Apply the fix, verify output integrity, and report findings")
        elif has_build_update:
            understanding_parts.append(
                f"Process and update the requested data/deliverables"
                + (f" using {files_lbl}" if files_lbl else "")
            )
            steps.append(f"Load and validate input data{f' ({files_lbl})' if files_lbl else ''} in the shared sandbox")
            steps.append("Execute the processing/update pipeline and verify all generated deliverables")
        else:
            short_goal = clean_no_mentions[:140] + ("..." if len(clean_no_mentions) > 140 else "")
            understanding_parts.append(f"Fulfill operator directive: {short_goal}" if short_goal else f"Execute assigned {agent_role} task")
            steps.append(f"Inspect relevant sandbox files{f' ({files_lbl})' if files_lbl else ''} and room context")
            steps.append("Execute the required analysis/actions and report verified results")

        if has_async_monitor and not any("async" in s.lower() or "progress" in s.lower() for s in steps):
            understanding_parts.append("track background async task progress regularly")
            steps.append("Register and monitor the background async task until completion")
        elif has_async_monitor:
            understanding_parts.append("perform regular progress checks on the async task")
            steps.append("Monitor the running async task log and verify milestone completion")

        if has_whatsapp or has_telegram:
            chan_lbl = "WhatsApp & Telegram" if (has_whatsapp and has_telegram) else ("WhatsApp" if has_whatsapp else "Telegram")
            understanding_parts.append(f"send milestone progress updates via {chan_lbl}")
            steps.append(f"Dispatch live milestone and completion updates to operator via {chan_lbl}")

    understanding = "; ".join(understanding_parts)
    if understanding:
        understanding = understanding[0].upper() + understanding[1:]
        if not understanding.endswith("."):
            understanding += "."

    plan_steps = steps[:4]
    intent_flat = f"Understanding: {understanding} | Plan: " + "; ".join(f"{i+1}) {s}" for i, s in enumerate(plan_steps))
    return {
        "understanding": understanding,
        "plan_steps": plan_steps,
        "intent": intent_flat[:320],
    }


def generate_pre_execution_brief(
    agent_name: str,
    agent_role: str,
    directive_text: str,
    recent_history: Optional[List[Dict[str, Any]]] = None,
    swarm_phase: str = "",
) -> Dict[str, Any]:
    """
    Fast ~1-2s structured Pre-Flight Brief returning:
      - understanding: 1 clear sentence confirming the agent understood the assignment & constraints
      - plan_steps: 2-4 concrete bullet steps explaining what the agent will do before proceeding
      - intent: single-line summary for compact banners
    """
    fallback_brief = _build_deterministic_preflight_brief(agent_name, agent_role, directive_text, swarm_phase=swarm_phase)
    clean_dir = re.sub(r"\s+", " ", (directive_text or "")).strip()
    if not clean_dir:
        return fallback_brief

    short_dir = clean_dir[:500] + ("..." if len(clean_dir) > 500 else "")
    phase_hint = ""
    if swarm_phase == "plan":
        phase_hint = "You are Phase 1 Lead Planner: explain how you understand the goal and how you will partition it for workers."
    elif swarm_phase == "synthesis":
        phase_hint = "You are Phase 3 Synthesizer: explain how you will consolidate the parallel worker outputs."
    elif swarm_phase in ("swarm", "worker"):
        phase_hint = "You are executing a focused parallel swarm assignment."

    recent_ctx = ""
    if recent_history:
        lines = []
        for m in recent_history[-3:]:
            t = (m.get("text") or "").strip().replace("\n", " ")[:160]
            if t:
                lines.append(f"{m.get('sender', 'User')}: {t}")
        if lines:
            recent_ctx = "Recent context:\n" + "\n".join(lines) + "\n\n"

    sys_p = (
        f"You are {agent_name} ({agent_role}). Before executing the operator's directive, state your pre-flight understanding and action plan.\n"
        f"CRITICAL RULES:\n"
        f"1. Do NOT parrot or quote the operator's raw words back verbatim. Paraphrase to prove you genuinely understand the goal, target files, and constraints (e.g., timeout fixes, async monitoring, WhatsApp notifications).\n"
        f"2. Provide 2 to 4 concrete, specific action steps you will execute.\n"
        f"3. {phase_hint}\n"
        f"Return ONLY valid JSON in this exact schema:\n"
        f"{{\"understanding\": \"<1 clear sentence summarizing what the operator wants and why>\", \"plan_steps\": [\"<concrete step 1>\", \"<concrete step 2>\", \"<concrete step 3>\"]}}"
    )
    usr_p = f"{recent_ctx}Operator Directive:\n{short_dir}\n\nJSON pre-flight brief:"
    raw = _call_fast_dispatcher_llm(sys_p, usr_p, max_tokens=220, timeout=4.0, temperature=0.15)
    if raw:
        try:
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.IGNORECASE).strip()
            m_obj = re.search(r"\{[\s\S]*\}", cleaned)
            parsed = json.loads(m_obj.group(0) if m_obj else cleaned)
            if isinstance(parsed, dict):
                und = re.sub(r"\s+", " ", str(parsed.get("understanding") or "")).strip()
                raw_steps = parsed.get("plan_steps") or parsed.get("steps") or []
                clean_steps = [
                    re.sub(r"^\d+[\).\s-]+", "", re.sub(r"\s+", " ", str(s)).strip())
                    for s in raw_steps
                    if str(s).strip()
                ][:4]
                if len(und) >= 12 and clean_steps:
                    intent_flat = f"Understanding: {und} | Plan: " + "; ".join(f"{i+1}) {s}" for i, s in enumerate(clean_steps))
                    return {
                        "understanding": und[:280],
                        "plan_steps": [s[:180] for s in clean_steps],
                        "intent": intent_flat[:320],
                    }
        except Exception:
            pass
    return fallback_brief


def generate_pre_execution_intent(
    agent_name: str,
    agent_role: str,
    directive_text: str,
    recent_history: Optional[List[Dict[str, Any]]] = None,
    swarm_phase: str = "",
) -> str:
    """Backwards-compatible string wrapper around `generate_pre_execution_brief`."""
    brief = generate_pre_execution_brief(
        agent_name=agent_name,
        agent_role=agent_role,
        directive_text=directive_text,
        recent_history=recent_history,
        swarm_phase=swarm_phase,
    )
    return brief.get("understanding") or brief.get("intent") or ""
