import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useStore } from "@/store";

import { SessionsSidebar } from "../../../modules/sessions/components/sessions-sidebar.js";
import { IDS } from "../../backend/scenario";
import { seedAgents } from "../agents/story-helpers";

/** The chat's session list for the selected agent, read from the agent's
 *  fixture sessions. */
const openAgent = (agentId: string, sessionId: string | null = null) => () => {
  useStore.setState({ selectedAgent: agentId, sessionId });
  return {};
};

const meta = {
  title: "Components/Sessions/SessionsSidebar",
  component: SessionsSidebar,
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="flex h-screen w-[280px] flex-col border-r border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    onToggle: fn(),
    onResumeSession: fn(),
    onNewSession: fn(),
  },
} satisfies Meta<typeof SessionsSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CodingAgent: Story = {
  loaders: [openAgent(IDS.codingAgent, IDS.session1)],
};

export const SlackAgent: Story = {
  loaders: [openAgent(IDS.slackAgent)],
};

export const NoSessions: Story = {
  loaders: [openAgent(IDS.freshAgent)],
};

export const Collapsed: Story = {
  loaders: [openAgent(IDS.codingAgent)],
  args: { open: false },
};
