#!/usr/bin/env bash
# UNIT_BOUNDARY_DESCRIPTION: builds the browser panel's VNC server — wayvnc and its own neatvnc — into <dest>/opt/platform-vnc. Debian's neatvnc links Debian's ffmpeg, which carries GPL codecs; built here with H.264 off it links only permissively licensed libraries. Needs meson, ninja and the -dev packages listed in REQUIRES on the build host; the result is cached by this script's and the patch's content.
set -euo pipefail

NEATVNC_TAG=v0.9.5
WAYVNC_TAG=v0.9.1
REQUIRES="meson ninja-build pkg-config libaml-dev libpixman-1-dev libturbojpeg0-dev zlib1g-dev libdrm-dev libgbm-dev libwayland-dev wayland-protocols libxkbcommon-dev libjansson-dev"

dest="$1"
here="$(cd "$(dirname "$0")" && pwd)"
cache="${PLATFORM_VNC_CACHE:-$HOME/.cache/platform-vnc}"
key="$(cat "$0" "$here"/*.patch | sha256sum | cut -c1-16)"
out="$cache/$key"

if [ ! -x "$out/opt/platform-vnc/bin/wayvnc" ]; then
  missing=""
  for p in $REQUIRES; do dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"; done
  [ -z "$missing" ] || { echo "platform-vnc: install on the build host:$missing" >&2; exit 1; }
  src="$cache/src-$key"
  rm -rf "$src" "$out"
  mkdir -p "$src"
  git -c advice.detachedHead=false clone -q --depth 1 -b "$NEATVNC_TAG" https://github.com/any1/neatvnc.git "$src/neatvnc"
  git -c advice.detachedHead=false clone -q --depth 1 -b "$WAYVNC_TAG" https://github.com/any1/wayvnc.git "$src/wayvnc"
  git -C "$src/neatvnc" apply "$here/neatvnc-without-h264.patch"
  git -C "$src/wayvnc" apply "$here/wayvnc-headless-refresh.patch"
  (cd "$src/neatvnc" &&
    meson setup build --buildtype=release --prefix=/opt/platform-vnc --libdir=lib \
      -Dh264=disabled -Dtls=disabled -Djpeg=enabled -Dtests=false -Dexamples=false >/dev/null &&
    meson compile -C build >/dev/null && DESTDIR="$out" meson install -C build >/dev/null) ||
    { echo "platform-vnc: neatvnc build failed" >&2; exit 1; }
  mkdir -p "$src/pc"
  sed "s|^prefix=.*|prefix=$out/opt/platform-vnc|" "$out/opt/platform-vnc/lib/pkgconfig/neatvnc.pc" >"$src/pc/neatvnc.pc"
  (cd "$src/wayvnc" &&
    PKG_CONFIG_PATH="$src/pc" \
      meson setup build --buildtype=release --prefix=/opt/platform-vnc -Dpam=disabled -Dtests=false -Dman-pages=disabled \
      -Dc_link_args=-Wl,-rpath,/opt/platform-vnc/lib >/dev/null &&
    meson compile -C build >/dev/null && DESTDIR="$out" meson install -C build >/dev/null) ||
    { echo "platform-vnc: wayvnc build failed" >&2; exit 1; }
  rm -rf "$out/opt/platform-vnc/include" "$out/opt/platform-vnc/lib/pkgconfig"
  rm -rf "$src"
  if LD_LIBRARY_PATH="$out/opt/platform-vnc/lib" ldd "$out/opt/platform-vnc/bin/wayvnc" | grep -E 'libav|libx26|not found'; then
    echo "platform-vnc: wayvnc links a library it must not" >&2
    rm -rf "$out"
    exit 1
  fi
fi

mkdir -p "$dest/opt"
cp -a "$out/opt/platform-vnc" "$dest/opt/"
