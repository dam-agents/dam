import type { Meta, StoryObj } from "@storybook/react-vite";

import { ConnectedKnowledgeBases } from "@/modules/knowledge-bases/components/connected-knowledge-bases";

import { IDS } from "../../backend/scenario";

const meta = {
  title: "Components/KnowledgeBases/ConnectedKnowledgeBases",
  component: ConnectedKnowledgeBases,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof ConnectedKnowledgeBases>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The fake backend has no shared-KB connections, so the list is empty. */
export const NoneConnected: Story = {};
