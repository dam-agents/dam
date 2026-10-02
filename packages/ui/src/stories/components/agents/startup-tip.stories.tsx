import type { Meta, StoryObj } from "@storybook/react-vite";

import { StartupTip } from "../../../modules/agents/components/startup-tip.js";
import { AGENTS } from "../../backend/fixtures/agents";

/** The rotating tip under the "starting" overlay. It fades in after a second
 *  and picks a new random tip every six seconds. */
const meta = {
  title: "Components/Agents/StartupTip",
  component: StartupTip,
  parameters: { layout: "centered" },
  args: { sandbox: AGENTS[0]!.name },
} satisfies Meta<typeof StartupTip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
