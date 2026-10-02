import type { Meta, StoryObj } from "@storybook/react-vite";

import { WorkingDots } from "../../../modules/sessions/components/working-dots.js";

const meta = {
  title: "Components/Sessions/WorkingDots",
  component: WorkingDots,
  parameters: { layout: "centered" },
  args: { className: "text-accent", title: "Working" },
} satisfies Meta<typeof WorkingDots>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As the session row shows a working session. */
export const Small: Story = {};
/** As the chat shows a reply in progress. */
export const Medium: Story = { args: { size: "md" } };
/** Background work: slower, in the success colour. */
export const BackgroundWork: Story = {
  args: { size: "md", className: "working-dots-slow text-success" },
};
