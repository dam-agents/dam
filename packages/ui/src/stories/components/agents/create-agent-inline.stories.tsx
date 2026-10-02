import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CreateAgentInline } from "../../../modules/agents/components/create-agent-inline.js";
import { seedAgents } from "./story-helpers";

/** The compact create form the bind pages embed. Harnesses and providers
 *  come from the fixture templates and connections. */
const meta = {
  title: "Components/Agents/CreateAgentInline",
  component: CreateAgentInline,
  parameters: { layout: "padded" },
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="max-w-[788px]">
        <Story />
      </div>
    ),
  ],
  args: { onCreated: fn() },
} satisfies Meta<typeof CreateAgentInline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
