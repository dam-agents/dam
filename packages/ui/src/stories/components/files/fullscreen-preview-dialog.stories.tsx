import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Markdown } from "../../../components/markdown.js";
import { FullscreenPreviewDialog } from "../../../modules/files/components/fullscreen-preview-dialog.js";
import { CODING_FILES } from "../../backend/agent-fixtures";

/** The full-window preview the file viewer opens. Escape closes it. */
const meta = {
  title: "Components/Files/FullscreenPreviewDialog",
  component: FullscreenPreviewDialog,
  args: {
    title: "README.md",
    onClose: fn(),
    children: <Markdown>{CODING_FILES["README.md"]!}</Markdown>,
  },
} satisfies Meta<typeof FullscreenPreviewDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MarkdownPreview: Story = {};
