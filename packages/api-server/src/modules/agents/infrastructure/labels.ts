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
// Both grants are always selective: absence is treated as an empty grant
// list, and new instance ConfigMaps initialize the annotations explicitly
// so the explicit-empty vs. legacy-absent distinction is moot.
export const ANN_GRANTED_SECRET_IDS = "agent-platform.ai/granted-secret-ids";
export const ANN_GRANTED_CONNECTION_IDS = "agent-platform.ai/granted-connection-ids";

// Render-affecting hash of the agent's currently-granted secrets (ADR-040).
// The api-server bumps this on the instance ConfigMap whenever a granted
// secret's `envMappings` change, because Pod env is immutable on a running
// pod and the merged env can only be re-rendered by rolling. Bumping the
// annotation forces the controller's ConfigMap watch to refire so the agent
// pod re-renders with the merged env. The value is opaque to the
// controller — a roll trigger only.
//
// `hostPattern` / `pathPattern` edits do NOT bump this annotation: they
// propagate hot via `connectionRules.syncForAgent` (live `egress_rules`
// rows). `injectionConfig` (ADR-028) currently has no fanout; if a future
// change wires it through this rev, update this comment then.
export const ANN_SECRETS_REV = "agent-platform.ai/secrets-rev";
