import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps, ComponentType } from "react";
import { fn } from "storybook/test";

import type { Message } from "@/types";

import { appendInterruptedNotice } from "../../../modules/acp/session-projection.js";
import { ChatMessage } from "../../../modules/sessions/components/chat-message.js";
import { timeProps } from "../../../modules/sessions/lib/thread-items.js";
import { ago, NOW } from "../../backend/scenario";
import { resetState, seedFlags } from "../agents/story-helpers";
import {
  AGENT_REPLY,
  CHECKOUT_MESSAGES,
  undeliveredMessage,
  USER_MESSAGE,
} from "./chat-fixtures";
import { seedPendingPermissions } from "./permission-fixtures";

const times = (m: Message) => timeProps(m.at, new Date(NOW));

type Props = ComponentProps<typeof ChatMessage>;
/** `Props` with its time-label union flattened, which Storybook args need. */
type Args = Omit<Props, "timeLabel" | "timeTitle"> & {
  timeLabel?: string;
  timeTitle?: string;
};
const asProps = (args: Args) => args as Props;

/** One bubble of the conversation. Messages are the checkout-service fixture
 *  transcript as the real ACP projection builds them. */
const meta = {
  title: "Components/Sessions/ChatMessage",
  component: ChatMessage as ComponentType<Args>,
  render: (args) => <ChatMessage {...asProps(args)} />,
  parameters: { layout: "padded" },
  loaders: [() => (resetState(), {})],
  decorators: [
    (Story) => (
      <div className="mx-auto flex max-w-[813px] flex-col gap-6 px-4">
        <Story />
      </div>
    ),
  ],
  args: {
    message: USER_MESSAGE,
    ...times(USER_MESSAGE),
    isLast: false,
    hasPendingPermission: false,
    onRetry: fn(),
    onFileClick: fn(),
    onDelete: fn(),
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {};

/** Thought, prose and tool calls (one failed) in one reply. */
export const AgentReply: Story = {
  args: { message: AGENT_REPLY, ...times(AGENT_REPLY) },
};

/** With the "agent-avatars" flag on the reply shows the agent's head. */
export const AgentReplyWithAvatar: Story = {
  loaders: [() => (seedFlags({ "agent-avatars": true }), {})],
  args: {
    message: AGENT_REPLY,
    ...times(AGENT_REPLY),
    avatarAgentName: "checkout-service",
  },
};

export const Streaming: Story = {
  args: {
    message: { ...AGENT_REPLY, streaming: true },
    ...times(AGENT_REPLY),
    isLast: true,
  },
};

/** Sent while an earlier prompt is still running. */
export const Queued: Story = {
  args: {
    message: { id: "queued", role: "assistant", parts: [], streaming: true, queued: true },
    isLast: true,
  },
};

export const AwaitingApproval: Story = {
  loaders: [seedPendingPermissions()],
  args: {
    message: { ...AGENT_REPLY, streaming: true },
    ...times(AGENT_REPLY),
    isLast: true,
    hasPendingPermission: true,
  },
};

export const Undelivered: Story = {
  args: { message: undeliveredMessage() },
};

export const ReplyFailed: Story = {
  args: {
    message: {
      id: "failed",
      role: "assistant",
      parts: [],
      streaming: false,
      error: { message: "Connection closed (code 1006)" },
    },
  },
};

export const ReplyInterrupted: Story = {
  args: {
    message: {
      ...AGENT_REPLY,
      error: {
        message:
          "429 rate_limit_error: Number of request tokens has exceeded your per-minute rate limit",
      },
    },
    ...times(AGENT_REPLY),
  },
};

/** The notice the real projection appends after an unexpected restart. */
export const Notice: Story = {
  args: { message: appendInterruptedNotice([], ago(1))[0]! },
};

/** The whole fixture conversation, bubble after bubble. */
export const Conversation: Story = {
  render: (args) => (
    <>
      {CHECKOUT_MESSAGES.map((m, i) => (
        <ChatMessage
          key={m.id}
          {...asProps({
            ...args,
            message: m,
            ...times(m),
            isLast: i === CHECKOUT_MESSAGES.length - 1,
          })}
        />
      ))}
    </>
  ),
};
