import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { SkillDriftBanner } from "@/modules/sandboxes/components/skills/skill-drift-banner";
import { SkillSetActions } from "@/modules/sandboxes/components/skills/skill-set-actions";
import { SkillsSearchHeader } from "@/modules/sandboxes/components/skills/skills-search-header";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

interface Args {
  initialQuery: string;
  withNotice: boolean;
  withActions: boolean;
}

function Header({ initialQuery, withNotice, withActions }: Args) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <SkillsHarness agentId={IDS.codingAgent} query={query}>
      {(surface, derived) => (
        <SkillsSearchHeader
          query={query}
          onQueryChange={setQuery}
          totals={derived.totals}
          matchCount={derived.matchCount}
          notice={
            withNotice && derived.drifted.length > 0 ? (
              <SkillDriftBanner
                drifted={derived.drifted}
                busy={surface.updatingAll}
                onUpdateAll={fn()}
              />
            ) : undefined
          }
          actions={
            withActions ? (
              <SkillSetActions
                canSave={derived.anyInstalled}
                previewReady={derived.previewReady}
                onAddSets={fn()}
                onSaveSet={fn()}
              />
            ) : undefined
          }
        />
      )}
    </SkillsHarness>
  );
}

const meta = {
  title: "Components/Sandboxes/Skills/SkillsSearchHeader",
  parameters: { layout: "padded" },
  args: { initialQuery: "", withNotice: true, withActions: true },
  render: (args) => (
    <div className="max-w-3xl">
      <Header {...args} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As the skills page composes it: drift notice and skill-set actions. */
export const Default: Story = {};
/** A query swaps the totals for a match count. */
export const Searching: Story = { args: { initialQuery: "review" } };
/** Header alone, no notice or actions. */
export const Bare: Story = { args: { withNotice: false, withActions: false } };
