import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { HarnessGrid } from "@/modules/sandboxes/components/setup/harness-grid";

import { loadTemplates } from "../load";

type Args = Omit<ComponentProps<typeof HarnessGrid>, "harnesses">;

const loadHarnesses = async () => ({ harnesses: await loadTemplates() });
type Loaded = Awaited<ReturnType<typeof loadHarnesses>>;

const meta = {
  title: "Components/Sandboxes/Setup/HarnessGrid",
  parameters: { layout: "padded" },
  loaders: [loadHarnesses],
  args: {
    loading: false,
    error: false,
    onRetry: fn(),
    templateId: null,
    onPick: fn(),
  },
  render: (args, { loaded }) => (
    <div className="max-w-3xl">
      <HarnessGrid {...args} harnesses={(loaded as Loaded).harnesses} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { templateId: "claude-code" } };
export const Loading: Story = { args: { loading: true } };
export const Error: Story = { args: { error: true } };

export const Empty: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <HarnessGrid {...args} harnesses={[]} />
    </div>
  ),
};
