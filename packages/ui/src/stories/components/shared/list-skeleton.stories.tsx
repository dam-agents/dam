import type { Meta, StoryObj } from "@storybook/react-vite";

import { ListSkeleton } from "@/components/list-skeleton";

const meta = {
  title: "Components/Shared/ListSkeleton",
  component: ListSkeleton,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[720px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ListSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleRow: Story = {};
export const ThreeRows: Story = { args: { rows: 3 } };
export const CompactRows: Story = { args: { rows: 4, rowHeight: 44 } };
