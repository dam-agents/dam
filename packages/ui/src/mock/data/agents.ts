import type { AgentView } from "../../types.js";

const AGENT_IDS = {
  codexResearch: "a1b2c3d4-0001-4000-8000-000000000001",
  claudeCodeMain: "a1b2c3d4-0002-4000-8000-000000000002",
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
];
