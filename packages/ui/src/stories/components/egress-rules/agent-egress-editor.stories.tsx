import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { AgentEgressEditor } from "@/modules/egress-rules/components/agent-egress-editor";

import { CONNECTIONS } from "../../backend/fixtures/connections";
import { IDS } from "../../backend/scenario";

const meta = {
  title: "Components/EgressRules/AgentEgressEditor",
  component: AgentEgressEditor,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-4xl">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.codingAgent, currentPreset: "trusted" },
} satisfies Meta<typeof AgentEgressEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Trusted preset plus hand-added and inbox-approved rules. */
export const Live: Story = {};

/** Preset "none" with two owner rules. */
export const NoPreset: Story = {
  args: { agentId: IDS.hibernatedAgent, currentPreset: "none" },
};

type Staged = NonNullable<ComponentProps<typeof AgentEgressEditor>["staged"]>;

const slack = CONNECTIONS.find((c) => c.id === "conn-slack")!;

/** Inside the agent settings form: changes are staged until saved. The staged
 *  delete targets the agent's last fixture rule, loaded from the backend. */
export const StagedChanges: Story = {
  loaders: [
    async () => ({
      rules: await api.egressRules.listForAgent.query({
        agentId: IDS.codingAgent,
      }),
    }),
  ],
  render: (args, { loaded }) => {
    const { rules } = loaded as {
      rules: Awaited<ReturnType<typeof api.egressRules.listForAgent.query>>;
    };
    const staged: Staged = {
      preset: null,
      setPreset: fn(),
      pendingDeletes: new Set(rules.slice(-1).map((r) => r.id)),
      togglePendingDelete: fn(),
      pendingAdds: [
        {
          tempId: "pending-1",
          host: "api.stripe.com",
          method: "GET",
          pathPattern: "/v1/charges",
          verdict: "deny",
        },
      ],
      appendPendingAdd: fn(),
      removePendingAdd: fn(),
      pendingConnectionGrants: slack.hosts.map((host) => ({
        connectionId: slack.id,
        host,
        label: slack.name,
      })),
      pendingConnectionRevokes: new Set(),
      connectionLabels: new Map(CONNECTIONS.map((c) => [c.id, c.name])),
    };
    return <AgentEgressEditor {...args} staged={staged} />;
  },
};

/** Staged switch to "Allow everything", previewing the preset's rows. */
export const StagedPresetChange: Story = {
  args: {
    staged: {
      preset: "all",
      setPreset: fn(),
      pendingDeletes: new Set(),
      togglePendingDelete: fn(),
      pendingAdds: [],
      appendPendingAdd: fn(),
      removePendingAdd: fn(),
      pendingConnectionGrants: [],
      pendingConnectionRevokes: new Set(),
      connectionLabels: new Map(CONNECTIONS.map((c) => [c.id, c.name])),
    },
  },
};
