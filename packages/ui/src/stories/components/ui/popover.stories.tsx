import { Close } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const meta = {
  title: "Components/UI/Popover",
  component: Popover,
  parameters: { layout: "centered" },
  args: { defaultOpen: true, onOpenChange: fn() },
  argTypes: { defaultOpen: { control: "boolean" } },
  render: (args) => (
    <div className="pt-40">
      <Popover {...args}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            claude-sonnet-4-5
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="flex w-[300px] flex-col gap-2 text-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-bold text-foreground">Current model</h2>
            <PopoverClose asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Close"
                className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
              >
                <Close size={16} />
              </Button>
            </PopoverClose>
          </div>
          <p className="text-muted-foreground">
            This session is using{" "}
            <span className="text-foreground">claude-sonnet-4-5</span>. Change
            the model in Agent Setup.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  ),
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentModel: Story = {};

export const Closed: Story = { args: { defaultOpen: false } };
