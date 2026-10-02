import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { OpenAIForm } from "@/modules/providers/components/openai/form";

const meta = {
  title: "Components/Providers/OpenAIForm",
  component: OpenAIForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[505px] rounded-xl border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: { variant: "wizard", onSave: fn(async () => {}), onCancel: fn() },
} satisfies Meta<typeof OpenAIForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Wizard: Story = {};
export const Edit: Story = { args: { variant: "edit" } };
