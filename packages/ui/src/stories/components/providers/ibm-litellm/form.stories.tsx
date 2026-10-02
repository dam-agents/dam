import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { IbmLitellmForm } from "@/modules/providers/components/ibm-litellm/form";

const meta = {
  title: "Components/Providers/IbmLitellmForm",
  component: IbmLitellmForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[505px] rounded-xl border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: { variant: "wizard", onSave: fn(async () => {}), onCancel: fn() },
} satisfies Meta<typeof IbmLitellmForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Wizard: Story = {};
export const Edit: Story = { args: { variant: "edit" } };
