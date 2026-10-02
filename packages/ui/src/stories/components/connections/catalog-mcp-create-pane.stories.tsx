import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { McpCreatePane } from "@/modules/connections/components/catalog-mcp-create-pane";

import { TEMPLATE_BY_ID } from "./catalog-data";

const meta = {
  title: "Components/Connections/McpCreatePane",
  component: McpCreatePane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="flex h-[640px] max-w-2xl flex-col rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: { templateById: TEMPLATE_BY_ID, onBack: fn(), onCreated: fn() },
} satisfies Meta<typeof McpCreatePane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
