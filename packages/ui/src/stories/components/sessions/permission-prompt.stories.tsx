import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PermissionPrompt } from "../../../modules/sessions/components/permission-prompt.js";
import { seedPendingPermissions } from "./permission-fixtures";

/** Replaces the chat input while a tool call waits for the user's approval.
 *  It reads the pending requests from the store; number keys pick options. */
const meta = {
  title: "Components/Sessions/PermissionPrompt",
  component: PermissionPrompt,
  parameters: { layout: "padded" },
  loaders: [seedPendingPermissions()],
  args: { onResolved: fn() },
} satisfies Meta<typeof PermissionPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShellCommand: Story = {};

export const WithFileLocation: Story = {
  loaders: [
    seedPendingPermissions(1, "Edit `/home/agent/work/src/pricing/tax.ts`"),
  ],
};

export const MoreQueued: Story = { loaders: [seedPendingPermissions(3)] };

/** A title past three lines is clamped behind "Show more". */
export const LongCommand: Story = {
  loaders: [
    seedPendingPermissions(
      1,
      `\`pnpm vitest run ${Array.from({ length: 30 }, (_, i) => `src/pricing/case-${i}.test.ts`).join(" ")}\``,
    ),
  ],
};
