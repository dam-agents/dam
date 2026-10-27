# Sourced by cluster.sh when the cluster is an Environment's k3s
# (CLUSTER_ENVIRONMENT names it, from a task's --environment): the node is
# reached over the Environment Link, `ssh env-<name>`, and the API through a
# tunnel on a free local port. One SSH control master carries both, so a
# command after the first skips the link's set-up. It closes after ten idle
# minutes, since an open link keeps the Environment and this agent awake; the
# next task opens it again, on the same local port when that is still free.

ENV_HOST="env-$CLUSTER_ENVIRONMENT"
ENV_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/platform-cluster/$ENV_HOST"
ENV_SOCK="$ENV_DIR/ssh.sock"
export KUBECONFIG="$ENV_DIR/kubeconfig.yaml"
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

# An SSH shell into an Environment whose image predates the link passing on
# the tools' PATH finds no k3s, and openrc then starts a k3s service that runs
# nothing: the image's mise names the tools.
ENV_PRELUDE='command -v k3s >/dev/null 2>&1 || eval "$(MISE_SYSTEM_DATA_DIR=/usr/share/mise /usr/local/bin/mise env -s bash 2>/dev/null)"'

# The endpoints an install needs, all on one port, where the host-name bridge
# listens.
ENV_ENDPOINTS="app keycloak share content"

env_ssh() {
  ssh -o ControlMaster=auto -o ControlPath="$ENV_SOCK" -o ControlPersist=10m "$ENV_HOST" "$@"
}

# node_env_sh <command>...: runs one command as root on the Environment, with
# this shell's stdin; the words are quoted for the remote shell.
node_env_sh() {
  env_ssh "$ENV_PRELUDE; $(printf '%q ' "$@")"
}

export ENV_HOST ENV_DIR ENV_SOCK ENV_PRELUDE
export -f env_ssh node_env_sh

# env_master: opens the control master unless one runs. platform-env wakes a
# sleeping Environment on the way.
env_master() {
  ssh -o ControlPath="$ENV_SOCK" -O check "$ENV_HOST" >/dev/null 2>&1 && return 0
  ssh -f -N -o ControlMaster=yes -o ControlPath="$ENV_SOCK" -o ControlPersist=10m "$ENV_HOST"
}

# env_tunnel: forwards a local port to the Environment's k3s API and writes
# the kubeconfig for it. Returns 1, saying nothing, while k3s has written no
# kubeconfig yet. The API's port is the one that kubeconfig names: 16443, or
# 6443 on an Environment whose cluster was made before the image's k3s moved.
env_tunnel() {
  local config port
  env_master || return 1
  config="$(env_ssh 'cat /etc/rancher/k3s/k3s.yaml 2>/dev/null')" || return 1
  [ -n "$config" ] || return 1
  ENV_API_PORT="$(printf '%s\n' "$config" | sed -n 's#^ *server: https://127.0.0.1:\([0-9]*\)$#\1#p' | head -n 1)"
  [ -n "$ENV_API_PORT" ] || return 1
  port="$(cat "$ENV_DIR/port" 2>/dev/null || true)"
  # A forward the master already holds is accepted again, so the port and the
  # kubeconfig stay the ones an earlier task wrote.
  if [ -z "$port" ] || ! ssh -o ControlPath="$ENV_SOCK" -O forward -L "127.0.0.1:$port:127.0.0.1:$ENV_API_PORT" "$ENV_HOST" 2>/dev/null; then
    port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
    ssh -o ControlPath="$ENV_SOCK" -O forward -L "127.0.0.1:$port:127.0.0.1:$ENV_API_PORT" "$ENV_HOST" || return 1
    echo "$port" > "$ENV_DIR/port"
  fi
  (umask 077 && printf '%s\n' "$config" | sed "s#https://127.0.0.1:$ENV_API_PORT#https://127.0.0.1:$port#" > "$KUBECONFIG")
}

# env_k3s start|stop|status|restart: the Environment's k3s service. start also
# puts it in the default runlevel, so it comes back at every boot, and starts
# it again when openrc reads it as started with no k3s running, which a start
# from a shell without the tools on PATH leaves behind.
env_k3s() {
  node_env_sh sh -s "$1" <<'SH'
if [ -x /etc/init.d/k3s ]; then
  case "$1" in
    start)
      rc-update add k3s default >/dev/null 2>&1 || true
      rc-service k3s status >/dev/null 2>&1 && ! pgrep -x k3s-server >/dev/null && rc-service k3s zap >/dev/null
      rc-service k3s status >/dev/null 2>&1 || rc-service k3s start
      ;;
    *) rc-service k3s "$1" ;;
  esac
else
  echo "this Environment's image has no k3s service" >&2
  exit 1
fi
SH
}

# env_list: this agent's Environments as the list_environments tool returns
# them, asked through the image's platform-env, which finds the agent's
# platform MCP address itself.
env_list() {
  python3 -I -c '
import importlib.machinery, importlib.util, json, sys
loader = importlib.machinery.SourceFileLoader("platform_env", "/usr/local/bin/platform-env")
module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(module)
print(json.dumps(module.mcp("list_environments", {}) or []))'
}

# env_describe: this Environment, out of env_list.
env_describe() {
  env_list | jq -e --arg n "$CLUSTER_ENVIRONMENT" '.[] | select(.name == $n)' ||
    { echo "FATAL: you own no Environment named $CLUSTER_ENVIRONMENT; platform-env list shows yours" >&2; return 1; }
}

# env_chart_values: the Environment's JSON on stdin. Prints the chart values
# its endpoints decide, one key=value a line, and the bridge's own as
# bridge.<key>=<value>. Fails, naming what to create, when an endpoint is
# missing or has no address, or when the four do not share one port.
env_chart_values() {
  jq -r --arg need "$ENV_ENDPOINTS" '
    ($need | split(" ")) as $names
    | (.endpoints // []) as $eps
    | [$names[] | select(. as $n | any($eps[]; .name == $n and (.url // "") != "") | not)] as $missing
    | if ($missing | length) > 0 then
        error("the Environment needs the endpoints \($names | join(", ")), all on one port, and \($missing | join(", ")) is missing or has no address")
      else . end
    | [$eps[] | select(.name as $n | $names | index($n))] as $ours
    | ([$ours[].port] | unique) as $ports
    | if ($ports | length) > 1 then
        error("the endpoints \($names | join(", ")) must share one port, the host-name bridge'"'"'s, and use \($ports | map(tostring) | join(", "))")
      else . end
    | ($ours | map({(.name): .url}) | add) as $url
    | ($url.app | capture("^(?<scheme>https?)://[^/:]+(:(?<port>[0-9]+))?")) as $app
    | "urls.ui=\($url.app)",
      "urls.keycloak=\($url.keycloak)",
      "urls.share=\($url.share)",
      "urls.content=\($url.content)",
      "scheme=\($app.scheme)",
      "bridge.port=\($ports[0])",
      "bridge.scheme=\($app.scheme)",
      "bridge.publicPort=\($app.port // (if $app.scheme == "https" then "443" else "80" end))"'
}

# env_bridge_manifest <envoy image> <port> <ingress port> <scheme> <public port>:
# the host-name bridge. The gate relays each endpoint to its port on the
# Environment's loopback with `Host: 127.0.0.1:<port>`, and names the address
# the browser asked for in X-Forwarded-Host, while the ingress routes by host
# name. So an Envoy on the node's network, on that port, puts the address back
# as the host and passes the request to Traefik's app entrypoint on the same
# loopback. It also names the public scheme and port, which Keycloak builds
# its links from, since Traefik would otherwise name its own.
env_bridge_manifest() {
  cat <<YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: platform-environment-bridge
  namespace: kube-system
data:
  envoy.yaml: |
    static_resources:
      listeners:
        - name: bridge
          address: { socket_address: { address: 127.0.0.1, port_value: $2 } }
          filter_chains:
            - filters:
                - name: envoy.filters.network.http_connection_manager
                  typed_config:
                    "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                    stat_prefix: bridge
                    upgrade_configs: [{ upgrade_type: websocket }]
                    stream_idle_timeout: 0s
                    route_config:
                      request_headers_to_add:
                        - { header: { key: x-forwarded-proto, value: "$4" }, append_action: OVERWRITE_IF_EXISTS_OR_ADD }
                        - { header: { key: x-forwarded-port, value: "$5" }, append_action: OVERWRITE_IF_EXISTS_OR_ADD }
                      virtual_hosts:
                        - name: all
                          domains: ["*"]
                          routes:
                            - match: { prefix: "/" }
                              route: { cluster: ingress, host_rewrite_header: x-forwarded-host, timeout: 0s }
                    http_filters:
                      - name: envoy.filters.http.router
                        typed_config: { "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router }
      clusters:
        - name: ingress
          type: STATIC
          load_assignment:
            cluster_name: ingress
            endpoints: [{ lb_endpoints: [{ endpoint: { address: { socket_address: { address: 127.0.0.1, port_value: $3 } } } }] }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: platform-environment-bridge
  namespace: kube-system
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector:
    matchLabels: { app: platform-environment-bridge }
  template:
    metadata:
      labels: { app: platform-environment-bridge }
      annotations:
        platform-environment-bridge/config: "$(printf '%s ' "$@" | sha256sum | cut -c1-16)"
    spec:
      hostNetwork: true
      containers:
        - name: envoy
          image: $1
          args: ["-c", "/etc/envoy/envoy.yaml", "--log-level", "warn"]
          volumeMounts:
            - { name: config, mountPath: /etc/envoy }
      volumes:
        - name: config
          configMap: { name: platform-environment-bridge }
YAML
}

# env_reuse_ref <component>: the registry image image:resolve reuses for the
# component, or nothing when it must be built here. Asked once per install.
env_reuse_ref() {
  local d
  d="$("$MISE_CONFIG_ROOT/.mise/tasks/image/resolve" resolve "$1")" || d=BUILD
  case "$d" in "REUSE "*) echo "${d#REUSE }" ;; esac
}

# env_pull_as <ref> <component>: the node pulls a registry image and names it
# the local tag the chart's local values run, platform-<component>:latest.
env_pull_as() {
  node_env_sh sh -c 'k3s crictl pull "$1" >/dev/null &&
    k3s ctr -n k8s.io images tag --force "$1" "docker.io/library/platform-$2:latest" >/dev/null' _ "$1" "$2"
}

# env_image_id <ref>: the ID of the image the node holds under that reference,
# or nothing when it holds none.
env_image_id() {
  node_env_sh k3s crictl inspecti -o go-template --template '{{.status.id}}' "$1" 2>/dev/null || true
}

# env_build_id <tar or layout>: the ID a local build imports as, its config's
# digest, or nothing when the file names none.
env_build_id() {
  local m
  if [ -d "$1" ]; then m="$(cat "$1/manifest.json" 2>/dev/null)"; else m="$(tar -xOf "$1" manifest.json 2>/dev/null)"; fi
  m="$(printf '%s' "$m" | jq -r '.[0].Config // empty' 2>/dev/null)" || return 0
  [ -n "$m" ] || return 0
  m="${m##*/}"
  printf 'sha256:%s' "${m%.json}"
}


# The ports the e2e lane's backchannel takes in an Environment, one per
# Environment, so the suites of several Environments, and the local lane on
# 6555, run side by side on one agent: the forward listens on the same port
# on this agent's loopback, since the port is part of every address.
E2E_ENV_PORT_MIN=6560 E2E_ENV_PORT_MAX=6599

# env_e2e_port: the port the e2e lane takes in this Environment. The one its
# install already answers on, when it is in the range, so a rerun keeps the
# addresses its realm and cookies name; else the one this agent recorded for
# it; else the first port of the range that no other Environment of this agent
# still holds and nothing here listens on. The record is this agent's only, so
# a lock keeps two runs that start at once off one port, and the record of an
# Environment that is gone frees its port.
env_e2e_port() {
  local port
  port="$(cluster_install_port 2>/dev/null || true)"
  if [ -n "$port" ] && [ "$port" -ge "$E2E_ENV_PORT_MIN" ] && [ "$port" -le "$E2E_ENV_PORT_MAX" ]; then
    echo "$port" > "$ENV_DIR/e2e-port"
    printf '%s' "$port"
    return 0
  fi
  (
    flock 9
    [ ! -s "$ENV_DIR/e2e-port" ] || exit 0
    names="$(env_list | jq -r '.[].name')" ||
      { echo "FATAL: cannot list this agent's Environments, so cannot tell which e2e ports are still taken" >&2; exit 1; }
    names=" $(printf '%s\n' "$names" | xargs) "
    used=" "
    for f in "${ENV_DIR%/*}"/env-*/e2e-port; do
      [ -f "$f" ] || continue
      n="${f%/e2e-port}"; n="${n##*/env-}"
      case "$names" in *" $n "*) used="$used$(cat "$f") " ;; esac
    done
    for p in $(seq "$E2E_ENV_PORT_MIN" "$E2E_ENV_PORT_MAX"); do
      case "$used" in *" $p "*) continue ;; esac
      (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && continue
      echo "$p" > "$ENV_DIR/e2e-port"
      exit 0
    done
    echo "FATAL: every port of $E2E_ENV_PORT_MIN-$E2E_ENV_PORT_MAX is taken by another of this agent's Environments, or listened on here" >&2
    exit 1
  ) 9>"${ENV_DIR%/*}/e2e-port.lock" || return 1
  cat "$ENV_DIR/e2e-port"
}

# env_e2e_forward <port>: forwards the lane's backchannel port, and a port of
# its own to the k3s API env_tunnel found, to this agent's loopback, and writes
# the suite's kubeconfig for that API port. An SSH link of its own, not the
# control master's, which closes after ten idle minutes while a suite can wait
# longer than that between two calls to the API. It runs until
# env_e2e_forward_close stops it.
ENV_E2E_KUBECONFIG="$ENV_DIR/e2e-kubeconfig.yaml"
export ENV_E2E_KUBECONFIG
env_e2e_forward() {
  local port="$1" api
  [ -n "${ENV_API_PORT:-}" ] || { echo "FATAL: no tunnel to the k3s API of Environment $CLUSTER_ENVIRONMENT, so no port to forward it from" >&2; return 1; }
  api="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
  (umask 077 && sed "s#https://127.0.0.1:[0-9]*#https://127.0.0.1:$api#" "$KUBECONFIG" > "$ENV_E2E_KUBECONFIG")
  ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -L "127.0.0.1:$port:127.0.0.1:$port" -L "127.0.0.1:$api:127.0.0.1:$ENV_API_PORT" "$ENV_HOST" </dev/null &
  ENV_E2E_FORWARD_PID=$!
  for _ in $(seq 1 90); do
    (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && (exec 3<>"/dev/tcp/127.0.0.1/$api") 2>/dev/null && return 0
    kill -0 "$ENV_E2E_FORWARD_PID" 2>/dev/null || {
      echo "FATAL: could not forward port $port from Environment $CLUSTER_ENVIRONMENT; another task of this lane, or a local e2e cluster, may hold it here" >&2
      return 1
    }
    sleep 1
  done
  echo "FATAL: the forward of port $port from Environment $CLUSTER_ENVIRONMENT did not open in 90s" >&2
  return 1
}
env_e2e_forward_close() {
  [ -n "${ENV_E2E_FORWARD_PID:-}" ] || return 0
  kill "$ENV_E2E_FORWARD_PID" 2>/dev/null || true
  wait "$ENV_E2E_FORWARD_PID" 2>/dev/null || true
  ENV_E2E_FORWARD_PID=""
}
