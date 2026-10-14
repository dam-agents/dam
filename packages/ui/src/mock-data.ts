import { queryClient } from "./query-client.js";
import type { AgentView, TemplateView } from "./types.js";

const MOCK_AGENTS: AgentView[] = [
  {
    id: "agent-research",
    name: "Research Agent",
    templateId: null,
    templateUpdate: null,
    image: "ghcr.io/dam-agents/claude-code:latest",
    description: "Deep research across codebases and documentation",
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "2", memory: "2Gi" },
    contributionFailures: [],
    channels: [],
    kbTemplateId: null,
    spawnedBy: null,
    features: { liveUpdates: true },
  },
  {
    id: "agent-deploy",
    name: "Deploy Bot",
    templateId: null,
    templateUpdate: null,
    image: "ghcr.io/dam-agents/claude-code:latest",
    description: "Handles CI/CD and deployment workflows",
    hibernationTimeoutMin: 0,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "4", memory: "4Gi" },
    contributionFailures: [],
    channels: [{ type: "slack", slackChannelId: "C0123DEPLOY", default: true }],
    kbTemplateId: null,
    spawnedBy: null,
    features: { liveUpdates: true },
  },
  {
    id: "agent-review",
    name: "Code Review",
    templateId: null,
    templateUpdate: null,
    image: "ghcr.io/dam-agents/claude-code:latest",
    description: "Reviews PRs and suggests improvements",
    hibernationTimeoutMin: 15,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "hibernated",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "2", memory: "2Gi" },
    contributionFailures: [],
    channels: [],
    kbTemplateId: null,
    spawnedBy: null,
    features: { liveUpdates: false },
  },
];

const MOCK_TEMPLATES: TemplateView[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    image: "quay.io/dam-agents/claude-code:latest",
    description: "Default Claude Code agent",
    category: "harness",
    tags: ["Anthropic"],
    experimental: false,
    vm: false,
  },
  {
    id: "codex",
    name: "Codex",
    image: "quay.io/dam-agents/codex:latest",
    description: "OpenAI Codex coding agent",
    category: "harness",
    tags: ["OpenAI"],
    experimental: false,
    vm: false,
  },
  {
    id: "pi-agent",
    name: "PI Agent",
    image: "quay.io/dam-agents/pi-agent:latest",
    description: "Pi coding agent with multi-LLM support",
    category: "harness",
    tags: ["Any provider"],
    experimental: false,
    vm: false,
  },
  {
    id: "bob",
    name: "IBM Bob",
    image: "quay.io/dam-agents/bob:latest",
    description: "Bob shell agent",
    category: "harness",
    tags: ["Anthropic", "Mistral", "Granite"],
    experimental: false,
    vm: false,
  },
  {
    id: "claude-code-vm",
    name: "Claude Code VM",
    image: "quay.io/dam-agents/claude-code-vm:latest",
    description: "Claude Code in a full VM — docker + k3s inside the sandbox",
    category: "harness",
    tags: ["Anthropic", "VM"],
    experimental: true,
    vm: true,
  },
  {
    id: "nous",
    name: "NOUS",
    image: "quay.io/dam-agents/nous:latest",
    description: "Nous hypothesis-driven experimentation agent",
    category: "preconfigured",
    tags: ["Any provider"],
    experimental: true,
    vm: false,
  },
  {
    id: "openevolve",
    name: "OpenEvolve",
    image: "quay.io/dam-agents/openevolve:latest",
    description: "OpenEvolve — evolutionary code-optimization agent",
    category: "preconfigured",
    tags: ["OpenAI-compatible"],
    experimental: true,
    vm: false,
  },
  {
    id: "shinkaevolve",
    name: "ShinkaEvolve",
    image: "quay.io/dam-agents/shinkaevolve:latest",
    description:
      "ShinkaEvolve — sample-efficient evolutionary program-optimization agent",
    category: "preconfigured",
    tags: ["OpenAI-compatible"],
    experimental: true,
    vm: false,
  },
  {
    id: "gepa",
    name: "GEPA",
    image: "quay.io/dam-agents/gepa:latest",
    description: "GEPA — reflective prompt & text-optimization agent",
    category: "preconfigured",
    tags: ["Any provider"],
    experimental: true,
    vm: false,
  },
  {
    id: "k-search",
    name: "K-Search",
    image: "quay.io/dam-agents/k-search:latest",
    description: "K-Search — LLM-driven GPU kernel optimization (Modal eval)",
    category: "preconfigured",
    tags: [],
    experimental: true,
    vm: false,
  },
  {
    id: "adaevolve",
    name: "AdaEvolve",
    image: "quay.io/dam-agents/skydiscover:latest",
    description:
      "AdaEvolve — multi-island adaptive code & algorithm optimization (SkyDiscover)",
    category: "preconfigured",
    tags: ["OpenAI-compatible"],
    experimental: true,
    vm: false,
  },
  {
    id: "evox",
    name: "EvoX",
    image: "quay.io/dam-agents/skydiscover:latest",
    description:
      "EvoX — self-evolving code & algorithm optimization (SkyDiscover)",
    category: "preconfigured",
    tags: ["OpenAI-compatible"],
    experimental: true,
    vm: false,
  },
];

const MOCK_CONNECTIONS = [
  {
    id: "conn-anthropic",
    name: "Anthropic",
    templateId: "anthropic",
    status: "ready",
    createdAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "conn-litellm",
    name: "IBM LiteLLM",
    templateId: "ibm-litellm",
    status: "ready",
    createdAt: "2026-08-01T00:00:00Z",
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
    running: true,
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

  queryClient.setQueryData(
    [["templates", "list"], { type: "query" }],
    MOCK_TEMPLATES,
  );

  queryClient.setQueryData(
    [["connections", "list"], { type: "query" }],
    MOCK_CONNECTIONS,
  );

  queryClient.setQueryData(
    [["connections", "listTemplates"], { type: "query" }],
    [],
  );

  queryClient.setQueryData([["features", "flags"], { type: "query" }], {
    "vm-sandboxes": false,
  });

  for (const agent of MOCK_AGENTS.filter((a) => a.state === "running")) {
    queryClient.setQueryData(
      ["acp-sessions", agent.id, "home"],
      MOCK_SESSIONS.filter((s) => s.agentId === agent.id),
    );
  }
}
