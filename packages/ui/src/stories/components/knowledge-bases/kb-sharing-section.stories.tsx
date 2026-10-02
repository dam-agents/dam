import type { Meta, StoryObj } from "@storybook/react-vite";

import { KbSharingSection } from "@/modules/knowledge-bases/components/kb-sharing-section";

import { IDS } from "../../backend/scenario";

const meta = {
  title: "Components/KnowledgeBases/KbSharingSection",
  component: KbSharingSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.kbAgent },
} satisfies Meta<typeof KbSharingSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The knowledge-base agent has a published share in the fake backend. */
export const Shared: Story = {};
/** An agent with no share yet. */
export const NotShared: Story = { args: { agentId: IDS.codingAgent } };
