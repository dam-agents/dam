import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ChatArtifactsPanel } from "@/modules/artifacts/components/chat-artifacts-panel";
import { useStore } from "@/store";

import { IDS } from "../../backend/scenario";
import { ART, scenarioLoader } from "./artifact-fixtures";

/**
 * The "Artifacts" section of the chat sidebar, grouped by folder. Fetches the
 * agent's artifacts and folders itself.
 */
const meta = {
  title: "Components/Artifacts/ChatArtifactsPanel",
  component: ChatArtifactsPanel,
  parameters: { layout: "padded" },
  loaders: [scenarioLoader],
  args: { agentId: IDS.codingAgent, open: true, onToggle: fn() },
  argTypes: {
    agentId: { control: "select", options: Object.values(IDS).slice(0, 5) },
  },
  decorators: [
    (Story) => {
      useStore.setState({ openArtifactId: null, artifactFolderCollapse: {} });
      return (
        <div className="flex h-[600px] w-72 flex-col border border-border bg-card">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof ChatArtifactsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
/** One row highlighted as the artifact open in the docked panel. */
export const WithActiveArtifact: Story = {
  decorators: [
    (Story) => {
      useStore.setState({ openArtifactId: ART.html });
      return <Story />;
    },
  ],
};
/** A different agent's artifacts. */
export const KnowledgeBaseAgent: Story = { args: { agentId: IDS.kbAgent } };
export const Collapsed: Story = { args: { open: false } };
/** Agent with nothing published. */
export const Empty: Story = { args: { agentId: IDS.freshAgent } };
