import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { FileRowMenuItems } from "../../../modules/files/components/file-row-menu-items.js";

/** A file-tree row's actions, shown open in the dropdown `FileRow` mounts
 *  them in (the same items also fill its right-click menu). */
const meta = {
  title: "Components/Files/FileRowMenuItems",
  component: FileRowMenuItems,
  parameters: { layout: "padded" },
  args: { isDir: false, onAction: fn(), Item: DropdownMenuItem },
  render: (args) => (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">discount.ts</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <FileRowMenuItems {...args} />
      </DropdownMenuContent>
    </DropdownMenu>
  ),
} satisfies Meta<typeof FileRowMenuItems>;

export default meta;
type Story = StoryObj<typeof meta>;

export const File: Story = {};
export const Folder: Story = { args: { isDir: true } };
