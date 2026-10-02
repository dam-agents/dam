import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import {
  type SkillsModal,
  SkillsModals,
} from "@/modules/sandboxes/components/skills/skills-modals";
import type { SkillsDerivations } from "@/modules/sandboxes/hooks/use-skills-derivations";
import type { SkillsSurface } from "@/modules/sandboxes/hooks/use-skills-surface";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Kind = SkillsModal["kind"];

type Args = Pick<
  ComponentProps<typeof SkillsModals>,
  "onPublish" | "onDeleteLocal" | "onClose"
> & { kind: Kind };

/** Builds the `open` value SkillsSurface would set, from real surface data. */
function openFor(
  kind: Kind,
  surface: SkillsSurface,
  derived: SkillsDerivations,
): SkillsModal | null {
  const createdHere = derived.shownCreatedHere[0];
  const source = surface.sources.find((s) => surface.skillsBySource[s.id]);
  const skill = source && surface.skillsBySource[source.id]?.[0];
  switch (kind) {
    case "add-source":
      return { kind, tab: "github", files: [] };
    case "add-sets":
    case "save-set":
      return derived.previewReady ? { kind } : null;
    case "publish":
      return createdHere ? { kind, skill: createdHere } : null;
    case "render-local":
      return createdHere ? { kind, skill: createdHere } : null;
    case "render":
      return source && skill ? { kind, source, skill } : null;
  }
}

const meta = {
  title: "Components/Sandboxes/Skills/SkillsModals",
  args: {
    kind: "add-source",
    onPublish: fn(),
    onDeleteLocal: fn(),
    onClose: fn(),
  },
  argTypes: {
    kind: {
      control: "select",
      options: [
        "add-source",
        "add-sets",
        "save-set",
        "publish",
        "render",
        "render-local",
      ],
    },
  },
  render: ({ kind, ...args }) => (
    <SkillsHarness agentId={IDS.codingAgent}>
      {(surface, derived) => (
        <SkillsModals
          {...args}
          open={openFor(kind, surface, derived)}
          agentId={IDS.codingAgent}
          surface={surface}
          derived={derived}
        />
      )}
    </SkillsHarness>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AddSource: Story = {};
export const AddSets: Story = { args: { kind: "add-sets" } };
export const SaveSet: Story = { args: { kind: "save-set" } };
export const Publish: Story = { args: { kind: "publish" } };
/** A source skill's SKILL.md. */
export const RenderSourceSkill: Story = { args: { kind: "render" } };
/** A skill created in this agent, with Publish and Delete in the footer. */
export const RenderLocalSkill: Story = { args: { kind: "render-local" } };
