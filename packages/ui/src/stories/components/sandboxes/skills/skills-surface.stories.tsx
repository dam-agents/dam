import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { SkillsSurface } from "@/modules/sandboxes/components/skills/skills-surface";

import { IDS, type Scenario } from "../../../backend/scenario";
import { useScenario } from "./skills-harness";

function WithScenario({
  scenario,
  children,
}: {
  scenario: Scenario;
  children: ReactNode;
}) {
  useScenario(scenario);
  return <>{children}</>;
}

const meta = {
  title: "Components/Sandboxes/Skills/SkillsSurface",
  component: SkillsSurface,
  args: {
    agentId: IDS.codingAgent,
    agentState: "running",
    readOnly: false,
    comingUp: false,
  },
  parameters: { layout: "padded", scenario: "populated" },
  decorators: [
    (Story, { parameters }) => (
      <WithScenario scenario={parameters.scenario as Scenario}>
        <div className="max-w-3xl">
          <Story />
        </div>
      </WithScenario>
    ),
  ],
} satisfies Meta<typeof SkillsSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A running agent: created-here, sourced, platform and built-in skills. */
export const Running: Story = {};
/** Another running agent with a lighter setup. */
export const KnowledgeBaseAgent: Story = {
  args: { agentId: IDS.kbAgent },
};
/** Hibernated: the read-only snapshot of what starts next time. */
export const Stopped: Story = {
  args: {
    agentId: IDS.hibernatedAgent,
    agentState: "hibernated",
    readOnly: true,
  },
};
/** Hibernated and starting up. */
export const StoppedComingUp: Story = {
  args: { ...Stopped.args, comingUp: true },
};
/** Empty backend: no sources, nothing created here. */
export const Empty: Story = { parameters: { scenario: "empty" } };
