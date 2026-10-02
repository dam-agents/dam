import type { Meta, StoryObj } from "@storybook/react-vite";

import { SessionListSkeleton } from "../../../modules/sessions/components/session-list-skeleton.js";

/** Placeholder rows while the session list loads. */
const meta = {
  title: "Components/Sessions/SessionListSkeleton",
  component: SessionListSkeleton,
  decorators: [
    (Story) => (
      <div className="w-[280px] border-r border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionListSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SixRows: Story = { args: { rows: 6 } };
