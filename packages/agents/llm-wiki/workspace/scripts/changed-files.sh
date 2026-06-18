#!/usr/bin/env bash
set -euo pipefail

name="${1:-}"
since="${2:-}"

if [ -z "$name" ]; then
  echo "changed-files.sh: usage: changed-files.sh <name> [since-sha]" >&2
  exit 2
fi

dir="sources/${name}"
if [ ! -d "${dir}/.git" ]; then
  echo "changed-files.sh: source '${name}' not cloned (run fetch-source.sh first)" >&2
  exit 1
fi

if [ -z "$since" ]; then
  echo "FULL"
  exit 0
fi

git -C "$dir" diff --name-status "${since}..HEAD"
