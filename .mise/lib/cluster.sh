# Sourced by the cluster:* and e2e:* tasks: the one place that names the
# cluster they act on. LIMA_INSTANCE picks the lima VM (the e2e tasks pin
# platform-k3s-test); IS_SANDBOX means k3s runs on this host.
. "$(dirname "${BASH_SOURCE[0]}")/root.sh"

export LIMA_INSTANCE="${LIMA_INSTANCE:-platform-k3s}"
if [ -n "${IS_SANDBOX:-}" ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
else
  export KUBECONFIG="${LIMA_HOME:-$HOME/.lima}/$LIMA_INSTANCE/copied-from-guest/kubeconfig.yaml"
fi

# The supervisor k3s runs under: OpenRC where the host installed its service
# (k3s's own installer prefers it when openrc-run exists), systemd where it is
# running, and neither in a sandbox that has no init system — cluster:install
# starts k3s as a plain process there, and this returns 1.
k3s_service() { # start|stop|restart
  if [ -x /etc/init.d/k3s ]; then
    as_root rc-service k3s "$1"
  elif [ -d /run/systemd/system ]; then
    as_root systemctl "$1" k3s
  else
    return 1
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
  if [ -n "${IS_SANDBOX:-}" ]; then
    as_root bash -c "$prune"
  else
    limactl shell "$LIMA_INSTANCE" sudo bash -c "$prune"
  fi
}
