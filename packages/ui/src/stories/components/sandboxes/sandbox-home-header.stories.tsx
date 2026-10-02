import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import { resolveAgentDisplay } from "@/modules/agents/utils/agent-resolver";
import { SandboxHomeHeader } from "@/modules/sandboxes/components/sandbox-home-header";

import { IDS } from "../../backend/scenario";
import { loadAgent } from "./load";

type Args = Omit<ComponentProps<typeof SandboxHomeHeader>, "agent" | "display">;

const load = (id: string) => async () => ({ agent: await loadAgent(id) });
type Loaded = Awaited<ReturnType<ReturnType<typeof load>>>;

/** `display` is resolved with the same helper the page uses. */
const meta = {
  title: "Components/Sandboxes/SandboxHomeHeader",
  parameters: { layout: "padded" },
  render: (args, { loaded }) => {
    const { agent } = loaded as Loaded;
    return (
      <div className="max-w-[760px]">
        <SandboxHomeHeader
          {...args}
          agent={agent}
          display={resolveAgentDisplay(agent, new Set())}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = { loaders: [load(IDS.codingAgent)] };
export const Hibernated: Story = { loaders: [load(IDS.hibernatedAgent)] };

/** Mid-restart: the status reads "starting" and power actions are off. */
export const Restarting: Story = {
  loaders: [load(IDS.codingAgent)],
  render: (args, { loaded }) => {
    const { agent } = loaded as Loaded;
    return (
      <div className="max-w-[760px]">
        <SandboxHomeHeader
          {...args}
          agent={agent}
          display={resolveAgentDisplay(agent, new Set([agent.id]))}
        />
      </div>
    );
  },
};

/** Avatar follows the unsaved name draft. */
export const RenamingDraft: Story = {
  loaders: [load(IDS.codingAgent)],
  args: { avatarName: "payments-service" },
};
