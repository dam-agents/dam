import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { getBrand } from "@/brand";

import { AgentBindPicker } from "../../../modules/agents/components/bind/agent-bind-picker.js";
import { bindErrorCopy } from "../../../modules/slack/lib/bind-flow.js";
import { SLACK_PICKER_COPY, TELEGRAM_PICKER_COPY } from "./bind-copy";
import { seedAgents } from "./story-helpers";

/** The agent picker of the Slack / Telegram bind pages, reading the fixture
 *  agent list. */
const meta = {
  title: "Components/Agents/AgentBindPicker",
  component: AgentBindPicker,
  loaders: [seedAgents()],
  args: {
    copy: SLACK_PICKER_COPY,
    error: null,
    pending: false,
    onPick: fn(),
    onAgentCreated: fn(),
  },
} satisfies Meta<typeof AgentBindPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slack: Story = {};
export const Telegram: Story = { args: { copy: TELEGRAM_PICKER_COPY } };

/** The error copy is built at render time: it names the brand, which loads
 *  after the story modules do. */
export const WithError: Story = {
  render: (args) => (
    <AgentBindPicker
      {...args}
      error={bindErrorCopy("CONFLICT", getBrand().short)}
    />
  ),
};

/** No agents yet: the page offers the inline create form. */
export const NoAgents: Story = { loaders: [seedAgents([])] };
