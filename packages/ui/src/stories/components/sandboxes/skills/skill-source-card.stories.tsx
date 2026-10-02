import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { SkillSourceCard } from "@/modules/sandboxes/components/skills/skill-source-card";

import {
  installedRefFor,
  type LoadedSkills,
  loadSkills,
} from "./skills-harness";

type Args = Omit<
  ComponentProps<typeof SkillSourceCard>,
  "source" | "skills" | "scannedAt" | "visibility" | "installedRef"
> & {
  sourceId: string;
  /** `loading` = scan not back yet; `empty` = the scan found no skills. */
  skillsState: "loaded" | "loading" | "empty";
  /** Show only these skills, as a search would. */
  matching?: string[];
};

const meta = {
  title: "Components/Sandboxes/Skills/SkillSourceCard",
  parameters: { layout: "padded" },
  loaders: [() => loadSkills()],
  args: {
    sourceId: "skill-src-7d2a91c4",
    skillsState: "loaded",
    loading: false,
    revalidating: false,
    error: null,
    busyKey: null,
    disabled: false,
    stateLoaded: true,
    readOnly: false,
    bulkBusy: false,
    onToggle: fn(),
    onRescan: fn(),
    onRemove: fn(),
    onUpdate: fn(),
    onOpenSkill: fn(),
    onToggleAll: fn(),
    onManageConnections: fn(),
  },
  argTypes: {
    sourceId: {
      control: "select",
      options: ["skill-src-7d2a91c4", "skill-src-seed-anthropic-skills"],
    },
  },
  render: ({ sourceId, skillsState, matching, ...args }, { loaded }) => {
    const { sources, scanBySource, state } = loaded as LoadedSkills;
    const source = sources.find((s) => s.id === sourceId)!;
    const scan = scanBySource[sourceId]!;
    const skills =
      skillsState === "loading"
        ? undefined
        : skillsState === "empty"
          ? []
          : scan.skills;
    return (
      <div className="max-w-2xl">
        <SkillSourceCard
          {...args}
          source={source}
          skills={skills}
          scannedAt={skillsState === "loading" ? undefined : scan.scannedAt}
          visibility={scan.visibility}
          installedRef={installedRefFor(state.installed)}
          filteredNames={matching ? new Set(matching) : null}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A private source with some skills on, one out of date. Available skills
 *  start collapsed. */
export const PrivateSource: Story = {};
/** The seeded system source: public, and cannot be removed. */
export const SystemSource: Story = {
  args: { sourceId: "skill-src-seed-anthropic-skills" },
};
export const Loading: Story = {
  args: { skillsState: "loading", loading: true },
};
export const Rescanning: Story = { args: { revalidating: true } };
export const NoSkills: Story = { args: { skillsState: "empty" } };
export const ScanFailed: Story = {
  args: {
    skillsState: "loading",
    error: {
      code: "needs_github_connection",
      title: "Can't load skills from this source",
      detail:
        "The repository may be private or the URL may not be valid. Add a GitHub connection or check the URL, then re-scan.",
    },
  },
};
/** A search narrowed the card to matching skills. */
export const Filtered: Story = {
  args: { matching: ["code-review", "release-notes"] },
};
/** Enable/disable all is in flight. */
export const BulkBusy: Story = { args: { bulkBusy: true } };
export const ReadOnly: Story = { args: { readOnly: true, disabled: true } };
