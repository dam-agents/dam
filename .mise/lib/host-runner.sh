# Sourced by cluster:install, cluster:host-runner, cluster:stop, cluster:delete
# and image:stage-vm: where the macOS host VM runner lives. smolvm keeps each
# VMM's control socket under HOME, and a unix socket path is capped at 104
# bytes, so the directory must stay short.
export HOST_RUNNER_DIR="${PLATFORM_VM_RUNNER_HOME:-$HOME/.local/state/platform-vm-runner}"
# The address pods reach this host at: lima's user-mode network relays it to
# the host's loopback, which is all the runner listens on.
export HOST_RUNNER_ADDRESS=192.168.5.2
# The ports machines are published on. They stay clear of the NodePort range,
# which lima forwards onto the same loopback for the guests' gateways.
export HOST_RUNNER_PORT_MIN=33000 HOST_RUNNER_PORT_MAX=33099

# host_runner_images: attaches, creating it the first time, the case-sensitive
# volume the runner's images live on, and prints its mount point. An image tree
# holds names that differ only in case (xtables' libxt_DSCP.so and
# libxt_dscp.so), which the Mac's default filesystem folds into one file.
host_runner_images() {
  local img="$HOST_RUNNER_DIR/images.sparsebundle" mnt="$HOST_RUNNER_DIR/images"
  mkdir -p "$HOST_RUNNER_DIR"
  [ -d "$img" ] || hdiutil create -quiet -size 200g -type SPARSEBUNDLE -fs "Case-sensitive APFS" -volname platform-vm-images "$img"
  mount | grep -q " on $mnt (" || { mkdir -p "$mnt" && hdiutil attach -quiet -nobrowse -owners on -mountpoint "$mnt" "$img"; }
  echo "$mnt"
}

# host_runner_stop: stops the runner, which stops its machines as a runner pod
# does on termination; they start again once it is back.
host_runner_stop() {
  local pid
  pid="$(cat "$HOST_RUNNER_DIR/runner.pid" 2>/dev/null)" || return 0
  # A pid file that outlived a reboot may name someone else's process.
  if ps -p "$pid" -o command= 2>/dev/null | grep -q "^$HOST_RUNNER_DIR/vm-runner " && kill "$pid" 2>/dev/null; then
    for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$HOST_RUNNER_DIR/runner.pid"
}
