#!/bin/bash
# Verify all voice clips by transcription; regenerate + trim failures; repeat.
cd "$(dirname "$0")/.."
export VOICE_MODEL=openai/gpt-audio
for round in 1 2 3; do
  echo "=== VERIFY ROUND $round ==="
  OUT=$(python3 scripts/verify_voice.py 2>&1)
  echo "$OUT"
  FAILS=$(echo "$OUT" | sed -n 's/^FAILURES: //p')
  if [ "$FAILS" = "none" ] || [ -z "$FAILS" ]; then
    echo "ALL CLIPS VERIFIED"
    exit 0
  fi
  echo "=== REGENERATING: $FAILS ==="
  python3 scripts/gen_voice.py $FAILS
  python3 scripts/trim_voice.py > /dev/null
done
echo "=== FINAL VERIFY ==="
python3 scripts/verify_voice.py 2>&1 | tail -3
