#!/bin/sh
SESSION_DIR="$HOME/.pi/agent/sessions"
mkdir -p "$SESSION_DIR" >/dev/null 2>&1
exec pi --session "$SESSION_DIR/$HARNESS_SESSION_ID.jsonl" "$@"
