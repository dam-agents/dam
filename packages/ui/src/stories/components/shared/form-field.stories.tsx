import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";

const meta = {
  title: "Components/Shared/FormField",
  component: FormField,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[480px]">
        <Story />
      </div>
    ),
  ],
  args: {
    label: "Agent name",
    children: <Input defaultValue="code-guardian" />,
  },
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = {
  args: { hint: "Lowercase letters, numbers and dashes." },
};
export const WithError: Story = {
  args: {
    children: <Input defaultValue="Code Guardian!" aria-invalid />,
    error: "Use lowercase letters, numbers and dashes only.",
  },
};
export const LabelInset: Story = { args: { labelInset: true } };
export const NoInset: Story = { args: { disableInset: true } };
