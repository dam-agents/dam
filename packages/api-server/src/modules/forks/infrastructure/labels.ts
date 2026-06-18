// CR labels stamped on the Fork object for kubectl/debugging. Fork GC is by
// owner reference to the parent Agent (set by the controller), not these
// labels. (The Kind carries the type, so no type label.)
export const LABEL_AGENT_REF = "agent-platform.ai/agent";
export const LABEL_FORK_ID = "agent-platform.ai/fork-id";

// agent-platform.ai/v1 Fork custom resource coordinates.
export const GROUP = "agent-platform.ai";
export const VERSION = "v1";
export const FORKS_PLURAL = "forks";
export const KIND_FORK = "Fork";
