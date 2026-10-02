import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import { SandboxSkillsSection } from "@/modules/sandboxes/components/sandbox-skills-section";

import { IDS } from "../../backend/scenario";
import { loadAgent } from "./load";

type Args = Omit<ComponentProps<typeof SandboxSkillsSection>, "agent">;

const load = (id: string) => async () => ({ agent: await loadAgent(id) });
type Loaded = Awaited<ReturnType<ReturnType<typeof load>>>;

/** Wraps SkillsSurface; read-only when the agent isn't running. */
const meta = {
  title: "Components/Sandboxes/SandboxSkillsSection",
  parameters: { layout: "padded" },
  render: (args, { loaded }) => (
    <div className="max-w-[760px]">
      <SandboxSkillsSection {...args} agent={(loaded as Loaded).agent} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = { loaders: [load(IDS.codingAgent)] };
export const Hibernated: Story = { loaders: [load(IDS.hibernatedAgent)] };
