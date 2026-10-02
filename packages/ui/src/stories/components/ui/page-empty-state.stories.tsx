import { Add } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PageEmptyState } from "@/components/ui/page-empty-state";

const meta = {
  title: "Components/UI/PageEmptyState",
  component: PageEmptyState,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-4xl">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "No artifacts yet",
    message: "Artifacts from every agent collect here.",
    actionLabel: "Go to agents",
    onAction: fn(),
  },
  argTypes: {
    message: { control: "text" },
    actionIcon: { control: false },
  },
} satisfies Meta<typeof PageEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Artifacts: Story = {};

export const ApiKeys: Story = {
  args: {
    title: "No API keys yet",
    message: "Create one to authenticate the CLI without a browser.",
    actionLabel: "Create key",
    actionIcon: <Add size={16} />,
  },
};

export const StarterKits: Story = {
  args: {
    title: "No starter kits in this catalog",
    message:
      "This install has no starter kit catalog configured, or the catalog lists no kits. You can still start from scratch.",
    actionLabel: "Start from scratch",
  },
};
