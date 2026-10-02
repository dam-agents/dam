import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { ModelIndicator } from "../../../modules/sessions/components/model-indicator.js";

/** The model name under the composer; click for the explanation popover. The
 *  model is checkout-service's fixture model. */
const meta = {
  title: "Components/Sessions/ModelIndicator",
  component: ModelIndicator,
  parameters: { layout: "centered" },
  args: { model: "Claude Sonnet 4.5", subject: "agent" },
} satisfies Meta<typeof ModelIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

const open = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button"));
};

export const Default: Story = {};
export const Open: Story = { play: open };
export const OpenWithSettingsLink: Story = {
  args: { settings: { label: "Agent Setup", onConfigure: fn() } },
  play: open,
};
