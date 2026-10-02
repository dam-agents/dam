import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { FileViewer } from "../../../modules/files/components/file-viewer.js";
import { seedAgents } from "../agents/story-helpers";
import { codingFile, openWorkspace } from "./file-fixtures";

/** The docked file preview/editor, over checkout-service fixture files. */
const meta = {
  title: "Components/Files/FileViewer",
  component: FileViewer,
  loaders: [seedAgents(), openWorkspace({ openFile: "src/pricing/discount.ts" })],
  decorators: [
    (Story) => (
      <div className="flex h-screen w-[720px] flex-col border-l border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    file: codingFile("src/pricing/discount.ts"),
    onClose: fn(),
    onOpenFile: fn(),
  },
} satisfies Meta<typeof FileViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Code: Story = {};

export const MarkdownRendered: Story = {
  loaders: [openWorkspace({ openFile: "README.md" })],
  args: { file: codingFile("README.md") },
};

export const Json: Story = {
  loaders: [openWorkspace({ openFile: "package.json" })],
  args: { file: codingFile("package.json") },
};

/** Opened with "Edit" from the file tree. */
export const Editing: Story = {
  loaders: [openWorkspace({ openFile: "src/pricing/discount.ts", edit: true })],
};

export const TooLarge: Story = {
  args: {
    file: {
      path: "pnpm-lock.yaml",
      content: "",
      mimeType: "text/yaml",
      tooLarge: true,
    },
  },
};

/** Rendered previews (markdown, SVG, HTML) can open full-window. */
export const Fullscreen: Story = {
  ...MarkdownRendered,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Open fullscreen" }),
    );
  },
};
