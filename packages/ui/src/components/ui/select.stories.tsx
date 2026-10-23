import type { Meta, StoryObj } from "@storybook/react";

import { Select } from "./select";

const meta: Meta<typeof Select> = {
  title: "Components/Select",
  component: Select,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  render: () => (
    <Select className="w-[280px]">
      <option value="">Select a harness...</option>
      <option value="claude-code">Claude Code</option>
      <option value="codex">Codex</option>
      <option value="gemini-cli">Gemini CLI</option>
    </Select>
  ),
};

export const Invalid: Story = {
  render: () => (
    <Select variant="invalid" className="w-[280px]">
      <option value="">Required</option>
    </Select>
  ),
};

export const Small: Story = {
  render: () => (
    <Select size="sm" className="w-[240px]">
      <option value="2">2 CPU / 2 Gi</option>
      <option value="4">4 CPU / 4 Gi</option>
      <option value="8">8 CPU / 8 Gi</option>
    </Select>
  ),
};

export const ExtraSmall: Story = {
  render: () => (
    <Select size="xs" className="w-[200px]">
      <option value="anthropic">Anthropic</option>
      <option value="openai">OpenAI</option>
      <option value="google">Google</option>
    </Select>
  ),
};

export const AllSizes: Story = {
  name: "All sizes",
  render: () => (
    <div className="flex w-[280px] flex-col gap-3">
      <Select size="xs">
        <option>Extra small</option>
      </Select>
      <Select size="sm">
        <option>Small</option>
      </Select>
      <Select>
        <option>Default</option>
      </Select>
    </div>
  ),
};
