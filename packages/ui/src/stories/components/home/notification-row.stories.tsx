import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useFeed, useFeedArtifacts } from "@/modules/home/api/queries";
import { NotificationRow } from "@/modules/home/components/notification-row";
import {
  type ChannelType,
  channelTypeFor,
} from "@/modules/home/lib/activity-filter";

import { inScenario } from "../shared/in-scenario";

/** Renders the first fixture feed item of `kind` (and channel, when given)
 *  with the props FeedList passes. */
function FeedRow({
  kind,
  channel,
  dismissible = true,
}: {
  kind: "unread" | "in-progress";
  channel?: ChannelType;
  dismissible?: boolean;
}) {
  const { items, agents } = useFeed();
  const { bySession } = useFeedArtifacts(items);
  const item = items.find(
    (i) =>
      i.kind === kind &&
      (channel === undefined || channelTypeFor(i) === channel),
  );
  if (item?.kind !== "unread" && item?.kind !== "in-progress") {
    return (
      <p className="text-sm text-muted-foreground">
        No {kind} {channel ?? ""} item in the fixture feed.
      </p>
    );
  }
  const name = agents.find((a) => a.id === item.agentId)?.name;
  return (
    <NotificationRow
      item={item}
      agents={agents}
      agentName={name ?? item.agentId}
      avatarName={name}
      meta="12m ago"
      artifacts={
        item.kind === "unread"
          ? (bySession.get(item.session.sessionId) ?? [])
          : []
      }
      onOpen={fn()}
      onDismiss={dismissible && item.kind === "unread" ? fn() : undefined}
      onOpenArtifact={fn()}
    />
  );
}

const meta = {
  title: "Components/Home/NotificationRow",
  component: NotificationRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
    inScenario("populated"),
  ],
} satisfies Meta<typeof NotificationRow>;

export default meta;
type Story = StoryObj<typeof NotificationRow>;

/** Unread session with touched artifacts; hover to reveal Dismiss. */
export const Unread: Story = { render: () => <FeedRow kind="unread" /> };

export const FromSlack: Story = {
  render: () => <FeedRow kind="unread" channel="slack" />,
};
