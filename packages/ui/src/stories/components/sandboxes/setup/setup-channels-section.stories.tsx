import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SetupChannelsSection } from "@/modules/sandboxes/components/setup/setup-channels-section";

/** Only messengers the install offers are listed; the fixture install offers
 *  Slack only. */
const meta = {
  title: "Components/Sandboxes/Setup/SetupChannelsSection",
  component: SetupChannelsSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    value: { slack: false, telegram: false },
    onChange: fn(),
    onGoToConnections: fn(),
  },
} satisfies Meta<typeof SetupChannelsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const SlackChecked: Story = {
  args: { value: { slack: true, telegram: false } },
};
