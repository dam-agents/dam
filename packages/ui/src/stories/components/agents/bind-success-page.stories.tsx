import type { Meta, StoryObj } from "@storybook/react-vite";

import { getBrand } from "@/brand";

import { BindSuccessPage } from "../../../modules/agents/components/bind/bind-success-page.js";
import { CommandChip } from "../../../modules/agents/components/bind/command-chip.js";
import { IDS } from "../../backend/scenario";
import { fixtureAgent } from "./story-helpers";

const agent = fixtureAgent(IDS.slackAgent);

/** Reads the brand at render time: it loads after the story modules do. */
function SlackSuccessCopy() {
  const brand = getBrand();
  return (
    <>
      <p>
        Mention <CommandChip>@{brand.name}</CommandChip> in the channel to use
        it. If the channel has more than one agent, add the name:{" "}
        <CommandChip>
          @{brand.name} {agent.name}
        </CommandChip>
      </p>
      <p>
        Disconnect anytime with{" "}
        <CommandChip>
          /{brand.short} unbind {agent.name}
        </CommandChip>
        .
      </p>
    </>
  );
}

/** Children as the Slack bind success view passes them (without its ambient
 *  mode card, which belongs to the Sandboxes stories). */
const meta = {
  title: "Components/Agents/BindSuccessPage",
  component: BindSuccessPage,
  args: {
    messenger: "slack",
    title: `${agent.name} has been added to #help-platform`,
    children: <SlackSuccessCopy />,
  },
} satisfies Meta<typeof BindSuccessPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slack: Story = {};
