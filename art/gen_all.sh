#!/bin/bash
# Generate all sprites from prompts.txt with limited parallelism.
cd /Users/peteallen/work/robotgame
STYLE="Style: adorable high-end 3D cartoon render for a toddler's video game, like a prop from a modern animated movie. Soft rounded shapes, glossy toy-like materials, bright cheerful saturated colors, soft even studio lighting, crisp clean silhouette. The object is centered, fully visible, with generous margin on all sides, on a SOLID PURE BRIGHT GREEN background (hex 00FF00) filling every pixel behind and around it. Absolutely no ground shadow, no floor, no reflection, no text, no watermark, no border."

run_one() {
  local name="$1" prompt="$2"
  ./art/gen.sh "$name" "$prompt $STYLE"
}

export -f run_one
export STYLE

# read prompts, run max 5 at a time
pids=()
count=0
while IFS='|' read -r name prompt; do
  [ -z "$name" ] && continue
  run_one "$name" "$prompt" &
  pids+=($!)
  count=$((count + 1))
  if (( count % 5 == 0 )); then
    wait
  fi
done < art/prompts.txt
wait
echo "ALL DONE"
ls -la art/raw/*.png | wc -l
