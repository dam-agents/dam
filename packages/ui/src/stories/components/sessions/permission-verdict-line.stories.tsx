import type { Meta, StoryObj } from "@storybook/react-vite";

import { PermissionVerdictLine } from "../../../modules/sessions/components/permission-prompt.js";
import { EXECUTE_CHIP } from "./chat-fixtures";

/** What the user answered, left in the reply after a permission prompt.
 *  Labels are the ones the prompt writes per option kind. Click to expand a
 *  long subject. */
const meta = {
  title: "Components/Sessions/PermissionVerdictLine",
  component: PermissionVerdictLine,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[813px]">
        <Story />
      </div>
    ),
  ],
  args: {
    verdict: {
      kind: "verdict",
      label: "Allowed once",
      subject: EXECUTE_CHIP.title,
      allowed: true,
    },
  },
} satisfies Meta<typeof PermissionVerdictLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllowedOnce: Story = {};

export const AlwaysAllowed: Story = {
  args: {
    verdict: {
      kind: "verdict",
      label: "Always allowed",
      subject: EXECUTE_CHIP.title,
      allowed: true,
    },
  },
};

export const Denied: Story = {
  args: {
    verdict: {
      kind: "verdict",
      label: "Denied",
      subject: EXECUTE_CHIP.title,
      allowed: false,
    },
  },
};
