import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { AgentBindingField } from "@/modules/api-keys/components/create-api-key-dialog/agent-binding-field";

import { IDS } from "../../../backend/scenario";

type Args = ComponentProps<typeof AgentBindingField>;

const meta = {
  title: "Components/ApiKeys/AgentBindingField",
  component: AgentBindingField,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-lg">
        <Story />
      </div>
    ),
  ],
  args: {
    mode: "all",
    selectedAgentIds: new Set<string>(),
    onModeChange: fn(),
    onToggleAgent: fn(),
    lockedToAll: false,
    lockedReason: null,
  },
} satisfies Meta<typeof AgentBindingField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllAgents: Story = {};
/** Agent checkboxes list the fake backend's agents. */
export const SpecificAgents: Story = {
  args: {
    mode: "specific",
    selectedAgentIds: new Set<string>([IDS.codingAgent]),
  } satisfies Partial<Args>,
};
export const LockedByManageScope: Story = {
  args: { lockedToAll: true, lockedReason: "manage" },
};
export const LockedBySatelliteScope: Story = {
  args: { lockedToAll: true, lockedReason: "serve" },
};
