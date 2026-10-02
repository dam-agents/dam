import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { AgentRow } from "../../../modules/agents/components/agent-row.js";
import { useAgentRows } from "../../../modules/agents/hooks/use-agent-rows.js";
import { IDS } from "../../backend/scenario";
import {
  codingAgent,
  displayOf,
  fixtureAgent,
  seedAgents,
  seedFlags,
  seedVmRuntime,
} from "./story-helpers";

type Props = ComponentProps<typeof AgentRow>;

/** Leaves every prop to the story except an empty `subtitle`, which is filled
 *  in the way the home list fills it (`useAgentRows().rowProps`). */
function AgentRowStory(props: Props) {
  const { rowProps } = useAgentRows();
  return (
    <AgentRow
      {...props}
      subtitle={props.subtitle || rowProps(props.agent).subtitle}
    />
  );
}

const running = codingAgent();

const meta = {
  title: "Components/Agents/AgentRow",
  component: AgentRow,
  parameters: { layout: "padded" },
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="max-w-[880px]">
        <Story />
      </div>
    ),
  ],
  render: (args) => <AgentRowStory {...args} />,
  args: {
    agent: running,
    display: displayOf(running),
    subtitle: "",
    deletePending: false,
    updatePending: false,
    updateBusy: false,
    migratePending: false,
    migrationControlsBusy: false,
    configureLabel: "Configure agent",
    messengers: { slack: true },
    onSelect: fn(),
    onUpdate: fn(),
    onMigrate: fn(),
    onAbortMigration: fn(),
    onRetryMigration: fn(),
    onConfigure: fn(),
    onShare: fn(),
    onWake: fn(),
    onRestart: fn(),
    onPause: fn(),
    onStop: fn(),
    onDelete: fn(),
    onAddToChannel: fn(),
  },
} satisfies Meta<typeof AgentRow>;

export default meta;
type Story = StoryObj<typeof meta>;

function withAgent(
  agent: Props["agent"],
  opts?: Parameters<typeof displayOf>[1],
) {
  return { agent, display: displayOf(agent, opts) };
}

export const Running: Story = {};

export const Working: Story = { args: { working: true } };

/** With the "agent-avatars" feature flag on. */
export const WithAvatar: Story = {
  loaders: [() => (seedFlags({ "agent-avatars": true }), {})],
};

export const SleepingWithAvatar: Story = {
  loaders: WithAvatar.loaders,
  args: withAgent(fixtureAgent(IDS.hibernatedAgent)),
};

export const StoppedWithAvatar: Story = {
  loaders: WithAvatar.loaders,
  args: withAgent(codingAgent({ state: "hibernated", stopRequested: true })),
};

const hibernated = fixtureAgent(IDS.hibernatedAgent);
export const Hibernated: Story = { args: withAgent(hibernated) };

export const Hibernating: Story = {
  args: withAgent(running, { pausing: true }),
};

export const Starting: Story = {
  args: withAgent(codingAgent({ state: "starting" })),
};

export const Restarting: Story = {
  args: withAgent(running, { restarting: true }),
};

export const PreparingWorkspace: Story = {
  args: withAgent(codingAgent({ state: "preparing_workspace" })),
};

export const ErrorState: Story = {
  args: withAgent(
    codingAgent({
      state: "error",
      error: "Back-off restarting failed container harness",
      podTerminationReason: "OOMKilled",
      podRestarts: 4,
    }),
  ),
};

export const OverBudget: Story = {
  args: withAgent(
    codingAgent({
      state: "hibernated",
      overBudget: true,
      overBudgetMessage:
        "starting it needs 2 CPU / 2 GiB, and only 1 CPU / 1 GiB of your budget is free",
    }),
  ),
};

export const Stopped: Story = {
  args: withAgent(codingAgent({ state: "hibernated", stopRequested: true })),
};

export const AlwaysOn: Story = {
  args: withAgent(codingAgent({ hibernationTimeoutMin: 0 })),
};

export const UpdateAvailable: Story = {
  args: withAgent(
    codingAgent({
      templateUpdate: {
        fromImage: running.image.replace(":latest", ":1.4.2"),
        toImage: running.image.replace(":latest", ":1.5.0"),
      },
    }),
  ),
};

export const Updating: Story = {
  args: {
    ...UpdateAvailable.args,
    updatePending: true,
    updateBusy: true,
  },
};

export const KnowledgeBase: Story = {
  args: withAgent(fixtureAgent(IDS.kbAgent)),
};

export const WithSlackChannel: Story = {
  args: withAgent(fixtureAgent(IDS.slackAgent)),
};

export const FromStarterKit: Story = {
  args: withAgent(
    codingAgent({ starterKit: `${IDS.kitCatalog}/${IDS.kit}@1.2.0` }),
  ),
};

export const InstallFailures: Story = {
  args: withAgent(
    codingAgent({
      contributionFailures: [
        { kind: "skill", message: "code-review: SKILL.md missing frontmatter" },
      ],
      workspaceFailures: [
        {
          kind: "workspace-command",
          error: "pnpm install exited with code 1",
          settled: true,
          attempts: 3,
          maxAttempts: 3,
        },
      ],
    }),
  ),
};

export const MissingConfig: Story = {
  args: withAgent(
    codingAgent({ unsupportedContributionKinds: ["skill", "mcp-server"] }),
  ),
};

export const WithTemporaryAgents: Story = {
  args: { temporaryDraw: { count: 2, cpuMilli: 2000, memoryMi: 4096 } },
};

export const OldRuntimeMigratable: Story = {
  loaders: [() => (seedVmRuntime(true), {})],
  args: withAgent(codingAgent({ runtimeMigratable: true })),
};

export const Migrating: Story = {
  loaders: [() => (seedVmRuntime(true), {})],
  args: withAgent(
    codingAgent({
      state: "migrating",
      runtimeMigration: {
        phase: "copying",
        abortable: true,
        retryable: false,
      },
    }),
  ),
};

export const MigrationFailed: Story = {
  loaders: [() => (seedVmRuntime(true), {})],
  args: withAgent(
    codingAgent({
      state: "error",
      runtimeMigration: {
        phase: "failed",
        message: "copy job timed out after 10m",
        attempts: 1,
        abortable: true,
        retryable: true,
      },
    }),
  ),
};
