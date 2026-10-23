# Sourced by the cluster:* and e2e:* tasks: the one place that names the
# cluster they act on. CLUSTER_ENVIRONMENT picks one of this agent's
# Environments, whose k3s is reached over the Environment Link
# (cluster-environment.sh); a task takes it as a leading
# `--environment <name>` too. Otherwise LIMA_INSTANCE picks the lima VM (the
# e2e tasks pin platform-k3s-test), and IS_SANDBOX means k3s runs on this host.
# CLUSTER_TARGET says which of the three it is: environment, host or lima.
. "$(dirname "${BASH_SOURCE[0]}")/root.sh"

# A task that declares the flag in #USAGE gets it from mise. One that parses
# no arguments of its own takes it first, before what it passes on: sourced
# with no arguments, this file shifts the task's own.
if [ -n "${usage_environment:-}" ]; then
  export CLUSTER_ENVIRONMENT="$usage_environment"
fi
case "${1:-}" in
  --environment) export CLUSTER_ENVIRONMENT="${2:?--environment needs a name}"; shift 2 ;;
  --environment=*) export CLUSTER_ENVIRONMENT="${1#--environment=}"; shift ;;
esac

export LIMA_INSTANCE="${LIMA_INSTANCE:-platform-k3s}"
if [ -n "${CLUSTER_ENVIRONMENT:-}" ]; then
  export CLUSTER_TARGET=environment
  . "$(dirname "${BASH_SOURCE[0]}")/cluster-environment.sh"
  # Every task but the install, which starts k3s first, finds the API here.
  env_tunnel || true
elif [ -n "${IS_SANDBOX:-}" ]; then
  export CLUSTER_TARGET=host
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
else
  export CLUSTER_TARGET=lima
  export KUBECONFIG="${LIMA_HOME:-$HOME/.lima}/$LIMA_INSTANCE/copied-from-guest/kubeconfig.yaml"
fi

# node_sh <command>...: runs one command as root on the k3s node, with this
# shell's stdin: on this host, in the lima VM, or on the Environment.
node_sh() {
  case "$CLUSTER_TARGET" in
    environment) node_env_sh "$@" ;;
    host) as_root "$@" ;;
    lima) limactl shell "$LIMA_INSTANCE" sudo "$@" ;;
  esac
}
export -f node_sh as_root

# The supervisor k3s runs under: OpenRC where the host installed its service
# (k3s's own installer prefers it when openrc-run exists), systemd where it is
# running, and neither in a sandbox that has no init system — cluster:install
# starts k3s as a plain process there. Ask k3s_has_service first: a return code
# cannot tell that case apart from a supervisor that failed, since a missing
# rc-service exits 127 too.
k3s_has_service() { [ -x /etc/init.d/k3s ] || [ -d /run/systemd/system ]; }
k3s_service() { # start|stop|restart
  if [ -x /etc/init.d/k3s ]; then
    as_root rc-service k3s "$1"
  elif [ -d /run/systemd/system ]; then
    as_root systemctl "$1" k3s
  else
    echo "FATAL: no init system owns k3s here; test k3s_has_service first." >&2
    return 1
  fi
}

# Whether k3s is up, as its supervisor reports it. `pgrep -x k3s-server` is not
# that question: a container on the same host runs its own k3s under the same
# process name, so a host k3s that is stopped would read as up.
k3s_running() {
  if [ -x /etc/init.d/k3s ]; then
    as_root rc-service k3s status >/dev/null 2>&1
  elif [ -d /run/systemd/system ]; then
    as_root systemctl is-active --quiet k3s
  else
    pgrep -x k3s-server >/dev/null
  fi
}

# e2e_mark <phase>: appends "<epoch seconds>\t<phase>" to the file E2E_TIMINGS
# names, and does nothing without it. CI's two lanes set it, and e2e:timings
# turns the marks into the job's per-phase timing summary.
e2e_mark() {
  [ -z "${E2E_TIMINGS:-}" ] || printf '%s\t%s\n' "$(date +%s)" "$1" >> "$E2E_TIMINGS"
}

# What ztunnel logs for an expired mesh cert: its own SVID's, or a waypoint's
# (it logs the failed HBONE handshake). The ztunnel-cert-watchdog CronJob in
# cluster:install runs in the cluster and has its own copy; keep the two in sync.
MESH_CERT_EXPIRED='certificate expired|AlertReceived\(CertificateExpired\)'

# prune_dangling_images: drops the node's `<none>:<none>` images, the old
# `:latest` SHAs that lost their tag to a freshly imported one (issue #244).
# Not `crictl rmi --prune`: with no instance pods running, the agent images
# just loaded are unpinned, and it would wipe them too.
prune_dangling_images() {
  local prune='k3s crictl images 2>/dev/null | sed -nE "s/^<none>[[:space:]]+<none>[[:space:]]+([^[:space:]]+).*/\\1/p" | xargs -r k3s crictl rmi >/dev/null 2>&1 || true'
  node_sh bash -c "$prune"
}
