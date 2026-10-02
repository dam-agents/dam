import { Add } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import { SkillSourcesSection } from "@/modules/sandboxes/components/skills/skill-sources-section";

import { IDS, type Scenario } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Args = Pick<
  ComponentProps<typeof SkillSourcesSection>,
  | "readOnly"
  | "onOpenSkill"
  | "onAddSets"
  | "onToggleAll"
  | "onRemove"
  | "onManageConnections"
> & { query: string; scenario: Scenario };

// The same "Add source" button SkillsSurface passes in.
const addSourceButton = (
  <Button variant="outline" size="sm">
    <Add size={16} /> Add source
  </Button>
);

function Section({ query, scenario, ...args }: Args) {
  return (
    <SkillsHarness
      agentId={IDS.codingAgent}
      readOnly={args.readOnly}
      query={query}
      scenario={scenario}
    >
      {(surface, derived) => (
        <SkillSourcesSection
          {...args}
          surface={surface}
          derived={derived}
          action={addSourceButton}
        />
      )}
    </SkillsHarness>
  );
}

const meta = {
  title: "Components/Sandboxes/Skills/SkillSourcesSection",
  parameters: { layout: "padded" },
  args: {
    query: "",
    scenario: "populated",
    readOnly: false,
    onOpenSkill: fn(),
    onAddSets: fn(),
    onToggleAll: fn(),
    onRemove: fn(),
    onManageConnections: fn(),
  },
  argTypes: { scenario: { control: false } },
  render: (args) => (
    <div className="max-w-3xl">
      <Section {...args} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** A search narrows every source card to its matches. */
export const Searching: Story = { args: { query: "test" } };
/** No sources connected (empty backend). */
export const NoSources: Story = { args: { scenario: "empty" } };
