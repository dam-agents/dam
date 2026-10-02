import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { useHarnessConfigDraft } from "../../../modules/sandboxes/hooks/use-harness-config-draft.js";
import { ModelSettingsPanel } from "../../../modules/sessions/components/model-settings-panel.js";
import { IDS } from "../../backend/scenario";
import { seedAgents } from "../agents/story-helpers";

/** Agent Setup's model picker. The catalog, live config and stopped-agent
 *  snapshot come from the fixture backend (`harnessConfig.*`); the draft is
 *  the real `useHarnessConfigDraft`. */
function ModelSettingsPanelStory(args: {
  agentId: string;
  disabled?: boolean;
  headerAction?: ReactNode;
}) {
  const draft = useHarnessConfigDraft(args.agentId);
  return (
    <div className="max-w-[640px]">
      <ModelSettingsPanel {...args} draft={draft} />
    </div>
  );
}

const meta = {
  title: "Components/Sessions/ModelSettingsPanel",
  component: ModelSettingsPanelStory,
  parameters: { layout: "padded" },
  loaders: [seedAgents()],
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof ModelSettingsPanelStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

/** The Codex agent's catalog. */
export const OtherHarness: Story = { args: { agentId: IDS.slackAgent } };

/** A hibernated agent shows its last known settings, read-only. */
export const StoppedSnapshot: Story = {
  args: { agentId: IDS.hibernatedAgent, disabled: true },
};
