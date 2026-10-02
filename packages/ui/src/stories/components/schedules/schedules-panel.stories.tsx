import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SchedulesPanel } from "@/modules/schedules/components/schedules-panel";

import { IDS } from "../../backend/scenario";

const meta = {
  title: "Components/Schedules/SchedulesPanel",
  component: SchedulesPanel,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.codingAgent, onResumeSession: fn() },
} satisfies Meta<typeof SchedulesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSchedules: Story = {};
/** The fresh agent has no schedules. */
export const Empty: Story = { args: { agentId: IDS.freshAgent } };
