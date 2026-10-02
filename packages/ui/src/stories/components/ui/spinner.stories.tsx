import type { Meta, StoryObj } from "@storybook/react-vite";

import { Spinner } from "@/components/ui/spinner";

const meta = {
  title: "Components/UI/Spinner",
  component: Spinner,
  parameters: { layout: "centered" },
  args: { size: 14, label: "Loading" },
  argTypes: {
    size: { control: { type: "number", min: 8, max: 48 } },
    label: { control: "text" },
  },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-6">
      {[13, 14, 16, 24, 32].map((size) => (
        <Spinner key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

export const InlineWithText: Story = {
  args: { label: undefined },
  render: (args) => (
    <span className="flex h-9 items-center gap-1.5 text-sm font-medium text-muted-foreground">
      Agent is starting…
      <Spinner {...args} />
    </span>
  ),
};

export const Tinted: Story = {
  args: { size: 16, className: "text-accent" },
};
