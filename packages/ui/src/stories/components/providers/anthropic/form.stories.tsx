import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { AnthropicForm } from "@/modules/providers/components/anthropic/form";

const meta = {
  title: "Components/Providers/AnthropicForm",
  component: AnthropicForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[505px] rounded-xl border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: {
    variant: "wizard",
    initialMode: "oauth",
    onSave: fn(async () => {}),
    onCancel: fn(),
  },
} satisfies Meta<typeof AnthropicForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WizardOAuth: Story = {};
export const WizardApiKey: Story = { args: { initialMode: "api-key" } };
export const EditLockedOAuth: Story = {
  args: { variant: "edit", lockMode: true },
};
export const EditLockedApiKey: Story = {
  args: { variant: "edit", initialMode: "api-key", lockMode: true },
};
export const EditUnlocked: Story = { args: { variant: "edit" } };
