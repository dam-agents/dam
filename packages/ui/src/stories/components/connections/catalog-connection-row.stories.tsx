import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CatalogConnectionRow } from "@/modules/connections/components/catalog-connection-row";

import { connectionById } from "./catalog-data";

const meta = {
  title: "Components/Connections/CatalogConnectionRow",
  component: CatalogConnectionRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    connection: connectionById("conn-anthropic"),
    tag: "api.anthropic.com",
    iconSlug: "anthropic",
    onDelete: fn(),
  },
} satisfies Meta<typeof CatalogConnectionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};

export const Expired: Story = {
  args: {
    connection: connectionById("conn-linear"),
    tag: "mcp.linear.app",
    iconSlug: "mcp",
    maintenance: { onReauthenticate: fn() },
  },
};

export const NotInAgent: Story = {
  args: { grant: { granted: false, onToggle: fn() } },
};

export const InAgent: Story = {
  args: { grant: { granted: true, onToggle: fn() } },
};

export const GrantBlocked: Story = {
  args: {
    grant: {
      granted: false,
      onToggle: fn(),
      blockedReason:
        'This agent already signs in to api.anthropic.com as "anthropic-work". Remove it from the agent to use this account instead.',
    },
  },
};

/** Inside an agent's connection list, with the inline remove button. */
export const Removable: Story = {
  args: {
    connection: connectionById("conn-github"),
    tag: "GitHub OAuth",
    iconSlug: "github",
    onRemove: fn(),
    onDelete: undefined,
  },
};
