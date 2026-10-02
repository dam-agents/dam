import type { Meta, StoryObj } from "@storybook/react-vite";

import { TelegramChannelCard } from "@/modules/sandboxes/components/channels/telegram-channel-card";

import { IDS } from "../../../backend/scenario";

/** The fixture install has no Telegram bot and no bound chats, so this shows
 *  the empty state with the generic bot wording. */
const meta = {
  title: "Components/Sandboxes/Channels/TelegramChannelCard",
  component: TelegramChannelCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof TelegramChannelCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoChats: Story = {};
