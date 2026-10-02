import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { FreeUpComputeItems } from "../../../modules/agents/components/power-menu-items.js";
import { codingAgent } from "./story-helpers";

/** The "Free up compute" group of an agent's actions menu, shown open inside
 *  a real dropdown the way the agent row and chat header mount it. */
const meta = {
  title: "Components/Agents/FreeUpComputeItems",
  component: FreeUpComputeItems,
  parameters: { layout: "padded" },
  render: (args) => (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Agent actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <FreeUpComputeItems {...args} />
        <DropdownMenuItem>Restart</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  args: { agent: codingAgent(), onPause: fn(), onStop: fn() },
} satisfies Meta<typeof FreeUpComputeItems>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** An always-on agent can't be paused. */
export const AlwaysOn: Story = {
  args: { agent: codingAgent({ hibernationTimeoutMin: 0 }) },
};
