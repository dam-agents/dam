import { queryClient } from "./query-client.js";
import { trpc } from "./trpc.js";
import type { AgentView } from "./types.js";

const agentBase: Omit<
  AgentView,
  "id" | "name" | "description" | "hibernationTimeoutMin" | "state" | "size"
> = {
  templateId: null,
  templateUpdate: null,
  image: "ghcr.io/dam-agents/claude-code:latest",
  grantedSecretIds: [],
  grantedConnectionIds: [],
  stopRequested: false,
  overBudget: false,
  contributionFailures: [],
  channels: [],
  kbTemplateId: null,
  spawnedBy: null,
  features: { liveUpdates: true },
};

const MOCK_AGENTS: AgentView[] = [
  {
    ...agentBase,
    id: "agent-research",
    name: "Research Agent",
    description: "Deep research across codebases and documentation",
    hibernationTimeoutMin: 30,
    state: "running",
    size: { cpu: "2", memory: "2Gi" },
  },
  {
    ...agentBase,
    id: "agent-deploy",
    name: "Deploy Bot",
    description: "Handles CI/CD and deployment workflows",
    hibernationTimeoutMin: 0,
    state: "running",
    size: { cpu: "4", memory: "4Gi" },
    channels: [{ type: "slack", slackChannelId: "C0123DEPLOY", default: true }],
  },
  {
    ...agentBase,
    id: "agent-review",
    name: "Code Review",
    description: "Reviews PRs and suggests improvements",
    hibernationTimeoutMin: 15,
    state: "starting",
    size: { cpu: "2", memory: "2Gi" },
    features: { liveUpdates: false },
  },
  {
    ...agentBase,
    id: "agent-ci",
    name: "CI Pipeline",
    description: "Runs integration tests on every PR",
    hibernationTimeoutMin: 20,
    state: "hibernated",
    size: { cpu: "2", memory: "2Gi" },
  },
  {
    ...agentBase,
    id: "agent-docs",
    name: "Docs Writer",
    description: "Keeps documentation in sync with code changes",
    hibernationTimeoutMin: 15,
    state: "running",
    size: { cpu: "1", memory: "1Gi" },
  },
];

const MOCK_SESSIONS = [
  {
    sessionId: "sess-research-1",
    agentId: "agent-research",
    type: "regular" as const,
    mode: "chat" as const,
    createdAt: "2026-08-27T10:00:00Z",
    title: "Investigate auth middleware patterns",
    updatedAt: "2026-08-27T14:30:00Z",
    running: true,
  },
  {
    sessionId: "sess-research-2",
    agentId: "agent-research",
    type: "regular" as const,
    mode: "chat" as const,
    createdAt: "2026-08-26T09:00:00Z",
    title: "Review API rate limiting strategies",
    updatedAt: "2026-08-26T16:45:00Z",
    running: false,
  },
  {
    sessionId: "sess-deploy-1",
    agentId: "agent-deploy",
    type: "schedule_cron" as const,
    mode: "terminal" as const,
    createdAt: "2026-08-27T08:00:00Z",
    title: "Morning deploy check",
    updatedAt: "2026-08-27T08:12:00Z",
    running: false,
  },
  {
    sessionId: "sess-ci-1",
    agentId: "agent-ci",
    type: "regular" as const,
    mode: "terminal" as const,
    createdAt: "2026-08-27T11:00:00Z",
    title: "PR #412 integration tests",
    updatedAt: "2026-08-27T11:25:00Z",
    running: false,
  },
  {
    sessionId: "sess-docs-1",
    agentId: "agent-docs",
    type: "regular" as const,
    mode: "chat" as const,
    createdAt: "2026-08-27T09:30:00Z",
    title: "Update API reference docs",
    updatedAt: "2026-08-27T10:00:00Z",
    running: false,
  },
];

export function seedMockData(): void {
  queryClient.setDefaultOptions({
    queries: { staleTime: Infinity, retry: false, refetchOnMount: false },
  });

  queryClient.setQueryData(["agents", "list-with-channels"], {
    list: MOCK_AGENTS,
    availableChannels: [],
  });

  queryClient.setQueryData(["approvals", "owner"], []);

  for (const agent of MOCK_AGENTS.filter((a) => a.state === "running")) {
    queryClient.setQueryData(
      ["acp-sessions", agent.id, "home"],
      MOCK_SESSIONS.filter((s) => s.agentId === agent.id),
    );
  }

  queryClient.setQueryData(trpc.budgets.reserved.queryKey(), {
    cpu: { reservedMilli: 7000, ceilingMilli: 16000 },
    memory: { reservedBytes: 7 * 1024 ** 3, ceilingBytes: 16 * 1024 ** 3 },
  });

  setTimeout(() => {
    const updated = MOCK_AGENTS.map((a) =>
      a.id === "agent-review" ? { ...a, state: "running" as const } : a,
    );
    queryClient.setQueryData(["agents", "list-with-channels"], {
      list: updated,
      availableChannels: [],
    });
  }, 12_000);
}
