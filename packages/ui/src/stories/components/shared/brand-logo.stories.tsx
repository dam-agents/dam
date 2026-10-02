import type { Meta, StoryObj } from "@storybook/react-vite";

import { BrandLogo } from "@/components/brand-logo";

const meta = {
  title: "Components/Shared/BrandLogo",
  component: BrandLogo,
  parameters: { layout: "centered" },
} satisfies Meta<typeof BrandLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Muted: Story = {
  args: { className: "text-foreground/80" },
};
