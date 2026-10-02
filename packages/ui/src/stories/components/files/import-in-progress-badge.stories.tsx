import type { Meta, StoryObj } from "@storybook/react-vite";

import { useStore } from "@/store";

import { ImportInProgressBadge } from "../../../modules/files/components/import-in-progress-badge.js";
import { IDS } from "../../backend/scenario";
import { resetState } from "../agents/story-helpers";

/** Shown while files are being imported into the agent's workspace. Renders
 *  nothing when no import is running. */
const meta = {
  title: "Components/Files/ImportInProgressBadge",
  component: ImportInProgressBadge,
  parameters: { layout: "centered" },
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof ImportInProgressBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Importing: Story = {
  loaders: [
    () => {
      resetState();
      useStore.setState({ importingAgents: { [IDS.codingAgent]: 1 } });
      return {};
    },
  ],
};

export const Idle: Story = { loaders: [() => (resetState(), {})] };
