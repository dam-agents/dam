import type { Meta, StoryObj } from "@storybook/react-vite";

import type { AgentView } from "@/types";

import { OutdatedTemplatesBanner } from "../../../modules/agents/components/outdated-templates-banner.js";
import { AGENTS } from "../../backend/fixtures/agents";
import { seedAgents } from "./story-helpers";

const outdated = (a: AgentView): AgentView => ({
  ...a,
  templateUpdate: {
    fromImage: a.image,
    toImage: a.image.replace(":latest", ":next"),
  },
});

/** Shows once two or more agents have a newer image; with fewer it renders
 *  nothing (the row's own Update action covers a single agent). */
const meta = {
  title: "Components/Agents/OutdatedTemplatesBanner",
  component: OutdatedTemplatesBanner,
  parameters: { layout: "padded" },
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="max-w-[880px]">
        <Story />
      </div>
    ),
  ],
  args: { agents: AGENTS.map((a, i) => (i < 3 ? outdated(a) : a)) },
} satisfies Meta<typeof OutdatedTemplatesBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeOutdated: Story = {};

export const OnlyOneOutdated: Story = {
  args: { agents: AGENTS.map((a, i) => (i === 0 ? outdated(a) : a)) },
};
