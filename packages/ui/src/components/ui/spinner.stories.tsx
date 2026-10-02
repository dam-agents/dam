import type { Meta, StoryObj } from "@storybook/react";

import { Spinner } from "./spinner";

const meta: Meta<typeof Spinner> = {
  title: "Components/Spinner",
  component: Spinner,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};

export const Large: Story = {
  args: { size: 24 },
};

export const Small: Story = {
  args: { size: 10 },
};

export const WithLabel: Story = {
  name: "With label",
  args: { label: "Loading sessions..." },
};

export const AllSizes: Story = {
  name: "All sizes",
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner size={10} />
      <Spinner size={14} />
      <Spinner size={20} />
      <Spinner size={28} />
      <Spinner size={36} />
    </div>
  ),
};

export const InContext: Story = {
  name: "In loading context",
  render: () => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner size={14} />
      Agent is working...
    </div>
  ),
};
