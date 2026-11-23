import os
import io
import re
import json
import wave
import hashlib
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import APIRouter, Query, Body, HTTPException, Response, status
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/tts", tags=["TTS"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SETTINGS_FILE = DATA_DIR / "tts_settings.json"
CACHE_DIR = Path("/tmp/nexusdesk_tts_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# In-memory LRU cache: hash -> (media_type, bytes)
_MEMORY_CACHE: Dict[str, tuple[str, bytes]] = {}
_MAX_CACHE_ITEMS = 120

# Pre-indexed Voice Catalogs
EDGE_VOICES = [
    {"id": "en-US-GuyNeural", "name": "Guy (US Male - Crisp & Technical)", "gender": "male", "lang": "en-US", "persona": "developer"},
    {"id": "en-US-JennyNeural", "name": "Jenny (US Female - Clear & Articulate)", "gender": "female", "lang": "en-US", "persona": "reviewer"},
    {"id": "en-US-AriaNeural", "name": "Aria (US Female - Expressive & Fast)", "gender": "female", "lang": "en-US", "persona": "scout"},
    {"id": "en-US-ChristopherNeural", "name": "Christopher (US Male - Deep Baritone)", "gender": "male", "lang": "en-US", "persona": "architect"},
    {"id": "en-US-EricNeural", "name": "Eric (US Male - Conversational)", "gender": "male", "lang": "en-US", "persona": "orchestrator"},
    {"id": "en-US-AnaNeural", "name": "Ana (US Female - Soft & Friendly)", "gender": "female", "lang": "en-US", "persona": "creative"},
    {"id": "en-GB-RyanNeural", "name": "Ryan (UK Male - British Accent)", "gender": "male", "lang": "en-GB", "persona": "sysadmin"},
    {"id": "en-GB-SoniaNeural", "name": "Sonia (UK Female - British Accent)", "gender": "female", "lang": "en-GB", "persona": "security"},
    {"id": "en-US-SteffanNeural", "name": "Steffan (US Male - Direct & Focused)", "gender": "male", "lang": "en-US", "persona": "coder"},
    {"id": "en-US-BrianNeural", "name": "Brian (US Male - Warm & Conversational)", "gender": "male", "lang": "en-US", "persona": "facilitator"},
    {"id": "en-US-RogerNeural", "name": "Roger (US Male - Pragmatic & Grounded)", "gender": "male", "lang": "en-US", "persona": "automation"},
]

PIPER_VOICES = [
    {"id": "en_US-lessac-medium", "name": "Lessac (US Neutral - Local ONNX)", "gender": "female", "lang": "en-US", "persona": "offline_default"},
]

KOKORO_VOICES = [
    {"id": "af_bella", "name": "Bella (US Female - Warm & Natural Local Kokoro)", "gender": "female", "lang": "en-US", "persona": "concierge"},
    {"id": "af_heart", "name": "Heart (US Female - Expressive Local Kokoro)", "gender": "female", "lang": "en-US", "persona": "reviewer"},
    {"id": "af_sarah", "name": "Sarah (US Female - Clear Local Kokoro)", "gender": "female", "lang": "en-US", "persona": "assistant"},
    {"id": "am_adam", "name": "Adam (US Male - Crisp Local Kokoro)", "gender": "male", "lang": "en-US", "persona": "developer"},
    {"id": "am_michael", "name": "Michael (US Male - Deep Local Kokoro)", "gender": "male", "lang": "en-US", "persona": "architect"},
    {"id": "bf_emma", "name": "Emma (UK Female - British Local Kokoro)", "gender": "female", "lang": "en-GB", "persona": "security"},
    {"id": "bm_george", "name": "George (UK Male - British Local Kokoro)", "gender": "male", "lang": "en-GB", "persona": "sysadmin"},
    {"id": "zf_xiaoxiao", "name": "Xiaoxiao (Mandarin Female - Local Kokoro)", "gender": "female", "lang": "zh-CN", "persona": "mandarin"},
    {"id": "zf_xiaoyi", "name": "Xiaoyi (Mandarin Female Soft - Local Kokoro)", "gender": "female", "lang": "zh-CN", "persona": "mandarin"},
]

DEFAULT_AGENT_VOICES = {
    "solaris": {"edge_voice": "en-US-EricNeural", "piper_voice": "en_US-lessac-medium", "pitch": 1.0, "rate": 1.0, "gender": "male"},
    "claude": {"edge_voice": "en-US-ChristopherNeural", "piper_voice": "en_US-lessac-medium", "pitch": 1.0, "rate": 1.0, "gender": "male"},
    "codex": {"edge_voice": "en-US-GuyNeural", "piper_voice": "en_US-lessac-medium", "pitch": 0.95, "rate": 1.0, "gender": "male"},
    "thecodexer": {"edge_voice": "en-US-GuyNeural", "piper_voice": "en_US-lessac-medium", "pitch": 0.95, "rate": 1.0, "gender": "male"},
    "agy": {"edge_voice": "en-US-AriaNeural", "piper_voice": "en_US-lessac-medium", "pitch": 1.0, "rate": 1.05, "gender": "female"},
    "pylon": {"edge_voice": "en-GB-RyanNeural", "piper_voice": "en_US-lessac-medium", "pitch": 0.9, "rate": 0.95, "gender": "male"},
    "chroma": {"edge_voice": "en-US-AnaNeural", "piper_voice": "en_US-lessac-medium", "pitch": 1.1, "rate": 1.05, "gender": "female"},
    "opencode": {"edge_voice": "en-US-SteffanNeural", "piper_voice": "en_US-lessac-medium", "pitch": 0.95, "rate": 1.0, "gender": "male"},
    "scribe": {"edge_voice": "en-US-JennyNeural", "piper_voice": "en_US-lessac-medium", "pitch": 1.05, "rate": 1.0, "gender": "female"},
    "lore": {"edge_voice": "en-GB-SoniaNeural", "piper_voice": "en_US-lessac-medium", "pitch": 0.95, "rate": 0.95, "gender": "female"},
    "chorusius": {"edge_voice": "en-US-BrianNeural", "piper_voice": "en_US-lessac-medium", "pitch": 1.0, "rate": 1.0, "gender": "male"},
    "desktop": {"edge_voice": "en-US-RogerNeural", "piper_voice": "en_US-lessac-medium", "pitch": 0.95, "rate": 1.0, "gender": "male"},
}

DEFAULT_ROLE_PERSONAS = {
    "architect": "en-US-ChristopherNeural",
    "developer": "en-US-GuyNeural",
    "coder": "en-US-GuyNeural",
    "reviewer": "en-US-JennyNeural",
    "auditor": "en-US-JennyNeural",
    "scout": "en-US-AriaNeural",
    "researcher": "en-US-AriaNeural",
    "orchestrator": "en-US-EricNeural",
    "security": "en-GB-SoniaNeural",
    "creative": "en-US-AnaNeural",
    "sysadmin": "en-GB-RyanNeural",
    "default": "en-US-GuyNeural",
}

DEFAULT_SETTINGS = {
    "active_engine": "edge",  # "edge", "kokoro", "piper", or "browser"
    "speech_scope": "first_sentence",  # "first_sentence" or "full"
    "default_edge_voice": "en-US-GuyNeural",
    "default_piper_voice": "en_US-lessac-medium",
    "default_kokoro_voice": "af_bella",
    "agent_voices": DEFAULT_AGENT_VOICES,
    "role_personas": DEFAULT_ROLE_PERSONAS,
    "playback_speed": 1.0,
    "playback_pitch": 1.0,
}

# Cached Piper voice model instance & isolated Kokoro worker config
_PIPER_VOICE_INSTANCE = None
_PIPER_LOAD_LOCK = asyncio.Lock()
import threading
import subprocess
import sys
import time
import urllib.request
_KOKORO_LOAD_LOCK = threading.Lock()
_KOKORO_WORKER_URL = "http://127.0.0.1:9206"
_KOKORO_WORKER_PROC = None


def get_tts_settings() -> Dict[str, Any]:
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                merged = {**DEFAULT_SETTINGS, **saved}
                return merged
        except Exception:
            pass
    return DEFAULT_SETTINGS.copy()


def save_tts_settings(settings: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)


def get_piper_voice():
    global _PIPER_VOICE_INSTANCE
    if _PIPER_VOICE_INSTANCE is not None:
        return _PIPER_VOICE_INSTANCE

    import piper
    model_path = DATA_DIR / "piper_voices" / "en_US-lessac-medium.onnx"
    config_path = model_path.with_suffix(".onnx.json")

    if not model_path.exists():
        raise FileNotFoundError(f"Piper ONNX model not found at {model_path}")

    _PIPER_VOICE_INSTANCE = piper.PiperVoice.load(str(model_path), config_path=str(config_path) if config_path.exists() else None)
    return _PIPER_VOICE_INSTANCE


def _kokoro_worker_healthy(timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(f"{_KOKORO_WORKER_URL}/health", timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def ensure_kokoro_worker_running() -> None:
    """Starts the isolated Kokoro TTS HTTP worker subprocess (127.0.0.1:9206) if not running."""
    global _KOKORO_WORKER_PROC
    if _kokoro_worker_healthy(timeout=1.0):
        return
    with _KOKORO_LOAD_LOCK:
        if _kokoro_worker_healthy(timeout=1.0):
            return
        kokoro_dir = DATA_DIR / "kokoro_voices"
        if not (kokoro_dir / "kokoro-v1.0.onnx").exists() or not (kokoro_dir / "voices-v1.0.bin").exists():
            raise FileNotFoundError(f"Kokoro ONNX assets missing in {kokoro_dir}")
        worker_script = Path(__file__).resolve().parent.parent / "services" / "kokoro_worker.py"
        if not worker_script.exists():
            raise FileNotFoundError(f"Kokoro worker script not found at {worker_script}")
        runtime_tmp = kokoro_dir / "runtime_tmp"
        runtime_tmp.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["TMPDIR"] = str(runtime_tmp)
        _KOKORO_WORKER_PROC = subprocess.Popen(
            [sys.executable, str(worker_script)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
        for _ in range(30):
            if _kokoro_worker_healthy(timeout=0.5):
                return
            time.sleep(0.25)
        raise RuntimeError("Kokoro TTS worker failed to start on 127.0.0.1:9206")


def synthesize_kokoro_wav(text: str, voice: str = "af_bella", lang: str = "en-us", speed: float = 1.0) -> bytes:
    """Synthesizes 24kHz mono WAV bytes via the isolated Kokoro worker (keeps onnxruntime/espeak out of server.py)."""
    ensure_kokoro_worker_running()
    payload = json.dumps({
        "text": text,
        "voice": voice or "af_bella",
        "lang": lang or "en-us",
        "speed": float(speed or 1.0),
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{_KOKORO_WORKER_URL}/synthesize",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45.0) as resp:
        data = resp.read()
    if not data:
        raise ValueError("Kokoro worker returned 0 bytes")
    return data


@router.get("/status")
def tts_status():
    """Return status of installed TTS engines and active configuration."""
    settings = get_tts_settings()
    has_edge = False
    try:
        import edge_tts
        has_edge = True
    except ImportError:
        pass

    has_piper = False
    piper_model_ready = False
    try:
        import piper
        has_piper = True
        model_path = DATA_DIR / "piper_voices" / "en_US-lessac-medium.onnx"
        piper_model_ready = model_path.exists()
    except ImportError:
        pass

    has_kokoro = False
    kokoro_model_ready = False
    try:
        import importlib.util
        has_kokoro = importlib.util.find_spec("kokoro_onnx") is not None
        k_dir = DATA_DIR / "kokoro_voices"
        kokoro_model_ready = (k_dir / "kokoro-v1.0.onnx").exists() and (k_dir / "voices-v1.0.bin").exists()
    except Exception:
        pass

    return {
        "active_engine": settings.get("active_engine", "edge"),
        "speech_scope": settings.get("speech_scope", "first_sentence"),
        "edge_available": has_edge,
        "piper_available": has_piper and piper_model_ready,
        "piper_model_ready": piper_model_ready,
        "kokoro_available": has_kokoro and kokoro_model_ready,
        "kokoro_model_ready": kokoro_model_ready,
        "default_edge_voice": settings.get("default_edge_voice", "en-US-GuyNeural"),
        "default_piper_voice": settings.get("default_piper_voice", "en_US-lessac-medium"),
        "default_kokoro_voice": settings.get("default_kokoro_voice", "af_bella"),
        "agent_voices": settings.get("agent_voices", DEFAULT_AGENT_VOICES),
        "role_personas": settings.get("role_personas", DEFAULT_ROLE_PERSONAS),
        "cached_phrases": len(_MEMORY_CACHE),
    }


@router.get("/voices")
def list_voices():
    """Return available voices catalog for Edge, Kokoro, and Piper."""
    settings = get_tts_settings()
    return {
        "active_engine": settings.get("active_engine", "edge"),
        "speech_scope": settings.get("speech_scope", "first_sentence"),
        "edge_voices": EDGE_VOICES,
        "kokoro_voices": KOKORO_VOICES,
        "piper_voices": PIPER_VOICES,
        "agent_voices": settings.get("agent_voices", DEFAULT_AGENT_VOICES),
        "role_personas": settings.get("role_personas", DEFAULT_ROLE_PERSONAS),
    }


@router.get("/settings")
def get_settings():
    """Fetch current persistent TTS settings."""
    return get_tts_settings()


@router.post("/settings")
def update_settings(payload: Dict[str, Any] = Body(...)):
    """Update active TTS engine and voice preferences."""
    current = get_tts_settings()
    current.update(payload)
    save_tts_settings(current)
    return {"status": "ok", "settings": current}


@router.get("/stream")
async def stream_speech(
    text: str = Query(..., description="Text content to speak"),
    voice: Optional[str] = Query(None, description="Voice ID to synthesize with"),
    engine: Optional[str] = Query(None, description="Engine: 'edge' or 'piper'"),
    rate: Optional[str] = Query(None, description="Playback speed adjustment, e.g. +10% or -5%"),
    pitch: Optional[str] = Query(None, description="Playback pitch adjustment, e.g. +5Hz"),
    agent_name: Optional[str] = Query(None, description="Exact agent name/id to select personalized voice profile (BL-TTS-15)"),
    agent_role: Optional[str] = Query(None, description="Agent role to auto-select persona voice"),
    scope: Optional[str] = Query(None, description="Speech scope: 'first_sentence' or 'full'"),
):
    """
    Synthesize and stream audio directly with LRU memory caching.
    Supports Edge-TTS (Studio Neural, MP3) and Piper-TTS (Local ONNX, WAV).
    BL-TTS-15: Resolves unique personalized agent voice by exact agent_name before role fallback.
    """
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    settings = get_tts_settings()
    active_scope = scope or settings.get("speech_scope", "first_sentence")

    # If first sentence scope requested, extract the first sentence (skipping any "<Agent> here." intro prefix
    # and avoiding mid-token splits on decimals/filenames like 43.5% or script.py)
    if active_scope == "first_sentence":
        intro_m = re.match(r"^([A-Za-z0-9_\-]{2,24}\s+here[.!?,:]\s+)(.+)$", clean_text, flags=re.IGNORECASE | re.DOTALL)
        intro_prefix = intro_m.group(1) if intro_m else ""
        body_for_sentence = intro_m.group(2) if intro_m else clean_text
        match = re.search(r"^(.+?[.!?])(?=\s|$)", body_for_sentence)
        if match and len(match.group(1).strip()) > 8:
            clean_text = f"{intro_prefix}{match.group(1).strip()}".strip()
        elif len(clean_text) > 180:
            clean_text = clean_text[:177] + "..."
    else:
        # Full scope: truncate at 1000 characters
        if len(clean_text) > 1000:
            clean_text = clean_text[:997] + "..."

    active_engine = engine or settings.get("active_engine", "edge")

    # BL-TTS-15: 1. Priority Resolution: Personalized Agent Voice Profile
    agent_voices = settings.get("agent_voices", DEFAULT_AGENT_VOICES)
    matched_voice = None
    if agent_name:
        agent_key = agent_name.lower().strip()
        prof = agent_voices.get(agent_key)
        if prof and isinstance(prof, dict):
            matched_voice = prof.get("edge_voice") if active_engine == "edge" else prof.get("piper_voice")
            if not rate and prof.get("rate"):
                spd_pct = round((prof["rate"] - 1.0) * 100)
                if spd_pct != 0:
                    rate = f"{'+' if spd_pct > 0 else ''}{spd_pct}%"
            if not pitch and prof.get("pitch"):
                p_val = prof["pitch"]
                if p_val != 1.0:
                    pitch_hz = round((p_val - 1.0) * 50)
                    pitch = f"{'+' if pitch_hz > 0 else ''}{pitch_hz}Hz"

    # 2. Secondary Resolution: Role-Based Persona
    if not matched_voice and agent_role:
        role_personas = settings.get("role_personas", DEFAULT_ROLE_PERSONAS)
        role_key = agent_role.lower().strip()
        for k, v in role_personas.items():
            if k in role_key:
                matched_voice = v
                break

    valid_edge_voices = {v["id"] for v in EDGE_VOICES}
    valid_piper_voices = {v["id"] for v in PIPER_VOICES}
    valid_kokoro_voices = {v["id"] for v in KOKORO_VOICES}

    if active_engine == "edge":
        if not voice or voice not in valid_edge_voices:
            voice = matched_voice or settings.get("default_edge_voice", "en-US-GuyNeural")
    elif active_engine == "kokoro":
        if not voice or voice not in valid_kokoro_voices:
            prof_k = (agent_voices.get(agent_name.lower().strip()) if agent_name else None) or {}
            voice = (prof_k.get("kokoro_voice") if isinstance(prof_k, dict) else None) or settings.get("default_kokoro_voice", "af_bella")
    else:
        if not voice or voice not in valid_piper_voices:
            voice = matched_voice or settings.get("default_piper_voice", "en_US-lessac-medium")

    # Check cache
    cache_key = hashlib.sha256(f"{active_engine}:{voice}:{rate}:{pitch}:{active_scope}:{clean_text}".encode("utf-8")).hexdigest()
    if cache_key in _MEMORY_CACHE:
        media_type, cached_bytes = _MEMORY_CACHE[cache_key]
        return Response(
            content=cached_bytes,
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(cached_bytes)),
                "Cache-Control": "public, max-age=86400",
                "X-TTS-Engine": active_engine,
                "X-TTS-Voice": voice,
                "X-TTS-Cached": "true",
            },
        )

    # 1. Synthesize via Edge-TTS
    if active_engine == "edge":
        try:
            import edge_tts
            voice_rate = rate or "+0%"
            voice_pitch = pitch or "+0Hz"
            communicate = edge_tts.Communicate(clean_text, voice, rate=voice_rate, pitch=voice_pitch)
            out_buf = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    out_buf.write(chunk["data"])

            audio_data = out_buf.getvalue()
            if not audio_data:
                raise ValueError("Edge-TTS produced 0 audio bytes")

            # Store in cache
            if len(_MEMORY_CACHE) >= _MAX_CACHE_ITEMS:
                _MEMORY_CACHE.pop(next(iter(_MEMORY_CACHE)))
            _MEMORY_CACHE[cache_key] = ("audio/mpeg", audio_data)

            return Response(
                content=audio_data,
                media_type="audio/mpeg",
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(audio_data)),
                    "Cache-Control": "public, max-age=86400",
                    "X-TTS-Engine": "edge",
                    "X-TTS-Voice": voice,
                    "X-TTS-Cached": "false",
                },
            )
        except Exception as e:
            # Fallback to piper if edge fails
            active_engine = "piper"

    # 1b. Synthesize via Kokoro-TTS (Local Offline ONNX, EN & ZH)
    if active_engine == "kokoro":
        try:
            has_cjk = bool(re.search(r"[\u4e00-\u9fff]", clean_text))
            k_lang = "zh" if has_cjk else "en-us"
            k_voice = "zf_xiaoxiao" if (has_cjk and not str(voice).startswith("z")) else voice
            audio_data = await asyncio.to_thread(synthesize_kokoro_wav, clean_text, k_voice, k_lang, 1.0)
            if len(_MEMORY_CACHE) >= _MAX_CACHE_ITEMS:
                _MEMORY_CACHE.pop(next(iter(_MEMORY_CACHE)))
            _MEMORY_CACHE[cache_key] = ("audio/wav", audio_data)
            return Response(
                content=audio_data,
                media_type="audio/wav",
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(audio_data)),
                    "Cache-Control": "public, max-age=86400",
                    "X-TTS-Engine": "kokoro",
                    "X-TTS-Voice": k_voice,
                    "X-TTS-Cached": "false",
                },
            )
        except Exception:
            active_engine = "piper"

    # 2. Synthesize via Piper-TTS (Local Offline ONNX)
    if active_engine == "piper":
        try:
            import numpy as np
            piper_voice = get_piper_voice()
            out_buf = io.BytesIO()
            with wave.open(out_buf, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(piper_voice.config.sample_rate)
                for chunk in piper_voice.synthesize(clean_text):
                    int16_data = (chunk.audio_float_array * 32767).astype(np.int16).tobytes()
                    wav_file.writeframes(int16_data)

            audio_data = out_buf.getvalue()
            if not audio_data:
                raise ValueError("Piper-TTS produced 0 audio bytes")

            # Store in cache
            if len(_MEMORY_CACHE) >= _MAX_CACHE_ITEMS:
                _MEMORY_CACHE.pop(next(iter(_MEMORY_CACHE)))
            _MEMORY_CACHE[cache_key] = ("audio/wav", audio_data)

            return Response(
                content=audio_data,
                media_type="audio/wav",
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(audio_data)),
                    "Cache-Control": "public, max-age=86400",
                    "X-TTS-Engine": "piper",
                    "X-TTS-Voice": "en_US-lessac-medium",
                    "X-TTS-Cached": "false",
                },
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"TTS synthesis failed on both engines: {str(e)}",
            )

    raise HTTPException(status_code=400, detail=f"Unsupported TTS engine: {active_engine}")
