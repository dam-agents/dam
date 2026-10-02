import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { AgentPickerCard } from "../../../modules/agents/components/bind/agent-picker-card.js";
import { IDS } from "../../backend/scenario";
import { codingAgent, fixtureAgent, seedAgents } from "./story-helpers";

const meta = {
  title: "Components/Agents/AgentPickerCard",
  component: AgentPickerCard,
  parameters: { layout: "padded" },
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="max-w-[788px]">
        <Story />
      </div>
    ),
  ],
  args: {
    agent: codingAgent(),
    selected: false,
    activeSchedules: 0,
    onSelect: fn(),
  },
} satisfies Meta<typeof AgentPickerCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };
export const WithSchedules: Story = { args: { activeSchedules: 3 } };
export const Hibernated: Story = {
  args: { agent: fixtureAgent(IDS.hibernatedAgent) },
};
export const WithSlackChannel: Story = {
  args: { agent: fixtureAgent(IDS.slackAgent) },
};
export const AlwaysOn: Story = {
  args: { agent: codingAgent({ hibernationTimeoutMin: 0 }) },
};
export const InstallFailed: Story = {
  args: {
    agent: codingAgent({
      contributionFailures: [
        { kind: "skill", message: "code-review: SKILL.md missing frontmatter" },
      ],
    }),
  },
};
