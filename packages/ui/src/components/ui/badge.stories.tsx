import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "Components/Badge",
  component: Badge,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { children: "Default" },
};

export const Success: Story = {
  args: { variant: "success", children: "Running" },
};

export const Warning: Story = {
  args: { variant: "warning", children: "Pending" },
};

export const Danger: Story = {
  args: { variant: "danger", children: "Failed" },
};

export const Info: Story = {
  args: { variant: "info", children: "Hibernated" },
};

export const Muted: Story = {
  args: { variant: "muted", children: "Inactive" },
};

export const Accent: Story = {
  args: { variant: "accent", children: "Featured" },
};

export const SmallSize: Story = {
  name: "Small",
  args: { variant: "success", size: "sm", children: "Active" },
};

export const AllVariants: Story = {
  name: "All variants",
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="danger">Danger</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="muted">Muted</Badge>
      <Badge variant="accent">Accent</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="template">Template</Badge>
      <Badge variant="preset">Preset</Badge>
    </div>
  ),
};
