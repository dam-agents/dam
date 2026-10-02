import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { OpenInTerminalDialog } from "@/modules/sandboxes/components/open-in-dialogs";

import { IDS } from "../../backend/scenario";
import { loadAgent } from "./load";

type Args = Omit<
  ComponentProps<typeof OpenInTerminalDialog>,
  "agentId" | "agentName"
>;

const load = async () => ({ agent: await loadAgent(IDS.codingAgent) });
type Loaded = Awaited<ReturnType<typeof load>>;

/** From open-in-dialogs.tsx. */
const meta = {
  title: "Components/Sandboxes/OpenInTerminalDialog",
  loaders: [load],
  args: { onClose: fn() },
  render: (args, { loaded }) => {
    const { agent } = loaded as Loaded;
    return (
      <OpenInTerminalDialog
        {...args}
        agentId={agent.id}
        agentName={agent.name}
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
