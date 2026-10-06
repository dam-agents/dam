import type { Meta, StoryObj } from "@storybook/react-vite";

import { BackgroundWorkIndicator } from "../../../modules/sessions/components/background-work-indicator.js";

/** Shown under a settled reply while the agent still runs background tasks.
 *  Hover for the task list. Renders nothing with no items. */
const meta = {
  title: "Components/Sessions/BackgroundWorkIndicator",
  component: BackgroundWorkIndicator,
  parameters: { layout: "centered" },
  args: {
    items: [
      {
        id: "bash_1",
        description: "Watch the test suite",
        command: "pnpm vitest --watch",
      },
    ],
  },
} satisfies Meta<typeof BackgroundWorkIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneTask: Story = {};
export const SeveralTasks: Story = {
  args: {
    items: [
      {
        id: "bash_1",
        description: "Watch the test suite",
        command: "pnpm vitest --watch",
      },
      { id: "bash_2", command: "pnpm dev" },
    ],
  },
};
