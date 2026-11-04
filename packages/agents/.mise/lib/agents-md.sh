#!/usr/bin/env bash
# A workload image packs its own rootfs as a layer over the default image, so a
# file at the same path shadows the platform's whole. A workload's
# /etc/AGENTS.md therefore extends the platform's instructions instead: base
# first, one blank line, then the workload's own.
compose_agents_md() {
  { cat "$1"; printf '\n'; cat "$2"; } > "$3"
}

# The workload-tree preparation build_thin runs before it packs, in the layout
# it calls it with: <stage> (holding base/rootfs) and the copied workload tree.
compose_workload_agents_md() {
  local build=$2
  [ -f "$build/etc/AGENTS.md" ] || return 0
  compose_agents_md "$1/base/rootfs/etc/AGENTS.md" "$build/etc/AGENTS.md" "$build/etc/AGENTS.md.composed"
  mv "$build/etc/AGENTS.md.composed" "$build/etc/AGENTS.md"
}
