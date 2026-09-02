import type { AgentView } from "../../types.js";

const AGENT_IDS = {
  agent1: "a1b2c3d4-0001-4000-8000-000000000001",
  agent2: "a1b2c3d4-0002-4000-8000-000000000002",
  agent3: "a1b2c3d4-0003-4000-8000-000000000003",
  agent4: "a1b2c3d4-0004-4000-8000-000000000004",
  agent5: "a1b2c3d4-0005-4000-8000-000000000005",
  agent6: "a1b2c3d4-0006-4000-8000-000000000006",
};

export { AGENT_IDS };

const base: Omit<
  AgentView,
  "id" | "name" | "description" | "state" | "hibernationTimeoutMin" | "size"
> = {
  spawnedBy: null,
  templateId: "claude-code",
  templateUpdate: null,
  image: "ghcr.io/anthropics/claude-code:latest",
  grantedSecretIds: [],
  grantedConnectionIds: [],
  error: undefined,
  stopRequested: false,
  overBudget: false,
  overBudgetMessage: undefined,
  podTerminationReason: undefined,
  contributionFailures: [],
  channels: [],
  kind: undefined,
  kbTemplateId: null,
  features: { liveUpdates: true },
};

export const agents: AgentView[] = [
  {
    ...base,
    id: AGENT_IDS.agent1,
    name: "brand-asset-generator",
    description:
      "Generates brand assets, social media graphics, and marketing collateral",
    state: "running",
    hibernationTimeoutMin: 60,
    size: { cpu: "1000m", memory: "1Gi" },
  },
  {
    ...base,
    id: AGENT_IDS.agent2,
    name: "photo-retouching",
    description:
      "Batch photo retouching, background removal, and color grading",
    state: "running",
    hibernationTimeoutMin: 0,
    size: { cpu: "1000m", memory: "1Gi" },
  },
  {
    ...base,
    id: AGENT_IDS.agent3,
    name: "brand-guidelines",
    description:
      "Living brand guidelines — colors, typography, logo usage, tone of voice",
    state: "running",
    hibernationTimeoutMin: 0,
    size: { cpu: "1000m", memory: "1Gi" },
  },
  {
    ...base,
    id: AGENT_IDS.agent4,
    name: "packaging-layouts",
    description: "Creates packaging mockups and print-ready layout files",
    state: "hibernated",
    hibernationTimeoutMin: 60,
    size: { cpu: "1000m", memory: "1Gi" },
  },
  {
    ...base,
    id: AGENT_IDS.agent5,
    name: "color-palette-testing",
    description: "Testing color palette variations for the spring campaign",
    state: "hibernated",
    hibernationTimeoutMin: 60,
    size: { cpu: "1000m", memory: "1Gi" },
  },
  {
    ...base,
    id: AGENT_IDS.agent6,
    name: "font-pairing-eval",
    description: "Evaluating font pairings for the website redesign",
    state: "hibernated",
    hibernationTimeoutMin: 60,
    size: { cpu: "1000m", memory: "1Gi" },
  },
];
