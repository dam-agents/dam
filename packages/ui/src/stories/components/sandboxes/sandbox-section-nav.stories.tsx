import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SandboxSectionNav } from "@/modules/sandboxes/components/sandbox-section-nav";
import { useSectionSummaries } from "@/modules/sandboxes/hooks/use-section-summaries";
import type { AgentView } from "@/types";

import { IDS } from "../../backend/scenario";
import { loadAgent } from "./load";

const meta = {
  title: "Components/Sandboxes/SandboxSectionNav",
  component: SandboxSectionNav,
  parameters: { layout: "padded" },
  args: { active: "setup", onNavigate: fn() },
} satisfies Meta<typeof SandboxSectionNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No summaries: every row shows "—". */
export const Bare: Story = {};

/** Summaries and warnings from the real hook the sandbox page uses. */
function WithRealSummaries(
  props: Omit<
    Parameters<typeof SandboxSectionNav>[0],
    "summaries" | "warnings"
  > & {
    agent: AgentView;
  },
) {
  const { summaries, warnings } = useSectionSummaries(props.agent);
  return (
    <SandboxSectionNav
      active={props.active}
      onNavigate={props.onNavigate}
      summaries={summaries}
      warnings={warnings}
    />
  );
}

export const WithSummaries: Story = {
  loaders: [async () => ({ agent: await loadAgent(IDS.codingAgent) })],
  render: (args, { loaded }) => (
    <WithRealSummaries
      {...args}
      agent={(loaded as { agent: AgentView }).agent}
    />
  ),
};

export const ConnectionsActive: Story = {
  ...WithSummaries,
  args: { active: "connections" },
};
