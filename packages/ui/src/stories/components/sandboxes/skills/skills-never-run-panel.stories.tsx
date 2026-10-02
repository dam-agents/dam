import { Add } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import { SkillsNeverRunPanel } from "@/modules/sandboxes/components/skills/skills-never-run-panel";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Args = Pick<
  ComponentProps<typeof SkillsNeverRunPanel>,
  "comingUp" | "onStart" | "onRescan" | "onRemove" | "onManageConnections"
>;

// The same "Add source" button SkillsSurface passes in.
const addSourceButton = (
  <Button variant="outline" size="sm">
    <Add size={16} /> Add source
  </Button>
);

const meta = {
  title: "Components/Sandboxes/Skills/SkillsNeverRunPanel",
  parameters: { layout: "padded" },
  args: {
    comingUp: false,
    onStart: fn(),
    onRescan: fn(),
    onRemove: fn(),
    onManageConnections: fn(),
  },
  render: (args) => (
    <div className="max-w-3xl">
      <SkillsHarness agentId={IDS.freshAgent} readOnly>
        {(surface) => (
          <SkillsNeverRunPanel
            {...args}
            sources={surface.sources}
            sourcesLoaded={surface.sourcesLoaded}
            visibilityBySource={surface.visibilityBySource}
            scannedAtBySource={surface.scannedAtBySource}
            loadingBySource={surface.loadingBySource}
            revalidatingBySource={surface.revalidatingBySource}
            errorBySource={surface.errorBySource}
            addSourceButton={addSourceButton}
          />
        )}
      </SkillsHarness>
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** "Start agent" was pressed and the agent is coming up. */
export const ComingUp: Story = { args: { comingUp: true } };
