import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CatalogPaneHeader } from "@/modules/connections/components/catalog-pane-header";

const meta = {
  title: "Components/Connections/CatalogPaneHeader",
  component: CatalogPaneHeader,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
  args: { title: "Connect GitHub", onBack: fn() },
} satisfies Meta<typeof CatalogPaneHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {};
export const WithSubtitle: Story = {
  args: {
    title: "Add an MCP server",
    subtitle: "Connect a remote MCP server your agents can call",
  },
};
