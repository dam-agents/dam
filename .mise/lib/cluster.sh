# Sourced by the cluster:* and e2e:* tasks: the one place that names the
# cluster they act on. LIMA_INSTANCE picks the lima VM (the e2e tasks pin
# platform-k3s-test); IS_SANDBOX means k3s runs on this host.
export LIMA_INSTANCE="${LIMA_INSTANCE:-platform-k3s}"
if [ -n "${IS_SANDBOX:-}" ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
else
  export KUBECONFIG="${LIMA_HOME:-$HOME/.lima}/$LIMA_INSTANCE/copied-from-guest/kubeconfig.yaml"
fi

# What ztunnel logs for an expired mesh cert: its own SVID's, or a waypoint's
# (it logs the failed HBONE handshake). The ztunnel-cert-watchdog CronJob in
# cluster:install runs in the cluster and has its own copy; keep the two in sync.
MESH_CERT_EXPIRED='certificate expired|AlertReceived\(CertificateExpired\)'

# prune_dangling_images: drops the node's `<none>:<none>` images, the old
# `:latest` SHAs that lost their tag to a freshly imported one (issue #244).
# Not `crictl rmi --prune`: with no instance pods running, the agent images
# just loaded are unpinned, and it would wipe them too.
prune_dangling_images() {
  local prune='sudo k3s crictl images 2>/dev/null | sed -nE "s/^<none>[[:space:]]+<none>[[:space:]]+([^[:space:]]+).*/\\1/p" | xargs -r sudo k3s crictl rmi >/dev/null 2>&1 || true'
  if [ -n "${IS_SANDBOX:-}" ]; then
    bash -c "$prune"
  else
    limactl shell "$LIMA_INSTANCE" bash -c "$prune"
  fi
}
