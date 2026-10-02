import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CodeEditor } from "../../../modules/files/components/code-editor.js";
import { CODING_FILES } from "../../backend/agent-fixtures";

/** The CodeMirror editor the file viewer switches to in edit mode. The
 *  language follows `path`. */
const meta = {
  title: "Components/Files/CodeEditor",
  component: CodeEditor,
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col">
        <Story />
      </div>
    ),
  ],
  args: {
    path: "src/pricing/discount.ts",
    value: CODING_FILES["src/pricing/discount.ts"]!,
    onChange: fn(),
    onSave: fn(),
  },
} satisfies Meta<typeof CodeEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeScript: Story = {};
export const Markdown: Story = {
  args: { path: "README.md", value: CODING_FILES["README.md"]! },
};
export const Json: Story = {
  args: { path: "package.json", value: CODING_FILES["package.json"]! },
};
export const ReadOnly: Story = { args: { readOnly: true } };
