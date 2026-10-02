import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "@/components/ui/input";

const VARIANTS = ["standard", "monospace", "invalid"] as const;
const SIZES = ["default", "sm", "xs"] as const;

const meta = {
  title: "Components/UI/Input",
  component: Input,
  parameters: { layout: "padded" },
  args: {
    variant: "standard",
    size: "default",
    placeholder: "e.g. CI release pipeline",
    disabled: false,
    className: "max-w-md",
  },
  argTypes: {
    variant: { control: "inline-radio", options: VARIANTS },
    size: { control: "inline-radio", options: SIZES },
    disabled: { control: "boolean" },
    placeholder: { control: "text" },
    value: { control: "text" },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllVariants: Story = {
  render: (args) => (
    <div className="grid max-w-3xl grid-cols-3 gap-3">
      {SIZES.map((size) =>
        VARIANTS.map((variant) => (
          <Input
            key={`${size}-${variant}`}
            {...args}
            className=""
            size={size}
            variant={variant}
            placeholder={`${variant} / ${size}`}
          />
        )),
      )}
    </div>
  ),
};

export const WithValue: Story = { args: { defaultValue: "my-agent" } };

export const Monospace: Story = {
  args: {
    variant: "monospace",
    size: "sm",
    placeholder: "api.anthropic.com",
  },
};

export const Invalid: Story = {
  args: {
    variant: "invalid",
    defaultValue: "My Agent!",
    "aria-invalid": true,
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "release-notes-bot" },
};

export const Search: Story = {
  args: { type: "search", size: "sm", placeholder: "Search artifacts…" },
};
