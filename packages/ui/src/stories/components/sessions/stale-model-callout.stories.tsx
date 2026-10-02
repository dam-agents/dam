import type { Meta, StoryObj } from "@storybook/react-vite";

import { StaleModelCallout } from "../../../modules/sessions/components/model-settings-snapshot.js";

/** Warns that a stopped agent's saved model is no longer offered. */
const meta = {
  title: "Components/Sessions/StaleModelCallout",
  component: StaleModelCallout,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[600px]">
        <Story />
      </div>
    ),
  ],
  args: { model: "claude-3-7-sonnet-20250219" },
} satisfies Meta<typeof StaleModelCallout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
