#!/bin/sh
DIR="$HOME/.pi/agent/sessions/--$(printf %s "$PWD" | sed 's|^/||; s|/|-|g')--"
mkdir -p "$DIR"
if ! ls "$DIR"/*_"$HARNESS_SESSION_ID".jsonl >/dev/null 2>&1; then
  printf '{"type":"session","version":3,"id":"%s","timestamp":"%s","cwd":"%s"}\n' \
    "$HARNESS_SESSION_ID" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$PWD" \
    > "$DIR/$(date -u +%Y-%m-%dT%H-%M-%S.000Z)_$HARNESS_SESSION_ID.jsonl"
fi
exec pi --session "$HARNESS_SESSION_ID" "$@"
