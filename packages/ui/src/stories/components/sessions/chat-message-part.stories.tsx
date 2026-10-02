import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ChatMessagePart } from "../../../modules/sessions/components/chat-message-part.js";
import {
  COMPLETED_CHIP,
  EXECUTE_CHIP,
  FAILED_CHIP,
  MARKDOWN_TEXT,
  THOUGHT_TEXT,
  USER_MESSAGE,
} from "./chat-fixtures";

const userText =
  USER_MESSAGE.parts[0]?.kind === "text" ? USER_MESSAGE.parts[0].text : "";

/** One piece of a chat message, dispatched on `part.kind`. Content comes from
 *  the checkout-service fixture transcript. */
const meta = {
  title: "Components/Sessions/ChatMessagePart",
  component: ChatMessagePart,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="flex max-w-[813px] flex-col gap-4 text-sm">
        <Story />
      </div>
    ),
  ],
  args: {
    part: { kind: "text", text: MARKDOWN_TEXT },
    role: "assistant",
    streaming: false,
    isLast: true,
    onFileClick: fn(),
  },
} satisfies Meta<typeof ChatMessagePart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Agent prose renders as markdown; file paths are clickable. */
export const AgentMarkdown: Story = {};

export const UserText: Story = {
  args: { role: "user", part: { kind: "text", text: userText } },
};

/** The caret while the user's own text is still being echoed. */
export const UserTextStreaming: Story = {
  args: { ...UserText.args, streaming: true },
};

export const Thought: Story = {
  args: { part: { kind: "thought", text: THOUGHT_TEXT } },
};

export const ToolCall: Story = { args: { part: COMPLETED_CHIP } };
export const ToolCallFailed: Story = { args: { part: FAILED_CHIP } };

export const Verdict: Story = {
  args: {
    part: {
      kind: "verdict",
      label: "Allowed once",
      subject: EXECUTE_CHIP.title,
      allowed: true,
    },
  },
};

/** An attachment on a user message, as the prompt mentioned it. */
export const File: Story = {
  args: {
    role: "user",
    part: {
      kind: "file",
      name: "src/pricing/discount.ts",
      mimeType: "text/typescript",
      size: 1_284,
    },
  },
};

/** Earlier messages carried into a Slack-thread prompt. */
export const History: Story = {
  args: {
    role: "user",
    part: {
      kind: "history",
      text: "[@maria] the checkout total on order 4417 is 1 cent higher than the receipt\n[@devon] same for 4420 — both have the SPRING10 code",
    },
  },
};
