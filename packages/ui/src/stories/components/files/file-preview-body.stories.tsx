import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { FilePreviewBody } from "../../../modules/files/components/file-preview-body.js";
import { codingFile } from "./file-fixtures";

/** The body of the file viewer, per file type. Text comes from the
 *  checkout-service fixture workspace. */
const meta = {
  title: "Components/Files/FilePreviewBody",
  component: FilePreviewBody,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[720px] text-sm">
        <Story />
      </div>
    ),
  ],
  args: {
    file: codingFile("src/pricing/discount.ts"),
    editMode: false,
    draft: codingFile("src/pricing/discount.ts").content,
    onDraftChange: fn(),
    onSave: fn(),
    renderSvg: true,
    renderMd: true,
    renderHtml: true,
    pdfBlobUrl: null,
    onOpenFile: fn(),
  },
} satisfies Meta<typeof FilePreviewBody>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HighlightedCode: Story = {};

export const MarkdownRendered: Story = {
  args: { file: codingFile("README.md") },
};

/** With the viewer's render toggle off. */
export const MarkdownSource: Story = {
  args: { file: codingFile("README.md"), renderMd: false },
};

export const Editing: Story = { args: { editMode: true } };

export const Binary: Story = {
  args: {
    file: {
      path: "test/fixtures/receipt.bin",
      content: btoa(codingFile("CLAUDE.md").content),
      binary: true,
      mimeType: "application/octet-stream",
    },
  },
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
