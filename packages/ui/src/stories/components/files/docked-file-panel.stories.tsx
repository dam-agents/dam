import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { DockedFilePanel } from "../../../modules/files/components/docked-file-panel.js";
import { seedAgents } from "../agents/story-helpers";
import { openWorkspace } from "./file-fixtures";

/** The viewer for whatever file the store has open, loaded through the
 *  fixture backend's `files.read`. Renders nothing with no file open. */
const meta = {
  title: "Components/Files/DockedFilePanel",
  component: DockedFilePanel,
  loaders: [seedAgents(), openWorkspace({ openFile: "src/pricing/cart-total.ts" })],
  decorators: [
    (Story) => (
      <div className="flex h-screen w-[720px] flex-col border-l border-border">
        <Story />
      </div>
    ),
  ],
  args: { onOpenFile: fn() },
} satisfies Meta<typeof DockedFilePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenFile: Story = {};

export const Readme: Story = {
  loaders: [openWorkspace({ openFile: "README.md" })],
};
