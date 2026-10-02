import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { NewSessionLauncher } from "../../../modules/sessions/components/new-session-launcher.js";
import { IDS } from "../../backend/scenario";
import { fixtureAgent, seedAgents } from "../agents/story-helpers";

const agent = fixtureAgent(IDS.codingAgent);

/** The "other ways in" tiles on a new chat. The Slack tile shows because the
 *  fixture install has Slack configured. */
const meta = {
  title: "Components/Sessions/NewSessionLauncher",
  component: NewSessionLauncher,
  parameters: { layout: "centered" },
  loaders: [seedAgents()],
  args: { agentId: agent.id, agentName: agent.name, onNewTerminal: fn() },
} satisfies Meta<typeof NewSessionLauncher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LocalTerminalDialog: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText("Local Terminal"));
  },
};

export const EditorDialog: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText("VS Code / Zed"));
  },
};
