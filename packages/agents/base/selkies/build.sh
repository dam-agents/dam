#!/usr/bin/env bash
# UNIT_BOUNDARY_DESCRIPTION: installs the browser panel's stream server into <dest>/opt/selkies, for the image's Python: released Selkies, pixelflux and pcmflux and their dependencies, all published wheels, each pinned by hash in requirements.txt. The pixelflux and pcmflux wheels bundle their native libraries, x264, x265 and FFmpeg (GPL) among them; those run only inside Selkies' own process, which the agent runtime reaches over a socket, and platform-display locks Selkies to VP8, which is royalty-free. Regenerate the lock with `uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes --no-header -o requirements.txt`. The result is cached by this script, the lock and the Python version.
set -euo pipefail

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
  mkdir -p "$work/out/opt/selkies/site" "$work/out/opt/selkies/bin"
  "$python" -m pip install --quiet --disable-pip-version-check --root-user-action=ignore --no-deps \
    --only-binary=:all: --require-hashes --target "$work/out/opt/selkies/site" -r "$here/requirements.txt"
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
