#!/usr/bin/env python3
"""
Generate robot-vacuum voice lines via OpenRouter audio-capable models.
Saves WAV files to public/assets/voice/.
Usage: gen_voice.py [--test] [key ...]
"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/voice"
OUT.mkdir(parents=True, exist_ok=True)

LINES = {
    "start_clean": "Starting cleaning.",
    "go_charge": "Going to charge.",
    "charge_done": "Charging complete.",
    "go_empty": "Going to empty the dust bin.",
    "emptying": "Emptying the dust bin.",
    "go_dock": "Returning to dock.",
    "uh_oh": "Uh oh.",
    "go_mop_install": "Going to install the mop pads.",
    "mop_installed": "Mop pads installed. Starting mopping.",
    "go_mop_wash": "Going to wash the mop pads.",
    "washing": "Washing the mop.",
    "mop_done": "Mopping complete.",
    "remove_pads": "Removing the mop pads.",
    "bag_full": "Dust bag full. Please empty the dust bag.",
    "clean_empty": "Clean water tank empty. Please refill the clean water tank.",
    "dirty_full": "Dirty water tank full. Please empty the dirty water tank.",
    "thank_you": "Thank you!",
}

# openai/gpt-audio is the audio-output model that actually exists on OpenRouter
# (gpt-4o-audio-preview is NOT a valid OpenRouter model ID and 400s).
# See "Models" in README.md before changing.
MODEL = os.environ.get("VOICE_MODEL", "openai/gpt-audio")
VOICE = os.environ.get("VOICE_NAME", "coral")


def api_key():
    k = os.environ.get("OPENROUTER_API_KEY")
    if k:
        return k.strip()
    p = Path.home() / ".config/openrouter/key"
    if p.exists():
        return p.read_text().strip()
    raise SystemExit("no OpenRouter key")


def wav_wrap(pcm: bytes, rate=24000, channels=1, sampwidth=2) -> bytes:
    import struct
    byte_rate = rate * channels * sampwidth
    block_align = channels * sampwidth
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, rate, byte_rate, block_align, sampwidth * 8)
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


def gen(key, text):
    # OpenRouter requires streaming for audio output; PCM16 chunks arrive as
    # base64 deltas which we concatenate and wrap in a WAV header.
    body = {
        "model": MODEL,
        "modalities": ["text", "audio"],
        "audio": {"voice": VOICE, "format": "pcm16"},
        "stream": True,
        "messages": [
            {
                "role": "system",
                "content": "You are a text-to-speech engine, NOT an assistant. You never converse, "
                           "never acknowledge, never respond, never add words like 'Understood' or "
                           "'You're welcome'. You receive a script line between « » and speak ONLY "
                           "that line aloud, verbatim. Voice: calm, warm, pleasant, slightly "
                           "synthetic announcer, like a smart home appliance.",
            },
            {"role": "user", "content": f"«{text}»"},
        ],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
        },
    )
    pcm = bytearray()
    with urllib.request.urlopen(req, timeout=180) as res:
        for raw in res:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if "error" in chunk:
                raise RuntimeError(chunk["error"])
            for ch in chunk.get("choices", []):
                audio = (ch.get("delta") or {}).get("audio") or {}
                data = audio.get("data")
                if data:
                    pcm.extend(base64.b64decode(data))
    if not pcm:
        raise RuntimeError("stream contained no audio deltas")
    out = OUT / f"{key}.wav"
    out.write_bytes(wav_wrap(bytes(pcm)))
    print(f"{key}: OK ({len(pcm) // 1024} KB pcm) — {text!r}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keys = args or list(LINES)
    if "--test" in sys.argv:
        keys = keys[:1]
    for k in keys:
        try:
            gen(k, LINES[k])
        except Exception as e:
            print(f"{k}: FAIL — {e}")


if __name__ == "__main__":
    main()
