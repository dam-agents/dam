import type { Meta, StoryObj } from "@storybook/react-vite";

import { ConnectionIcon } from "@/modules/connections/components/connection-icon";

import { TEMPLATES } from "../../backend/fixtures/connections";

const meta = {
  title: "Components/Connections/ConnectionIcon",
  component: ConnectionIcon,
  parameters: { layout: "padded" },
  args: { iconSlug: "github", alt: "GitHub", size: 16 },
} satisfies Meta<typeof ConnectionIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GitHub: Story = {};
export const Slack: Story = { args: { iconSlug: "slack", alt: "Slack" } };
export const McpServer: Story = { args: { iconSlug: "mcp", alt: "MCP" } };
export const Key: Story = { args: { iconSlug: "key", alt: "Key" } };
export const Fallback: Story = { args: { iconSlug: undefined, alt: "Link" } };

/** Every icon slug the fixture template catalog uses. */
export const AllTemplateIcons: Story = {
  render: () => {
    const slugs = [...new Set(TEMPLATES.map((t) => t.iconSlug))];
    return (
      <div className="grid grid-cols-3 gap-3">
        {slugs.map((slug) => (
          <div key={slug ?? "none"} className="flex items-center gap-2 text-sm">
            <ConnectionIcon iconSlug={slug} alt="" size={16} />
            <span className="text-muted-foreground">{slug ?? "(none)"}</span>
          </div>
        ))}
      </div>
    );
  },
};
