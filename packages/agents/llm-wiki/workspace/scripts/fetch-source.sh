#!/usr/bin/env bash
set -euo pipefail

repo="${1:-}"
ref="${2:-}"

if [ -z "$repo" ]; then
  echo "fetch-source.sh: usage: fetch-source.sh <org/repo> [ref]" >&2
  exit 2
fi

name="${repo##*/}"
dest="sources/${name}"

mkdir -p sources

if [ ! -d "${dest}/.git" ]; then
  gh repo clone "$repo" "$dest" -- --filter=blob:none --no-checkout 1>&2
fi

if [ -n "$ref" ]; then
  git -C "$dest" fetch --quiet --filter=blob:none origin "$ref"
else
  git -C "$dest" fetch --quiet --filter=blob:none origin HEAD
fi

git -C "$dest" -c advice.detachedHead=false checkout --quiet --force FETCH_HEAD
git -C "$dest" rev-parse HEAD
