import { Add } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { SkillsStoppedPanel } from "@/modules/sandboxes/components/skills/skills-stopped-panel";
import { StaleModelNotice } from "@/modules/sandboxes/components/skills/stale-model-notice";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Args = Pick<
  ComponentProps<typeof SkillsStoppedPanel>,
  "comingUp" | "onStart" | "onRescan" | "onRemove" | "onManageConnections"
> & { staleModel: boolean };

// The same "Add source" button SkillsSurface passes in.
const addSourceButton = (
  <Button variant="outline" size="sm">
    <Add size={16} /> Add source
  </Button>
);

const loadModel = async () => {
  const { snapshot } = await api.harnessConfig.snapshot.query({
    agentId: IDS.hibernatedAgent,
  });
  return { model: snapshot?.model ?? "" };
};
type Loaded = Awaited<ReturnType<typeof loadModel>>;

const meta = {
  title: "Components/Sandboxes/Skills/SkillsStoppedPanel",
  parameters: { layout: "padded" },
  loaders: [loadModel],
  args: {
    staleModel: false,
    comingUp: false,
    onStart: fn(),
    onRescan: fn(),
    onRemove: fn(),
    onManageConnections: fn(),
  },
  render: ({ staleModel, ...args }, { loaded }) => (
    <div className="max-w-3xl">
      <SkillsHarness agentId={IDS.hibernatedAgent} readOnly>
        {(surface, derived) => (
          <SkillsStoppedPanel
            {...args}
            onCount={derived.snapshotOnCount}
            rows={derived.snapshotRows}
            sources={surface.sources}
            sourcesLoaded={surface.sourcesLoaded}
            visibilityBySource={surface.visibilityBySource}
            scannedAtBySource={surface.scannedAtBySource}
            loadingBySource={surface.loadingBySource}
            revalidatingBySource={surface.revalidatingBySource}
            errorBySource={surface.errorBySource}
            addSourceButton={addSourceButton}
            callout={
              staleModel ? (
                <StaleModelNotice
                  model={(loaded as Loaded).model}
                  comingUp={args.comingUp}
                  onStartAndFix={fn()}
                />
              ) : undefined
            }
          />
        )}
      </SkillsHarness>
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The hibernated agent's recorded skills, read-only until it runs. */
export const Default: Story = {};
export const ComingUp: Story = { args: { comingUp: true } };
/** With the stale-model callout SkillsSurface adds when the saved model is gone. */
export const WithStaleModelNotice: Story = { args: { staleModel: true } };
