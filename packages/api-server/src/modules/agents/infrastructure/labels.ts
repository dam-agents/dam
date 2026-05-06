/** K8s label keys and well-known values used across the agents module. */

// ---- Label keys ----
export const LABEL_TYPE = "agent-platform.ai/type";
export const LABEL_TEMPLATE_REF = "agent-platform.ai/template";
export const LABEL_AGENT_REF = "agent-platform.ai/agent";
export const LABEL_INSTANCE_REF = "agent-platform.ai/instance";
export const LABEL_OWNER = "agent-platform.ai/owner";
export const LABEL_CHANNEL_TYPE = "agent-platform.ai/channel-type";
export const LABEL_SYSTEM = "agent-platform.ai/system";
export const LABEL_CREATED_BY = "agent-platform.ai/created-by";

// Per-pod role within an instance pair (ADR-038). Distinguishes the agent
// pod from the paired gateway (Envoy) pod that mounts credentials.
export const LABEL_ROLE = "agent-platform.ai/role";
export const ROLE_AGENT = "agent";
export const ROLE_GATEWAY = "gateway";

// ---- Label values for LABEL_TYPE ----
export const TYPE_TEMPLATE = "agent-template";
export const TYPE_AGENT = "agent";
export const TYPE_INSTANCE = "agent-instance";
export const TYPE_SCHEDULE = "agent-schedule";
export const TYPE_CHANNEL_SECRET = "channel-secret";

// ---- ConfigMap data keys ----
export const SPEC_KEY = "spec.yaml";
export const STATUS_KEY = "status.yaml";

// ---- Annotation keys ----
export const LAST_ACTIVITY_KEY = "agent-platform.ai/last-activity";
export const ACTIVE_SESSION_KEY = "agent-platform.ai/active-session";

// Per-agent grant annotations stored on the instance ConfigMap. The
// controller reads these on every reconcile and intersects them with the
// owner's credential Secret list before mounting into the Envoy sidecar.
//
// `agent-platform.ai/secret-mode`:
//   - absent or "all": every owner Secret is granted
//   - "selective":     only Secrets whose id is in `granted-secret-ids`
// `agent-platform.ai/granted-connection-ids`:
//   - absent: every owner connection is granted
//   - present (even empty string): only connections in the comma-separated list
export const ANN_SECRET_MODE = "agent-platform.ai/secret-mode";
export const ANN_GRANTED_SECRET_IDS = "agent-platform.ai/granted-secret-ids";
export const ANN_GRANTED_CONNECTION_IDS = "agent-platform.ai/granted-connection-ids";
