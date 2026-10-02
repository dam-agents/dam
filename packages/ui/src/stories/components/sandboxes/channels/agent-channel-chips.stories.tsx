import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { AgentChannelChips } from "@/modules/sandboxes/components/channels/agent-channel-chips";

import { IDS } from "../../../backend/scenario";
import { loadAgent } from "../load";

type Args = Omit<ComponentProps<typeof AgentChannelChips>, "agent">;

const load = (id: string) => async () => ({ agent: await loadAgent(id) });
type Loaded = Awaited<ReturnType<ReturnType<typeof load>>>;

/** Renders nothing for an agent with no channels and no children. */
const meta = {
  title: "Components/Sandboxes/Channels/AgentChannelChips",
  parameters: { layout: "padded" },
  render: (args, { loaded }) => (
    <AgentChannelChips {...args} agent={(loaded as Loaded).agent} />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** triage-bot: one Slack channel. */
export const SlackChannel: Story = { loaders: [load(IDS.slackAgent)] };

/** Extra chips appended after the messenger chips. */
export const WithChildren: Story = {
  loaders: [load(IDS.slackAgent)],
  args: { children: <Badge variant="muted">Always on</Badge> },
};

/** checkout-service has no channels: only the children render. */
export const ChildrenOnly: Story = {
  loaders: [load(IDS.codingAgent)],
  args: { children: <Badge variant="muted">Always on</Badge> },
};
