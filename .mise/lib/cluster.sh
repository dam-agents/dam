# Sourced by the cluster:* and e2e:* tasks: the one place that names the
# cluster they act on, and the install on it. It resolves two axes, once:
#
#   target  which cluster: `environment:<name>` (--environment, or the
#           CLUSTER_ENVIRONMENT variable a nested `mise run` hands down), `host`
#           (this machine, IS_SANDBOX), or `lima` (the LIMA_INSTANCE VM).
#           CLUSTER_TARGET says which.
#   install which install on it: --name, else DAM_INSTALL, else a linked
#           worktree's branch slug. A cluster that holds one install never takes
#           a name: the repo's own checkout, a sandbox host, and an Environment
#           (which holds one install by product design).
#
# The `Where and which` section of the cluster-ops skill carries the tables.
. "$(dirname "${BASH_SOURCE[0]}")/root.sh"

# A task that declares the flag in #USAGE gets it from mise. One that parses
# no arguments of its own takes it first, before what it passes on: sourced
# with no arguments, this file shifts the task's own.

# --- target ---------------------------------------------------------------
GIVEN_ENVIRONMENT=""
if [ -n "${usage_environment:-}" ]; then
  GIVEN_ENVIRONMENT="$usage_environment"
fi
case "${1:-}" in
  --environment) GIVEN_ENVIRONMENT="${2:?--environment needs a name}"; shift 2 ;;
  --environment=*) GIVEN_ENVIRONMENT="${1#--environment=}"; shift ;;
esac
if [ -n "$GIVEN_ENVIRONMENT" ]; then
  export CLUSTER_ENVIRONMENT="$GIVEN_ENVIRONMENT"
  # An e2e task given the flag marks the Environment as the lane's, and the
  # tasks it runs inherit the mark with the variable.
  [ -z "${E2E_LANE:-}" ] || export E2E_ENVIRONMENT="$GIVEN_ENVIRONMENT"
fi
unset GIVEN_ENVIRONMENT

# The e2e lane pins its own VM and the default install; an Environment outranks
# both below. A CLUSTER_ENVIRONMENT left in the shell would install the lane's
# values into a business Environment and run the suite there, so the lane goes
# into an Environment only when an e2e task was given --environment.
if [ -n "${E2E_LANE:-}" ] && [ -n "${CLUSTER_ENVIRONMENT:-}" ] && [ "${E2E_ENVIRONMENT:-}" != "$CLUSTER_ENVIRONMENT" ]; then
  echo "FATAL: the e2e lane runs in an Environment only when its task is given --environment, and CLUSTER_ENVIRONMENT=$CLUSTER_ENVIRONMENT is set. Unset it, or pass --environment $CLUSTER_ENVIRONMENT." >&2
  exit 1
fi

export LIMA_INSTANCE="${LIMA_INSTANCE:-platform-k3s}"
if [ -n "${CLUSTER_ENVIRONMENT:-}" ]; then
  export CLUSTER_TARGET=environment
elif [ -n "${IS_SANDBOX:-}" ]; then
  export CLUSTER_TARGET=host
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
else
  export CLUSTER_TARGET=lima
  export KUBECONFIG="${LIMA_HOME:-$HOME/.lima}/$LIMA_INSTANCE/copied-from-guest/kubeconfig.yaml"
fi
export CLUSTER_TARGET

# --- install --------------------------------------------------------------
# What the flags and variables said, before the target decides whether a name
# applies at all.
CLUSTER_INSTALL_GIVEN=""
CLUSTER_INSTALL_ORIGIN=""
if [ -n "${usage_name:-}" ]; then
  CLUSTER_INSTALL_GIVEN="$usage_name"
  CLUSTER_INSTALL_ORIGIN="--name"
fi
case "${1:-}" in
  --name) CLUSTER_INSTALL_GIVEN="${2:?--name needs a name}"; CLUSTER_INSTALL_ORIGIN="--name"; shift 2 ;;
  --name=*) CLUSTER_INSTALL_GIVEN="${1#--name=}"; CLUSTER_INSTALL_ORIGIN="--name"; shift ;;
esac
if [ -z "$CLUSTER_INSTALL_GIVEN" ] && [ -n "${DAM_INSTALL:-}" ]; then
  CLUSTER_INSTALL_GIVEN="$DAM_INSTALL"
  CLUSTER_INSTALL_ORIGIN="DAM_INSTALL"
fi
# `default` is how a worktree or a pinned lane says the default install by name,
# which is the empty name; the target rules below read it as `default`.

# worktree_install_name: the name a linked worktree's branch gives its install.
# One worktree holds one install, so two agents in two worktrees never land on
# one by surprise, and the repo's own checkout keeps the default install, which
# keeps main's names and port (no migration for a single-checkout developer).
# The default is the empty name, not `default`: release, namespace and URLs stay
# what they were.
cluster_worktree_install_name() {
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

case "$CLUSTER_TARGET" in
  environment)
    # An Environment is one agent's cluster and holds one install: its endpoints
    # name one address set, so a second install there would have nowhere to
    # publish. A branch slug never reaches it, and a name is refused rather than
    # dropped, since a caller that passed one meant another install.
    if [ -n "$CLUSTER_INSTALL_GIVEN" ] && [ "$CLUSTER_INSTALL_GIVEN" != default ]; then
      echo "FATAL: an Environment holds one install, so '$CLUSTER_INSTALL_GIVEN' ($CLUSTER_INSTALL_ORIGIN) does not apply: 'cluster:install -- --environment $CLUSTER_ENVIRONMENT' always installs the default install there. Drop the name." >&2
      exit 1
    fi
    CLUSTER_INSTALL=""
    CLUSTER_INSTALL_ORIGIN=""
    ;;
  host)
    # A sandbox host is this agent's own machine, and its k3s goes with it.
    if [ -n "$CLUSTER_INSTALL_GIVEN" ] && [ "$CLUSTER_INSTALL_GIVEN" != default ]; then
      echo "FATAL: a sandbox host's cluster is this agent's own and holds one install, so '$CLUSTER_INSTALL_GIVEN' ($CLUSTER_INSTALL_ORIGIN) does not apply here." >&2
      exit 1
    fi
    CLUSTER_INSTALL=""
    CLUSTER_INSTALL_ORIGIN="sandbox"
    ;;
  *)
    if [ -n "$CLUSTER_INSTALL_GIVEN" ]; then
      CLUSTER_INSTALL="$CLUSTER_INSTALL_GIVEN"
    else
      CLUSTER_INSTALL="$(cluster_worktree_install_name)"
      if [ -n "$CLUSTER_INSTALL" ]; then CLUSTER_INSTALL_ORIGIN="branch"; else CLUSTER_INSTALL_ORIGIN="repository checkout"; fi
    fi
    ;;
esac
[ "$CLUSTER_INSTALL" != default ] || CLUSTER_INSTALL=""
export CLUSTER_INSTALL CLUSTER_INSTALL_ORIGIN
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
# The entrypoint this install's Ingress attaches to in the cluster's one Traefik
# config. Every install serves the same host names (`localhost`,
# `keycloak.localhost`, …) on a port of its own, so the entrypoint is what tells
# them apart; the default install keeps the name it had before there were several.
export CLUSTER_ENTRYPOINT="platform${CLUSTER_INSTALL:+-$CLUSTER_INSTALL}"
# A named install's port comes from this range, which one Lima port-forward rule
# carries from the VM to this host's loopback (`etc/lima/k3s.yaml`).
export CLUSTER_PORT_MIN=4400 CLUSTER_PORT_MAX=4499

# cluster_install_port: the port this install's entrypoint listens on, read from
# the cluster's Traefik config — the only record of it, and the reason two
# worktrees never take one port. Empty when the install is not there.
cluster_install_port() {
  kubectl -n kube-system get helmchartconfig traefik -o jsonpath='{.spec.valuesContent}' 2>/dev/null |
    ENTRY="$CLUSTER_ENTRYPOINT" yq -r '.ports[env(ENTRY)].exposedPort // ""' 2>/dev/null
}

# install_url: where this install answers from this host. Empty when it is not
# installed, and empty is a success: the caller prints nothing for it.
install_url() {
  local p
  p="$(cluster_install_port)" || return 0
  [ -n "$p" ] || return 0
  printf 'http://localhost:%s' "$p"
}

# traefik_entrypoint_port [fixed-port] [insecure]: adds this install's entrypoint
# to the cluster's one Traefik chart config and prints the port it took. The
# config is shared, so the write is a compare-and-swap on the object's
# resourceVersion: two installs starting at once take two ports, and neither
# drops the other's entrypoint. A fixed port is the default install's (and an
# Environment's); a named install takes the first port of the range no entrypoint
# names yet, and keeps it on the next run.
# yq reads the entrypoint name and port from ENTRY/PORT: mikefarah's yq has no
# --arg.
traefik_entrypoint_port() {
  local fixed="${1:-}" insecure="${2:-}" values json port used p i
  for i in $(seq 1 20); do
    json="$(kubectl -n kube-system get helmchartconfig traefik -o json 2>/dev/null)" || json=""
    values=""
    [ -z "$json" ] || values="$(printf '%s' "$json" | jq -r '.spec.valuesContent // ""')"
    port="$(printf '%s' "$values" | ENTRY="$CLUSTER_ENTRYPOINT" yq -r '.ports[env(ENTRY)].exposedPort // ""' 2>/dev/null)"
    if [ -n "$port" ]; then
      # This install's already. A fixed port that agrees with the record needs no
      # write; one that differs is the caller moving the install (a changed
      # `port` value, an Environment's backchannel port) and wins, below.
      if [ -z "$fixed" ] || [ "$fixed" = "$port" ]; then printf '%s' "$port"; return 0; fi
    fi
    if [ -n "$fixed" ]; then
      port="$fixed"
    elif [ -z "$port" ]; then
      used="$(printf '%s' "$values" | yq -r '[.ports[]?.exposedPort] | join(" ")' 2>/dev/null)"
      for p in $(seq "$CLUSTER_PORT_MIN" "$CLUSTER_PORT_MAX"); do
        case " $used " in *" $p "*) continue ;; esac
        port="$p"; break
      done
      [ -n "$port" ] || {
        echo "FATAL: every port of $CLUSTER_PORT_MIN-$CLUSTER_PORT_MAX is taken by another install; remove one with 'mise run cluster:uninstall -- --name <name>'" >&2
        return 1
      }
    fi
    values="$(printf '%s' "$values" | ENTRY="$CLUSTER_ENTRYPOINT" PORT="$port" yq -r '
      .ports = ((.ports // {}) | .[env(ENTRY)] = {
        "port": (env(PORT) | tonumber),
        "expose": {"default": true},
        "exposedPort": (env(PORT) | tonumber),
        "protocol": "TCP"
      })')" || return 1
    if [ "$insecure" = insecure ]; then
      values="$(printf '%s' "$values" | ENTRY="$CLUSTER_ENTRYPOINT" yq -r '.ports[env(ENTRY)].forwardedHeaders = {"insecure": true}')" || return 1
    fi
    if [ -z "$json" ]; then
      kubectl apply -f - >/dev/null <<YAML || continue
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |
$(printf '%s' "$values" | sed 's/^/    /')
YAML
      printf '%s' "$port"; return 0
    fi
    if printf '%s' "$json" | jq --arg v "$values" '.spec.valuesContent = $v' | kubectl replace -f - >/dev/null 2>&1; then
      printf '%s' "$port"; return 0
    fi
  done
  echo "FATAL: could not reserve a Traefik entrypoint for install '$CLUSTER_INSTALL' (the cluster's Traefik config kept changing)" >&2
  return 1
}

# traefik_entrypoint_drop: takes this install's entrypoint out of the cluster's
# Traefik config, so its port is free for the next install.
traefik_entrypoint_drop() {
  local json values i
  for i in $(seq 1 20); do
    json="$(kubectl -n kube-system get helmchartconfig traefik -o json 2>/dev/null)" || return 0
    values="$(printf '%s' "$json" | jq -r '.spec.valuesContent // ""' |
      ENTRY="$CLUSTER_ENTRYPOINT" yq -r 'del(.ports[env(ENTRY)])' 2>/dev/null)" || return 0
    printf '%s' "$json" | jq --arg v "$values" '.spec.valuesContent = $v' | kubectl replace -f - >/dev/null 2>&1 && return 0
  done
  echo "WARN: could not drop install $CLUSTER_INSTALL's Traefik entrypoint; its port stays reserved" >&2
  return 0
}

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

# The port the e2e lane answers on from this agent: the test cluster's, which
# e2e:install sets. An Environment takes one of its own (env_e2e_port), so a
# local lane and several Environments run side by side on one agent.
E2E_PORT=6555

# e2e_endpoint: where the e2e lane answers from this agent, as E2E_PORT,
# E2E_BASE_URL and E2E_KEYCLOAK_URL; the kubeconfig the suite acts on the
# cluster with, as E2E_KUBECONFIG; and the port of the suite's Keycloak login
# lock, as E2E_LOGIN_LOCK_PORT, one per lane, since each lane has a Keycloak
# of its own. In an Environment that is its backchannel and its API,
# forwarded to this agent by env_e2e_forward: a task that calls this closes
# the forward with env_e2e_forward_close on its way out.
e2e_endpoint() {
  E2E_KUBECONFIG="$KUBECONFIG"
  E2E_LOGIN_LOCK_PORT=47319
  if [ "$CLUSTER_TARGET" = environment ]; then
    E2E_PORT="$(env_e2e_port)" || return 1
    env_e2e_forward "$E2E_PORT" || return 1
    E2E_KUBECONFIG="$ENV_E2E_KUBECONFIG"
    E2E_LOGIN_LOCK_PORT=$((47320 + E2E_PORT - E2E_ENV_PORT_MIN))
  fi
  E2E_BASE_URL="http://localhost:$E2E_PORT"
  E2E_KEYCLOAK_URL="http://keycloak.localhost:$E2E_PORT"
}
env_e2e_forward_close() { :; }

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

# cluster_announce: the resolution as one line — which cluster, which install,
# and where each came from — so a task never acts on a cluster the caller did not
# mean without saying so. On stderr: cluster:kubeconfig, cluster:kubectl and
# cluster:installs feed scripts, and their stdout stays what it was.
cluster_announce() {
  local where install addr
  case "$CLUSTER_TARGET" in
    environment) where="environment $CLUSTER_ENVIRONMENT" ;;
    host) where=host ;;
    *) where="lima $LIMA_INSTANCE" ;;
  esac
  install="${CLUSTER_INSTALL:-default}"
  [ -z "$CLUSTER_INSTALL_ORIGIN" ] || install="$install ($CLUSTER_INSTALL_ORIGIN)"
  # An Environment's public address comes from its endpoints, which only the
  # install reads; it prints them. Everywhere else the port is in the cluster's
  # Traefik config, and empty until the install exists.
  addr=""
  [ "$CLUSTER_TARGET" = environment ] || addr="$(install_url 2>/dev/null)"
  printf '→ %s · install %s%s\n' "$where" "$install" "${addr:+ · $addr}" >&2
}

# cluster_require_install: refuses unless this install's release exists on the
# cluster. cluster:build and cluster:helm act on an install and create none, so
# a name that nothing installed would otherwise fail deep in kubectl.
cluster_require_install() {
  helm status "$CLUSTER_RELEASE" -n "$CLUSTER_NAMESPACE" >/dev/null 2>&1 && return 0
  echo "FATAL: no install '$CLUSTER_RELEASE' in namespace '$CLUSTER_NAMESPACE' on this $CLUSTER_TARGET cluster. Run 'mise run cluster:install' first; 'mise run cluster:installs -- --all' lists what is there." >&2
  return 1
}

# Once per process tree: a task that hands on to another cluster task (helm,
# e2e:install, build and its import) says the resolution once, not once a step.
if [ -z "${CLUSTER_ANNOUNCED:-}" ] && [ -z "${CLUSTER_RESOLVE_ONLY:-}" ]; then
  cluster_announce
  export CLUSTER_ANNOUNCED=1
fi

# The link and its tunnel last, so a task's first output is the resolution
# above: opening the link takes seconds, and says so when the Environment is
# not there. check:cluster-resolve reads this file for the target and the name
# alone — the link is not its business, and its sandbox writes nothing outside
# the checkout.
if [ "$CLUSTER_TARGET" = environment ] && [ -z "${CLUSTER_RESOLVE_ONLY:-}" ]; then
  . "$(dirname "${BASH_SOURCE[0]}")/cluster-environment.sh"
  # Every task but the install, which starts k3s first, finds the API here.
  env_tunnel || true
fi
