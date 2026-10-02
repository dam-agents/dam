import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { AgentStoppedCallout } from "../../../modules/agents/components/agent-stopped-callout.js";

const meta = {
  title: "Components/Agents/AgentStoppedCallout",
  component: AgentStoppedCallout,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
  ],
  args: {
    comingUp: false,
    onStart: fn(),
    children:
      "— its skills are read-only until it runs again. Start the agent to change them.",
  },
} satisfies Meta<typeof AgentStoppedCallout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As the Skills tab shows it. */
export const Skills: Story = {};

/** As the schedule results modal shows it. */
export const ScheduleResults: Story = {
  args: { children: "— Start the agent to see runs." },
};

export const Starting: Story = { args: { comingUp: true } };
