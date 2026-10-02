import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SandboxList } from "../../../modules/agents/components/sandbox-list.js";
import { useAgentRows } from "../../../modules/agents/hooks/use-agent-rows.js";
import { splitTemporarySandboxes } from "../../../modules/agents/utils/temporary-sandboxes.js";
import { AGENTS } from "../../backend/fixtures/agents";
import { IDS } from "../../backend/scenario";
import { seedAgents } from "./story-helpers";

/** The home page's agent list: every fixture agent, with the row props the
 *  real `useAgentRows` hook builds. */
function SandboxListStory({
  working,
  onStop,
  onDelete,
}: {
  working?: ReadonlyMap<string, boolean>;
  onStop: () => void;
  onDelete: () => void;
}) {
  const { rowProps } = useAgentRows();
  const { visible, drawByDriver } = splitTemporarySandboxes(AGENTS);
  return (
    <div className="max-w-[880px]">
      <SandboxList
        agents={visible}
        drawByDriver={drawByDriver}
        rowProps={rowProps}
        workingByAgent={working}
        onStop={onStop}
        onDelete={onDelete}
      />
    </div>
  );
}

const meta = {
  title: "Components/Agents/SandboxList",
  component: SandboxListStory,
  parameters: { layout: "padded" },
  loaders: [seedAgents()],
  args: { onStop: fn(), onDelete: fn() },
} satisfies Meta<typeof SandboxListStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OneWorking: Story = {
  args: { working: new Map([[IDS.codingAgent, true]]) },
};
