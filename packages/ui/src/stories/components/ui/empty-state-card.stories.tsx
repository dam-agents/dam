import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { EmptyStateCard } from "@/components/ui/empty-state-card";

const meta = {
  title: "Components/UI/EmptyStateCard",
  component: EmptyStateCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl md:pl-4">
        <Story />
      </div>
    ),
  ],
  args: {
    message: "You have not added any Connections to this Agent yet",
    actionLabel: "Add Connection",
    onAction: fn(),
  },
} satisfies Meta<typeof EmptyStateCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connections: Story = {};

export const Schedules: Story = {
  args: {
    message: "You have not set up any Schedules yet",
    actionLabel: "Create Schedule",
  },
};
