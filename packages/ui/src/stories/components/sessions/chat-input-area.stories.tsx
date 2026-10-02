import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { fn } from "storybook/test";

import { useStore } from "@/store";

import { ChatInputArea } from "../../../modules/sessions/components/chat-input-area.js";
import { IDS } from "../../backend/scenario";
import { resetState } from "../agents/story-helpers";
import { seedPendingPermissions } from "./permission-fixtures";

/** The composer slot: the chat input, or the permission prompt while a tool
 *  call waits for approval. */
function ChatInputAreaStory(args: {
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <ChatInputArea textareaRef={textareaRef} loadingSession={false} {...args} />
  );
}

const openSession = () => {
  resetState();
  useStore.setState({ selectedAgent: IDS.codingAgent, sessionId: IDS.session1 });
  return {};
};

const meta = {
  title: "Components/Sessions/ChatInputArea",
  component: ChatInputAreaStory,
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col justify-end pb-4">
        <Story />
      </div>
    ),
  ],
  args: { busy: false, onSend: fn(), onStop: fn() },
} satisfies Meta<typeof ChatInputAreaStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Composer: Story = { loaders: [openSession] };
export const AwaitingApproval: Story = {
  loaders: [seedPendingPermissions()],
  args: { busy: true },
};
