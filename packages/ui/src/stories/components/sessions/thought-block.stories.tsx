import type { Meta, StoryObj } from "@storybook/react-vite";

import { ThoughtBlock } from "../../../modules/sessions/components/thought-block.js";
import { THOUGHT_TEXT } from "./chat-fixtures";

/** The agent's reasoning, from the fixture transcript. Open while it streams,
 *  collapsed once the reply settles; the user can toggle it either way. */
const meta = {
  title: "Components/Sessions/ThoughtBlock",
  component: ThoughtBlock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[813px]">
        <Story />
      </div>
    ),
  ],
  args: { text: THOUGHT_TEXT, streaming: false },
} satisfies Meta<typeof ThoughtBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Settled: Story = {};
export const Streaming: Story = { args: { streaming: true } };
