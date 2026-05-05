/** K8s label keys and well-known values used across the agents module. */

// ---- Label keys ----
export const LABEL_TYPE = "humr.ai/type";
export const LABEL_TEMPLATE_REF = "humr.ai/template";
export const LABEL_AGENT_REF = "humr.ai/agent";
export const LABEL_INSTANCE_REF = "humr.ai/instance";
export const LABEL_OWNER = "humr.ai/owner";
export const LABEL_CHANNEL_TYPE = "humr.ai/channel-type";
export const LABEL_SYSTEM = "humr.ai/system";
export const LABEL_CREATED_BY = "humr.ai/created-by";

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
export const LAST_ACTIVITY_KEY = "humr.ai/last-activity";
export const ACTIVE_SESSION_KEY = "humr.ai/active-session";

// Per-agent grant annotations stored on the instance ConfigMap. The
// controller reads these on every reconcile and intersects them with the
// owner's credential Secret list before mounting into the Envoy sidecar.
//
// `humr.ai/secret-mode`:
//   - absent or "all": every owner Secret is granted
//   - "selective":     only Secrets whose id is in `granted-secret-ids`
// `humr.ai/granted-connection-ids`:
//   - absent: every owner connection is granted
//   - present (even empty string): only connections in the comma-separated list
export const ANN_SECRET_MODE = "humr.ai/secret-mode";
export const ANN_GRANTED_SECRET_IDS = "humr.ai/granted-secret-ids";
export const ANN_GRANTED_CONNECTION_IDS = "humr.ai/granted-connection-ids";
