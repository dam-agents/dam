#!/usr/bin/env bash
# Decide whether a container image must be built or can be reused from the
# registry. Single source of truth shared by the local `*:image` mise tasks and
# CI (the `changes` job) so the dependency graph and skip logic never drift.
#
# An image is REUSABLE when its effective source (its own paths PLUS its base's,
# transitively) has no uncommitted changes AND the registry already has it at the
# commit that last touched that source. The transitive path union is what makes a
# base change propagate to its children automatically (a stale base ⇒ the child's
# last-touching commit moves ⇒ its reuse tag moves too), and the registry check is
# self-correcting: a missing image (never built, build failed, off-main branch)
# just falls back to BUILD.
#
# Usage:
#   resolve-image.sh resolve <component>        -> "BUILD" | "REUSE <full-ref>"
#   resolve-image.sh build-or-reuse <c> -- ...  -> pull+tag locally, or `docker build ... -t <local-tag>`
#   resolve-image.sh gha-outputs                -> key=value lines for $GITHUB_OUTPUT (all components)
#   resolve-image.sh paths <component>          -> effective source paths (debug)
#   resolve-image.sh --self-check               -> run assertions (no docker/git/network)
#
# Env: IMAGE_PREFIX (default quay.io/dam-agents), GITHUB_SHA, EVENT (gha-outputs
# archs), RESOLVE_NO_REUSE=1 forces BUILD everywhere (CI main/tag: publish all).
# Written for bash 3.2 (macOS) — no associative arrays.
set -euo pipefail

IMAGE_PREFIX="${IMAGE_PREFIX:-quay.io/dam-agents}"

# platform-base's build context is the repo root but it only COPYs these paths;
# keep in sync with packages/platform-base/Dockerfile.
PLATFORM_BASE_PATHS="packages/platform-base packages/agent-runtime packages/agent-runtime-api packages/api-server-api packages/dev-config scripts/install-pnpm.js package.json pnpm-workspace.yaml pnpm-lock.yaml"

own_paths() {
  case "$1" in
    platform-base) echo "$PLATFORM_BASE_PATHS" ;;
    claude-code|codex|pi-agent|bob|k-search|nous|openevolve) echo "packages/agents/$1" ;;
    mock) echo "packages/e2e/agents/mock" ;;
    *) echo "unknown component: $1" >&2; return 1 ;;
  esac
}

base_of() {
  case "$1" in
    platform-base) echo "" ;;
    claude-code|codex|pi-agent|bob|k-search|mock) echo "platform-base" ;;
    nous|openevolve) echo "claude-code" ;;
    *) echo "unknown component: $1" >&2; return 1 ;;
  esac
}

# Local docker tag the *:image tasks build/pull to (mirrors values-local.yaml).
local_tag() { case "$1" in platform-base) echo "platform-base" ;; *) echo "platform-$1:latest" ;; esac; }

effective_paths() {
  local base; base="$(base_of "$1")"
  if [ -n "$base" ]; then echo "$(own_paths "$1") $(effective_paths "$base")"; else own_paths "$1"; fi
}

registry_has() { docker manifest inspect "$1" >/dev/null 2>&1 || docker buildx imagetools inspect "$1" >/dev/null 2>&1; }

resolve() {
  local comp="$1" paths sha ref
  [ -n "${RESOLVE_NO_REUSE:-}" ] && { echo BUILD; return; }
  paths="$(effective_paths "$comp")"
  # Uncommitted change (or untracked file) in the effective source ⇒ must build.
  [ -n "$(git status --porcelain -- $paths 2>/dev/null)" ] && { echo BUILD; return; }
  sha="$(git log -1 --format=%H -- $paths 2>/dev/null || true)"
  [ -z "$sha" ] && { echo BUILD; return; }
  ref="${IMAGE_PREFIX}/${comp}:${sha}"
  if registry_has "$ref"; then echo "REUSE $ref"; else echo BUILD; fi
}

build_or_reuse() {
  local comp="$1"; shift
  [ "${1:-}" = "--" ] && shift
  [ -n "${SKIP_IMAGE_BUILD:-}" ] && exit 0
  local decision ref lt; lt="$(local_tag "$comp")"
  decision="$(resolve "$comp")"
  if [ "${decision%% *}" = REUSE ]; then
    ref="${decision#REUSE }"
    echo "↺ reuse $ref -> $lt"
    if docker pull "$ref" && docker tag "$ref" "$lt"; then return 0; fi
    echo "  pull failed, building instead" >&2
  fi
  echo "⚒ build $lt"
  docker build -t "$lt" ${GITHUB_TOKEN:+--secret id=GITHUB_TOKEN,env=GITHUB_TOKEN} "$@"
}

# tag portion to hand children as BASE_IMAGE / to publish under this run's sha
tag_for() {
  local d; d="$(resolve "$1")"
  if [ "${d%% *}" = REUSE ]; then local r="${d#REUSE }"; echo "${r##*:}"; else echo "${GITHUB_SHA:?GITHUB_SHA required}"; fi
}

gha_outputs() {
  local archs pb pb_tag built a agents_json cc_tag nous oe
  archs='["amd64","arm64"]'; [ "${EVENT:-}" = pull_request ] && archs='["amd64"]'
  if [ "$(resolve platform-base | cut -d' ' -f1)" = REUSE ]; then pb=false; else pb=true; fi
  pb_tag="$(tag_for platform-base)"
  built=()
  for a in claude-code codex pi-agent bob k-search; do
    [ "$(resolve "$a" | cut -d' ' -f1)" = BUILD ] && built+=("$a")
  done
  agents_json="$(printf '%s\n' "${built[@]:-}" | jq -R . | jq -cs 'map(select(length>0))')"
  cc_tag="$(tag_for claude-code)"
  nous=false; [ "$(resolve nous | cut -d' ' -f1)" = BUILD ] && nous=true
  oe=false;   [ "$(resolve openevolve | cut -d' ' -f1)" = BUILD ] && oe=true
  printf 'platform_base=%s\nplatform_base_tag=%s\nagents=%s\narchs=%s\nnous=%s\nopenevolve=%s\nclaude_code_base_tag=%s\n' \
    "$pb" "$pb_tag" "$agents_json" "$archs" "$nous" "$oe" "$cc_tag"
}

self_check() {
  local f=0
  chk() { if [ "$1" != "$2" ]; then echo "FAIL: expected [$2] got [$1]" >&2; f=1; fi; }
  has() { case "$1" in *"$2"*) ;; *) echo "FAIL: [$1] missing [$2]" >&2; f=1 ;; esac; }
  chk "$(base_of nous)" claude-code
  chk "$(base_of claude-code)" platform-base
  chk "$(base_of platform-base)" ""
  chk "$(local_tag platform-base)" platform-base
  chk "$(local_tag bob)" "platform-bob:latest"
  has "$(effective_paths nous)" packages/platform-base
  has "$(effective_paths nous)" packages/agents/claude-code
  has "$(effective_paths nous)" packages/agents/nous
  # NO_REUSE reproduces the full-build (main/tag) output without git/docker.
  local out; out="$(EVENT=push GITHUB_SHA=deadbeef RESOLVE_NO_REUSE=1; export EVENT GITHUB_SHA RESOLVE_NO_REUSE; gha_outputs)"
  has "$out" 'platform_base=true'
  has "$out" 'agents=["claude-code","codex","pi-agent","bob","k-search"]'
  has "$out" 'archs=["amd64","arm64"]'
  has "$out" 'claude_code_base_tag=deadbeef'
  [ "$f" = 0 ] && echo "self-check OK" || exit 1
}

case "${1:-}" in
  resolve)        resolve "$2" ;;
  build-or-reuse) shift; build_or_reuse "$@" ;;
  gha-outputs)    gha_outputs ;;
  paths)          effective_paths "$2" ;;
  --self-check)   self_check ;;
  *) echo "usage: resolve-image.sh {resolve|build-or-reuse|gha-outputs|paths|--self-check}" >&2; exit 2 ;;
esac
