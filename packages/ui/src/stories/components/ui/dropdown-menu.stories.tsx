import { ChevronDown, Filter, OverflowMenuVertical } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CHANNELS = ["Chat", "Slack", "Telegram", "Schedule", "Terminal"];

const meta = {
  title: "Components/UI/DropdownMenu",
  component: DropdownMenu,
  parameters: { layout: "padded" },
  args: { defaultOpen: true, modal: false, onOpenChange: fn() },
  argTypes: { defaultOpen: { control: "boolean" } },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ArtifactActions: Story = {
  render: (args) => (
    <div className="flex justify-end pr-64">
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Artifact actions">
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Move to folder…</DropdownMenuItem>
          <DropdownMenuItem>Share</DropdownMenuItem>
          <DropdownMenuItem>Download</DropdownMenuItem>
          <DropdownMenuItem>Start a new session</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Delete after…</DropdownMenuItem>
          <DropdownMenuItem tone="danger">Delete artifact</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

export const WithLabelAndDisabled: Story = {
  render: (args) => (
    <div className="flex justify-end pr-64">
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Agent actions">
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Free up compute</DropdownMenuLabel>
          <DropdownMenuItem>Stop</DropdownMenuItem>
          <DropdownMenuItem disabled>Pause</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Restart</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger">Delete Agent</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

export const CheckboxItems: Story = {
  render: function CheckboxItems(args) {
    const [selected, setSelected] = useState(new Set(["Chat", "Slack"]));
    const toggle = (channel: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(channel)) next.delete(channel);
        else next.add(channel);
        return next;
      });
    return (
      <DropdownMenu {...args}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="text-sm font-normal text-muted-foreground"
          >
            <Filter size={16} />
            {selected.size === CHANNELS.length
              ? "All types"
              : `Types (${String(selected.size)})`}
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {CHANNELS.map((channel) => (
            <DropdownMenuCheckboxItem
              key={channel}
              checked={selected.has(channel)}
              onCheckedChange={() => toggle(channel)}
              onSelect={(event) => event.preventDefault()}
            >
              {channel}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
};

export const Closed: Story = {
  ...ArtifactActions,
  args: { defaultOpen: false },
};
