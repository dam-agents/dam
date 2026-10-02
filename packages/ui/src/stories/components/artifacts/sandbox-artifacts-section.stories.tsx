import type { Meta, StoryObj } from "@storybook/react-vite";

import { SandboxArtifactsSection } from "@/modules/artifacts/components/sandbox-artifacts-section";

import { IDS } from "../../backend/scenario";
import { restoreScenario, scenarioLoader } from "./artifact-fixtures";

/** An agent's Artifacts tab: explainer plus folder-grouped rows. Fetches its own data. */
const meta = {
  title: "Components/Artifacts/SandboxArtifactsSection",
  component: SandboxArtifactsSection,
  parameters: { layout: "padded" },
  loaders: [scenarioLoader],
  beforeEach: restoreScenario,
  args: { agentId: IDS.codingAgent },
  argTypes: {
    agentId: { control: "select", options: Object.values(IDS).slice(0, 5) },
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SandboxArtifactsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CodingAgent: Story = {};
export const KnowledgeBaseAgent: Story = { args: { agentId: IDS.kbAgent } };
/** Nothing published yet. */
export const Empty: Story = { args: { agentId: IDS.freshAgent } };
/** Whole backend empty (no artifacts, no folders). */
export const EmptyScenario: Story = { parameters: { scenario: "empty" } };
