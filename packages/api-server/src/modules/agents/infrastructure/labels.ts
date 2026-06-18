/** K8s label keys and well-known values used across the agents module.
 *  Instance and Agent merged into Agent. The previous
 *  agent-instance type and agent-platform.ai/agent label are gone. */

// ---- Label keys ----
export const LABEL_TYPE = "agent-platform.ai/type";
export const LABEL_TEMPLATE_REF = "agent-platform.ai/template";
export const LABEL_AGENT_REF = "agent-platform.ai/agent";
export const LABEL_OWNER = "agent-platform.ai/owner";
export const LABEL_CHANNEL_TYPE = "agent-platform.ai/channel-type";
export const LABEL_SYSTEM = "agent-platform.ai/system";
export const LABEL_CREATED_BY = "agent-platform.ai/created-by";

// Per-pod role within an agent pair. Distinguishes the agent
// pod from the paired gateway (Envoy) pod that mounts credentials.
export const LABEL_ROLE = "agent-platform.ai/role";
export const ROLE_AGENT = "agent";
export const ROLE_GATEWAY = "gateway";

// ---- Label values for LABEL_TYPE ----
export const TYPE_TEMPLATE = "agent-template";
export const TYPE_AGENT = "agent";
export const TYPE_SCHEDULE = "agent-schedule";
export const TYPE_CHANNEL_SECRET = "channel-secret";

// ---- Agent-scoped registry pull-secret labels ----
export const LABEL_SECRET_TYPE = "agent-platform.ai/secret-type";
export const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
export const MANAGED_BY_API_SERVER = "api-server";
export const SECRET_TYPE_REGISTRY_PULL = "registry-pull";

// ---- ConfigMap data keys ----
export const SPEC_KEY = "spec.yaml";
export const STATUS_KEY = "status.yaml";

// ---- agent-platform.ai/v1 Agent custom resource coordinates ----
export const GROUP = "agent-platform.ai";
export const VERSION = "v1";
export const AGENTS_PLURAL = "agents";
export const KIND_AGENT = "Agent";

// ---- Annotation keys ----
export const LAST_ACTIVITY_KEY = "agent-platform.ai/last-activity";
export const ACTIVE_SESSION_KEY = "agent-platform.ai/active-session";

// Roll trigger. The api-server bumps this annotation on the Agent
// to request a rolling restart of the pair: the controller stamps its value
// into both pod templates, so a change rolls the pods without any spec/status
// write. Used by the UI restart button and to force a pod re-render when a
// granted secret's env mappings change (Pod env is immutable on a live pod).
// The value is opaque to the controller — a roll trigger only.
export const ANN_ROLL_REV = "agent-platform.ai/roll-rev";

// Reason the controller stamps on the Ready condition when it hibernates an
// agent (scales to zero). Lets the api-server tell "hibernated" from "starting"
// — both report Ready=False — from conditions alone. Mirrors the controller
// constant.
export const READY_REASON_HIBERNATED = "Hibernated";
