import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectionGroupCard } from "@/modules/connections/components/connection-group-card";

import { groupFor, TEMPLATE_BY_ID } from "./catalog-data";

const meta = {
  title: "Components/Connections/ConnectionGroupCard",
  component: ConnectionGroupCard,
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
    onDelete: fn(),
  },
} satisfies Meta<typeof ConnectionGroupCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GitHub: Story = {};
export const WithCount: Story = { args: { showCount: true } };
export const McpServer: Story = {
  args: { group: groupFor("mcp-server"), showCount: true },
};

/** How an agent's connection list uses it: grant controls and a manage link. */
export const InAgent: Story = {
  args: {
    group: groupFor("openai"),
    grant: () => ({ granted: true, onToggle: fn() }),
    onManage: fn(),
    onDelete: undefined,
  },
};
