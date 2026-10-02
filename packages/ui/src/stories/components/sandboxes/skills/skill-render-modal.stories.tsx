import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { isDrifted } from "@/modules/sandboxes/components/skills/skill-drift";
import { SkillRenderModal } from "@/modules/sandboxes/components/skills/skill-render-modal";

import {
  installedRefFor,
  type LoadedSkills,
  loadSkills,
} from "./skills-harness";

type Args = Omit<
  ComponentProps<typeof SkillRenderModal>,
  "source" | "skill" | "agentId" | "visibility" | "installed" | "hasDrift"
> & { pick: "installed" | "available" | "drifted" };

const ACME = "skill-src-7d2a91c4";

const meta = {
  title: "Components/Sandboxes/Skills/SkillRenderModal",
  loaders: [() => loadSkills()],
  args: {
    pick: "installed",
    disabled: false,
    onToggle: fn(),
    onUpdate: fn(),
    onClose: fn(),
  },
  argTypes: {
    pick: { control: "select", options: ["installed", "available", "drifted"] },
  },
  render: ({ pick, ...args }, { loaded }) => {
    const { agentId, sources, scanBySource, state } = loaded as LoadedSkills;
    const source = sources.find((s) => s.id === ACME)!;
    const scan = scanBySource[ACME]!;
    const refOf = installedRefFor(state.installed);
    const skill = scan.skills.find((s) => {
      const ref = refOf(s.source, s.name);
      if (pick === "available") return !ref;
      if (pick === "drifted") return isDrifted(ref, s);
      return ref && !isDrifted(ref, s);
    })!;
    const ref = refOf(skill.source, skill.name);
    return (
      <SkillRenderModal
        {...args}
        source={source}
        skill={skill}
        agentId={agentId}
        visibility={scan.visibility}
        installed={ref !== undefined}
        hasDrift={isDrifted(ref, skill)}
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Installed: Story = {};
export const NotInstalled: Story = { args: { pick: "available" } };
/** Out of date: "Update to latest" in the header. */
export const OutOfDate: Story = { args: { pick: "drifted" } };
/** Mutations paused: the switch and update are disabled. */
export const Disabled: Story = { args: { pick: "drifted", disabled: true } };
