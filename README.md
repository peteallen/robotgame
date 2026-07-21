# Robo Sweep! 🤖🧹

A tablet-friendly, no-text toddler game about a robot vacuum cleaning a cozy
living room. Made for a 3-year-old who loves the Roomba 650 and Roborock Z70.

## Run

```bash
cd ~/work/robotgame
npm install
npm run dev
# open the printed URL (defaults to http://localhost:5173, or PORT=xxxx npm run dev)
```

Best on an iPad in landscape (add to home screen for fullscreen), works in any
browser. Sound starts after the first tap (browser autoplay rules).

## How to play (no reading required)

- **Robo cleans by himself** — wanders, does spiral cleans and wall-follows,
  slips under the coffee table, sucks up crumbs, cereal, dust bunnies, leaves
  and sparkles.
- **Tap the floor** → sprinkle a mess for him to chase (cycles crumb types).
  **Drag your finger** → a whole crumb trail!
- **Tap Robo** → a random surprise (13 of them): spin dance, turbo zoom,
  rainbow trail, bubble party (pop the bubbles!), disco mode, the robotic-arm
  sock grab (Roborock Z70 style!), toy tidy-up, cat ride, happy beeps,
  fireworks, a big sneeze, bounce party, hover mode, under-couch treasure dive.
- **Dust bin fills up** → he announces "Going to empty the dust bin", drives
  home, spins 180° and BACKS IN (with a backup beeper!), then auto-empties with
  a big WHOOSH into the dock's dust bag.
- **Battery runs low** → "Going to charge" → docks and fast-charges.
- **The dog** naps, trots around, rides the robot, and every so often gets the
  zoomies and CHASES the robot around the room, barking (real recorded corgi
  barks) while the robot flees in a panic. He also poops on the floor every
  time you tap him (toddler's orders). The robot drives through it,
  obliviously smears it EVERYWHERE — mop pads installed or not — then:
  "Uh oh." → installs pads if it needs them (skips the trip if they're already
  on) → mops the whole mess → "Going to wash the mop pads" → docks to wash
  (watch the water tanks change).
- **Maintain the dock or he stops working**: the dust bag fills up (can't
  empty — he waits at the dock), the clean tank runs dry and the dirty tank
  fills (can't mop — the mess stays). While ANYTHING on the dock needs a
  human, a docked robot blinks its light red and flat-out refuses to head
  back out. Bouncing red ! bubbles show exactly what to tap; one tap services
  it ("Thank you!") and he gets right back to it.
- **Mode picker (left HUD)**: vacuum / mop / vacuum+mop. Switching sends him to
  the dock — "Going to install the mop pads" or "Removing the mop pads" — with
  an undercarriage-cam cutaway showing pads clicking on/off. Dirty pads get
  washed (sudsy cutaway, water tanks exchange) before removal, and every ~1
  min of mopping he announces "Going to wash the mop pads" and heads home.
  Mop-only mode ignores crumbs entirely — vacuuming is not its job.
- **Tap the dock base** → he comes home, backs in, and services whatever he's
  wearing — empties the bin if it has dust, washes the pads if they're dirty
  (undercarriage cam), tops up the battery — then naps until you tap him awake.
- **Mop dirtiness gauge** lives next to the dust-bin gauge (ghosted when pads
  are off); when the pads get too grubby he announces a wash trip on his own,
  exactly like the bin-full trip.
- He talks — real voice lines generated with OpenRouter (`openai/gpt-audio`):
  "Starting cleaning", "Dust bag full", "Mopping complete", and friends
  (see `scripts/gen_voice.py`; clips in `public/assets/voice/`).
- **Socks live in the laundry basket** — tap the basket to pop one onto the
  floor, or drag one out and drop it anywhere. Before long the robot arm
  fetches it back to the basket. The sock stash is stored by the dev server
  (`.sock-stash.json`), so every browser/device in the house sees the same
  basket; on static hosting (GitHub Pages) it falls back to per-browser
  localStorage.
- **He gets stuck!** Every few minutes he wedges himself under the couch arm
  or the coffee table — sticking out just enough to grab — status light
  flashing red (with a rotating beacon spilling across the floor) and pleading
  "Help! I'm stuck! Please move me somewhere new." Press-and-hold to pick him
  up (wheels dangling), carry him anywhere, and set him down. He keeps
  flashing until you tap him — "Thank you! Resuming cleaning." — then does the
  little relocalizing spin real robots do. A plain click won't free him; he
  has to be *carried*.
- **Clean the whole floor → victory party.** Dirt only appears when someone
  makes it (tap the floor, shake the plant for falling leaves, launch toys,
  pull socks out, poke the dog) — nothing falls on its own. When the last
  speck, sock and toy is gone: "The room is all clean!", fireworks, and a
  proud pirouette with confetti — then he announces "Returning to dock",
  drives home, backs in, services himself, and NAPS on the pad until you tap
  him awake (new messes wait patiently for him to be started again).
- **Battery gauge rides on the robot itself** (always upright, blinks red
  when low, fills green while fast-charging on the dock).
- **Tap the dog, TV, plant, toy box, couch** — everything does something.
- If nobody's tapping, surprises happen on their own every minute or so
  (dances, hops, dog rides — never new messes).

## Architecture

- `src/game/Game.js` — main loop, y-sorted rendering, input routing (incl. the
  trapped-robot drag rescue), and the watchdog pipeline (poop chain, win
  party, equipment trips, trap/chase timers, dock reminders).
- `src/game/entities/Robot.js` — the star: movement AI (wander/spiral/wall-follow/
  seek/dock state machine), LED-face expressions, on-body battery gauge,
  suction, dock service plan, red distress blink (trapped / dock blocked).
- `src/game/entities/` — `Dock` (bag + water tanks, service anims), `DirtSystem`
  (all floor items; spawning marks the room dirty), `Dog` (the corgi: naps,
  rides, chases, poops), `Ambience` (sunbeam + motes).
- `src/game/world/Room.js` — layout, furniture footprints/collision, tap zones,
  procedural fallbacks for every sprite.
- `src/game/actions/` — `ActionRegistry` (weighted, non-repeating) + themed
  modules (`celebrations`, `stunts`, `chores`, `dockTrips`, `trapped`)
  registered via `actions/index.js`; see that file for how to add one.
- `src/game/core/SoundEngine.js` — synthesized audio (beeps, hum, empty-roar,
  disco chiptune); `core/Sfx.js` — recorded clips (corgi barks) with synth
  fallbacks; `core/Voice.js` — spoken announcements.
- `src/game/fx/` — `Particles` (confetti/dust/sparkles/hearts), `Smears`,
  `Cutaway` (undercarriage cam), `Splash` (title screen).
- `src/game/ui/Hud.js` — icon-only dust-bin/mop pill, mode picker, sound
  toggle (battery intentionally lives on the robot, not up here).

## Art pipeline

Sprites generated with the `openrouter-image` skill
(`google/gemini-3.1-flash-image-preview`, green/magenta screen prompts), then
keyed + trimmed + aspect-padded by `scripts/process_art.py` into
`public/assets/sprites/`. Raw renders live in `art/raw/` (not shipped).
Regenerate one sprite: edit its prompt in `art/prompts.txt`, run
`./art/gen.sh <name> "<prompt> <style suffix>"`, then
`python3 scripts/process_art.py <name>`.

Every sprite is optional — the game draws procedural stand-ins for anything
missing, so it runs before/without generated art.

## Models

Everything generated goes through OpenRouter. These are the defaults baked
into each script (all overridable via the env var shown); change them here AND
in the script comment if you switch:

| Purpose | Model | Where | Override | Why this one |
| --- | --- | --- | --- | --- |
| Sprite/scene generation | `google/gemini-3.1-flash-image-preview` | `art/gen.sh` | `IMAGE_MODEL` | Nano Banana 2 — best quality/consistency for the locked art style; the lite default of the skill was skipped for fidelity. |
| Image editing (variants) | `google/gemini-3.1-flash-image-preview` | `scripts/edit_image.py` | `EDIT_MODEL` | Same model as generation so edited variants (e.g. dust-bag states) stay pixel-consistent with their base sprite. |
| Voice lines (TTS) | `openai/gpt-audio`, voice `coral` | `scripts/gen_voice.py` | `VOICE_MODEL`, `VOICE_NAME` | Only audio-output chat model that works on OpenRouter (`gpt-4o-audio-preview` is not a valid OpenRouter ID — 400s). Requires `stream: true` + `format: pcm16`; script wraps the PCM deltas into WAV (24 kHz mono). |
| Voice QA (transcription) | `google/gemini-3.5-flash` | `scripts/verify_voice.py` | `TRANSCRIBE_MODEL` | `gpt-audio` too often ignores the audio attachment and answers the prompt instead; Gemini transcribes reliably. Every clip must pass verbatim transcription (`scripts/voice_qa_loop.sh`) — the TTS model sometimes *replies* to a line ("Thank you!" → "You're welcome") instead of reading it. |
| Sound effects | ElevenLabs sound generation | `scripts/gen_sfx.py` | `ELEVENLABS_API_KEY` (or `~/.codex/.env`) | Real recorded-quality effects (corgi barks, panting) that WebAudio synthesis can't fake; mp3s land in `public/assets/sfx/`, loaded by `core/Sfx.js` with synth fallbacks. |
| Dev subagents | Claude Opus 4.8 | session tooling (Agent tool, `model: "opus"`) | — | Cheaper agents for small, scoped, disjoint-file tasks (HUD widgets, mechanical edits), each reviewed before integration. |

Voice-line gotchas learned the hard way: quote the script line in «guillemets»
with a "you are a TTS engine, not an assistant" system prompt, trim silence
with `scripts/trim_voice.py`, and avoid phonetically ambiguous phrasing
("wash the mop" transcribes as "wash them up" — we say "wash the mop pads").

## Asset checklist

All shipping sprites, voice clips, and sound effects are declared in
`src/game/core/assetManifest.js`. When adding or renaming an asset, put the final
file in `public/assets/sprites/`, `public/assets/voice/`, or `public/assets/sfx/`,
add it to `SPRITE_MANIFEST`, `VOICE_LINES`, or `SFX_CLIPS`, and reference the
manifest key from code. Voice lines generated by `scripts/gen_voice.py` must also
be listed in that script's `LINES` table, and sound effects generated by
`scripts/gen_sfx.py` in its `SFX` table — the asset check enforces both.

Before pushing asset changes, run:

```bash
npm run build
```

That command validates the source manifest, builds the Vite app, and validates
the copied `dist/assets` output. GitHub Pages runs the same checks before it
publishes, so missing or unmanifested assets should fail the build instead of
silently shipping a broken cut scene.
