import type { AgentView } from "../../types.js";

const AGENT_IDS = {
  codexResearch: "a1b2c3d4-0001-4000-8000-000000000001",
  geminiPipeline: "a1b2c3d4-0003-4000-8000-000000000003",
  knowledgeBase: "a1b2c3d4-0004-4000-8000-000000000004",
  experiment1: "a1b2c3d4-0005-4000-8000-000000000005",
  experiment2: "a1b2c3d4-0006-4000-8000-000000000006",
  knowledgeBase2: "a1b2c3d4-0007-4000-8000-000000000007",
};

export { AGENT_IDS };

export const agents: AgentView[] = [
  {
    id: AGENT_IDS.codexResearch,
    spawnedBy: null,
    name: "ci-pipeline",
    templateId: "codex",
    templateUpdate: null,
    image: "ghcr.io/openai/codex:latest",
    description:
      "Runs integration tests, builds Docker images, and deploys to staging",

    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    error: undefined,
    stopRequested: false,
    overBudget: false,
    overBudgetMessage: undefined,
    size: { cpu: "2000m", memory: "2Gi" },
    podTerminationReason: undefined,
    contributionFailures: [],
    channels: [],

    kind: undefined,
    kbTemplateId: null,
    features: { liveUpdates: true },
  },
  {
    id: AGENT_IDS.geminiPipeline,
    spawnedBy: null,
    name: "security-scanner",
    templateId: "gemini-cli",
    templateUpdate: null,
    image: "ghcr.io/google/gemini-cli:latest",
    description:
      "Scans repositories for vulnerabilities, outdated dependencies, and secret leaks",

    hibernationTimeoutMin: 60,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "hibernated",
    error: undefined,
    stopRequested: false,
    overBudget: false,
    overBudgetMessage: undefined,
    size: { cpu: "1000m", memory: "1Gi" },
    podTerminationReason: undefined,
    contributionFailures: [],
    channels: [{ type: "slack", slackChannelId: "#security-alerts" }],

    kind: undefined,
    kbTemplateId: null,
    features: { liveUpdates: true },
  },
  {
    id: AGENT_IDS.knowledgeBase,
    spawnedBy: null,
    name: "docs-builder",
    templateId: "claude-code",
    templateUpdate: null,
    image: "ghcr.io/anthropic/claude-code:latest",
    description:
      "Generates and maintains API documentation from source code and inline comments",

    hibernationTimeoutMin: 45,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    error: undefined,
    stopRequested: false,
    overBudget: false,
    overBudgetMessage: undefined,
    size: { cpu: "2000m", memory: "2Gi" },
    podTerminationReason: undefined,
    contributionFailures: [],
    channels: [],

    kind: undefined,
    kbTemplateId: null,
    features: { liveUpdates: true },
  },
];
