import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import { LocalSkillRenderModal } from "@/modules/sandboxes/components/skills/local-skill-render-modal";

import { IDS } from "../../../backend/scenario";
import { type LoadedSkills, loadSkills } from "./skills-harness";

type Args = Omit<
  ComponentProps<typeof LocalSkillRenderModal>,
  "skill" | "agentId" | "publish" | "footer"
> & {
  pick: "created-here" | "built-in";
  /** Read with another agent's id, which has no such skill: the error state. */
  wrongAgent: boolean;
  withFooter: boolean;
};

const meta = {
  title: "Components/Sandboxes/Skills/LocalSkillRenderModal",
  loaders: [() => loadSkills()],
  args: {
    pick: "created-here",
    wrongAgent: false,
    withFooter: true,
    onDownload: fn(),
    onClose: fn(),
  },
  render: ({ pick, wrongAgent, withFooter, ...args }, { loaded }) => {
    const { agentId, local, state } = loaded as LoadedSkills;
    const skill = local.find((s) =>
      pick === "built-in" ? s.origin === "system" : s.origin === "user",
    )!;
    const publish = state.instancePublishes.find(
      (p) => p.skillName === skill.name,
    );
    return (
      <LocalSkillRenderModal
        {...args}
        skill={skill}
        agentId={wrongAgent ? IDS.kbAgent : agentId}
        publish={publish}
        footer={
          withFooter && pick === "created-here" ? (
            // The footer SkillsModals passes for a skill created here.
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger-light hover:text-danger"
            >
              Delete skill
            </Button>
          ) : undefined
        }
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Created in this agent and published (PR chip), with a Delete footer. */
export const CreatedHere: Story = {};
/** Ships with the sandbox image. */
export const BuiltIn: Story = { args: { pick: "built-in" } };
/** SKILL.md couldn't be read. */
export const ReadFailed: Story = { args: { wrongAgent: true } };
