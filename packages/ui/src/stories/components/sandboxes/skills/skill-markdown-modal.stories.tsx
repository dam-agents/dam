import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { repoSlug } from "@/lib/git-source";
import {
  SkillChip,
  SkillMarkdownModal,
} from "@/modules/sandboxes/components/skills/skill-markdown-modal";

import { ensureScenario } from "./skills-harness";

const SOURCE_ID = "skill-src-seed-anthropic-skills";
const NAME = "webapp-testing";

const load = async () => {
  ensureScenario("populated");
  const sources = await api.skills.sources.list.query();
  const { skills } = await api.skills.listWithScan.query({
    sourceId: SOURCE_ID,
  });
  const content = await api.skills.getSkillContent.query({
    sourceId: SOURCE_ID,
    name: NAME,
  });
  return {
    ...content,
    source: sources.find((s) => s.id === SOURCE_ID)!,
    skill: skills.find((s) => s.name === NAME)!,
  };
};
type Loaded = Awaited<ReturnType<typeof load>>;

type Args = Omit<
  ComponentProps<typeof SkillMarkdownModal>,
  "title" | "content" | "path" | "chips"
>;

const meta = {
  title: "Components/Sandboxes/Skills/SkillMarkdownModal",
  loaders: [load],
  args: {
    isPending: false,
    isError: false,
    onDownload: fn(),
    onClose: fn(),
  },
  render: (args, { loaded }) => {
    const { content, dir, source, skill } = loaded as Loaded;
    return (
      <SkillMarkdownModal
        {...args}
        title={NAME}
        chips={
          <>
            <SkillChip>{repoSlug(source.gitUrl)}</SkillChip>
            <SkillChip className="font-mono">
              {skill.version.slice(0, 7)}
            </SkillChip>
          </>
        }
        path={`${dir}/SKILL.md`}
        content={args.isPending || args.isError ? undefined : content}
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Pending: Story = { args: { isPending: true } };
export const ReadFailed: Story = { args: { isError: true } };
