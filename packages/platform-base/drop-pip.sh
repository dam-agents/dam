#!/bin/sh
# Remove pip from one interpreter, given its path (`mise where`/`uv python
# find` both hand you one).
#
# pip's vendor tree is where this repo's setuptools and msgpack findings come
# from — no pip release fixes them, and nothing in these images needs pip: uv
# drives every install, and `uv venv` (unlike `python -m venv`) seeds none.
#
# Removal only. platform-base writes a `uv pip` shim over the hole afterwards
# because its interpreter is the one on PATH as `python`; the uv-managed
# interpreters the workload images add are reached only through uv, so they
# just lose it.
set -eu

py="$1"
sp="$("$py" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
bin="$(dirname "$py")"
rm -rf "$sp"/pip "$sp"/pip-*.dist-info "$bin"/pip "$bin"/pip3 "$bin"/pip3.*

if "$py" -c 'import pip' 2>/dev/null; then
  echo "drop-pip: pip still importable in $py" >&2
  exit 1
fi
# CI validation only, reverted before merge: moves platform-base so every agent builds.
