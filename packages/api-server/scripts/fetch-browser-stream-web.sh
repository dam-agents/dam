#!/usr/bin/env bash
# UNIT_BOUNDARY_DESCRIPTION: puts Selkies' web client into <dest>, the page the api-server serves for the browser panel's stream: the selkies_web directory of the released Selkies wheel, at the version and hashes packages/agents/base/selkies/requirements.txt pins for the stream server, so client and server are one release. It comes from PyPI, checked against that lock, never from an agent's sandbox, so no code an agent can change runs on the platform's origin.
set -euo pipefail

dest="$1"
here="$(cd "$(dirname "$0")" && pwd)"
lock="$here/../../agents/base/selkies/requirements.txt"
version="$(sed -n 's/^selkies==\([^ ]*\) .*/\1/p' "$lock")"
hashes="$(sed -n '/^selkies==/,/^[^ ]/p' "$lock" | grep -o 'sha256:[0-9a-f]*' | cut -d: -f2)"
[ -n "$version" ] && [ -n "$hashes" ] || { echo "fetch-browser-stream-web: $lock pins no selkies" >&2; exit 1; }
cache="${XDG_CACHE_HOME:-$HOME/.cache}/platform-selkies-web/$version"

if [ ! -f "$cache/index.html" ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  url="$(curl -fsSL "https://pypi.org/pypi/selkies/$version/json" |
    jq -r '[.urls[] | select(.packagetype == "bdist_wheel")][0].url')"
  curl -fsSL --retry 3 -o "$work/selkies.whl" "$url"
  sum="$(sha256sum "$work/selkies.whl" | cut -c1-64)"
  grep -qx "$sum" <<<"$hashes" || { echo "fetch-browser-stream-web: $url does not match $lock" >&2; exit 1; }
  unzip -q "$work/selkies.whl" 'selkies/selkies_web/*' -x 'selkies/selkies_web/__init__.py' -d "$work/wheel"
  rm -rf "$cache"
  mkdir -p "$(dirname "$cache")"
  mv "$work/wheel/selkies/selkies_web" "$cache"
fi

mkdir -p "$dest"
cp -a "$cache/." "$dest/"
