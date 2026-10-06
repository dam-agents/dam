#!/usr/bin/env bash
# UNIT_BOUNDARY_DESCRIPTION: builds Selkies' web client (addons/selkies-web-core, MPL-2.0) into <dest>, the page the api-server serves for the browser panel's stream. The page is built into the api-server image from a pinned commit, never fetched from an agent's sandbox, so no code an agent can change runs on the platform's origin. The commit is the one packages/agents/base/selkies/build.sh builds the stream server from; the result is cached by this script's content.
set -euo pipefail

SELKIES_REV=f0b02a13a267c85cc54425ed12b2b9cfb568315a

dest="$1"
cache="${PLATFORM_SELKIES_WEB_CACHE:-$HOME/.cache/platform-selkies-web}"
key="$(sha256sum "$0" | cut -c1-16)"
out="$cache/$key"

if [ ! -f "$out/index.html" ]; then
  src="$cache/src-$key"
  rm -rf "$src" "$out"
  git init -q "$src"
  git -C "$src" fetch -q --depth 1 https://github.com/selkies-project/selkies.git "$SELKIES_REV"
  git -C "$src" -c advice.detachedHead=false checkout -q FETCH_HEAD
  (cd "$src/addons/selkies-web-core" &&
    npm ci --no-audit --no-fund --fetch-retries=5 >/dev/null &&
    npm run build >/dev/null)
  cp -a "$src/addons/selkies-web-core/dist" "$out"
  cp "$src/LICENSE" "$out/LICENSE"
  rm -rf "$src"
fi

mkdir -p "$dest"
cp -a "$out/." "$dest/"
