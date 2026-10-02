import type { Meta, StoryObj } from "@storybook/react-vite";

import { SlackChannelExplainer } from "@/components/channel-connection-explainer";
import { Badge } from "@/components/ui/badge";
import { ChannelCard } from "@/modules/sandboxes/components/channels/channel-card";

const meta = {
  title: "Components/Sandboxes/Channels/ChannelCard",
  component: ChannelCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    iconSlug: "slack",
    title: "Slack Channel",
    children: (
      <div className="px-4 py-4">
        <p className="text-sm text-muted-foreground">
          No channels connected yet. Mentions of the bot in a connected channel
          drive this agent.
        </p>
      </div>
    ),
  },
} satisfies Meta<typeof ChannelCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slack: Story = {};

export const Telegram: Story = {
  args: { iconSlug: "telegram", title: "Telegram Chat" },
};

/** The shell with both optional slots filled. */
export const WithAccessoryAndHeaderRight: Story = {
  args: {
    titleAccessory: <SlackChannelExplainer />,
    headerRight: <Badge variant="muted">1 connected</Badge>,
  },
};
