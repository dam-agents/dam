# The e2e install: its own cluster VM and its own node VM, on their own host
# ports, so a run never disturbs the dev pair or races them for a forward.
# Sourced by every e2e task.
export DAM_CLUSTER_VM="${E2E_CLUSTER_VM:-dam-e2e-cluster}"
export DAM_VM="${E2E_VM_NAME:-dam-e2e}"
export DAM_NAMESPACE=dam
# Its cluster publishes the same guest NodePorts on host ports 100 higher.
export DAM_CLUSTER_PORT_OFFSET=100
export DAM_NODE_ID=e2e-node-1
export DAM_PORT=5555
export DAM_UI_URL="http://localhost:${DAM_PORT}"
# One node, so nothing ever dials this; naming a host address it does not own
# would only be a lie waiting for a second node to expose.
export DAM_NODE_ADDRESS="127.0.0.1:4002"
export PLATFORM_BASE_URL="$DAM_UI_URL"
# The realm the e2e cluster imports publishes the same issuer a browser uses.
export PLATFORM_KEYCLOAK_URL="http://localhost:30181"
