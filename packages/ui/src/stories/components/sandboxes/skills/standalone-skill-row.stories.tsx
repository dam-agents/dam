import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SkillPublishRecord } from "api-server-api";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { Card } from "@/components/ui/card";
import { StandaloneSkillRow } from "@/modules/sandboxes/components/skills/standalone-skill-row";

import { type LoadedSkills, loadSkills } from "./skills-harness";

type Args = Omit<
  ComponentProps<typeof StandaloneSkillRow>,
  "skill" | "publish"
> & {
  /** Which state of the fixture's pull request to show; `none` = never published. */
  prState: SkillPublishRecord["prState"] | "none";
};

const meta = {
  title: "Components/Sandboxes/Skills/StandaloneSkillRow",
  parameters: { layout: "padded" },
  loaders: [() => loadSkills()],
  args: {
    prState: "open",
    divided: false,
    readOnly: false,
    canPublish: true,
    onPublish: fn(),
    onDownload: fn(),
    onDelete: fn(),
    onTrack: fn(),
    onOpen: fn(),
    trackUnavailable: false,
  },
  argTypes: {
    prState: {
      control: "select",
      options: ["none", "draft", "open", "merged", "closed"],
    },
  },
  render: ({ prState, ...args }, { loaded }) => {
    const { local, state } = loaded as LoadedSkills;
    const skill = local.find((s) => s.origin === "user")!;
    const record = state.instancePublishes.find(
      (p) => p.skillName === skill.name,
    );
    const publish =
      prState === "none" || !record ? undefined : { ...record, prState };
    return (
      <Card className="max-w-2xl">
        <StandaloneSkillRow {...args} skill={skill} publish={publish} />
      </Card>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Published, pull request still open. */
export const PublishedOpen: Story = {};
export const NotPublished: Story = { args: { prState: "none" } };
/** Merged: the menu offers "Track from <source>". */
export const PublishedMerged: Story = { args: { prState: "merged" } };
/** Closed: the menu offers "Publish again…". */
export const PublishedClosed: Story = { args: { prState: "closed" } };
/** No GitHub source can take a publish. */
export const CannotPublish: Story = {
  args: { prState: "none", canPublish: false },
};
export const ReadOnly: Story = { args: { readOnly: true } };
