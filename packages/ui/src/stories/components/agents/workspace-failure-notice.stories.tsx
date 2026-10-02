import type { Meta, StoryObj } from "@storybook/react-vite";

import { WorkspaceFailureNotice } from "../../../modules/agents/components/workspace-failure-notice.js";
import { IDS } from "../../backend/scenario";
import { codingAgent, seedAgents } from "./story-helpers";

/** One strip per failed workspace step above the chat. Retry shows once the
 *  platform has stopped retrying on its own. */
const meta = {
  title: "Components/Agents/WorkspaceFailureNotice",
  component: WorkspaceFailureNotice,
  parameters: { layout: "fullscreen" },
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof WorkspaceFailureNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GaveUp: Story = {
  loaders: [
    seedAgents([
      codingAgent({
        workspaceFailures: [
          {
            kind: "workspace-command",
            error: "pnpm install exited with code 1",
            settled: true,
            attempts: 3,
            maxAttempts: 3,
          },
        ],
      }),
    ]),
  ],
};

export const Retrying: Story = {
  loaders: [
    seedAgents([
      codingAgent({
        workspaceFailures: [
          {
            kind: "workspace-seed",
            error: "git clone: could not resolve host github.com",
            settled: false,
            attempts: 2,
            maxAttempts: 3,
          },
        ],
      }),
    ]),
  ],
};

export const BothSteps: Story = {
  loaders: [
    seedAgents([
      codingAgent({
        workspaceFailures: [
          {
            kind: "workspace-seed",
            error: "git clone: repository not found",
            settled: true,
            attempts: 3,
            maxAttempts: 3,
          },
          {
            kind: "workspace-command",
            error: "bash bootstrap.sh exited with code 127",
            settled: false,
            attempts: 1,
            maxAttempts: 3,
          },
        ],
      }),
    ]),
  ],
};
