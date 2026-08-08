# Robo Sweep! 🤖🧹

A tablet-friendly, no-text toddler game about a robot vacuum cleaning a cozy
two-room house. Made for a 3-year-old who loves the Roomba 650 and Roborock Z70.

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

- **Robo cleans by himself** — for vacuumable debris, he chooses the shortest
  route he can actually drive around the furniture instead of following the
  order in which things landed. Once he starts toward a target, he sticks with
  it instead of making a U-turn every time the player taps out another mess.
  Between jobs he wanders, does spiral cleans and wall-follows, slips under the
  coffee table, and sucks up crumbs, cereal, dust bunnies, leaves and sparkles.
- **Tap the floor** → sprinkle a mess for him to chase (cycles crumb types).
  **Drag your finger** → a whole crumb trail!
- **Switch rooms without moving Robo** by tapping the glowing doorway or either
  room on the bottom-right house map. This changes the room Theo is looking at;
  Robo stays on his current job and drives between rooms by himself when work
  or a dock trip takes him there. The map highlights the viewed room while its
  marker shows where Robo actually is.
- **The kitchen is playful too** — poke the milk bottle on the island to make
  it lean, poke it again to tip it farther, and give it a third poke to knock it
  over and slowly spill milk across the floor. The cereal bowl and trash bin
  make cleanable spills too, while the refrigerator, sink, and cabinets have
  tidy light, bubble, and bounce reactions.
- **Tap Robo** → a random surprise (13 of them): spin dance, turbo zoom,
  rainbow trail, bubble party (pop the bubbles!), disco mode, the robotic-arm
  sock grab (Roborock Z70 style!), toy tidy-up, cat ride, happy beeps,
  fireworks, a big sneeze, bounce party, hover mode, under-couch treasure dive.
- **Dust bin fills up** → he announces "Going to empty the dust bin", drives
  home, spins 180° and BACKS IN (with a backup beeper!), then auto-empties with
  a big WHOOSH into the dock's dust bag.
- **Battery comes first.** As soon as it runs low, Robo interrupts whatever he
  is doing, announces "Going to charge," and returns to the dock to fast-charge
  before resuming cleanup or other service.
- **The dog** naps, trots around, rides the robot, and every so often gets the
  zoomies and CHASES the robot around the room, barking (real recorded corgi
  barks) while the robot flees in a panic. Tap him for a room-specific accident
  (toddler's orders): he poops in the living room and throws up on the kitchen
  floor.
- **Wet messes respect the selected mode.** Spilled milk, smeared poop, and
  vomit never make Robo install pads while he is in vacuum-only mode. He ignores
  them as cleaning targets, and each crossing makes the problem worse by
  dragging the mess into visible wheel tracks. When Theo selects mop or
  vacuum+mop, Robo makes the normal dock trip to install pads if needed, then
  cleans the wet messes. A fresh poop pile still gets the original oblivious
  full-smear gag once before the selected-mode rules take over.
- **Maintain the dock or he stops working**: the dust bag fills up (he cannot
  empty it) and the clean or dirty water tanks eventually need service before
  another pad wash. While ANYTHING on the dock needs a human, a docked robot
  blinks its light red and flat-out refuses to head back out. Bouncing red !
  bubbles show exactly what to tap; one tap services it ("Thank you!") and he
  gets right back to it.
- **Mode picker (left HUD)**: vacuum / mop / vacuum+mop. Deliberately choosing
  a different mode still sends him to the dock — "Going to install the mop
  pads" or "Removing the mop pads" — with an undercarriage-cam cutaway showing
  pads clicking on/off. Dirty pads get washed (sudsy cutaway, water tanks
  exchange) before removal, and every ~1 min of mopping he announces "Going to
  wash the mop pads" and heads home. Mop-only mode ignores crumbs entirely —
  vacuuming is not its job.
- **Send Robo home at any time** by tapping the physical dock or the round
  return-to-dock button beside the mode picker, even while viewing the kitchen.
  He immediately stops what he is doing, safely puts down anything held in his
  robotic arm, returns home, services the equipment he is wearing, tops up the
  battery, and naps until Theo taps him awake.
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
  localStorage. If a refresh finds an empty or invalid saved stash, the default
  pair is restored so the basket cannot remain permanently empty.
- **He gets stuck!** Every few minutes he wedges himself under the couch arm
  or the coffee table — sticking out just enough to grab — status light
  flashing red (with a rotating beacon spilling across the floor) and pleading
  "Help! I'm stuck! Please move me somewhere new." Press-and-hold to pick him
  up (wheels dangling), carry him anywhere, and set him down. He keeps
  flashing until you tap him — "Thank you! Resuming cleaning." — then does the
  little relocalizing spin real robots do. A plain click won't free him; he
  has to be *carried*.
- **Clean the whole house → victory party.** Dirt only appears when someone
  makes it (tap the floor, shake the plant for falling leaves, launch toys,
  pull socks out, poke the dog) — nothing falls on its own. When all dry and wet
  messes, socks, and toys in both rooms are gone: "The whole house is clean!",
  fireworks, and a
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
  trapped-robot drag rescue), and the watchdog pipeline (wet-mess handling, win
  party, equipment trips, trap/chase timers, dock reminders).
- `src/game/entities/Robot.js` — the star: movement AI (wander/spiral/wall-follow,
  shortest-route target selection, committed seeking, and docking), LED-face
  expressions, on-body battery gauge, suction, wet wheel tracks, dock service
  plan, and the red distress blink (trapped / dock blocked).
- `src/game/entities/` — `Dock` (bag + water tanks, service anims), `DirtSystem`
  (room-owned floor items; spawning marks the house dirty), `Dog` (the corgi:
  naps, rides, chases, and has room-specific accidents), `MilkBottle` (the
  kitchen's staged spill), and `Ambience` (sunbeam + motes).
- `src/game/world/House.js` — owns the two-room registry, reciprocal doorway
  metadata, active scene, and the visual crossing handoff.
- `src/game/world/Room.js` and `KitchenRoom.js` — living-room and kitchen
  layouts, furniture footprints/collision, tap zones, and procedural fallbacks.
- `src/game/actions/` — `ActionRegistry` (weighted, non-repeating) + themed
  modules (`celebrations`, `stunts`, `chores`, `dockTrips`, `trapped`)
  registered via `actions/index.js`; see that file for how to add one.
- `src/game/core/SoundEngine.js` — synthesized audio (beeps, hum, empty-roar,
  disco chiptune); `core/Sfx.js` — recorded clips (corgi barks) with synth
  fallbacks; `core/Voice.js` — spoken announcements.
- `src/game/fx/` — `Particles` (confetti/dust/sparkles/hearts), `Smears` (milk,
  poop, vomit, and wheel-track cleanup), `Cutaway` (undercarriage cam), and
  `Splash` (title screen).
- `src/game/ui/Hud.js` and `Minimap.js` — icon-only dust-bin/mop pill, mode
  picker, return-to-dock button, sound toggle, and the two-room view map. The
  map tracks the viewed room separately from Robo's physical room; the battery
  intentionally lives on the robot, not in the HUD.

## Art pipeline

Most sprites were generated with the `openrouter-image` skill
(`google/gemini-3.1-flash-image-preview`, green/magenta screen prompts). The
kitchen room, island, refrigerator, and bin were generated with Codex's built-in
image tool using the existing room and furniture as visual references. All
sources are keyed when necessary, then trimmed and aspect-padded by
`scripts/process_art.py` into `public/assets/sprites/`; the full kitchen plate
is emitted as an optimized WebP to keep startup quick. Raw renders and the
kitchen chroma-key sources live in `art/raw/` (not shipped). Prompts are recorded
in `art/prompts.txt`. For an OpenRouter sprite, run
`./art/gen.sh <name> "<prompt> <style suffix>"`; for either source path, finish
with `python3 scripts/process_art.py <name>`.

Every sprite is optional — the game draws procedural stand-ins for anything
missing, so it runs before/without generated art.

## Models

The scripted generation paths use OpenRouter; the kitchen expansion used
Codex's built-in image tool. These are the defaults and one-off sources used by
the project. Change this table and the corresponding script comment together
when a scripted default changes:

| Purpose | Model | Where | Override | Why this one |
| --- | --- | --- | --- | --- |
| Sprite/scene generation | `google/gemini-3.1-flash-image-preview` | `art/gen.sh` | `IMAGE_MODEL` | Nano Banana 2 — best quality/consistency for the locked art style; the lite default of the skill was skipped for fidelity. |
| Kitchen room and furniture | Codex built-in image generation (`gpt-image-2`) | `art/prompts.txt`, reference images in `public/assets/sprites/` | — | Reference-guided generation matched the existing perspective and lighting; chroma-key furniture sources were converted to alpha before `process_art.py`. |
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
