import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { SkillDriftBanner } from "@/modules/sandboxes/components/skills/skill-drift-banner";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Args = Omit<ComponentProps<typeof SkillDriftBanner>, "drifted">;

const meta = {
  title: "Components/Sandboxes/Skills/SkillDriftBanner",
  parameters: { layout: "padded" },
  args: { busy: false, onUpdateAll: fn() },
  render: (args) => (
    <div className="max-w-3xl">
      <SkillsHarness agentId={IDS.codingAgent}>
        {(_, derived) =>
          derived.drifted.length > 0 ? (
            <SkillDriftBanner {...args} drifted={derived.drifted} />
          ) : null
        }
      </SkillsHarness>
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The coding agent's out-of-date skills, as the skills page derives them. */
export const Default: Story = {};
/** "Update all" is running. */
export const Updating: Story = { args: { busy: true } };
