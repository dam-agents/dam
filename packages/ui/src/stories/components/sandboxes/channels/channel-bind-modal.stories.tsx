import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ChannelBindModal } from "@/modules/sandboxes/components/channels/channel-bind-modal";

const meta = {
  title: "Components/Sandboxes/Channels/ChannelBindModal",
  component: ChannelBindModal,
  args: { messengers: ["slack"], onClose: fn() },
} satisfies Meta<typeof ChannelBindModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slack: Story = {};

/** The fixture install has no Telegram bot, so the "Open @bot" button is absent. */
export const Telegram: Story = { args: { messengers: ["telegram"] } };

/** Both messengers picked at setup: a two-step walkthrough. */
export const SlackThenTelegram: Story = {
  args: { messengers: ["slack", "telegram"] },
};
