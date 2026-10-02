import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ChannelRow } from "@/modules/sandboxes/components/channels/channel-row";

const meta = {
  title: "Components/Sandboxes/Channels/ChannelRow",
  component: ChannelRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "#help-platform",
    actionsLabel: "Slack channel #help-platform actions",
    actions: (
      <>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem tone="danger">Disconnect</DropdownMenuItem>
      </>
    ),
  },
} satisfies Meta<typeof ChannelRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Title only, as a bound Telegram chat renders. */
export const TitleOnly: Story = {};

/** A Slack channel row: default badge plus ambient subtitle. */
export const WithBadgeAndSubtitle: Story = {
  args: {
    badge: (
      <Badge variant="muted" className="shrink-0">
        Default
      </Badge>
    ),
    subtitle: "Ambient off",
  },
};
