import { Add, ChevronRight, Settings, TrashCan } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: "Button" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Secondary" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "Outline" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Ghost" },
};

export const Link: Story = {
  args: { variant: "link", children: "Link" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Delete" },
};

export const DangerOutline: Story = {
  name: "Danger (outline)",
  args: { variant: "outline", tone: "danger", children: "Delete" },
};

export const DangerGhost: Story = {
  name: "Danger (ghost)",
  args: { variant: "ghost", tone: "danger", children: "Remove" },
};

export const Small: Story = {
  args: { size: "sm", children: "Small" },
};

export const ExtraSmall: Story = {
  args: { size: "xs", children: "Extra small" },
};

export const Large: Story = {
  args: { size: "lg", children: "Large" },
};

export const Icon: Story = {
  args: { size: "icon", children: <Settings size={16} /> },
};

export const WithLeadingIcon: Story = {
  name: "With leading icon",
  args: {
    children: (
      <>
        <Add size={16} /> Create agent
      </>
    ),
  },
};

export const WithTrailingIcon: Story = {
  name: "With trailing icon",
  args: {
    children: (
      <>
        Continue <ChevronRight size={16} />
      </>
    ),
  },
};

export const Disabled: Story = {
  args: { children: "Disabled", disabled: true },
};

export const AllVariants: Story = {
  name: "All variants",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline" tone="danger">
        Danger outline
      </Button>
      <Button variant="ghost" tone="danger">
        Danger ghost
      </Button>
    </div>
  ),
};

export const AllSizes: Story = {
  name: "All sizes",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon">
        <Settings size={16} />
      </Button>
      <Button size="icon-sm">
        <Settings size={16} />
      </Button>
      <Button size="icon-xs">
        <Settings size={14} />
      </Button>
    </div>
  ),
};
