#!/usr/bin/env bash
# UNIT_BOUNDARY_DESCRIPTION: builds the browser panel's stream server — Selkies with a GPL-free pixelflux — into <dest>/opt/selkies. pixelflux's published wheels link x264 and x265 (GPL); built from source with PIXELFLUX_ENABLE_GPL=0 it encodes H.264 with Cisco's OpenH264 and H.265 with kvazaar, both BSD-licensed. pixelflux is pinned past 2.1.0, the release that still linked FFmpeg; kvazaar is built here because pixelflux needs 2.3.2 and Debian trixie has 2.3.1. Needs the -dev packages in REQUIRES, cmake, nasm, a C compiler and a Rust toolchain through mise on the build host; the repository's zig cross-linker is kept out of the pixelflux build, which links against the host's libraries; the result is cached by this script's content.
set -euo pipefail

SELKIES_REV=f0b02a13a267c85cc54425ed12b2b9cfb568315a
PIXELFLUX_REV=84d47c6a7a080dc6ece9dfc7442b3c2bceada098
KVAZAAR_TAG=v2.3.2
REQUIRES="cmake nasm pkg-config libclang-dev libvpx-dev libsvtav1enc-dev libdav1d-dev libde265-dev libgbm-dev libdrm-dev libwayland-dev libinput-dev libudev-dev libxkbcommon-dev libpixman-1-dev"

dest="$1"
cache="${PLATFORM_SELKIES_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/platform-selkies}"
key="$(cat "$0" | sha256sum | cut -c1-16)"
out="$cache/$key"
python="${PLATFORM_SELKIES_PYTHON:-$(command -v python3)}"

if [ ! -x "$out/opt/selkies/bin/selkies" ]; then
  missing=""
  for p in $REQUIRES; do dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"; done
  [ -z "$missing" ] || { echo "platform-selkies: install on the build host:$missing" >&2; exit 1; }
  src="$cache/src-$key"
  rm -rf "$src" "$out"
  mkdir -p "$src" "$out/opt/selkies/lib" "$out/opt/selkies/site" "$out/opt/selkies/bin"

  git -c advice.detachedHead=false clone -q --depth 1 -b "$KVAZAAR_TAG" https://github.com/ultravideo/kvazaar.git "$src/kvazaar"
  cmake -S "$src/kvazaar" -B "$src/kvazaar/build" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$src/prefix" -DBUILD_SHARED_LIBS=ON >/dev/null
  cmake --build "$src/kvazaar/build" -j >/dev/null
  cmake --install "$src/kvazaar/build" >/dev/null
  cp -a "$src/prefix/lib/"libkvazaar.so* "$out/opt/selkies/lib/"

  git init -q "$src/pixelflux"
  git -C "$src/pixelflux" fetch -q --depth 1 https://github.com/selkies-project/pixelflux.git "$PIXELFLUX_REV"
  git -C "$src/pixelflux" -c advice.detachedHead=false checkout -q FETCH_HEAD
  git init -q "$src/selkies"
  git -C "$src/selkies" fetch -q --depth 1 https://github.com/selkies-project/selkies.git "$SELKIES_REV"
  git -C "$src/selkies" -c advice.detachedHead=false checkout -q FETCH_HEAD

  "$python" -m venv "$src/venv"
  "$src/venv/bin/pip" install -q --upgrade pip setuptools wheel setuptools-rust
  PIXELFLUX_ENABLE_GPL=0 CARGO_BUILD_JOBS="${PLATFORM_SELKIES_JOBS:-2}" PKG_CONFIG_PATH="$src/prefix/lib/pkgconfig" \
    LD_LIBRARY_PATH="$src/prefix/lib" \
    env -u CC_x86_64_unknown_linux_gnu -u CC_aarch64_unknown_linux_gnu -u AR_x86_64_unknown_linux_gnu -u AR_aarch64_unknown_linux_gnu \
      -u CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER -u CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER \
      mise -C "$src" exec rust@stable -- "$src/venv/bin/pip" install -q --target "$out/opt/selkies/site" "$src/pixelflux"
  "$src/venv/bin/pip" install -q --target "$out/opt/selkies/site" --no-deps "$src/selkies"
  "$src/venv/bin/python" -c 'import tomllib,sys; print("\n".join(d for d in tomllib.load(open(sys.argv[1],"rb"))["project"]["dependencies"] if not d.startswith("pixelflux")))' \
    "$src/selkies/pyproject.toml" >"$src/requirements.txt"
  "$src/venv/bin/pip" install -q --target "$out/opt/selkies/site" -r "$src/requirements.txt"

  cat >"$out/opt/selkies/bin/selkies" <<'WRAPPER'
#!/bin/sh
export PYTHONPATH="/opt/selkies/site${PYTHONPATH:+:$PYTHONPATH}"
export LD_LIBRARY_PATH="/opt/selkies/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec python3 -c 'import sys; from selkies.__main__ import main; sys.argv[0] = "selkies"; sys.exit(main())' "$@"
WRAPPER
  chmod +x "$out/opt/selkies/bin/selkies"
  rm -rf "$src"

  if find "$out/opt/selkies" -name '*.so*' -exec env LD_LIBRARY_PATH="$out/opt/selkies/lib" ldd {} \; 2>/dev/null |
    grep -E 'libx264|libx265|libav(codec|format|util)'; then
    echo "platform-selkies: a library links GPL codecs" >&2
    rm -rf "$out"
    exit 1
  fi
  if ! PYTHONPATH="$out/opt/selkies/site" LD_LIBRARY_PATH="$out/opt/selkies/lib" "$python" -c \
    'import pixelflux, sys; e = pixelflux.SOFTWARE_ENCODERS; sys.exit(e.get("h264") != "openh264")'; then
    echo "platform-selkies: pixelflux does not encode H.264 with OpenH264" >&2
    rm -rf "$out"
    exit 1
  fi
fi

mkdir -p "$dest/opt"
cp -a "$out/opt/selkies" "$dest/opt/"
