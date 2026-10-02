import { ChannelType } from "api-server-api";

import { at, type PlatformOutput } from "../platform";
import { ago, IDS, whenPopulated } from "../scenario";
import { NotFound } from "../trpc-server";

type AgentView = PlatformOutput<"agents.list">[number];

const IMAGE = {
  claude: "quay.io/dam-agents/claude-code:latest",
  codex: "quay.io/dam-agents/codex:latest",
  pi: "quay.io/dam-agents/pi-agent:latest",
};

function agent(
  over: Partial<AgentView> & Pick<AgentView, "id" | "name">,
): AgentView {
  return {
    spawnedBy: null,
    createdAt: ago(60 * 24 * 12),
    templateId: "claude-code",
    templateUpdate: null,
    features: { liveUpdates: true },
    image: IMAGE.claude,
    description: undefined,
    env: [],
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: ["conn-github", "conn-anthropic"],
    state: "running",
    error: undefined,
    stopRequested: false,
    overBudget: false,
    overBudgetMessage: undefined,
    size: { cpu: "2", memory: "2Gi" },
    podTerminationReason: undefined,
    podRestarts: 0,
    podRestartReason: undefined,
    contributionFailures: [],
    unsupportedContributionKinds: [],
    workspaceFailures: [],
    channels: [],
    kind: undefined,
    kbTemplateId: null,
    vm: false,
    runtimeMigration: null,
    runtimeMigratable: false,
    starterKit: null,
    starterKitOnboarded: null,
    ...over,
  };
}

export const AGENTS: AgentView[] = [
  agent({
    id: IDS.codingAgent,
    name: "checkout-service",
    description: "Payments and checkout API",
  }),
  agent({
    id: IDS.kbAgent,
    name: "platform-docs",
    kind: "knowledge-base",
    templateId: "claude-code",
    kbTemplateId: "llm-wiki",
    description: "Knowledge base over the platform docs and ADRs",
    createdAt: ago(60 * 24 * 30),
  }),
  agent({
    id: IDS.slackAgent,
    name: "triage-bot",
    templateId: "codex",
    image: IMAGE.codex,
    description: "Answers support questions in #help-platform",
    grantedConnectionIds: ["conn-github", "conn-openai"],
    channels: [
      {
        type: ChannelType.Slack,
        slackChannelId: "C07HELPPLAT",
        teamId: "T01ACME",
        name: "help-platform",
        default: true,
      },
    ],
  }),
  agent({
    id: IDS.hibernatedAgent,
    name: "data-pipeline",
    templateId: "pi-agent",
    image: IMAGE.pi,
    state: "hibernated",
    createdAt: ago(60 * 24 * 45),
  }),
  agent({
    id: IDS.freshAgent,
    name: "onboarding-helper",
    createdAt: ago(5),
    size: { cpu: "1", memory: "2Gi" },
    grantedConnectionIds: ["conn-anthropic"],
  }),
];

const agents = () => whenPopulated(AGENTS, []);

export const agentEntries = [
  at("agents.list", agents),
  at("agents.get", ({ id }) => {
    const found = agents().find((a) => a.id === id);
    if (!found) throw new NotFound();
    return found;
  }),
  at("agents.backgroundWork", () => []),
  // Waking is a no-op here so the hibernated story stays hibernated.
  at("agents.wake", ({ id }) => {
    const found = agents().find((a) => a.id === id);
    if (!found) throw new NotFound();
    return found;
  }),
];
