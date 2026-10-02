import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useFeed, useFeedArtifacts } from "@/modules/home/api/queries";
import { FeedList } from "@/modules/home/components/feed-list";
import type { FeedItem } from "@/modules/home/lib/feed-item";

import { inScenario } from "../shared/in-scenario";

/** Feeds FeedList the live feed from the fixture backend, filtered to `only`. */
function LiveFeed({ only }: { only?: FeedItem["kind"] }) {
  const { items, agents } = useFeed();
  const { bySession } = useFeedArtifacts(items);
  const shown = only ? items.filter((i) => i.kind === only) : items;
  return (
    <FeedList
      items={shown}
      agents={agents}
      onOpenSession={fn()}
      onDismiss={fn()}
      onResolved={fn()}
      resolvedLabelFor={() => null}
      artifactsFor={(item) =>
        item.kind === "unread"
          ? (bySession.get(item.session.sessionId) ?? [])
          : []
      }
      onOpenArtifact={fn()}
    />
  );
}

const meta = {
  title: "Components/Home/FeedList",
  component: FeedList,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
    inScenario("populated"),
  ],
} satisfies Meta<typeof FeedList>;

export default meta;
type Story = StoryObj<typeof FeedList>;

/** Approvals, in-progress sessions and unread sessions together. */
export const Mixed: Story = { render: () => <LiveFeed /> };
export const ApprovalsOnly: Story = {
  render: () => <LiveFeed only="approval" />,
};
export const UnreadOnly: Story = { render: () => <LiveFeed only="unread" /> };

/** Nothing in the feed: the list renders empty. */
export const Empty: Story = {
  decorators: [inScenario("empty")],
  render: () => <LiveFeed />,
};
