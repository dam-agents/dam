import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { AmbientModeCard } from "@/modules/sandboxes/components/channels/ambient-mode-card";

const meta = {
  title: "Components/Sandboxes/Channels/AmbientModeCard",
  component: AmbientModeCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-lg">
        <Story />
      </div>
    ),
  ],
  args: {
    checked: false,
    onChange: fn(),
    // Copy the Slack channel modal passes in.
    children:
      "The agent reads along in the channel and may chime in without being mentioned when it can clearly help. It is set per agent, so other agents in the channel are unaffected, and it can be turned off anytime — here or with the in-chat ambient command.",
  },
} satisfies Meta<typeof AmbientModeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
