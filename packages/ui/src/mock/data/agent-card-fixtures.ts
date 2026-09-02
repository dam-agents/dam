import type { AgentView, Schedule } from "../../types.js";

/**
 * Fixture agents and schedules for the agent card redesign.
 * Each agent targets a specific §5 state from the design brief.
 */

// ---------------------------------------------------------------------------
// Agent fixtures — one per §5 state
// ---------------------------------------------------------------------------

const base: AgentView = {
  id: "",
  name: "",
  templateId: "claude-code",
  templateUpdate: null,
  image: "ghcr.io/anthropics/claude-code:latest",
  hibernationTimeoutMin: 30,
  grantedSecretIds: [],
  grantedConnectionIds: [],
  state: "running",
  stopRequested: false,
  overBudget: false,
  size: { cpu: "2000m", memory: "2Gi" },
  contributionFailures: [],
  channels: [],
  kbTemplateId: null,
  spawnedBy: null,
  features: { liveUpdates: true },
};

function agent(id: string, overrides: Partial<AgentView>): AgentView {
  return { ...base, id, ...overrides };
}

/** §5-1: Full card — pack, both messengers, connections, schedules, skills known, never-hibernates, running */
export const fullAgent = agent("fix-full", {
  name: "deploy-orchestrator",
  hibernationTimeoutMin: 0,
  grantedConnectionIds: [
    "conn-github",
    "conn-anthropic",
    "conn-slack",
    "conn-k8s",
  ],
  channels: [
    { type: "slack", slackChannelId: "#deployments", default: true },
    { type: "slack", slackChannelId: "#alerts" },
  ],
  state: "running",
});

/** §5-2: Bare card — plain agent, nothing attached, no pack */
export const bareAgent = agent("fix-bare", {
  name: "quick-prototype",
  grantedConnectionIds: ["conn-anthropic"],
  state: "running",
});

/** §5-3: One-of-each — singular forms */
export const singularAgent = agent("fix-singular", {
  name: "nightly-runner",
  grantedConnectionIds: ["conn-anthropic", "conn-github"],
  channels: [{ type: "slack", slackChannelId: "#eng-standup" }],
  state: "running",
});

/** §5-4: Hibernated with unknown skills — common real case */
export const hibernatedUnknownSkills = agent("fix-hibernated-unknown", {
  name: "weekend-reviewer",
  state: "hibernated",
  grantedConnectionIds: ["conn-anthropic"],
});

/** §5-5a: Never-hibernates but currently hibernated (user stopped it) */
export const neverHibernatesButHibernated = agent("fix-never-hib-stopped", {
  name: "background-watcher",
  hibernationTimeoutMin: 0,
  state: "hibernated",
  stopRequested: true,
  grantedConnectionIds: ["conn-anthropic"],
  channels: [{ type: "slack", slackChannelId: "#incident-room" }],
});

/** §5-5b: Never-hibernates but over budget */
export const neverHibernatesOverBudget = agent("fix-never-hib-budget", {
  name: "cost-runaway",
  hibernationTimeoutMin: 0,
  state: "hibernated",
  overBudget: true,
  overBudgetMessage: "Exceeded $200 daily spend limit",
  grantedConnectionIds: ["conn-anthropic"],
});

/** §5-6: Knowledge base card */
export const knowledgeBaseAgent = agent("fix-kb", {
  name: "team-wiki",
  kind: "knowledge-base",
  kbTemplateId: "llm-wiki",
  state: "running",
  grantedConnectionIds: ["conn-anthropic"],
  channels: [{ type: "slack", slackChannelId: "#team-wiki" }],
});

/** §5-7: Experiment card */
export const experimentAgent = agent("fix-experiment", {
  name: "prompt-variants-a-b",
  kind: "experiment",
  state: "running",
  grantedConnectionIds: ["conn-anthropic"],
});

/** §5-8: Pack applied but partly skipped — provenance without matching config */
export const packSkippedAgent = agent("fix-pack-skipped", {
  name: "link-checker",
  state: "running",
  grantedConnectionIds: ["conn-anthropic"],
});

/** §5-9: Error state with contribution failures */
export const errorAgent = agent("fix-error", {
  name: "broken-pipeline",
  state: "error",
  error: "Pod crashed: OOMKilled after 4Gi spike",
  grantedConnectionIds: ["conn-anthropic", "conn-github"],
  contributionFailures: [
    { kind: "git-clone", message: "Failed to clone: SSH key expired" },
    { kind: "connection", message: "Slack token revoked" },
  ],
});

/** §5-10: Temporary-agent driver row */
export const temporaryDriverAgent = agent("fix-driver", {
  name: "batch-processor",
  state: "running",
  grantedConnectionIds: ["conn-anthropic"],
});

/** §5-11: Demo agent from packs branch (uses pack badge) */
export const demoPackAgent = agent("fix-demo-pack", {
  name: "demo-code-reviewer",
  state: "running",
  grantedConnectionIds: ["conn-anthropic", "conn-github"],
  channels: [{ type: "slack", slackChannelId: "#code-reviews" }],
});

// ---------------------------------------------------------------------------
// Schedule fixtures
// ---------------------------------------------------------------------------

const scheduleBase: Schedule = {
  id: "",
  name: "",
  agentId: "",
  type: "cron",
  cron: "0 9 * * 1-5",
  rrule: null,
  timezone: "America/New_York",
  quietHours: [],
  task: null,
  enabled: true,
  sessionMode: "fresh",
  createdBy: "user",
  status: null,
};

function sched(
  id: string,
  agentId: string,
  overrides: Partial<Schedule>,
): Schedule {
  return { ...scheduleBase, id, agentId, ...overrides };
}

export const fixtureSchedules: Schedule[] = [
  sched("sched-full-1", "fix-full", { name: "Morning deploy check" }),
  sched("sched-full-2", "fix-full", { name: "Nightly rollback audit" }),
  sched("sched-full-3", "fix-full", {
    name: "Friday summary",
    cron: "0 17 * * 5",
  }),
  sched("sched-singular-1", "fix-singular", { name: "Nightly lint run" }),
  sched("sched-driver-1", "fix-driver", {
    name: "Batch image processing",
    enabled: true,
  }),
  sched("sched-driver-2", "fix-driver", {
    name: "Report generation",
    enabled: true,
  }),
];

// ---------------------------------------------------------------------------
// Pack provenance map (fixture — field does not exist on AgentView today)
// ---------------------------------------------------------------------------

export const fixturePackProvenance: Record<string, string> = {
  "fix-full": "design-prototyper",
  "fix-pack-skipped": "link-monitor",
  "fix-demo-pack": "code-reviewer",
};

// ---------------------------------------------------------------------------
// Skill counts (fixture — skills are not reachable for hibernated agents)
// ---------------------------------------------------------------------------

export const fixtureSkillCounts: Record<
  string,
  { installed: number; standalone: number } | null
> = {
  "fix-full": { installed: 4, standalone: 1 },
  "fix-singular": { installed: 1, standalone: 0 },
  "fix-kb": { installed: 2, standalone: 0 },
  "fix-experiment": { installed: 3, standalone: 0 },
  "fix-driver": { installed: 2, standalone: 1 },
  "fix-demo-pack": { installed: 3, standalone: 0 },
  "fix-error": { installed: 2, standalone: 0 },
  "fix-pack-skipped": { installed: 1, standalone: 0 },
};

// ---------------------------------------------------------------------------
// All fixture agents, in display order
// ---------------------------------------------------------------------------

export const allFixtureAgents: AgentView[] = [
  fullAgent,
  bareAgent,
  singularAgent,
  hibernatedUnknownSkills,
  neverHibernatesButHibernated,
  neverHibernatesOverBudget,
  knowledgeBaseAgent,
  experimentAgent,
  packSkippedAgent,
  errorAgent,
  temporaryDriverAgent,
  demoPackAgent,
];
