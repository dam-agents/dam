# How a task reaches the node it is installing onto or driving. Usually the
# node is a lima guest and every step is addressed through limactl; when the
# caller is already inside the box that is the node — CI — the same steps run
# here. Sourced rather than duplicated, so a task is written once and the two
# environments cannot drift apart.
#
# Expects DAM_VM to name the guest in the lima case.
if [ -n "${IS_SANDBOX:-}" ]; then
  on_node() { sudo "$@"; }
  copy_to_node() { sudo install -m 0644 "$1" "$2"; }
  node_exists() { [ -f /etc/dam/env ]; }
else
  on_node() { limactl shell "${DAM_VM:?}" sudo "$@"; }
  copy_to_node() { limactl copy "$1" "${DAM_VM:?}":"$2"; }
  node_exists() { limactl list -q 2>/dev/null | grep -qx "${DAM_VM:?}"; }
fi
