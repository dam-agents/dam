import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import type { AgentView } from "@/types";

import { AgentUnavailableOverlay } from "../../../modules/agents/components/agent-unavailable-overlay.js";
import { IDS } from "../../backend/scenario";
import {
  codingAgent,
  displayOf,
  fixtureAgent,
  seedAgents,
  seedFlags,
} from "./story-helpers";

/** Covers the chat while the agent can't take messages, one face per state. */
const meta = {
  title: "Components/Agents/AgentUnavailableOverlay",
  component: AgentUnavailableOverlay,
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="relative h-screen">
        <Story />
      </div>
    ),
  ],
  args: { agent: null, display: null, name: codingAgent().name, onBack: fn() },
} satisfies Meta<typeof AgentUnavailableOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

const of = (agent: AgentView, opts?: Parameters<typeof displayOf>[1]) => ({
  agent,
  display: displayOf(agent, opts),
});

export const Loading: Story = {};

/** A running agent whose connection dropped. */
export const Reconnecting: Story = { args: of(codingAgent()) };

export const Starting: Story = {
  args: of(codingAgent({ state: "starting" })),
};

/** With the "agent-avatars" flag on, starting shows the agent's head. */
export const StartingWithAvatar: Story = {
  loaders: [() => (seedFlags({ "agent-avatars": true }), {})],
  args: of(codingAgent({ state: "starting" })),
};

export const PreparingWorkspace: Story = {
  args: of(codingAgent({ state: "preparing_workspace" })),
};

export const PreparingWorkspaceRetrying: Story = {
  args: of(
    codingAgent({
      state: "preparing_workspace",
      workspaceFailures: [
        {
          kind: "workspace-seed",
          error: "git clone: could not resolve host github.com",
          settled: false,
          attempts: 2,
          maxAttempts: 3,
        },
      ],
    }),
  ),
};

export const Hibernating: Story = {
  args: of(codingAgent(), { pausing: true }),
};

export const Hibernated: Story = {
  args: of(fixtureAgent(IDS.hibernatedAgent)),
};

export const ErrorState: Story = {
  args: of(
    codingAgent({
      state: "error",
      error: "The harness exited during startup.",
      podTerminationReason: "OOMKilled",
    }),
  ),
};

export const OverBudget: Story = {
  args: of(
    codingAgent({
      state: "hibernated",
      overBudget: true,
      overBudgetMessage:
        "starting it needs 2 CPU / 2 GiB, and only 1 CPU / 1 GiB of your budget is free",
    }),
  ),
};

export const Migrating: Story = {
  args: of(
    codingAgent({
      state: "migrating",
      runtimeMigration: { phase: "copying", abortable: true, retryable: false },
    }),
  ),
};
