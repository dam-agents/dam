// CR labels stamped on the Fork object for kubectl/debugging (the controller
// reconciles by name and does not select on these). The "type" label is gone —
// the custom resource Kind carries that distinction now (ADR-058).
export const LABEL_AGENT_REF = "agent-platform.ai/agent";
export const LABEL_FORK_ID = "agent-platform.ai/fork-id";

// agent-platform.ai/v1 Fork custom resource coordinates (ADR-058).
export const GROUP = "agent-platform.ai";
export const VERSION = "v1";
export const FORKS_PLURAL = "forks";
export const KIND_FORK = "Fork";
