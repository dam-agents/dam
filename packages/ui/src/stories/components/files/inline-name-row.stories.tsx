import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { InlineNameRow } from "../../../modules/files/components/inline-name-row.js";

/** The name field the file tree shows for New file / New folder / Rename.
 *  Enter commits, Escape cancels. */
const meta = {
  title: "Components/Files/InlineNameRow",
  component: InlineNameRow,
  decorators: [
    (Story) => (
      <div className="w-[280px] border-r border-border">
        <Story />
      </div>
    ),
  ],
  args: { kind: "file", depth: 1, onCommit: fn(), onCancel: fn() },
} satisfies Meta<typeof InlineNameRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewFile: Story = { args: { placeholder: "new-file.ts" } };
export const NewFolder: Story = {
  args: { kind: "dir", placeholder: "new-folder" },
};
export const Rename: Story = { args: { initial: "cart-total.ts", depth: 2 } };
