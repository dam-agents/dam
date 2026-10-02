import type { Meta, StoryObj } from "@storybook/react-vite";

import { AgentAvatar } from "@/modules/agents/components/avatar/agent-avatar";
import { SpendBar } from "@/modules/metrics/components/spend-bar";
import { seriesColor } from "@/modules/metrics/lib/series-color";

import { AGENTS } from "../../backend/fixtures/agents";

const agent = AGENTS[0]?.name ?? "agent";

const meta = {
  title: "Components/Metrics/SpendBar",
  component: SpendBar,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[720px]">
        <Story />
      </div>
    ),
  ],
  args: {
    label: "claude-sonnet-4-5",
    value: "$42.18",
    pct: 100,
    color: seriesColor(0),
  },
} satisfies Meta<typeof SpendBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Largest: Story = {};
export const Partial: Story = {
  args: { pct: 38, value: "$16.02", color: seriesColor(1) },
};
/** Tiny shares keep an 8px minimum so they stay visible. */
export const Tiny: Story = {
  args: { pct: 0.4, value: "$0.17", color: seriesColor(2) },
};
export const Zero: Story = { args: { pct: 0, value: "$0.00" } };
export const WithCaption: Story = {
  args: { caption: "1.2M → 84K" },
};
export const WithIcon: Story = {
  args: {
    label: agent,
    icon: <AgentAvatar name={agent} size={16} />,
    value: "$12.40",
    pct: 64,
  },
};
