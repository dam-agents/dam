#!/bin/sh
set -eu

mkdir -p /opt/shims/high /opt/shims/low /var/log/dam-vm/install

# ── helpers ────────────────────────────────────────────────────────────────

# auto-install <name> <cmd...>: run an install command, logging it, with a
# friendly line. A lock serializes concurrent installs; a re-entrant call (an
# install that triggers another shim) skips re-locking so it can't deadlock.
cat > /opt/shims/high/auto-install << 'EOF'
#!/bin/sh
name=$1; shift
log="/var/log/dam-vm/install/$name.log"
printf '\033[1;35m•\033[0m installing %s…\n' "$name" >&2
if [ -z "${DAM_INSTALLING:-}" ]; then
  set -- flock /var/lock/dam-install.lock env DAM_INSTALLING=1 "$@"
fi
if "$@" > "$log" 2>&1; then
  printf '\033[1;32m•\033[0m installed %s\n' "$name" >&2
else
  printf '\033[1;31m•\033[0m failed to install %s (see %s)\n' "$name" "$log" >&2
  tail -n 30 "$log" >&2
  exit 1
fi
EOF

# command-real <bin>: resolve the real binary, ignoring shim dirs and mise
# shims; fall back to the mise-managed copy. No recursion into the mise shim.
cat > /opt/shims/high/command-real << 'EOF'
#!/bin/sh
_mise=/usr/local/bin/mise
PATH=$(printf %s "$PATH" | tr : '\n' | grep -v -e '^/opt/shims/' -e '/mise/shims' | paste -sd:) \
  command -v "$1" 2>/dev/null || { [ -x "$_mise" ] && "$_mise" which "$1" 2>/dev/null; } || exit 1
EOF

# command-real-or-autoinstalled <bin>: like command-real but keeps low/ shims
# reachable, so a tool that was just installed resolves on this call.
cat > /opt/shims/high/command-real-or-autoinstalled << 'EOF'
#!/bin/sh
_mise=/usr/local/bin/mise
{ [ -x "$_mise" ] && "$_mise" which "$1" 2>/dev/null; } \
  || PATH=$(printf %s "${PATH#*/opt/shims/high:}" | tr : '\n' | grep -v '/mise/shims' | paste -sd:) command -v "$1" 2>/dev/null \
  || exit 1
EOF

# ensure-node: install Node via mise if absent (many shims need it).
cat > /opt/shims/high/ensure-node << 'EOF'
#!/bin/sh
command-real node >/dev/null 2>&1 && exit 0
auto-install nodejs sh -c 'MISE_AUTO_INSTALL=false MISE_NO_HOOKS=true mise use -g node && mise install node' >/dev/null 2>&1
EOF

# ── high shims (shadow real binaries) ────────────────────────────────────────

# docker: install the engine + build tooling from Fedora repos, run the daemon.
cat > /opt/shims/high/docker << 'EOF'
#!/bin/sh
if ! command-real docker >/dev/null 2>&1; then
  auto-install docker sh -c '
    dnf install -yq moby-engine docker-compose docker-buildx &&
    systemctl enable --now containerd docker'
fi
_real=$(command-real docker)
timeout 60 sh -c 'until "$0" info >/dev/null 2>&1; do sleep 0.5; done' "$_real" || true
exec "$_real" "$@"
EOF

# git: install from Fedora repos if missing.
cat > /opt/shims/high/git << 'EOF'
#!/bin/sh
command-real git >/dev/null 2>&1 || auto-install git dnf install -yq git
exec "$(command-real-or-autoinstalled git)" "$@"
EOF

# node / npx / npm: ensure Node (via mise) then run the real tool.
for bin in node npx npm; do
  cat > "/opt/shims/high/$bin" << EOF
#!/bin/sh
ensure-node
exec "\$(command-real-or-autoinstalled $bin)" "\$@"
EOF
done

chmod +x /opt/shims/high/*

# ── low shims (fill in tools that aren't installed) ──────────────────────────

# mise itself: download the pinned release, checksum it, install to /opt/mise.
cat > /opt/shims/low/mise << 'EOF'
#!/bin/sh
if ! command-real mise >/dev/null 2>&1; then
  auto-install mise sh -c '
    set -eu
    ver=2026.4.10
    case "$(uname -m)" in
      x86_64)        arch=x64;   sum=78e91794c9139ab787c9a4de5e9e63a56d65b16bce60912884cb09f7114f7275 ;;
      aarch64|arm64) arch=arm64; sum=03ebfb523239e4f202b19983d0a435e06edae7217694d61b08580ad6afa7a6b4 ;;
      *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
    esac
    file=mise-v$ver-linux-$arch.tar.gz
    tmp=$(mktemp -d); trap "rm -rf \"$tmp\"" EXIT
    curl -fsSL -o "$tmp/$file" "https://mise.jdx.dev/v$ver/$file"
    [ "$(sha256sum "$tmp/$file" | cut -d" " -f1)" = "$sum" ] || { echo "checksum mismatch" >&2; exit 1; }
    rm -rf /opt/mise; mkdir -p /opt/mise
    tar -xf "$tmp/$file" -C /opt/mise --strip-components=1
    ln -sf /opt/mise/bin/mise /usr/local/bin/mise'
fi
exec "$(command-real mise)" "$@"
EOF

# Tools installed on first use via mise. `pkg=bin` — one shim per bin.
for pair in \
  jq=jq yq=yq rg=rg fd=fd \
  kubectl=kubectl k9s=k9s \
  uv=uv uv=uvx poetry=poetry bun=bun \
  python=python python=python3 python=pip python=pip3 \
; do
  pkg=${pair%%=*}; bin=${pair#*=}
  cat > "/opt/shims/low/$bin" << EOF
#!/bin/sh
if ! command-real $bin >/dev/null 2>&1; then
  auto-install $pkg sh -c 'MISE_AUTO_INSTALL=false MISE_NO_HOOKS=true mise use -g $pkg && mise install $pkg'
fi
exec "\$(command-real-or-autoinstalled $bin)" "\$@"
EOF
done

chmod +x /opt/shims/low/*

# Login shells get the shim PATH too (dam-vm-server sets it for `incus exec`).
echo 'export PATH=/opt/shims/high:/opt/shims/low:$PATH' > /etc/profile.d/00-dam-shims.sh
