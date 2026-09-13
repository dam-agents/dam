# The e2e install: its own cluster VM and its own node VM, on their own host
# ports, so a run never disturbs the dev pair or races them for a forward.
# Sourced by every e2e task.
export DAM_CLUSTER_VM="${E2E_CLUSTER_VM:-dam-e2e-cluster}"
export DAM_VM="${E2E_VM_NAME:-dam-e2e}"
export DAM_NAMESPACE=dam
# Its cluster publishes the same guest NodePorts on host ports 100 higher. In
# sandbox mode (CI) there is no lima and nothing is forwarded, so the ports are
# the ones k3s binds.
if [ -n "${IS_SANDBOX:-}" ]; then
  export DAM_CLUSTER_PORT_OFFSET=0
else
  export DAM_CLUSTER_PORT_OFFSET=100
fi
export DAM_NODE_ID=e2e-node-1
export DAM_PORT=5555
export DAM_UI_URL="http://localhost:${DAM_PORT}"
# The e2e node's peer port on the host, apart from the dev node's, so the two
# VMs never race for one forward. One node, so nothing dials it yet.
export DAM_PEER_HOST_PORT=4202
export DAM_NODE_ADDRESS="127.0.0.1:${DAM_PEER_HOST_PORT}"
export PLATFORM_BASE_URL="$DAM_UI_URL"
# The realm the e2e cluster imports publishes the same issuer a browser uses.
export PLATFORM_KEYCLOAK_URL="http://localhost:$((30081 + DAM_CLUSTER_PORT_OFFSET))"
