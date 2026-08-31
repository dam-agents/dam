import { useState } from "react";

import { PageHeader } from "@/components/ui/page-header";

import type { AgentView } from "../../../types.js";
import { AgentCard } from "../components/agent-card.js";
import { AgentRow } from "../components/agent-row.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";

const SAMPLE_AGENTS: AgentView[] = [
  {
    id: "code-1",
    name: "Frontend Engineer",
    templateId: "claude-code",
    templateUpdate: null,
    features: { liveUpdates: true },
    image: "claude-code:latest",
    description: "Builds and maintains the React UI",
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "2", memory: "2Gi" },
    contributionFailures: [],
    channels: [
      { type: "slack", slackChannelId: "frontend-dev", ambient: false },
    ],
    kbTemplateId: null,
    spawnedBy: null,
  },
  {
    id: "code-2",
    name: "Backend API Agent",
    templateId: "claude-code",
    templateUpdate: null,
    features: { liveUpdates: true },
    image: "claude-code:latest",
    description: "Handles API server changes and migrations",
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "4", memory: "4Gi" },
    contributionFailures: [],
    channels: [
      { type: "slack", slackChannelId: "backend-eng", ambient: true },
      { type: "slack", slackChannelId: "incidents", ambient: false },
    ],
    kbTemplateId: null,
    spawnedBy: null,
  },
  {
    id: "code-3",
    name: "Infra Bot",
    templateId: "claude-code",
    templateUpdate: null,
    features: { liveUpdates: true },
    image: "claude-code:latest",
    description: "Manages Terraform and Helm charts",
    hibernationTimeoutMin: 60,
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
  },
  {
    id: "code-4",
    name: "Test Runner",
    templateId: "claude-code",
    templateUpdate: null,
    features: { liveUpdates: true },
    image: "claude-code:latest",
    description: "Runs and fixes failing test suites",
    hibernationTimeoutMin: 15,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "2", memory: "2Gi" },
    contributionFailures: [],
    channels: [{ type: "slack", slackChannelId: "ci-alerts", ambient: true }],
    kbTemplateId: null,
    spawnedBy: null,
  },
  {
    id: "kb-1",
    name: "Platform Docs",
    templateId: null,
    templateUpdate: null,
    features: { liveUpdates: false },
    image: "kb-base:latest",
    description: "Architecture docs and runbooks",
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "1", memory: "1Gi" },
    contributionFailures: [],
    channels: [
      { type: "slack", slackChannelId: "ask-platform", ambient: false },
    ],
    kbTemplateId: "docs",
    spawnedBy: null,
    kind: "knowledge-base",
  },
  {
    id: "kb-2",
    name: "HR Policy Bot",
    templateId: null,
    templateUpdate: null,
    features: { liveUpdates: false },
    image: "kb-base:latest",
    description: "Employee handbook and benefits info",
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "hibernated",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "1", memory: "1Gi" },
    contributionFailures: [],
    channels: [],
    kbTemplateId: "docs",
    spawnedBy: null,
    kind: "knowledge-base",
  },
  {
    id: "kb-3",
    name: "Security Runbooks",
    templateId: null,
    templateUpdate: null,
    features: { liveUpdates: false },
    image: "kb-base:latest",
    description: "Incident response and compliance procedures",
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "1", memory: "1Gi" },
    contributionFailures: [],
    channels: [
      { type: "slack", slackChannelId: "security-ops", ambient: true },
      { type: "slack", slackChannelId: "incident-response", ambient: false },
    ],
    kbTemplateId: "docs",
    spawnedBy: null,
    kind: "knowledge-base",
  },
];

const NO_IDS: ReadonlySet<string> = new Set();
const noop = () => {};

export function SlackCardsPreviewView() {
  const [showNew, setShowNew] = useState(true);

  return (
    <div>
      <PageHeader
        title="Agent Cards — Slack Discovery"
        description="Preview of agent cards with Slack channel indicators. Toggle to compare with the current row layout."
      />

      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowNew(false)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            !showNew
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Current rows
        </button>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            showNew
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          New cards
        </button>
      </div>

      {showNew ? (
        <div className="flex flex-col gap-3">
          {SAMPLE_AGENTS.map((agent) => {
            const display = resolveAgentDisplay(agent, NO_IDS);
            const subtitle =
              agent.kind === "knowledge-base" ? "Knowledge base" : agent.image;
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                display={display}
                subtitle={subtitle}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {SAMPLE_AGENTS.map((agent) => {
            const display = resolveAgentDisplay(agent, NO_IDS);
            const subtitle =
              agent.kind === "knowledge-base" ? "Knowledge base" : agent.image;
            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                display={display}
                subtitle={subtitle}
                deletePending={false}
                updatePending={false}
                updateBusy={false}
                onSelect={noop}
                onUpdate={noop}
                onConfigure={noop}
                configureLabel="Configure"
                onWake={noop}
                onRestart={noop}
                onPause={noop}
                onStop={noop}
                onDelete={noop}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
