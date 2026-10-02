import type { Meta, StoryObj } from "@storybook/react-vite";

import { Textarea } from "@/components/ui/textarea";

const VARIANTS = ["standard", "monospace", "invalid"] as const;

const meta = {
  title: "Components/UI/Textarea",
  component: Textarea,
  parameters: { layout: "padded" },
  args: {
    variant: "standard",
    placeholder: "Enter a task prompt",
    rows: 3,
    disabled: false,
    className: "max-w-xl",
  },
  argTypes: {
    variant: { control: "inline-radio", options: VARIANTS },
    disabled: { control: "boolean" },
    rows: { control: "number" },
    placeholder: { control: "text" },
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllVariants: Story = {
  render: (args) => (
    <div className="flex max-w-xl flex-col gap-3">
      {VARIANTS.map((variant) => (
        <Textarea
          key={variant}
          {...args}
          className=""
          variant={variant}
          placeholder={variant}
        />
      ))}
    </div>
  ),
};

export const WithValue: Story = {
  args: {
    defaultValue:
      "Summarize yesterday's merged pull requests and post the summary in #releases.",
  },
};

export const Monospace: Story = {
  args: {
    variant: "monospace",
    rows: 8,
    placeholder: "-----BEGIN PRIVATE KEY-----",
  },
};

export const Invalid: Story = {
  args: { variant: "invalid", defaultValue: "", "aria-invalid": true },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: "Check for dependency updates every Monday morning.",
  },
};
