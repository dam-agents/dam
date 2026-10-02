import type { Meta, StoryObj } from "@storybook/react-vite";

import { FeaturesTab } from "@/modules/features/components/features-tab";

const meta = {
  title: "Components/Features/FeaturesTab",
  component: FeaturesTab,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FeaturesTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
