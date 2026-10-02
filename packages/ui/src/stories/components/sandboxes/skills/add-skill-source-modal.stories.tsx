import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { AddSkillSourceModal } from "@/modules/sandboxes/components/skills/add-skill-source-modal";

import { IDS } from "../../../backend/scenario";
import { ensureScenario } from "./skills-harness";

type Args = Omit<
  ComponentProps<typeof AddSkillSourceModal>,
  "sources" | "initialFiles"
> & { withFiles: boolean };

/** Existing sources (for duplicate checks) and a dropped .md file built from
 *  the coding agent's runbook skill. */
const load = async () => {
  ensureScenario("populated");
  const sources = await api.skills.sources.list.query();
  const { files } = await api.skills.readLocal.query({
    agentId: IDS.codingAgent,
    name: "checkout-runbook",
  });
  const manifest = files.find((f) => f.relPath === "SKILL.md");
  const dropped = new File([manifest?.content ?? ""], "checkout-runbook.md", {
    type: "text/markdown",
  });
  return { sources, dropped };
};
type Loaded = Awaited<ReturnType<typeof load>>;

const meta = {
  title: "Components/Sandboxes/Skills/AddSkillSourceModal",
  loaders: [load],
  args: {
    initialTab: "github",
    withFiles: false,
    onClose: fn(),
    onCreate: fn(async () => null),
    onCreateSkills: fn(async () => ({ ok: true as const })),
  },
  render: ({ withFiles, ...args }, { loaded }) => {
    const { sources, dropped } = loaded as Loaded;
    return (
      <AddSkillSourceModal
        {...args}
        sources={sources}
        initialFiles={withFiles ? [dropped] : undefined}
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GithubRepository: Story = {};
export const UploadTab: Story = { args: { initialTab: "upload" } };
/** A .md file dropped on the skills page opens straight onto Upload. */
export const UploadWithDroppedFile: Story = {
  args: { initialTab: "upload", withFiles: true },
};
