import type { Meta, StoryObj } from "@storybook/react-vite";

import { TruncateStart } from "@/components/truncate-start";

const PATH = "/home/agent/workspace/checkout-service/src/payments/refunds.ts";

const meta = {
  title: "Components/Shared/TruncateStart",
  component: TruncateStart,
  parameters: { layout: "padded" },
  args: { title: PATH, children: PATH, className: "block text-sm" },
} satisfies Meta<typeof TruncateStart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Long paths lose their start, so the file name stays visible. */
export const Truncated: Story = {
  decorators: [
    (Story) => (
      <div className="w-[240px] rounded-md border border-border p-2">
        <Story />
      </div>
    ),
  ],
};

export const FitsWithoutTruncation: Story = {
  decorators: [
    (Story) => (
      <div className="w-[560px] rounded-md border border-border p-2">
        <Story />
      </div>
    ),
  ],
};
