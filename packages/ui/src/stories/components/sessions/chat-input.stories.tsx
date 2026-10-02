import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { fn } from "storybook/test";

import { useStore } from "@/store";
import type { Attachment } from "@/types";

import { ChatInput } from "../../../modules/sessions/components/chat-input.js";
import { draftKey } from "../../../modules/sessions/lib/draft-key.js";
import { IDS } from "../../backend/scenario";
import { resetState } from "../agents/story-helpers";

/** The composer under the chat. Its text and attachments are the store's
 *  draft for the open agent + session, so stories seed that draft. */
function seedDraft(text = "", attachments: Attachment[] = []) {
  return () => {
    resetState();
    useStore.setState({
      selectedAgent: IDS.codingAgent,
      sessionId: IDS.session1,
      drafts: {
        [draftKey(IDS.codingAgent, IDS.session1)]: { text, attachments },
      },
    });
    return {};
  };
}

interface Args {
  busy: boolean;
  loadingSession: boolean;
  onSend: () => void;
  onStop: () => void;
}

function ChatInputStory(args: Args) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return <ChatInput textareaRef={textareaRef} {...args} />;
}

const meta = {
  title: "Components/Sessions/ChatInput",
  component: ChatInputStory,
  loaders: [seedDraft()],
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col justify-end pb-4">
        <Story />
      </div>
    ),
  ],
  args: { busy: false, loadingSession: false, onSend: fn(), onStop: fn() },
} satisfies Meta<typeof ChatInputStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithDraft: Story = {
  loaders: [
    seedDraft(
      "Also check that the invoice renderer and the receipt email use the same rounding.",
    ),
  ],
};

/** While the agent is replying: Stop, and new messages queue. */
export const AgentWorking: Story = { args: { busy: true } };

export const LoadingSession: Story = { args: { loadingSession: true } };

export const WithAttachment: Story = {
  loaders: [
    seedDraft("Here's the failing cart from production.", [
      {
        kind: "file",
        name: "carts.json",
        mimeType: "application/json",
        data: btoa('{"lines":[]}'),
        size: 12_480,
      },
    ]),
  ],
};
