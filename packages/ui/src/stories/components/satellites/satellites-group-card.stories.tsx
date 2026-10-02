import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SatellitesGroupCard } from "@/modules/satellites/components/satellites-group-card";

import { IDS } from "../../backend/scenario";
import { SATELLITES } from "./sample-satellites";

const meta = {
  title: "Components/Satellites/SatellitesGroupCard",
  component: SatellitesGroupCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { satellites: SATELLITES, onRemove: fn() },
} satisfies Meta<typeof SatellitesGroupCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithCount: Story = { args: { showCount: true } };
export const Removing: Story = { args: { removingName: "laptop" } };

/** In an agent's connection list: grant controls per satellite. */
export const InAgent: Story = {
  args: {
    grant: (s) => ({
      granted: s.grantedAgentIds.includes(IDS.codingAgent),
      onToggle: fn(),
    }),
    onRemove: undefined,
  },
};
