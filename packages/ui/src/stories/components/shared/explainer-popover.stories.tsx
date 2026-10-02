import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { ExplainerPopover } from "@/components/explainer-popover";

const meta = {
  title: "Components/Shared/ExplainerPopover",
  component: ExplainerPopover,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-h-[320px] items-center p-8">
        <Story />
      </div>
    ),
  ],
  args: {
    label: "What a satellite is",
    children: (
      <>
        <p>
          A satellite is a machine outside the platform that offers tools to
          your agents. It connects out to the platform, so nothing has to reach
          in.
        </p>
        <p>Only the agents you add it to can call its tools.</p>
      </>
    ),
  },
} satisfies Meta<typeof ExplainerPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed: just the help trigger. */
export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole("button"));
  },
};

export const OpenBelow: Story = {
  args: { side: "bottom" },
  play: Open.play,
};
