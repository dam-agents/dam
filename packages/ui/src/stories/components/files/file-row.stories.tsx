import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { FileRow } from "../../../modules/files/components/file-row.js";
import {
  FilesPanelContext,
  useFilesPanelController,
} from "../../../modules/files/components/files-panel-controller.js";
import { seedAgents } from "../agents/story-helpers";
import { openWorkspace } from "./file-fixtures";

/** A row needs the files panel's context; the real controller provides it
 *  for checkout-service's workspace, as `FilesPanel` does. */
function FileRowStory(props: ComponentProps<typeof FileRow>) {
  const controller = useFilesPanelController({ onOpenFile: fn() });
  return (
    <div className="w-[280px] border-r border-border">
      <FilesPanelContext.Provider value={controller.ctxValue}>
        <FileRow {...props} />
      </FilesPanelContext.Provider>
    </div>
  );
}

const meta = {
  title: "Components/Files/FileRow",
  component: FileRow,
  loaders: [seedAgents(), openWorkspace()],
  render: (args) => <FileRowStory {...args} />,
  args: {
    name: "discount.ts",
    path: "src/pricing/discount.ts",
    type: "file",
    depth: 2,
    isDot: false,
    isCollapsed: true,
    dropActive: false,
  },
} satisfies Meta<typeof FileRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const File: Story = {};

/** The file open in the viewer is highlighted. */
export const OpenFile: Story = {
  loaders: [openWorkspace({ openFile: "src/pricing/discount.ts" })],
};

export const Markdown: Story = {
  args: { name: "README.md", path: "README.md", depth: 0 },
};

export const DotFile: Story = {
  args: { name: ".env.example", path: ".env.example", depth: 0, isDot: true },
};

export const FolderCollapsed: Story = {
  args: { name: "src", path: "src", type: "dir", depth: 0 },
};

export const FolderExpanded: Story = {
  args: { name: "src", path: "src", type: "dir", depth: 0, isCollapsed: false },
};

/** Files dragged over a folder. */
export const DropTarget: Story = {
  args: { ...FolderCollapsed.args, dropActive: true },
};
