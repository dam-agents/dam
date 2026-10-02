import type { Meta, StoryObj } from "@storybook/react-vite";

import { PermissionStatusLine } from "../../../modules/sessions/components/permission-prompt.js";
import { seedPendingPermissions } from "./permission-fixtures";

/** The "Awaiting approval" line at the end of the agent's reply while a
 *  permission prompt is open. Renders nothing with no pending request. */
const meta = {
  title: "Components/Sessions/PermissionStatusLine",
  component: PermissionStatusLine,
  parameters: { layout: "padded" },
  loaders: [seedPendingPermissions()],
  decorators: [
    (Story) => (
      <div className="max-w-[813px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PermissionStatusLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Awaiting: Story = {};
