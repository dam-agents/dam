import type { Meta, StoryObj } from "@storybook/react-vite";

import { TextSkeleton } from "@/components/ui/text-skeleton";
import { FeedCardSkeleton } from "@/modules/home/components/feed-card-skeleton";

const meta = {
  title: "Components/UI/TextSkeleton",
  component: TextSkeleton,
  parameters: { layout: "padded" },
  args: { width: 96, tone: "primary" },
  argTypes: {
    width: { control: "text" },
    tone: { control: "inline-radio", options: ["primary", "muted"] },
  },
  render: (args) => (
    <p className="text-[15px] font-semibold">
      <TextSkeleton {...args} />
    </p>
  ),
} satisfies Meta<typeof TextSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Muted: Story = { args: { tone: "muted" } };

export const PercentWidth: Story = { args: { width: "62%" } };

export const InFeedCardSkeleton: Story = {
  render: () => (
    <div className="max-w-2xl">
      <FeedCardSkeleton rows={3} />
    </div>
  ),
};
