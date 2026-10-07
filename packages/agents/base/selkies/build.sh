#!/usr/bin/env bash
# UNIT_BOUNDARY_DESCRIPTION: installs the browser panel's stream server into <dest>/opt/selkies, for the image's Python: Selkies at a pinned commit, and pixelflux, pcmflux and the rest of its Python dependencies from their published wheels, every one pinned by hash in requirements.txt. The pixelflux and pcmflux wheels bundle their native libraries, x264, x265 and FFmpeg (GPL) among them; those run only inside Selkies' own process, which the agent runtime reaches over a socket, and platform-display limits Selkies to the royalty-free encoders, VP8, VP9, AV1 and JPEG. Regenerate the lock with `uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes --no-header -o requirements.txt`, keeping requirements.in to the dependencies Selkies' pyproject.toml names at SELKIES_REV. The result is cached by this script, the lock and the Python version.
set -euo pipefail

SELKIES_REV=f0b02a13a267c85cc54425ed12b2b9cfb568315a

dest="$1"
here="$(cd "$(dirname "$0")" && pwd)"
cache="${PLATFORM_SELKIES_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/platform-selkies}"
python="${PLATFORM_SELKIES_PYTHON:-$(command -v python3)}"
key="$({ cat "$0" "$here/requirements.txt"; "$python" -c 'import sys; print(sys.version_info[:2])'; uname -m; } |
  sha256sum | cut -c1-16)"
out="$cache/out-$key"

if [ ! -x "$out/opt/selkies/bin/selkies" ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  site="$work/out/opt/selkies/site"
  mkdir -p "$site" "$work/out/opt/selkies/bin"
  "$python" -m pip install --quiet --disable-pip-version-check --root-user-action=ignore --no-deps --only-binary=:all: \
    --require-hashes --target "$site" -r "$here/requirements.txt"
  git init -q "$work/selkies"
  git -C "$work/selkies" fetch -q --depth 1 https://github.com/selkies-project/selkies.git "$SELKIES_REV"
  git -C "$work/selkies" -c advice.detachedHead=false checkout -q FETCH_HEAD
  "$python" -m pip install --quiet --disable-pip-version-check --root-user-action=ignore --no-deps --target "$site" "$work/selkies"
  cp "$work/selkies/LICENSE" "$work/out/opt/selkies/LICENSE"
  cat >"$work/out/opt/selkies/bin/selkies" <<'WRAPPER'
#!/bin/sh
export PYTHONPATH="/opt/selkies/site${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -c 'import sys; from selkies.__main__ import main; sys.argv[0] = "selkies"; sys.exit(main())' "$@"
WRAPPER
  chmod +x "$work/out/opt/selkies/bin/selkies"
  rm -rf "$out"
  mkdir -p "$cache"
  mv "$work/out" "$out"
fi

mkdir -p "$dest/opt"
cp -a "$out/opt/selkies" "$dest/opt/"
