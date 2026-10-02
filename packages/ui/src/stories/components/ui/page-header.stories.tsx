import { Chat, OverflowMenuVertical } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusBadge } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AgentAvatar } from "@/modules/agents/components/avatar/agent-avatar";

const meta = {
  title: "Components/UI/PageHeader",
  component: PageHeader,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-4xl pt-8">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Providers",
    description: "Agents need an API key from a provider to reach a model.",
  },
  argTypes: {
    title: { control: "text" },
    description: { control: "text" },
    leading: { control: false },
    actions: { control: false },
    adornment: { control: false },
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleAndDescription: Story = {};

export const TitleOnly: Story = {
  args: { title: "Usage", description: undefined },
};

export const WithActions: Story = {
  args: {
    title: "Artifacts",
    description:
      "Pages and files created by you and your agents. Share with a link, or set them to delete automatically.",
    actions: <Button>Upload artifact</Button>,
  },
};

export const AgentHeader: Story = {
  args: {
    title: "release-notes-bot",
    description: undefined,
    leading: <AgentAvatar name="release-notes-bot" size={44} />,
    adornment: <StatusBadge state="running" working={false} />,
    actions: (
      <>
        <Button variant="outline">
          <Chat size={16} />
          Chat
        </Button>
        <Button variant="outline" size="icon" aria-label="Agent actions">
          <OverflowMenuVertical size={16} />
        </Button>
      </>
    ),
  },
};

export const LongTitle: Story = {
  args: {
    title:
      "quarterly-dependency-audit-for-every-service-in-the-platform-monorepo",
    description: undefined,
    actions: <Button variant="outline">Edit</Button>,
  },
};
