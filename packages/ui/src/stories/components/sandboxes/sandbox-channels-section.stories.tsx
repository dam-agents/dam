import type { Meta, StoryObj } from "@storybook/react-vite";

import { SandboxChannelsSection } from "@/modules/sandboxes/components/sandbox-channels-section";

import { IDS } from "../../backend/scenario";

/** The fixture install offers Slack only, so only the Slack card shows. */
const meta = {
  title: "Components/Sandboxes/SandboxChannelsSection",
  component: SandboxChannelsSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[760px]">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.slackAgent },
} satisfies Meta<typeof SandboxChannelsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};
export const NoChannels: Story = { args: { agentId: IDS.codingAgent } };
