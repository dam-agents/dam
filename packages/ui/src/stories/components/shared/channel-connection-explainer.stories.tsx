import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import {
  SlackAccountExplainer,
  SlackChannelExplainer,
} from "@/components/channel-connection-explainer";

const meta = {
  title: "Components/Shared/ChannelConnectionExplainer",
  component: SlackChannelExplainer,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-h-[320px] items-center p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SlackChannelExplainer>;

export default meta;
type Story = StoryObj<typeof meta>;

const hoverTrigger: Story["play"] = async ({ canvasElement }) => {
  await userEvent.hover(within(canvasElement).getByRole("button"));
};

export const SlackChannel: Story = {
  args: { onGoToConnections: fn() },
  play: hoverTrigger,
};

/** Without a handler the cross-link renders as plain text. */
export const SlackChannelNoLink: Story = { play: hoverTrigger };

export const SlackAccount: Story = {
  render: () => <SlackAccountExplainer onGoToChannels={fn()} />,
  play: hoverTrigger,
};
