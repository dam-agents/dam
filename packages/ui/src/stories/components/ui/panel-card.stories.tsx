import { Satellite } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PanelCard } from "@/components/ui/panel-card";
import { ConnectionIcon } from "@/modules/connections/components/connection-icon";

const meta = {
  title: "Components/UI/PanelCard",
  component: PanelCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "GitHub",
    icon: (
      <ConnectionIcon
        iconSlug="github"
        alt=""
        size={16}
        className="shrink-0 text-foreground/80"
      />
    ),
    titleAccessory: (
      <span className="shrink-0 text-sm text-muted-foreground">
        2 connections
      </span>
    ),
    children: (
      <div className="flex flex-col gap-3 p-4">
        <Card className="p-4 text-sm">octo-org</Card>
        <Card className="p-4 text-sm">personal</Card>
      </div>
    ),
  },
  argTypes: {
    title: { control: "text" },
    icon: { control: false },
    titleAccessory: { control: false },
    headerRight: { control: false },
    children: { control: false },
  },
} satisfies Meta<typeof PanelCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectionGroup: Story = {};

export const WithHeaderRight: Story = {
  args: {
    headerRight: (
      <Button variant="outline" size="sm">
        Connect
      </Button>
    ),
  },
};

export const Satellites: Story = {
  args: {
    title: "Satellites",
    icon: <Satellite size={16} className="shrink-0 text-foreground/80" />,
    titleAccessory: (
      <span className="shrink-0 text-sm text-muted-foreground">
        1 satellite
      </span>
    ),
    children: (
      <div className="flex flex-col gap-3 p-4">
        <Card className="p-4 text-sm">build-mac-mini</Card>
      </div>
    ),
  },
};

export const TitleOnly: Story = {
  args: {
    icon: undefined,
    titleAccessory: undefined,
    children: <p className="p-4 text-sm text-muted-foreground">No rows.</p>,
  },
};
