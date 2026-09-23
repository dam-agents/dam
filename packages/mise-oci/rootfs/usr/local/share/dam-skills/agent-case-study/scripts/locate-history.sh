#!/bin/sh
set -u
H="${HOME:-/home/agent}"

if [ -f "$H/.platform/session-metadata.json" ]; then
  echo "PLATFORM_INDEX=$H/.platform/session-metadata.json"
else
  echo "PLATFORM_INDEX=none"
fi

count_files() {
  find "$1" -name '*.jsonl' -type f 2>/dev/null | wc -l | tr -d ' '
}

count_recent_files() {
  find "$1" -name '*.jsonl' -type f -mtime -7 2>/dev/null | wc -l | tr -d ' '
}

if [ -d "$H/.claude/projects" ]; then
  echo "HARNESS=claude-code"
  echo "STORE=$H/.claude/projects"
  echo "FORMAT=jsonl-per-session"
  echo "TOTAL_SESSION_FILES=$(count_files "$H/.claude/projects")"
  echo "RECENT_SESSION_FILES=$(count_recent_files "$H/.claude/projects")"
elif [ -f "$H/.bob/db/bob.db" ]; then
  echo "HARNESS=bob"
  echo "STORE=$H/.bob/db/bob.db"
  echo "FORMAT=sqlite"
  if [ -f "$H/.bob/platform-shim-sessions.json" ]; then
    echo "SESSION_MAP=$H/.bob/platform-shim-sessions.json"
  fi
elif [ -d "$H/.pi/agent" ]; then
  echo "HARNESS=pi"
  echo "FORMAT=jsonl-per-session"
  if [ -d "$H/.pi/agent/sessions" ]; then
    echo "STORE=$H/.pi/agent/sessions"
    echo "TOTAL_SESSION_FILES=$(count_files "$H/.pi/agent/sessions")"
    echo "RECENT_SESSION_FILES=$(count_recent_files "$H/.pi/agent/sessions")"
  else
    echo "STORE=none-yet"
  fi
  if [ -d "$H/.pi/agent/memory" ]; then
    echo "MEMORY_DIR=$H/.pi/agent/memory"
  fi
  if [ -f "$H/.pi/pi-acp/session-map.json" ]; then
    echo "SESSION_MAP=$H/.pi/pi-acp/session-map.json"
  fi
elif [ -d "$H/.codex" ]; then
  echo "HARNESS=codex"
  if [ "$(count_files "$H/.codex")" != "0" ]; then
    echo "STORE=$H/.codex"
    echo "FORMAT=jsonl-probe"
    echo "TOTAL_SESSION_FILES=$(count_files "$H/.codex")"
    echo "RECENT_SESSION_FILES=$(count_recent_files "$H/.codex")"
  else
    echo "STORE=unknown"
  fi
else
  echo "HARNESS=unknown"
  echo "STORE=unknown"
fi
