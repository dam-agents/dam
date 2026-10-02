import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { UndeliveredNotice } from "../../../modules/sessions/components/undelivered-notice.js";
import { QUEUE_FULL_REASON, undeliveredMessage } from "./chat-fixtures";

/** The footer of a user bubble that never reached the agent. The ⋮ menu
 *  offers Retry, Copy text and Delete. Shown inside the bubble's frame. */
const meta = {
  title: "Components/Sessions/UndeliveredNotice",
  component: UndeliveredNotice,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="flex max-w-[620px] flex-col gap-2 rounded-xl border border-danger bg-card px-4 py-3 text-sm">
        <Story />
      </div>
    ),
  ],
  args: { message: undeliveredMessage(), onRetry: fn(), onDelete: fn() },
} satisfies Meta<typeof UndeliveredNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotDelivered: Story = {};

export const QueueFull: Story = {
  args: { message: undeliveredMessage(QUEUE_FULL_REASON) },
};
