import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { SkillSourceList } from "@/modules/sandboxes/components/skills/skills-source-list";

import { IDS } from "../../../backend/scenario";
import { SkillsHarness } from "./skills-harness";

type Args = Pick<
  ComponentProps<typeof SkillSourceList>,
  "onRescan" | "onRemove" | "onManageConnections"
> & { state: "loaded" | "loading" | "empty" | "scanning" | "failed" };

const meta = {
  title: "Components/Sandboxes/Skills/SkillSourceList",
  parameters: { layout: "padded" },
  args: {
    state: "loaded",
    onRescan: fn(),
    onRemove: fn(),
    onManageConnections: fn(),
  },
  render: ({ state, ...args }) => (
    <div className="max-w-2xl">
      <SkillsHarness agentId={IDS.hibernatedAgent} readOnly>
        {(surface) => {
          const first = surface.sources[0]?.id;
          return (
            <SkillSourceList
              {...args}
              sources={state === "empty" ? [] : surface.sources}
              loaded={state !== "loading" && surface.sourcesLoaded}
              visibilityBySource={surface.visibilityBySource}
              scannedAtBySource={surface.scannedAtBySource}
              loadingBySource={
                state === "scanning" && first
                  ? { ...surface.loadingBySource, [first]: true }
                  : surface.loadingBySource
              }
              revalidatingBySource={surface.revalidatingBySource}
              errorBySource={
                state === "failed" && first
                  ? {
                      ...surface.errorBySource,
                      [first]: {
                        code: "needs_sandbox",
                        title: "This source needs a sandbox to scan it",
                        detail:
                          "The repository isn't public, so reading it requires a running sandbox's GitHub connection.",
                      },
                    }
                  : surface.errorBySource
              }
            />
          );
        }}
      </SkillsHarness>
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The compact source list shown while the agent is stopped. */
export const Default: Story = {};
export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty" } };
export const Scanning: Story = { args: { state: "scanning" } };
export const ScanFailed: Story = { args: { state: "failed" } };
