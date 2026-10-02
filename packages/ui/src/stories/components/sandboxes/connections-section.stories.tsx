import type { Meta, StoryObj } from "@storybook/react-vite";

import { routeToPath } from "@/modules/platform/lib/routes";
import { ConnectionsSection } from "@/modules/sandboxes/components/connections-section";

import { IDS } from "../../backend/scenario";

const returnTo = (agentId: string) =>
  routeToPath({
    view: "sandbox-home",
    agentId,
    sandboxSection: "connections",
  });

/** The sandbox page's Connections section: granted connections grouped by
 *  provider, read from the fake backend. */
const meta = {
  title: "Components/Sandboxes/ConnectionsSection",
  component: ConnectionsSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[760px]">
        <Story />
      </div>
    ),
  ],
  args: {
    agentId: IDS.codingAgent,
    oauthReturnView: returnTo(IDS.codingAgent),
  },
} satisfies Meta<typeof ConnectionsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CheckoutService: Story = {};

export const TriageBot: Story = {
  args: {
    agentId: IDS.slackAgent,
    oauthReturnView: returnTo(IDS.slackAgent),
  },
};

/** onboarding-helper holds only its provider connection, which is hidden. */
export const OnlyProvider: Story = {
  args: {
    agentId: IDS.freshAgent,
    oauthReturnView: returnTo(IDS.freshAgent),
  },
};
