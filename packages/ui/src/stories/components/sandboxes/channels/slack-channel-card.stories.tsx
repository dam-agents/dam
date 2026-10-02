import type { Meta, StoryObj } from "@storybook/react-vite";

import { SlackChannelCard } from "@/modules/sandboxes/components/channels/slack-channel-card";

import { IDS } from "../../../backend/scenario";
import { loadAgent } from "../load";

const meta = {
  title: "Components/Sandboxes/Channels/SlackChannelCard",
  component: SlackChannelCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { agent: undefined },
  render: (args, { loaded }) => (
    <SlackChannelCard {...args} agent={(loaded as Loaded).agent} />
  ),
} satisfies Meta<typeof SlackChannelCard>;

type Loaded = { agent?: Awaited<ReturnType<typeof loadAgent>> };

export default meta;
type Story = StoryObj<typeof meta>;

/** triage-bot: bound to #help-platform as that channel's default agent. */
export const Connected: Story = {
  loaders: [async () => ({ agent: await loadAgent(IDS.slackAgent) })],
};

/** checkout-service: no Slack channel yet. */
export const Empty: Story = {
  loaders: [async () => ({ agent: await loadAgent(IDS.codingAgent) })],
};

/** Agent still loading: the connect button is disabled. */
export const NoAgent: Story = {};
