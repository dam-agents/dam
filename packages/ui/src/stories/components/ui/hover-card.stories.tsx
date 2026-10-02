import { Migrate, Renew } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

const meta = {
  title: "Components/UI/HoverCard",
  component: HoverCard,
  parameters: { layout: "centered" },
  args: {
    defaultOpen: true,
    openDelay: 200,
    closeDelay: 200,
    onOpenChange: fn(),
  },
  argTypes: {
    defaultOpen: { control: "boolean" },
    openDelay: { control: "number" },
    closeDelay: { control: "number" },
  },
  render: (args) => (
    <div className="pt-48">
      <HoverCard {...args}>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
          >
            <Renew size={16} />
            Update
          </Button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          className="flex w-[300px] flex-col gap-2 text-sm"
        >
          <p className="font-bold text-foreground">Update available</p>
          <p className="text-muted-foreground">
            Latest image version{" "}
            <span className="break-all font-mono text-xs text-foreground">
              ghcr.io/platform/claude-code:2.4.1
            </span>
          </p>
        </HoverCardContent>
      </HoverCard>
    </div>
  ),
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpdateAvailable: Story = {};

export const MoveToNewRuntime: Story = {
  render: (args) => (
    <div className="pt-72">
      <HoverCard {...args}>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
          >
            <Migrate size={16} />
            Migrate
          </Button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          className="flex w-[300px] flex-col gap-2 text-sm"
        >
          <p className="font-bold text-foreground">Move to the new runtime</p>
          <p className="text-muted-foreground">
            The agent restarts on the new sandbox runtime. Its home directory,
            with the workspace and settings, is copied over, and the agent is
            unavailable while the copy runs. The next step shows exactly what
            moves. The move can be undone until the agent first starts on the
            new runtime.
          </p>
        </HoverCardContent>
      </HoverCard>
    </div>
  ),
};

export const Closed: Story = { args: { defaultOpen: false } };
