#!/usr/bin/env python3
"""
Generate sound effects via the ElevenLabs sound-generation API.
Saves MP3 files to public/assets/sfx/ (decoded at runtime by WebAudio).

Key lookup order: ELEVENLABS_API_KEY env var, then ~/.codex/.env.
Usage: gen_sfx.py [key ...]     (no args = generate everything in SFX)
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/sfx"
OUT.mkdir(parents=True, exist_ok=True)

# name -> (prompt, seconds). Keep prompts concrete: subject + character + count.
SFX = {
    "bark_single": ("one single short cute high-pitched yip bark from a small corgi puppy, "
                    "friendly, no background noise", 1.2),
    "bark_excited": ("excited playful barking of a small corgi puppy chasing a toy, "
                     "three quick high-pitched yips, no background noise", 2.2),
    "dog_pant": ("a small dog panting happily after playing, light quick breaths, "
                 "no background noise", 2.5),
}


def api_key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    if k:
        return k.strip()
    env = Path.home() / ".codex/.env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("ELEVENLABS_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("no ElevenLabs key (set ELEVENLABS_API_KEY or add it to ~/.codex/.env)")


def gen(key_name, prompt, seconds):
    body = {
        "text": prompt,
        "duration_seconds": seconds,
        "prompt_influence": 0.4,
    }
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/sound-generation",
        data=json.dumps(body).encode(),
        headers={"xi-api-key": api_key(), "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        audio = res.read()
    out = OUT / f"{key_name}.mp3"
    out.write_bytes(audio)
    print(f"{key_name}: OK ({len(audio) // 1024} KB) — {prompt[:60]!r}")


def main():
    keys = sys.argv[1:] or list(SFX)
    for k in keys:
        try:
            prompt, seconds = SFX[k]
            gen(k, prompt, seconds)
        except Exception as e:
            print(f"{k}: FAIL — {e}")


if __name__ == "__main__":
    main()
