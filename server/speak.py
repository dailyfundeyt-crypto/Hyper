"""Spoken-script playback. The browser voice is the fallback."""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

# ElevenLabs publishes this premade voice id. It is not an API key.
DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"


def speak_plan(text: str) -> dict[str, Any]:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        return {"mode": "browser", "text": text}
    return {"mode": "elevenlabs", "text": text, "audio_path": "/api/speak/audio"}


def synthesize(text: str, *, opener: Any | None = None) -> tuple[bytes | None, str | None]:
    """Return MP3 bytes, or (None, reason) so the caller can fall back."""

    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        return None, "browser"
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{DEFAULT_VOICE}"
    payload = json.dumps({"text": text, "model_id": "eleven_flash_v2_5"}).encode()
    headers = {"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(request, timeout=20) as response:
            audio = response.read()
    except Exception:
        return None, "elevenlabs failed"
    if not audio:
        return None, "elevenlabs returned empty audio"
    return audio, None
