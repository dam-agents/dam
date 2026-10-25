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

# The install's name: several installs of the chart can live on one cluster, one
# per worktree, and every cluster:* task acts on this worktree's. --name/DAM_INSTALL
# names it; otherwise a linked worktree derives it from its branch, and the
# repo's own checkout is the default install, which keeps main's names and port
# (no per-worktree migration for a single-checkout developer). The default is
# the empty name, not `default`: release, namespace and URLs stay what they were.
cluster_install_name() {
  if [ -n "${DAM_INSTALL:-}" ]; then printf '%s' "$DAM_INSTALL"; return 0; fi
  local dir common branch
  dir="$(git -C "$MISE_CONFIG_ROOT" rev-parse --path-format=absolute --git-dir 2>/dev/null)" || return 0
  common="$(git -C "$MISE_CONFIG_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  # The repo's own checkout owns `default`; a linked worktree never does, so two
  # agents in two worktrees never land on one install by surprise.
  [ "$dir" != "$common" ] || return 0
  branch="$(git -C "$MISE_CONFIG_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ "$branch" != HEAD ] || branch="$(basename "$MISE_CONFIG_ROOT")"
  # A DNS label, short enough for every name the chart and the controller build
  # from the release: `<release>-extauthz-agent-<16 hex>` is the longest, and
  # Kubernetes caps a name at 63, so the release (9 + name) may take 32.
  # `default` here is the reserved name of the shared install, never a worktree's;
  # a branch named `…-agents` is refused by the checks below, not mapped.
  local slug
  slug="$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//' | cut -c1-20 | sed 's/-$//')"
  case "$slug" in
    ''|default) slug="wt-$(basename "$MISE_CONFIG_ROOT" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//' | cut -c1-16 | sed 's/-$//')" ;;
  esac
  printf '%s' "$slug"
}

if [ -n "${usage_name:-}" ]; then
  export CLUSTER_INSTALL="$usage_name"
fi
case "${1:-}" in
  --name) export CLUSTER_INSTALL="${2:?--name needs a name}"; shift 2 ;;
  --name=*) export CLUSTER_INSTALL="${1#--name=}"; shift ;;
esac
export CLUSTER_INSTALL="${CLUSTER_INSTALL:-$(cluster_install_name)}"
[ "$CLUSTER_INSTALL" != default ] || CLUSTER_INSTALL=""
if [ -n "$CLUSTER_INSTALL" ]; then
  case "$CLUSTER_INSTALL" in
    [a-z0-9]*) ;;
    *) echo "FATAL: install name '$CLUSTER_INSTALL' must start with a lowercase letter or digit" >&2; exit 1 ;;
  esac
  case "$CLUSTER_INSTALL" in
    *[!a-z0-9-]*) echo "FATAL: install name '$CLUSTER_INSTALL' may hold only lowercase letters, digits and dashes" >&2; exit 1 ;;
  esac
  # 20, so every name the chart and the controller build from the release stays
  # under Kubernetes' 63: `<release>-extauthz-agent-<16 hex>` is the longest.
  if [ ${#CLUSTER_INSTALL} -gt 20 ]; then
    echo "FATAL: install name '$CLUSTER_INSTALL' is ${#CLUSTER_INSTALL} characters; at most 20, or the per-agent names the controller builds from the release outgrow Kubernetes' 63" >&2
    exit 1
  fi
  # An install's namespace `platform-<name>` must not be another install's agent
  # namespace `platform-<name>-agents`, or a later uninstall takes that one with
  # it: `agents` claims the default install's, `foo-agents` claims install foo's.
  case "$CLUSTER_INSTALL" in
    agents|*-agents)
      echo "FATAL: install name '$CLUSTER_INSTALL' would claim a namespace another install's agents live in (platform-<name>-agents); pass --name with another name." >&2
      exit 1
      ;;
  esac
fi
# Everything the install's objects are named after. The chart's own values page
# repeats this for a production install; a local one gets it from these.
export CLUSTER_RELEASE="platform${CLUSTER_INSTALL:+-$CLUSTER_INSTALL}"
export CLUSTER_NAMESPACE="${CLUSTER_INSTALL:+platform-}${CLUSTER_INSTALL:-default}"
export CLUSTER_AGENT_NAMESPACE="platform${CLUSTER_INSTALL:+-$CLUSTER_INSTALL}-agents"
export CLUSTER_DOMAIN="${CLUSTER_INSTALL:+$CLUSTER_INSTALL.}localhost"
export CLUSTER_APP_PORT=4444
# Every install routes on the one Traefik entrypoint the VM forwards; the host
# name is what keeps them apart (docs/design in the PR).
export CLUSTER_URL="http://$CLUSTER_DOMAIN:$CLUSTER_APP_PORT"

# install_image_tags <component>...: aliases each freshly imported local image as
# this install's own tag. A tag is node-wide state, so two installs on one node
# sharing `:latest` would run each other's builds; `cluster:import` leaves the
# tar's own `:latest` in place for the default install and the e2e lane.
install_image_tags() {
  [ -n "$CLUSTER_INSTALL" ] || return 0
  local c rc=0
  for c in "$@"; do
    node_sh k3s ctr -n k8s.io images tag --force "docker.io/library/platform-$c:latest" \
      "docker.io/library/platform-$c:$CLUSTER_INSTALL" >/dev/null || {
      echo "FATAL: could not tag platform-$c:$CLUSTER_INSTALL on the node; the install would run the shared :latest instead" >&2; rc=1
    }
  done
  return $rc
}
export -f install_image_tags

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
