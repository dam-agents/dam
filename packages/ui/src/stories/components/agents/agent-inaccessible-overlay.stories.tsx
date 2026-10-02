import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { AgentInaccessibleOverlay } from "../../../modules/agents/components/agent-inaccessible-overlay.js";

const meta = {
  title: "Components/Agents/AgentInaccessibleOverlay",
  component: AgentInaccessibleOverlay,
  decorators: [
    (Story) => (
      <div className="relative h-screen">
        <Story />
      </div>
    ),
  ],
  args: { onLeave: fn() },
} satisfies Meta<typeof AgentInaccessibleOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
