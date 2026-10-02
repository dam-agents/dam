import type { Meta, StoryObj } from "@storybook/react-vite";

import { api } from "@/api";
import { KnowledgeSection } from "@/modules/knowledge-bases/components/knowledge-section";

import { IDS } from "../../backend/scenario";

const loadAgent = (id: string) => async () => ({
  agent: await api.agents.get.query({ id }),
});
type Loaded = Awaited<ReturnType<ReturnType<typeof loadAgent>>>;

const meta = {
  title: "Components/KnowledgeBases/KnowledgeSection",
  parameters: { layout: "padded" },
  render: (_args, { loaded }) => {
    const { agent } = loaded as Loaded;
    return (
      <div className="max-w-2xl">
        <KnowledgeSection agent={agent} />
      </div>
    );
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A knowledge-base agent: sharing controls plus connected KBs. */
export const KnowledgeBaseAgent: Story = { loaders: [loadAgent(IDS.kbAgent)] };
/** Any other agent: only connected KBs. */
export const RegularAgent: Story = { loaders: [loadAgent(IDS.codingAgent)] };
