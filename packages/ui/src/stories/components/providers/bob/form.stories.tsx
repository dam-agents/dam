import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { BobForm } from "@/modules/providers/components/bob/form";

const meta = {
  title: "Components/Providers/BobForm",
  component: BobForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[505px] rounded-xl border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: { variant: "wizard", onSave: fn(async () => {}), onCancel: fn() },
} satisfies Meta<typeof BobForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Wizard: Story = {};
export const EditNoPins: Story = { args: { variant: "edit" } };
/** Edit with pins set opens the Advanced section. */
export const EditWithPins: Story = {
  args: {
    variant: "edit",
    initialPins: { model: "premium-shell", maxCost: "5", chatMode: "plan" },
  },
};
