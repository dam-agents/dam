import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { AddSkillSetsModal } from "@/modules/sandboxes/components/skills/add-skill-sets-modal";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Args = Pick<
  ComponentProps<typeof AddSkillSetsModal>,
  "loadFailed" | "applying" | "onApply" | "onDelete" | "onClose"
> & { agentId: string };

const meta = {
  title: "Components/Sandboxes/Skills/AddSkillSetsModal",
  args: {
    agentId: IDS.codingAgent,
    loadFailed: false,
    applying: false,
    onApply: fn(async () => true),
    onDelete: fn(async () => true),
    onClose: fn(),
  },
  argTypes: { agentId: { control: false } },
  render: ({ agentId, loadFailed, applying, ...args }) => (
    <SkillsHarness agentId={agentId}>
      {(surface, derived) => (
        <AddSkillSetsModal
          {...args}
          sets={surface.sets}
          loadFailed={loadFailed || surface.setsFailed}
          available={derived.availableKeys}
          installedKeys={derived.installedKeys}
          unreadableSources={derived.unreadableSources}
          ready={derived.previewReady}
          applying={applying || surface.applyingSets}
        />
      )}
    </SkillsHarness>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Saved sets, previewed against the coding agent's sources and installs. */
export const Default: Story = {};
/** A different agent, so the sets preview differently. */
export const OtherAgent: Story = { args: { agentId: IDS.kbAgent } };
export const Applying: Story = { args: { applying: true } };
export const LoadFailed: Story = { args: { loadFailed: true } };
