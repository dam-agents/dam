import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { FilesPanel } from "../../../modules/files/components/files-panel.js";
import { seedAgents } from "../agents/story-helpers";
import { openWorkspace } from "./file-fixtures";

/** The chat sidebar's file tree over checkout-service's fixture workspace.
 *  Rows (`FileRow`, `DirContents`, `InlineNameRow`) render inside it. */
const meta = {
  title: "Components/Files/FilesPanel",
  component: FilesPanel,
  loaders: [seedAgents(), openWorkspace()],
  decorators: [
    (Story) => (
      <div className="flex h-screen w-[280px] flex-col border-r border-border">
        <Story />
      </div>
    ),
  ],
  args: { open: true, onToggle: fn(), onOpenFile: fn() },
} satisfies Meta<typeof FilesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Root: Story = {};

export const FoldersExpanded: Story = {
  loaders: [
    openWorkspace({
      expanded: ["src", "src/pricing"],
      openFile: "src/pricing/discount.ts",
    }),
  ],
};

export const Collapsed: Story = { args: { open: false } };
