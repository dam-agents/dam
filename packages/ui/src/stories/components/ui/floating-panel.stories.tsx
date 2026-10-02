import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  FLOATING_PANEL,
  FloatingPanelTail,
} from "@/components/ui/floating-panel";
import { cn } from "@/lib/utils";

const meta = {
  title: "Components/UI/FloatingPanel",
  component: FloatingPanelTail,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "`FLOATING_PANEL` is the surface class Popover and HoverCard content use. `FloatingPanelTail` is the arrow they pass to Radix `Arrow`; see Popover and HoverCard for it in place.",
      },
    },
  },
} satisfies Meta<typeof FloatingPanelTail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tail: Story = {
  render: (args) => (
    <div className="bg-popover p-6">
      <FloatingPanelTail {...args} />
    </div>
  ),
};

export const PanelSurface: Story = {
  render: () => (
    <div
      className={cn(FLOATING_PANEL, "flex w-[300px] flex-col gap-2 text-sm")}
    >
      <p className="font-bold text-foreground">Move to the new runtime</p>
      <p className="text-muted-foreground">
        The agent restarts on the new sandbox runtime. Its home directory, with
        the workspace and settings, is copied over.
      </p>
    </div>
  ),
};
