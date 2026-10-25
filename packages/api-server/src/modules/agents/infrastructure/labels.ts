export const LABEL_TEMPLATE_REF = "agent-platform.ai/template";
export const LABEL_AGENT_REF = "agent-platform.ai/agent";
export const LABEL_OWNER = "agent-platform.ai/owner";

export const LABEL_SECRET_TYPE = "agent-platform.ai/secret-type";
export const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
export const MANAGED_BY_API_SERVER = "api-server";
export const SECRET_TYPE_REGISTRY_PULL = "registry-pull";

export const GROUP = "agent-platform.ai";
export const VERSION = "v1";
export const AGENTS_PLURAL = "agents";
export const KIND_AGENT = "Agent";

export const LAST_ACTIVITY_KEY = "agent-platform.ai/last-activity";
export const ACTIVE_SESSION_KEY = "agent-platform.ai/active-session";
export const INVOCATIONS_ACTIVE_KEY = "agent-platform.ai/invocations-active";

export const STOP_REQUESTED_KEY = "agent-platform.ai/stop-requested";
export const DISABLED_KEY = "agent-platform.ai/disabled";
export const RECLAIMED_AT_KEY = "agent-platform.ai/reclaimed-at";

export const ANN_SWEEPABLE = "agent-platform.ai/sweepable";
export const ANN_LIFETIME_MS = "agent-platform.ai/lifetime-ms";

export const ANN_AGENT_KIND = "agent-platform.ai/agent-kind";

export const ANN_KB_TEMPLATE = "agent-platform.ai/kb-template";
export const ANN_KB_SHARE_ROOTS = "agent-platform.ai/kb-share-roots";

export const ANN_STARTER_KIT = "agent-platform.ai/starter-kit";
export const ANN_STARTER_KIT_ONBOARDED =
  "agent-platform.ai/starter-kit-onboarded";
export const ANN_STARTER_KIT_SEED = "agent-platform.ai/starter-kit-seed";
export const ANN_STARTER_KIT_DEFAULT_MODEL =
  "agent-platform.ai/starter-kit-default-model";
export const ANN_KIT_UPDATE_PENDING = "agent-platform.ai/kit-update-pending";
export const ANN_KIT_UPDATE_SKIPPED = "agent-platform.ai/kit-update-skipped";

export const ANN_ROLL_REV = "agent-platform.ai/roll-rev";
export const ANN_MACHINE_UP = "agent-platform.ai/machine-up-at";
export const ANN_MACHINE_DOWN = "agent-platform.ai/machine-down-at";
export const ANN_MEMORY_WAIT_UNTIL = "agent-platform.ai/memory-wait-until";
export const ANN_RUNNER_OOM_KILL = "agent-platform.ai/runner-oom-kill";
export const ANN_RUNNER_OOM_RECOVERED = "agent-platform.ai/runner-oom-over";
export const ANN_IMAGE_UPDATE_FROM = "agent-platform.ai/image-update-from";
export const ANN_IMAGE_UPDATE_REFUSED =
  "agent-platform.ai/image-update-refused";

export const READY_REASON_HIBERNATED = "Hibernated";
export const READY_REASON_OVER_BUDGET = "OverBudget";
export const MACHINE_STOPPING_REASON = "MachineStopping";
