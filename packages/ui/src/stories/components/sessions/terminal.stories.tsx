import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Terminal } from "../../../modules/sessions/components/terminal.js";
import { IDS } from "../../backend/scenario";

/** The browser terminal of a terminal session. The fake backend has no
 *  terminal socket, so only the disconnected state can be shown here, not a
 *  live shell. */
const meta = {
  title: "Components/Sessions/Terminal",
  component: Terminal,
  decorators: [
    (Story) => (
      <div className="flex h-[480px] flex-col">
        <Story />
      </div>
    ),
  ],
  args: {
    agentId: IDS.codingAgent,
    sessionId: IDS.session2,
    onConnected: fn(),
    onFirstOutput: fn(),
    onFirstSubmit: fn(),
    onSubmit: fn(),
  },
} satisfies Meta<typeof Terminal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = { args: { autoConnect: false } };
