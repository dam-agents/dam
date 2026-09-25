# Sourced by the cluster:* and e2e:* tasks: the one place that names the
# cluster they act on. LIMA_INSTANCE picks the lima VM (the e2e tasks pin
# platform-k3s-test); IS_SANDBOX means k3s runs on this host.
export LIMA_INSTANCE="${LIMA_INSTANCE:-platform-k3s}"
if [ -n "${IS_SANDBOX:-}" ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
else
  export KUBECONFIG="${LIMA_HOME:-$HOME/.lima}/$LIMA_INSTANCE/copied-from-guest/kubeconfig.yaml"
fi
