import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormError } from "@/components/form-error";

const meta = {
  title: "Components/Shared/FormError",
  component: FormError,
  parameters: { layout: "padded" },
} satisfies Meta<typeof FormError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithMessage: Story = {
  args: { message: "Name must be 63 characters or fewer." },
};

/** No message: renders nothing. */
export const Empty: Story = {};
