import type { Meta, StoryObj } from "@storybook/react-vite";

import { SnapshotNote } from "../../../modules/sessions/components/model-settings-snapshot.js";
import { ago } from "../../backend/scenario";

/** The note above a stopped agent's model settings. `capturedAt` matches the
 *  hibernated fixture agent's snapshot (three days ago). */
const meta = {
  title: "Components/Sessions/SnapshotNote",
  component: SnapshotNote,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[600px]">
        <Story />
      </div>
    ),
  ],
  args: { capturedAt: ago(60 * 24 * 3) },
} satisfies Meta<typeof SnapshotNote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeDaysAgo: Story = {};
export const JustNow: Story = { args: { capturedAt: ago(1) } };
