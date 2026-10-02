import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ActivityBlock } from "../../../modules/sessions/components/activity-block.js";

/** The left-ruled disclosure that tool calls, thoughts and replayed history
 *  are built on. */
const meta = {
  title: "Components/Sessions/ActivityBlock",
  component: ActivityBlock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[813px]">
        <Story />
      </div>
    ),
  ],
  args: {
    label: "Conversation history",
    children: (
      <div className="whitespace-pre-wrap break-words">
        Earlier messages from the Slack thread the agent was added to.
      </div>
    ),
  },
  render: function Render(args) {
    const [open, setOpen] = useState(args.open ?? false);
    return (
      <ActivityBlock
        {...args}
        open={open}
        onToggle={args.onToggle ? () => setOpen((o) => !o) : undefined}
      />
    );
  },
} satisfies Meta<typeof ActivityBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = { args: { onToggle: () => {} } };
export const Open: Story = { args: { onToggle: () => {}, open: true } };
/** No `onToggle`: a static label with no chevron. */
export const Static: Story = {};
