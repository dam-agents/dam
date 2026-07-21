// CR labels stamped on the Fork object for kubectl/debugging. Fork GC is by
// owner reference to the parent Agent (set by the controller), not these
// labels. (The Kind carries the type, so no type label.)
export const LABEL_AGENT_REF = "agent-platform.ai/agent";
export const LABEL_FORK_ID = "agent-platform.ai/fork-id";

// Activity annotation the controller measures the fork idle tiers against —
// the same key agents use, bumped per relayed turn and on every ensure.
export const ANNOTATION_LAST_ACTIVITY = "agent-platform.ai/last-activity";

// Bumped when the replier's credential set changes so the controller rolls
// the fork gateway at connect time — not on the next turn, which would race
// the roll (#2843).
export const ANNOTATION_CREDENTIALS_REV = "agent-platform.ai/credentials-rev";

// agent-platform.ai/v1 Fork custom resource coordinates.
export const GROUP = "agent-platform.ai";
export const VERSION = "v1";
export const FORKS_PLURAL = "forks";
export const KIND_FORK = "Fork";
