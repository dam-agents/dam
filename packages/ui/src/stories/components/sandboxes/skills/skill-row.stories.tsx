import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { Card } from "@/components/ui/card";
import { gitCompareUrl } from "@/lib/git-source";
import { isDrifted } from "@/modules/sandboxes/components/skills/skill-drift";
import { SkillRow } from "@/modules/sandboxes/components/skills/skill-row";

import {
  installedRefFor,
  type LoadedSkills,
  loadSkills,
} from "./skills-harness";

type Args = Omit<
  ComponentProps<typeof SkillRow>,
  "skill" | "installed" | "hasDrift" | "compareUrl"
> & { pick: "installed" | "available" | "drifted" };

const ACME = "skill-src-7d2a91c4";

const meta = {
  title: "Components/Sandboxes/Skills/SkillRow",
  parameters: { layout: "padded" },
  loaders: [() => loadSkills()],
  args: {
    pick: "installed",
    busy: false,
    disabled: false,
    onToggle: fn(),
    onUpdate: fn(),
    onOpen: fn(),
  },
  argTypes: { pick: { control: false } },
  render: ({ pick, ...args }, { loaded }) => {
    const { sources, skillsBySource, state } = loaded as LoadedSkills;
    const source = sources.find((s) => s.id === ACME)!;
    const refOf = installedRefFor(state.installed);
    const skills = skillsBySource[ACME]!;
    const skill = skills.find((s) => {
      const ref = refOf(s.source, s.name);
      if (pick === "available") return !ref;
      if (pick === "drifted") return isDrifted(ref, s);
      return ref && !isDrifted(ref, s);
    })!;
    const ref = refOf(skill.source, skill.name);
    const hasDrift = isDrifted(ref, skill);
    return (
      <Card className="max-w-2xl">
        <SkillRow
          {...args}
          skill={skill}
          installed={ref !== undefined}
          hasDrift={hasDrift}
          compareUrl={
            hasDrift && ref
              ? gitCompareUrl(source.gitUrl, ref.version, skill.version)
              : null
          }
        />
      </Card>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Installed: Story = {};
export const Available: Story = { args: { pick: "available" } };
/** Upstream moved since install: "Update" and a GitHub compare link. */
export const Drifted: Story = { args: { pick: "drifted" } };
/** A toggle for this skill is in flight. */
export const Busy: Story = { args: { busy: true } };
/** Mutations are paused (agent not operable). */
export const Disabled: Story = { args: { disabled: true } };
/** No `onOpen`: the name is plain text, not a link. */
export const NotOpenable: Story = { args: { onOpen: undefined } };
