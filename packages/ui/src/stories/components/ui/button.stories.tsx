import {
  Add,
  OverflowMenuVertical,
  Renew,
  TrashCan,
} from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";

const VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;
const SIZES = ["default", "sm", "xs", "inline", "lg"] as const;
const ICON_SIZES = ["icon", "icon-sm", "icon-xs"] as const;

const meta = {
  title: "Components/UI/Button",
  component: Button,
  parameters: { layout: "centered" },
  args: {
    children: "New agent",
    variant: "default",
    size: "default",
    tone: "default",
    disabled: false,
    onClick: fn(),
  },
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: [...SIZES, ...ICON_SIZES] },
    tone: { control: "inline-radio", options: ["default", "danger"] },
    tooltip: { control: "text" },
    asChild: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllVariants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          <span className="w-24 text-sm text-muted-foreground">{variant}</span>
          {SIZES.map((size) => (
            <Button key={size} {...args} variant={variant} size={size}>
              Restart
            </Button>
          ))}
          <Button {...args} variant={variant} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};

export const IconSizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {VARIANTS.filter((v) => v !== "link").map((variant) =>
        ICON_SIZES.map((size) => (
          <Button
            key={`${variant}-${size}`}
            {...args}
            variant={variant}
            size={size}
            aria-label="Agent actions"
          >
            <OverflowMenuVertical size={16} />
          </Button>
        )),
      )}
    </div>
  ),
};

export const DangerTone: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args} variant="ghost" tone="danger">
        <TrashCan size={16} />
        Delete
      </Button>
      <Button {...args} variant="outline" tone="danger">
        <TrashCan size={16} />
        Delete Agent
      </Button>
      <Button {...args} variant="link" tone="danger" size="inline">
        Remove
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  args: {
    variant: "outline",
    children: (
      <>
        <Add size={16} />
        Add Connection
      </>
    ),
  },
};

export const Destructive: Story = {
  args: {
    variant: "destructive",
    children: (
      <>
        <TrashCan size={16} />
        Remove
      </>
    ),
  },
};

export const Disabled: Story = {
  args: { disabled: true, children: "Create key" },
};

export const WithTooltip: Story = {
  args: {
    variant: "ghost",
    size: "sm",
    tooltip: "Update to the latest image version",
    children: (
      <>
        <Renew size={16} />
        Update
      </>
    ),
  },
  play: ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    button?.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
    );
  },
};
