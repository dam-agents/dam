import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const openAtTrigger = ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const trigger = canvasElement.querySelector("[data-story-trigger]");
  if (!trigger) return;
  const box = trigger.getBoundingClientRect();
  trigger.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 24,
      clientY: box.top + box.height / 2,
    }),
  );
};

const meta = {
  title: "Components/UI/ContextMenu",
  component: ContextMenu,
  parameters: { layout: "padded" },
  args: { onOpenChange: fn(), modal: true },
  render: (args) => (
    <ContextMenu {...args}>
      <ContextMenuTrigger asChild>
        <div
          data-story-trigger
          className="flex h-8 w-72 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
        >
          README.md
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Edit</ContextMenuItem>
        <ContextMenuItem>Download</ContextMenuItem>
        <ContextMenuItem>Rename</ContextMenuItem>
        <ContextMenuItem tone="danger">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
  play: openAtTrigger,
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FileRow: Story = {};

export const FolderRow: Story = {
  render: (args) => (
    <ContextMenu {...args}>
      <ContextMenuTrigger asChild>
        <div
          data-story-trigger
          className="flex h-8 w-72 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          src
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>New file…</ContextMenuItem>
        <ContextMenuItem>New folder…</ContextMenuItem>
        <ContextMenuItem>Upload files here…</ContextMenuItem>
        <ContextMenuItem>Rename</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem tone="danger">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const Closed: Story = { play: undefined };
