import type { Meta, StoryObj } from "@storybook/react";

import { Input } from "./input";

const meta: Meta<typeof Input> = {
  title: "Components/Input",
  component: Input,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: "Enter agent name..." },
};

export const Monospace: Story = {
  args: { variant: "monospace", placeholder: "ghcr.io/org/agent:latest" },
};

export const Invalid: Story = {
  args: { variant: "invalid", defaultValue: "bad value" },
};

export const Small: Story = {
  args: { size: "sm", placeholder: "Small input" },
};

export const ExtraSmall: Story = {
  args: { size: "xs", placeholder: "Extra small" },
};

export const Disabled: Story = {
  args: { placeholder: "Disabled", disabled: true },
};

export const Password: Story = {
  args: { type: "password", placeholder: "sk-ant-..." },
};

export const AllSizes: Story = {
  name: "All sizes",
  render: () => (
    <div className="flex w-[300px] flex-col gap-3">
      <Input size="xs" placeholder="Extra small" />
      <Input size="sm" placeholder="Small" />
      <Input placeholder="Default" />
    </div>
  ),
};
