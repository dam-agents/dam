# Sourced by cluster:install, cluster:host-runner, cluster:stop, cluster:delete
# and image:stage-vm: where the macOS host VM runner lives.
# One Mac runs one host runner per Platform install, so everything a runner keeps
# of its own — its token, certificate, pid, log and port — is under the
# install's directory; the image volume is shared, because a staged tree is
# named after the image reference and the install's tag.
export HOST_RUNNER_BASE="${PLATFORM_VM_RUNNER_HOME:-$HOME/.local/state/platform-vm-runner}"
export HOST_RUNNER_DIR="$HOST_RUNNER_BASE${CLUSTER_INSTALL:+/$CLUSTER_INSTALL}"
# The HOME the runner runs under, where smolvm keeps every machine: its disks,
# its record and its sockets, at Library/Caches/smolvm/vms/<16 hex>/<name>.
# macOS holds a unix socket path to 103 bytes and the longest socket name is
# 12 (control.sock), so this directory may take at most 47: HOST_RUNNER_BASE is
# 48 for a 9-letter user name, which is why the machines do not live under it.
# The default fits a user name of up to 27 letters; the runner refuses to start
# under a HOME that does not fit, naming the path and the limit. A named
# install's own home is short and hashed instead of readable, for the same
# limit: it carries up to 20 more characters.
# host_runner_vm_home <install-name>: the HOME that install's runner runs under.
# Empty is the default install, whose home is readable; a named one is hashed.
host_runner_vm_home() {
  if [ -n "${PLATFORM_VM_RUNNER_VM_HOME:-}" ]; then printf '%s' "$PLATFORM_VM_RUNNER_VM_HOME"; return 0; fi
  if [ -n "${1:-}" ]; then printf '%s' "$HOME/.pm-$(printf '%s' "$1" | shasum -a 256 | cut -c1-8)"; return 0; fi
  printf '%s' "$HOME/.platform-vm"
}
HOST_RUNNER_VM_HOME="$(host_runner_vm_home "${CLUSTER_INSTALL:-}")"
export HOST_RUNNER_VM_HOME
# The address pods reach this host at: lima's user-mode network relays it to
# the host's loopback, which is all the runner listens on.
export HOST_RUNNER_ADDRESS=192.168.5.2
# The default install's runner answers on the port it always did, and publishes
# machines on the range that stays clear of the NodePort range lima forwards
# onto the same loopback. A named install takes the first free port of its own
# and publishes on the 100 ports that follow its position in the range.
export HOST_RUNNER_PORT=4600
export HOST_RUNNER_PORT_MIN=33000 HOST_RUNNER_PORT_MAX=33099

# host_runner_port: the port this install's runner answers on. A named install
# records the one it took beside its token, so the chart it was installed with
# and the process started later agree; the first free one is picked only where
# that record is missing.
host_runner_port() {
  local p
  p="$(cat "$HOST_RUNNER_DIR/port" 2>/dev/null)"
  if [ -n "$p" ]; then printf '%s' "$p"; return 0; fi
  [ -n "$CLUSTER_INSTALL" ] || { printf '%s' "$HOST_RUNNER_PORT"; return 0; }
  # 4600 is the default install's, whether or not its runner runs right now. So
  # is a port another install recorded but has not started on yet: the record is
  # written at install time, the runner starts at its end, and two installs that
  # overlapped would otherwise bind one port.
  used=" 4600 "
  for f in "$HOST_RUNNER_BASE"/*/port; do
    [ -f "$f" ] || continue
    [ "$f" = "$HOST_RUNNER_DIR/port" ] && continue
    used="$used$(cat "$f") "
  done
  for p in $(seq 4601 4699); do
    case "$used" in *" $p "*) continue ;; esac
    python3 -c 'import socket, sys; s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", int(sys.argv[1]))); s.close()' "$p" 2>/dev/null || continue
    printf '%s' "$p"; return 0
  done
  echo "FATAL: no free port in 4601-4699 for install '$CLUSTER_INSTALL''s host runner" >&2
  return 1
}

# host_runner_machine_ports <port>: the 100 ports this install's machines are
# published on, derived from its runner port so no record is needed.
host_runner_machine_ports() {
  local first=$((33000 + 100 * (${1:?} - 4600)))
  printf '%s %s' "$first" "$((first + 99))"
}

# host_runner_volume <name>: attaches, creating it the first time, a
# case-sensitive volume of the runner's, and prints its mount point. An image
# tree holds names that differ only in case (xtables' libxt_DSCP.so and
# libxt_dscp.so), which the Mac's default filesystem folds into one file.
host_runner_volume() {
  local img="$HOST_RUNNER_BASE/$1.sparsebundle" mnt="$HOST_RUNNER_BASE/$1"
  mkdir -p "$HOST_RUNNER_BASE"
  [ -d "$img" ] || hdiutil create -quiet -size 200g -type SPARSEBUNDLE -fs "Case-sensitive APFS" -volname "platform-vm-$1" "$img"
  mount | grep -q " on $mnt (" || { mkdir -p "$mnt" && hdiutil attach -quiet -nobrowse -owners on -mountpoint "$mnt" "$img"; }
  echo "$mnt"
}

# host_runner_images: the volume the runner's images live on. Shared by every
# install on this Mac: a staged tree is named after the image reference, which
# carries the install's tag.
host_runner_images() { host_runner_volume images; }

# host_runner_stop: stops the runner, which stops its machines as a runner pod
# does on termination; they start again once it is back. <dir> is this install's
# unless another is given.
host_runner_stop() {
  local dir="${1:-$HOST_RUNNER_DIR}" pid
  pid="$(cat "$dir/runner.pid" 2>/dev/null)" || return 0
  # A pid file that outlived a reboot may name someone else's process.
  if ps -p "$pid" -o command= 2>/dev/null | grep -q "^$HOST_RUNNER_BASE/vm-runner " && kill "$pid" 2>/dev/null; then
    for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$dir/runner.pid"
}

# host_runner_stop_vm: stops every runner that serves this Lima VM, which is
# what deleting the VM needs; cluster:stop stops this install's alone.
host_runner_stop_vm() {
  local d name
  for d in "$HOST_RUNNER_BASE" "$HOST_RUNNER_BASE"/*/; do
    d="${d%/}"
    [ -f "$d/instance" ] || continue
    [ "$(cat "$d/instance")" = "$LIMA_INSTANCE" ] || continue
    name="$(basename "$d")"
    [ "$d" != "$HOST_RUNNER_BASE" ] || name=""
    host_runner_stop "$d"
    # The machines' disks are this runner's (its own home), and nothing else's
    # install on the Mac touches them.
    rm -rf "$d/machines" "$d/Library" "$(host_runner_vm_home "$name")/Library" "$d/instance"
  done
}
