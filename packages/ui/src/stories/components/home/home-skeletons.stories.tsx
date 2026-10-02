import type { Meta, StoryObj } from "@storybook/react-vite";

import { WidgetSkeleton } from "@/modules/home/components/home-skeletons";

const meta = {
  title: "Components/Home/WidgetSkeleton",
  component: WidgetSkeleton,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[440px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WidgetSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const TwoRows: Story = { args: { rows: 2 } };
