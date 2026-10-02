import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { OverlayFrame } from "../../../modules/agents/components/overlay-frame.js";

/** The full-bleed cover the chat's agent overlays share. It fills its nearest
 *  positioned parent; the back arrow only shows at mobile widths. */
const meta = {
  title: "Components/Agents/OverlayFrame",
  component: OverlayFrame,
  decorators: [
    (Story) => (
      <div className="relative h-screen">
        <Story />
      </div>
    ),
  ],
  args: {
    onBack: fn(),
    children: (
      <>
        <Spinner size={40} />
        <p className="max-w-105 text-sm text-muted-foreground">
          Loading agent…
        </p>
      </>
    ),
  },
} satisfies Meta<typeof OverlayFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithFooter: Story = {
  args: { footer: <Button variant="outline">Footer action</Button> },
};
