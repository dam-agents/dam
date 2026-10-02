import type { Meta, StoryObj } from "@storybook/react-vite";

import { FeedCardSkeleton } from "@/modules/home/components/feed-card-skeleton";

const meta = {
  title: "Components/Home/FeedCardSkeleton",
  component: FeedCardSkeleton,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FeedCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleCard: Story = {};
export const ThreeCards: Story = { args: { rows: 3 } };
