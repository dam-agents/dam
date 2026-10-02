import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectionRowActions } from "@/modules/connections/components/connection-row-actions";

import { connectionById, GITHUB_NEEDS_INSTALL } from "./catalog-data";

const meta = {
  title: "Components/Connections/ConnectionRowActions",
  component: ConnectionRowActions,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="flex max-w-2xl items-center justify-end gap-2">
        <Story />
      </div>
    ),
  ],
  args: {
    connection: connectionById("conn-anthropic"),
    onDelete: fn(),
  },
} satisfies Meta<typeof ConnectionRowActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MenuOnly: Story = {};

export const AddToAgent: Story = {
  args: { grant: { granted: false, onToggle: fn() } },
};

export const InAgent: Story = {
  args: { grant: { granted: true, onToggle: fn() } },
};

export const ExpiredOAuth: Story = {
  args: {
    connection: connectionById("conn-linear"),
    maintenance: { onReauthenticate: fn() },
  },
};

export const ExpiredBusy: Story = {
  args: {
    connection: connectionById("conn-linear"),
    maintenance: { onReauthenticate: fn(), busy: true },
  },
};

export const GithubNeedsInstall: Story = {
  args: {
    connection: GITHUB_NEEDS_INSTALL,
    grant: { granted: false, onToggle: fn() },
    maintenance: { onReauthenticate: fn(), onEditScope: fn() },
  },
};
