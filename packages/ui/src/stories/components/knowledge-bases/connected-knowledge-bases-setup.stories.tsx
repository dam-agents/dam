import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectedKnowledgeBasesSetup } from "@/modules/knowledge-bases/components/connected-knowledge-bases-setup";

const meta = {
  title: "Components/KnowledgeBases/ConnectedKnowledgeBasesSetup",
  component: ConnectedKnowledgeBasesSetup,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { connectionIds: [], onToggle: fn() },
} satisfies Meta<typeof ConnectedKnowledgeBasesSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingStaged: Story = {};
