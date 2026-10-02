import type { Meta, StoryObj } from "@storybook/react-vite";
import { platformSkillFeature } from "api-server-api";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { PlatformSkillsGroup } from "@/modules/sandboxes/components/skills/platform-skills-group";

import { type LoadedSkills, loadSkills } from "./skills-harness";

type Args = Omit<ComponentProps<typeof PlatformSkillsGroup>, "skills">;

const meta = {
  title: "Components/Sandboxes/Skills/PlatformSkillsGroup",
  parameters: { layout: "padded" },
  loaders: [() => loadSkills()],
  args: { onOpenSkill: fn(), onOpenSection: fn() },
  render: (args, { loaded }) => {
    const { local } = loaded as LoadedSkills;
    return (
      <div className="max-w-2xl">
        <PlatformSkillsGroup
          {...args}
          skills={local.filter((s) => platformSkillFeature(s))}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Feature badges link to their sandbox section where one exists. */
export const Default: Story = {};
/** No agent: names and badges are not interactive. */
export const Static: Story = {
  args: { onOpenSkill: undefined, onOpenSection: undefined },
};
