import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import {
  StandaloneSkillsEmptyState,
  StandaloneSkillsGroup,
} from "@/modules/sandboxes/components/skills/standalone-skills-group";

import { type LoadedSkills, loadSkills } from "./skills-harness";

type Args = Omit<
  ComponentProps<typeof StandaloneSkillsGroup>,
  "skills" | "publishes"
>;

const meta = {
  title: "Components/Sandboxes/Skills/StandaloneSkillsGroup",
  parameters: { layout: "padded" },
  loaders: [() => loadSkills()],
  args: {
    readOnly: false,
    canPublish: true,
    onPublish: fn(),
    onDownload: fn(),
    onDelete: fn(),
    onTrack: fn(),
    onOpenSkill: fn(),
    trackUnavailableNames: new Set<string>(),
  },
  render: (args, { loaded }) => {
    const { local, state } = loaded as LoadedSkills;
    return (
      <div className="max-w-2xl">
        <StandaloneSkillsGroup
          {...args}
          skills={local.filter(
            (s) => s.origin === undefined || s.origin === "user",
          )}
          publishes={state.instancePublishes}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ReadOnly: Story = { args: { readOnly: true } };
/** `StandaloneSkillsEmptyState`: nothing created in this agent yet. */
export const Empty: Story = {
  render: () => (
    <div className="max-w-2xl">
      <StandaloneSkillsEmptyState />
    </div>
  ),
};
