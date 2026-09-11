# The e2e node: its own VM and its own host ports, so a run never disturbs the
# dev node or races it for a forward. Sourced by every e2e task.
export DAM_VM="${E2E_VM_NAME:-dam-e2e}"
export DAM_PORT=5555
export DAM_KEYCLOAK_PORT=5556
export DAM_UI_URL="http://localhost:${DAM_PORT}"
export DAM_KEYCLOAK_URL="http://localhost:${DAM_KEYCLOAK_PORT}"
export PLATFORM_BASE_URL="$DAM_UI_URL"
export PLATFORM_KEYCLOAK_URL="$DAM_KEYCLOAK_URL"
