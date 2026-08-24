// UNIT_BOUNDARY_DESCRIPTION: the agent's home and workspace paths, fixed rather than configured — the image bakes this home into its user, the controller sets it as HOME on the pod, and agent-runtime and the harness MCP surface both resolve paths against it, so the value has to agree across all of them (a Go copy lives in the controller's reconciler).
export const AGENT_HOME_DIR = "/home/agent";

export const AGENT_WORK_DIR = `${AGENT_HOME_DIR}/work`;
