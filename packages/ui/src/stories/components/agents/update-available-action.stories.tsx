import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { UpdateAvailableAction } from "../../../modules/agents/components/update-available-action.js";
import { codingAgent, seedAgents } from "./story-helpers";

const outdated = codingAgent({
  templateUpdate: {
    fromImage: codingAgent().image.replace(":latest", ":1.4.2"),
    toImage: codingAgent().image.replace(":latest", ":1.5.0"),
  },
});

/** Renders nothing unless the agent has a `templateUpdate`. The hover card's
 *  "See what changed" link comes from the template's release notes URL. */
const meta = {
  title: "Components/Agents/UpdateAvailableAction",
  component: UpdateAvailableAction,
  parameters: { layout: "centered" },
  loaders: [seedAgents()],
  args: { agent: outdated, pending: false, busy: false, onUpdate: fn() },
} satisfies Meta<typeof UpdateAvailableAction>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HoverCard: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(
      within(canvasElement).getByRole("button", { name: /update/i }),
    );
  },
};

export const Updating: Story = { args: { pending: true } };

/** Another agent is updating, so this one waits. */
export const Busy: Story = { args: { busy: true } };
