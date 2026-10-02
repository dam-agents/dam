import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useFeed } from "@/modules/home/api/queries";
import { FeedApprovalCard } from "@/modules/home/components/feed-approval-card";

import { inScenario } from "../shared/in-scenario";

/** Renders the card for a pending approval from the fixture backend, picked by
 *  approval kind, with the same props FeedList passes. */
function PendingApproval({
  kind,
  resolvedLabel,
}: {
  kind: "acp_native" | "ext_authz";
  resolvedLabel?: string;
}) {
  const { items, agents } = useFeed();
  const item = items.find(
    (i) => i.kind === "approval" && i.approval.type === kind,
  );
  if (item?.kind !== "approval") return null;
  const name = agents.find((a) => a.id === item.agentId)?.name;
  return (
    <FeedApprovalCard
      approval={item.approval}
      agentName={name ?? item.agentId}
      avatarName={name}
      meta="4m ago"
      onDismiss={fn()}
      resolvedLabel={resolvedLabel}
      onResolved={fn()}
    />
  );
}

const meta = {
  title: "Components/Home/FeedApprovalCard",
  component: FeedApprovalCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
    inScenario("populated"),
  ],
} satisfies Meta<typeof FeedApprovalCard>;

export default meta;
type Story = StoryObj<typeof FeedApprovalCard>;

/** An agent asking to run a tool. */
export const ToolPermission: Story = {
  render: () => <PendingApproval kind="acp_native" />,
};

/** An agent asking to reach a network host; the menu adds Network settings. */
export const NetworkHost: Story = {
  render: () => <PendingApproval kind="ext_authz" />,
};

export const Allowed: Story = {
  render: () => (
    <PendingApproval kind="ext_authz" resolvedLabel="Allowed once" />
  ),
};

export const Denied: Story = {
  render: () => <PendingApproval kind="acp_native" resolvedLabel="Denied" />,
};
