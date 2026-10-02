import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { StaleModelNotice } from "@/modules/sandboxes/components/skills/stale-model-notice";

import { IDS } from "../../../backend/scenario";

type Args = Omit<ComponentProps<typeof StaleModelNotice>, "model">;

const loadModel = async () => {
  const { snapshot } = await api.harnessConfig.snapshot.query({
    agentId: IDS.hibernatedAgent,
  });
  return { model: snapshot?.model ?? "" };
};
type Loaded = Awaited<ReturnType<typeof loadModel>>;

const meta = {
  title: "Components/Sandboxes/Skills/StaleModelNotice",
  parameters: { layout: "padded" },
  loaders: [loadModel],
  args: { comingUp: false, onStartAndFix: fn() },
  render: (args, { loaded }) => (
    <div className="max-w-3xl">
      <StaleModelNotice {...args} model={(loaded as Loaded).model} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** The agent is starting after "Start & fix". */
export const ComingUp: Story = { args: { comingUp: true } };
