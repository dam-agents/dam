import type { Meta, StoryObj } from "@storybook/react-vite";
import { platformSkillFeature } from "api-server-api";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { LocalSkillsGroup } from "@/modules/sandboxes/components/skills/local-skills-group";

import { type LoadedSkills, loadSkills } from "./skills-harness";

type Args = Omit<ComponentProps<typeof LocalSkillsGroup>, "skills">;

const meta = {
  title: "Components/Sandboxes/Skills/LocalSkillsGroup",
  parameters: { layout: "padded" },
  loaders: [() => loadSkills()],
  args: { label: "Included with sandbox image" },
  render: (args, { loaded }) => {
    const { local } = loaded as LoadedSkills;
    const builtIn = local.filter(
      (s) =>
        (s.origin === "system" || s.origin === "system-modified") &&
        !platformSkillFeature(s),
    );
    return (
      <div className="max-w-2xl">
        <LocalSkillsGroup {...args} skills={builtIn} />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No `onOpenSkill` (no agent): names are plain text. */
export const Default: Story = {};
export const Openable: Story = { args: { onOpenSkill: fn() } };
