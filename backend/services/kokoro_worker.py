#!/usr/bin/env python3
"""
Isolated Local Kokoro-82M ONNX TTS Worker (127.0.0.1:9206).

Runs kokoro-onnx, onnxruntime, libespeak-ng, and misaki[zh] strictly outside the
main FastAPI `server.py` process so `server.py` never suffers Linux `fork()`
futex deadlocks from C++ thread pools when spawning CLI subprocesses.
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

HOST = os.environ.get("KOKORO_WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("KOKORO_WORKER_PORT", "9206"))
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KOKORO_DIR = DATA_DIR / "kokoro_voices"
RUNTIME_TMP = KOKORO_DIR / "runtime_tmp"

_LOAD_LOCK = threading.Lock()
_SYNTH_LOCK = threading.Lock()
_KOKORO = None
_ZH_G2P = None


def _get_kokoro():
    global _KOKORO
    if _KOKORO is not None:
        return _KOKORO
    with _LOAD_LOCK:
        if _KOKORO is not None:
            return _KOKORO
        from kokoro_onnx import EspeakConfig, Kokoro

        model_path = KOKORO_DIR / "kokoro-v1.0.onnx"
        voices_path = KOKORO_DIR / "voices-v1.0.bin"
        if not model_path.exists() or not voices_path.exists():
            raise FileNotFoundError(f"Kokoro ONNX assets missing in {KOKORO_DIR}")

        RUNTIME_TMP.mkdir(parents=True, exist_ok=True)
        os.environ["TMPDIR"] = str(RUNTIME_TMP)
        tempfile.tempdir = str(RUNTIME_TMP)

        sys_lib = Path("/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1")
        sys_data = Path("/usr/lib/x86_64-linux-gnu/espeak-ng-data")
        espeak_cfg = (
            EspeakConfig(lib_path=str(sys_lib), data_path=str(sys_data))
            if sys_lib.exists() and sys_data.exists()
            else None
        )
        inst = Kokoro(str(model_path), str(voices_path), espeak_config=espeak_cfg)
        inst.create("hi", voice="af_bella", speed=1.0, lang="en-us")
        _KOKORO = inst
        return _KOKORO


def _synthesize_wav(text: str, voice: str = "af_bella", lang: str = "en-us", speed: float = 1.0) -> bytes:
    global _ZH_G2P
    kokoro = _get_kokoro()
    is_zh = str(lang or "").lower().startswith(("zh", "cmn")) or str(voice or "").startswith("z")
    with _SYNTH_LOCK:
        if is_zh:
            if _ZH_G2P is None:
                from misaki import zh as misaki_zh
                _ZH_G2P = misaki_zh.ZHG2P()
            phonemes, _ = _ZH_G2P(text)
            samples, sample_rate = kokoro.create(
                phonemes, voice=voice or "zf_xiaoxiao", speed=float(speed or 1.0), is_phonemes=True
            )
        else:
            samples, sample_rate = kokoro.create(
                text, voice=voice or "af_bella", speed=float(speed or 1.0), lang=lang or "en-us"
            )

    pcm16 = np.clip(samples * 32767.0, -32768, 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm16.tobytes())
    data = buf.getvalue()
    if not data:
        raise ValueError("Kokoro worker produced 0 bytes")
    return data


class KokoroHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "loaded": _KOKORO is not None})
            return
        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/synthesize":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            body = json.loads(raw.decode("utf-8"))
            text = str(body.get("text") or "").strip()
            if not text:
                self._send_json(400, {"ok": False, "error": "text is required"})
                return
            voice = str(body.get("voice") or "af_bella")
            lang = str(body.get("lang") or "en-us")
            speed = float(body.get("speed") or 1.0)
            wav_bytes = _synthesize_wav(text, voice=voice, lang=lang, speed=speed)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.end_headers()
            self.wfile.write(wav_bytes)
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})


def main():
    RUNTIME_TMP.mkdir(parents=True, exist_ok=True)
    os.environ["TMPDIR"] = str(RUNTIME_TMP)
    tempfile.tempdir = str(RUNTIME_TMP)
    server = ThreadingHTTPServer((HOST, PORT), KokoroHandler)
    print(f"[KOKORO_WORKER] Listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
