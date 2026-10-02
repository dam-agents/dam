import type { Meta, StoryObj } from "@storybook/react-vite";

import { SandboxModelSettings } from "@/modules/sandboxes/components/sandbox-model-settings";
import { useHarnessConfigDraft } from "@/modules/sandboxes/hooks/use-harness-config-draft";

import { IDS } from "../../backend/scenario";

/** `draft` is the real hook the settings form wires in. */
function WithDraft({ agentId }: { agentId: string }) {
  const draft = useHarnessConfigDraft(agentId);
  return <SandboxModelSettings agentId={agentId} draft={draft} />;
}

const meta = {
  title: "Components/Sandboxes/SandboxModelSettings",
  component: WithDraft,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[760px]">
        <Story />
      </div>
    ),
  ],
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof WithDraft>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Running agent: editable model picker. */
export const Running: Story = {};

/** Hibernated agent: read-only, with the start-to-edit action. */
export const Hibernated: Story = { args: { agentId: IDS.hibernatedAgent } };
