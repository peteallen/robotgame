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
- **The dog** naps, trots around, rides the robot — and sometimes poops on the
  floor (randomly, or when you tap the dog). The robot drives through it,
  obliviously smears it EVERYWHERE, then: "Uh oh." → "Going to install the mop
  pads" → docks for pads → mops the whole mess → "Going to wash the mop" →
  docks again to wash (watch the water tanks change).
- **Maintain the dock or he stops working**: the dust bag fills up (can't
  empty — he waits at the dock), the clean tank runs dry and the dirty tank
  fills (can't mop — the mess stays). Bouncing red ! bubbles show exactly what
  to tap; one tap services it ("Thank you!") and he gets right back to it.
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
- **Tap the cat, TV, plant, toy box, couch** — everything does something.
- **Star meter** fills as he cleans; five stars = fireworks celebration.
- If nobody's tapping, surprises happen on their own every minute or so.

## Architecture

- `src/game/Game.js` — main loop, y-sorted rendering, input routing, screen shake/dim.
- `src/game/entities/Robot.js` — the star: movement AI (wander/spiral/wall-follow/
  seek/dock state machine), LED-face expressions, suction, battery/bin.
- `src/game/entities/` — `Dock` (auto-empty tower), `DirtSystem`, `Cat`, `Ambience`.
- `src/game/world/Room.js` — layout, furniture footprints/collision, tap zones,
  procedural fallbacks for every sprite.
- `src/game/actions/` — `ActionRegistry` (weighted, non-repeating) +
  `DefaultActions.js` (every tap surprise, one object each).
- `src/game/core/SoundEngine.js` — all audio synthesized live with WebAudio
  (robot beeps, vacuum hum, the empty-roar, disco chiptune, cartoon meows).
- `src/game/fx/Particles.js` — confetti/dust/sparkles/bubbles/hearts/flames.
- `src/game/ui/Hud.js` — icon-only battery, bin, star meter, sound toggle.

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

## Asset checklist

All shipping sprites and voice clips are declared in
`src/game/core/assetManifest.js`. When adding or renaming an asset, put the final
file in `public/assets/sprites/` or `public/assets/voice/`, add it to
`SPRITE_MANIFEST` or `VOICE_LINES`, and reference the manifest key from code.
Voice lines generated by `scripts/gen_voice.py` must also be listed in that
script's `LINES` table.

Before pushing asset changes, run:

```bash
npm run build
```

That command validates the source manifest, builds the Vite app, and validates
the copied `dist/assets` output. GitHub Pages runs the same checks before it
publishes, so missing or unmanifested assets should fail the build instead of
silently shipping a broken cut scene.
