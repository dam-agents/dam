import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatColumn } from "../../../modules/sessions/components/chat-column.js";
import { MARKDOWN_TEXT } from "./chat-fixtures";

/** The centred reading column (813px max) the chat, composer and permission
 *  prompt share. Outlined here to show its bounds. */
const meta = {
  title: "Components/Sessions/ChatColumn",
  component: ChatColumn,
  args: {
    className: "outline outline-1 outline-dashed outline-border py-4 text-sm",
    children: <p>{MARKDOWN_TEXT}</p>,
  },
} satisfies Meta<typeof ChatColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
