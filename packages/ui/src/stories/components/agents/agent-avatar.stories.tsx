import type { Meta, StoryObj } from "@storybook/react-vite";

import { AgentAvatar } from "../../../modules/agents/components/avatar/agent-avatar.js";
import { AGENTS } from "../../backend/fixtures/agents";

const meta = {
  title: "Components/Agents/AgentAvatar",
  component: AgentAvatar,
  parameters: { layout: "centered" },
  args: { name: AGENTS[0]!.name, size: 64 },
} satisfies Meta<typeof AgentAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Awake: Story = {};
export const Sleeping: Story = { args: { sleeping: true } };
export const Stopped: Story = { args: { stopped: true } };
export const Large: Story = { args: { size: 128 } };

export const EveryFixtureAgent: Story = {
  render: (args) => (
    <div className="flex items-end gap-6">
      {AGENTS.map((a) => (
        <div key={a.id} className="flex flex-col items-center gap-2">
          <AgentAvatar {...args} name={a.name} />
          <span className="text-sm text-muted-foreground">{a.name}</span>
        </div>
      ))}
    </div>
  ),
};
