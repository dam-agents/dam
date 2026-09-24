#!/bin/sh
# Exit 0 when ~/.codex/config.toml sets a top-level `model`. TOML allows
# top-level keys only before the first table header, so a `model` inside a
# table (a profile, an MCP server) is not counted.
awk '
  /^[[:space:]]*\[/ { exit }
  /^[[:space:]]*"?model"?[[:space:]]*=/ { found = 1; exit }
  END { exit !found }
' "$HOME/.codex/config.toml" 2>/dev/null
