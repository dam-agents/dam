import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { SlackChannelModal } from "@/modules/sandboxes/components/channels/slack-channel-modal";
import { findSlackChannels } from "@/modules/sandboxes/hooks/use-slack-channel-form";

import { IDS } from "../../../backend/scenario";
import { loadAgent } from "../load";

type Args = Omit<ComponentProps<typeof SlackChannelModal>, "agent" | "channel">;

/** `edit` picks the agent's first bound Slack channel. */
const load = (id: string, edit: boolean) => async () => {
  const agent = await loadAgent(id);
  return { agent, channel: edit ? findSlackChannels(agent)[0] : undefined };
};
type Loaded = Awaited<ReturnType<ReturnType<typeof load>>>;

const meta = {
  title: "Components/Sandboxes/Channels/SlackChannelModal",
  args: { onClose: fn() },
  render: (args, { loaded }) => {
    const { agent, channel } = loaded as Loaded;
    return <SlackChannelModal {...args} agent={agent} channel={channel} />;
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Connecting a new channel: asks for the channel ID. */
export const Connect: Story = { loaders: [load(IDS.codingAgent, false)] };

/** Editing triage-bot's bound #help-platform channel. */
export const Edit: Story = { loaders: [load(IDS.slackAgent, true)] };
