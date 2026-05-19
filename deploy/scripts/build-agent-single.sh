#!/usr/bin/env bash
# Load a single agent's image into k3s and restart only pods using that image.
# Used by `mise run cluster:build-agent:<name>` tasks.
#
# Usage: build-agent-single.sh <agent-name> <image-tag>
#   agent-name: short name (e.g. software-factory) — used only for tar filename
#   image-tag:  full image tag (e.g. platform-software-factory:latest)

set -eo pipefail

AGENT_NAME="${1:-}"
AGENT_IMAGE="${2:-}"

if [ -z "$AGENT_NAME" ] || [ -z "$AGENT_IMAGE" ]; then
  echo "Usage: $0 <agent-name> <image-tag>" >&2
  exit 1
fi

echo "Loading $AGENT_IMAGE into k3s..."
tar="/tmp/platform-agent-${AGENT_NAME}.tar"
docker save "$AGENT_IMAGE" -o "$tar"

if [ -n "${IS_SANDBOX:-}" ]; then
  KUBECONFIG="/etc/rancher/k3s/k3s.yaml"
  sudo k3s ctr images import "$tar"
else
  LIMA_INSTANCE="platform-k3s"
  KUBECONFIG="$HOME/.lima/$LIMA_INSTANCE/copied-from-guest/kubeconfig.yaml"
  limactl copy "$tar" "$LIMA_INSTANCE":"$tar"
  limactl shell "$LIMA_INSTANCE" sudo k3s ctr images import "$tar"
fi
rm -f "$tar"

echo "Finding pods using $AGENT_IMAGE..."
# Awk splits the comma-separated image list and requires an exact match per
# entry — `index()` would substring-match and could pick up similarly-named
# images (e.g. `platform-foo` vs `platform-foo-bar`).
PODS=$(kubectl --kubeconfig="$KUBECONFIG" get pods -n platform-agents \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.image}{","}{end}{"\n"}{end}' \
  | awk -v img="$AGENT_IMAGE" -F'\t' '{
      n = split($2, images, ",")
      for (i = 1; i <= n; i++) if (images[i] == img) { print $1; next }
    }')

if [ -n "$PODS" ]; then
  echo "Restarting pods:"
  echo "$PODS" | sed 's/^/  /'
  echo "$PODS" | xargs kubectl --kubeconfig="$KUBECONFIG" delete pod -n platform-agents
else
  echo "No running pods using $AGENT_IMAGE — image is loaded; next instance pod will pick it up."
fi

# Prune dangling layers (issue #244).
PRUNE_DANGLING='sudo k3s crictl images 2>/dev/null | sed -nE "s/^<none>[[:space:]]+<none>[[:space:]]+([^[:space:]]+).*/\1/p" | xargs -r sudo k3s crictl rmi >/dev/null 2>&1 || true'
if [ -n "${IS_SANDBOX:-}" ]; then
  bash -c "$PRUNE_DANGLING"
else
  limactl shell "$LIMA_INSTANCE" bash -c "$PRUNE_DANGLING"
fi

echo "Done."
