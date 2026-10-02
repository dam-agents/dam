import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "@/components/ui/badge";

const VARIANTS = [
  "default",
  "secondary",
  "destructive",
  "outline",
  "success",
  "warning",
  "danger",
  "info",
  "muted",
  "accent",
  "template",
  "kit",
] as const;

const COPY: Record<(typeof VARIANTS)[number], string> = {
  default: "New",
  secondary: "record",
  destructive: "Failed",
  outline: "Draft",
  success: "Connected",
  warning: "Reconnecting",
  danger: "Update failed",
  info: "Publishing…",
  muted: "Recommended",
  accent: "Advanced",
  template: "Private",
  kit: "Software",
};

const meta = {
  title: "Components/UI/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  args: { children: "Connected", variant: "success", size: "default" },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "inline-radio", options: ["default", "sm"] },
    asChild: { control: false },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllVariants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {(["default", "sm"] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-sm text-muted-foreground">{size}</span>
          {VARIANTS.map((variant) => (
            <Badge key={variant} {...args} variant={variant} size={size}>
              {COPY[variant]}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const Small: Story = {
  args: { size: "sm", variant: "kit", children: "Research" },
};

export const Muted: Story = {
  args: { variant: "muted", children: "Recommended" },
};

export const Warning: Story = {
  args: { variant: "warning", children: "Reconnecting" },
};
