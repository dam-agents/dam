import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { SaveSkillSetModal } from "@/modules/sandboxes/components/skills/save-skill-set-modal";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Args = Pick<
  ComponentProps<typeof SaveSkillSetModal>,
  "onCreate" | "onClose"
> & {
  agentId: string;
};

const meta = {
  title: "Components/Sandboxes/Skills/SaveSkillSetModal",
  args: {
    agentId: IDS.codingAgent,
    onCreate: fn(async () => true),
    onClose: fn(),
  },
  argTypes: { agentId: { control: false } },
  render: ({ agentId, ...args }) => (
    <SkillsHarness agentId={agentId}>
      {(surface, derived) =>
        // The modal snapshots its groups on mount, so wait for the preview.
        derived.previewReady ? (
          <SaveSkillSetModal
            {...args}
            groups={derived.setGroups}
            omitted={derived.saveOmitted}
            isOn={(skill) =>
              surface.installedRef(skill.source, skill.name) !== undefined
            }
            existingNames={derived.existingSetNames}
          />
        ) : null
      }
    </SkillsHarness>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The coding agent's on skills, pre-checked. */
export const Default: Story = {};
export const OtherAgent: Story = { args: { agentId: IDS.slackAgent } };
