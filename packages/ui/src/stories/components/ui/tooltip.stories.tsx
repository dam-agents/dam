import { Help } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/section-label";
import {
  HintTooltip,
  Tooltip,
  TooltipContent,
  TooltipRoot,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const hover = ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement
    .querySelector("[data-story-trigger], button")
    ?.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
    );
};

const meta = {
  title: "Components/UI/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
  args: {
    content:
      "This agent never hibernates on its own and keeps its compute reserved.",
    side: "top",
    children: (
      <span className="inline-flex" tabIndex={0} data-story-trigger>
        <Badge variant="muted">Always on</Badge>
      </span>
    ),
  },
  argTypes: {
    side: {
      control: "inline-radio",
      options: ["top", "right", "bottom", "left"],
    },
    content: { control: "text" },
    children: { control: false },
  },
  decorators: [
    (Story) => (
      <div className="p-24">
        <Story />
      </div>
    ),
  ],
  play: hover,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Top: Story = {};

export const Bottom: Story = { args: { side: "bottom" } };

export const Right: Story = { args: { side: "right" } };

export const Hint: StoryObj<typeof HintTooltip> = {
  render: (args) => (
    <div className="flex items-center gap-1.5">
      <SectionLabel>Compute resources</SectionLabel>
      <HintTooltip {...args} />
    </div>
  ),
  args: {
    label: "About compute resources",
    content:
      "Compute counts toward your budget only when the sandbox is active. Changing the size restarts the sandbox on save.",
    side: "bottom",
    children: <Help size={16} className="text-muted-foreground/60" />,
  },
  play: hover,
};

export const ContentWithTail: StoryObj<typeof TooltipContent> = {
  render: (args) => (
    <TooltipRoot open>
      <TooltipTrigger asChild>
        <span className="inline-block h-2 w-24 rounded-sm bg-primary" />
      </TooltipTrigger>
      <TooltipContent {...args}>3 slots available</TooltipContent>
    </TooltipRoot>
  ),
  args: {
    side: "top",
    tail: true,
    className: "max-w-xs px-3 py-2 text-sm leading-relaxed",
  },
  argTypes: {
    tail: { control: "boolean" },
    side: {
      control: "inline-radio",
      options: ["top", "right", "bottom", "left"],
    },
  },
  play: undefined,
};

export const ContentWithoutTail: StoryObj<typeof TooltipContent> = {
  ...ContentWithTail,
  args: { ...ContentWithTail.args, tail: false },
};
