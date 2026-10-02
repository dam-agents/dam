import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { PublishSkillModal } from "@/modules/sandboxes/components/skills/publish-skill-modal";

import { type LoadedSkills, loadSkills } from "./skills-harness";

type Args = Omit<ComponentProps<typeof PublishSkillModal>, "skill" | "sources">;

const meta = {
  title: "Components/Sandboxes/Skills/PublishSkillModal",
  loaders: [() => loadSkills()],
  args: { onPublish: fn(async () => true), onClose: fn() },
  render: (args, { loaded }) => {
    const { local, sources } = loaded as LoadedSkills;
    return (
      <PublishSkillModal
        {...args}
        skill={local.find((s) => s.origin === "user")!}
        sources={sources.filter((s) => s.canPublish)}
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
