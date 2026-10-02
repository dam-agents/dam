import type { Meta, StoryObj } from "@storybook/react-vite";

import { SandboxSetupSection } from "@/modules/sandboxes/components/sandbox-setup-section";
import { useSandboxSettingsForm } from "@/modules/sandboxes/hooks/use-sandbox-settings-form";
import { useStore } from "@/store";

import { IDS } from "../../backend/scenario";

/** `f` is the real settings-form hook, which reads the agent from the
 *  store's route. */
function WithForm() {
  const f = useSandboxSettingsForm();
  return <SandboxSetupSection f={f} />;
}

const meta = {
  title: "Components/Sandboxes/SandboxSetupSection",
  component: WithForm,
  parameters: { layout: "padded" },
} satisfies Meta<typeof WithForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const atAgent = (agentId: string): NonNullable<Story["decorators"]> => [
  (Story) => {
    useStore.setState({ agentId, sandboxSection: "setup" });
    return (
      <div className="max-w-[760px]">
        <Story />
      </div>
    );
  },
];

export const Running: Story = { decorators: atAgent(IDS.codingAgent) };
export const Hibernated: Story = { decorators: atAgent(IDS.hibernatedAgent) };
