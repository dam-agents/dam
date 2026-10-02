import type { Meta, StoryObj } from "@storybook/react-vite";

import { WelcomeEntryPoints } from "../../../modules/agents/components/welcome-entry-points.js";
import { resetState } from "./story-helpers";

/** The first-run welcome on the home page, before any agent exists. The brand
 *  name comes from `getBrand()`. */
const meta = {
  title: "Components/Agents/WelcomeEntryPoints",
  component: WelcomeEntryPoints,
  parameters: { layout: "padded" },
  loaders: [() => (resetState(), {})],
  decorators: [
    (Story) => (
      <div className="max-w-[880px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WelcomeEntryPoints>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
