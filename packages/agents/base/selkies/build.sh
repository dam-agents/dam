#!/usr/bin/env bash
# UNIT_BOUNDARY_DESCRIPTION: builds the browser panel's stream server — Selkies with a GPL-free pixelflux — into <dest>/opt/selkies. pixelflux's published wheels link x264 and x265 (GPL); built from source with PIXELFLUX_ENABLE_GPL=0 it encodes H.264 with Cisco's OpenH264 and H.265 with kvazaar, both BSD-licensed. pixelflux is pinned past 2.1.0, the release that still linked FFmpeg; kvazaar is built here because pixelflux needs 2.3.2 and Debian trixie has 2.3.1. pixelflux links the system's codec libraries, so it is built in a chroot of the image's own Debian base, whatever distribution the build host runs, with the host's mise Rust (trixie's is older than pixelflux needs) and the image's Python bind-mounted in. Needs root (or sudo), crane and mise. The result is cached under $XDG_CACHE_HOME/platform-selkies, keyed by this script, the base image, the image's packages, the Python version and the architecture — the directory CI keeps between runs with actions/cache — and Cargo's build directory beside it, so a build cut short resumes.
set -euo pipefail

SELKIES_REV=f0b02a13a267c85cc54425ed12b2b9cfb568315a
PIXELFLUX_REV=84d47c6a7a080dc6ece9dfc7442b3c2bceada098
KVAZAAR_TAG=v2.3.2
# What the build needs in the chroot, beside the image's own packages
# (base/apt.toml), which make a library the build finds missing one the image
# lacks too.
BUILD_PACKAGES="build-essential cmake nasm pkg-config git ca-certificates libclang-dev libvpx-dev libsvtav1enc-dev libdav1d-dev libde265-dev libgbm-dev libdrm-dev libwayland-dev libinput-dev libudev-dev libxkbcommon-dev libpixman-1-dev"

dest="$1"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
base="$(mise config get -f "$repo/.mise/config.toml" vars.base_image_debian)"
cache="${PLATFORM_SELKIES_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/platform-selkies}"
image_packages="$(sed -n 's/^"apt:\([^"]*\)".*/\1/p' "$here/../apt.toml" | paste -sd' ' -)"
python="$(realpath "${PLATFORM_SELKIES_PYTHON:-$(command -v python3)}")"
arch="$(uname -m | sed 's/aarch64/arm64/;s/x86_64/amd64/')"
key="$({ cat "$0"; echo "$base $image_packages"; "$python" -c 'import sys; print(sys.version_info[:2])'; } |
  sha256sum | cut -c1-16)-$arch"
out="$cache/out-$key"
python_home="$(dirname "$(dirname "$python")")"
sudo=(); [ "$(id -u)" = 0 ] || sudo=(sudo --preserve-env env "PATH=$PATH")

if [ ! -x "$out/opt/selkies/bin/selkies" ]; then
  eval "$(cd "$here" && mise exec rust@stable -- sh -c 'echo "rustup_home=$RUSTUP_HOME cargo_home=$CARGO_HOME"')"
  [ -n "$rustup_home" ] && [ -n "$cargo_home" ] || { echo "platform-selkies: mise's rust@stable sets no RUSTUP_HOME or CARGO_HOME" >&2; exit 1; }
  target="$cache/cargo-target-$(uname -m)"
  root="$cache/root-$key"
  ${sudo[@]+"${sudo[@]}"} rm -rf "$root" "$out"
  mkdir -p "$root" "$out" "$target"
  crane export --platform "linux/$arch" "$base" - |
    ${sudo[@]+"${sudo[@]}"} tar -xf - -C "$root"

  cat >"$cache/build-inner-$key.sh" <<INNER
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive HOME=/tmp
export SSL_CERT_FILE=/etc/ssl/certs/build-host-ca.crt
export GIT_SSL_CAINFO=\$SSL_CERT_FILE PIP_CERT=\$SSL_CERT_FILE REQUESTS_CA_BUNDLE=\$SSL_CERT_FILE CARGO_HTTP_CAINFO=\$SSL_CERT_FILE
apt-get update -q
apt-get install -qy --no-install-recommends $BUILD_PACKAGES $image_packages >/dev/null
src=/tmp/selkies-src out=/out
mkdir -p "\$src" "\$out/opt/selkies/lib" "\$out/opt/selkies/site" "\$out/opt/selkies/bin"

git -c advice.detachedHead=false clone -q --depth 1 -b $KVAZAAR_TAG https://github.com/ultravideo/kvazaar.git "\$src/kvazaar"
cmake -S "\$src/kvazaar" -B "\$src/kvazaar/build" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="\$src/prefix" -DBUILD_SHARED_LIBS=ON >/dev/null
cmake --build "\$src/kvazaar/build" -j >/dev/null
cmake --install "\$src/kvazaar/build" >/dev/null
cp -a "\$src/prefix/lib/"libkvazaar.so* "\$out/opt/selkies/lib/"

for r in pixelflux:$PIXELFLUX_REV selkies:$SELKIES_REV; do
  git init -q "\$src/\${r%%:*}"
  git -C "\$src/\${r%%:*}" fetch -q --depth 1 "https://github.com/selkies-project/\${r%%:*}.git" "\${r#*:}"
  git -C "\$src/\${r%%:*}" -c advice.detachedHead=false checkout -q FETCH_HEAD
done

"$python" -m venv "\$src/venv"
pip="\$src/venv/bin/pip"
"\$pip" install -q --upgrade pip setuptools wheel setuptools-rust
PATH="$cargo_home/bin:\$PATH" RUSTUP_HOME="$rustup_home" CARGO_HOME="$cargo_home" RUSTUP_TOOLCHAIN=stable \
  PIXELFLUX_ENABLE_GPL=0 CARGO_BUILD_JOBS="${PLATFORM_SELKIES_JOBS:-2}" CARGO_TARGET_DIR="$target" \
  PKG_CONFIG_PATH="\$src/prefix/lib/pkgconfig" LD_LIBRARY_PATH="\$src/prefix/lib" \
  "\$pip" install -q --target "\$out/opt/selkies/site" "\$src/pixelflux"
"\$pip" install -q --target "\$out/opt/selkies/site" --no-deps "\$src/selkies"
"\$src/venv/bin/python" -c 'import tomllib,sys; print("\n".join(d for d in tomllib.load(open(sys.argv[1],"rb"))["project"]["dependencies"] if not d.startswith("pixelflux")))' \
  "\$src/selkies/pyproject.toml" >"\$src/requirements.txt"
"\$pip" install -q --target "\$out/opt/selkies/site" -r "\$src/requirements.txt"
cp "\$src/selkies/LICENSE" "\$out/opt/selkies/LICENSE"

if find "\$out/opt/selkies" -name '*.so*' -exec env LD_LIBRARY_PATH="\$out/opt/selkies/lib" ldd {} \; 2>/dev/null |
  grep -E 'libx264|libx265|libav(codec|format|util)|not found'; then
  echo "platform-selkies: a library links GPL codecs, or one the image lacks" >&2
  exit 1
fi
PYTHONPATH="\$out/opt/selkies/site" LD_LIBRARY_PATH="\$out/opt/selkies/lib" "$python" -c \
  'import pixelflux, sys; e = pixelflux.SOFTWARE_ENCODERS; sys.exit(e.get("h264") != "openh264")' ||
  { echo "platform-selkies: pixelflux does not encode H.264 with OpenH264" >&2; exit 1; }
INNER

  # Everything the build reads from the host is bind-mounted at its own path,
  # so the paths above hold inside the chroot too.
  ca="${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}"
  proxy="$(env | grep -E '^(https?|no)_proxy=|^(HTTPS?|NO)_PROXY=' | tr '\n' ' ' || true)"
  ${sudo[@]+"${sudo[@]}"} env ca="$ca" proxy="$proxy" unshare --mount --propagation private sh -euc '
    r=$1 out=$2 script=$3; shift 3
    for d in "$@"; do mkdir -p "$r$d"; mount --bind "$d" "$r$d"; done
    mkdir -p "$r/out" && mount --bind "$out" "$r/out"
    # Only the device nodes a build reads, not the host'"'"'s devices or /sys.
    mount -t tmpfs -o mode=755 dev "$r/dev"
    for n in null zero random urandom; do touch "$r/dev/$n"; mount --bind "/dev/$n" "$r/dev/$n"; done
    mkdir -p "$r/dev/shm" && mount -t tmpfs shm "$r/dev/shm"
    mount -t proc proc "$r/proc"
    cp -L /etc/resolv.conf "$r/etc/resolv.conf"
    # The host trust store, which holds any proxy CA the host trusts, for git,
    # pip and cargo; apt keeps to Debian'"'"'s own. policy-rc.d keeps a package'"'"'s
    # postinst from starting its service here.
    mkdir -p "$r/etc/ssl/certs"
    cp -L "$ca" "$r/etc/ssl/certs/build-host-ca.crt"
    printf "#!/bin/sh\nexit 101\n" > "$r/usr/sbin/policy-rc.d"
    chmod 755 "$r/usr/sbin/policy-rc.d"
    chroot "$r" env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin $proxy bash < "$script"
  ' _ "$root" "$out" "$cache/build-inner-$key.sh" "$python_home" "$rustup_home" "$cargo_home" "$target" || {
    ${sudo[@]+"${sudo[@]}"} rm -rf "$root" "$out"
    exit 1
  }
  ${sudo[@]+"${sudo[@]}"} rm -rf "$root" "$cache/build-inner-$key.sh"
  [ ${#sudo[@]} -eq 0 ] || sudo chown -R "$(id -u):$(id -g)" "$out" "$target" "$cargo_home"

  cat >"$out/opt/selkies/bin/selkies" <<'WRAPPER'
#!/bin/sh
export PYTHONPATH="/opt/selkies/site${PYTHONPATH:+:$PYTHONPATH}"
export LD_LIBRARY_PATH="/opt/selkies/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec python3 -c 'import sys; from selkies.__main__ import main; sys.argv[0] = "selkies"; sys.exit(main())' "$@"
WRAPPER
  chmod +x "$out/opt/selkies/bin/selkies"
fi

mkdir -p "$dest/opt"
cp -a "$out/opt/selkies" "$dest/opt/"
