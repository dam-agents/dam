import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CatalogProviderCard } from "@/modules/connections/components/catalog-provider-card";

import { AGENTS } from "../../backend/fixtures/agents";
import { groupFor, TEMPLATE_BY_ID } from "./catalog-data";

const codingAgent = AGENTS[0]!;

const meta = {
  title: "Components/Connections/CatalogProviderCard",
  component: CatalogProviderCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    group: groupFor("github"),
    templateById: TEMPLATE_BY_ID,
    onNew: fn(),
    onDelete: fn(),
    deletingId: null,
  },
} satisfies Meta<typeof CatalogProviderCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithConnections: Story = {};

/** A provider the user has not connected yet. */
export const NoConnections: Story = { args: { group: groupFor("modal") } };

/** Slack shows the account explainer next to its title. */
export const Slack: Story = {
  args: { group: groupFor("slack"), onGoToChannels: fn() },
};

export const ExpiredNeedsReauth: Story = {
  args: {
    group: groupFor("mcp-server"),
    maintenance: (c) =>
      c.status === "expired" ? { onReauthenticate: fn() } : undefined,
  },
};

export const Deleting: Story = { args: { deletingId: "conn-github" } };

/** Opened from an agent: rows offer "Add to agent" / "In this agent". */
export const InAgentSandbox: Story = {
  args: {
    group: groupFor("github"),
    sandbox: {
      grantedIds: new Set(codingAgent.grantedConnectionIds),
      onToggleGrant: fn(),
    },
  },
};
