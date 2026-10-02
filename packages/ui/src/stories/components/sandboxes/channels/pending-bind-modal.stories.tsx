import type { Meta, StoryObj } from "@storybook/react-vite";

import { PendingBindModal } from "@/modules/sandboxes/components/channels/pending-bind-modal";
import { recordBindIntent } from "@/modules/sandboxes/lib/bind-intent";
import { useStore } from "@/store";

import { IDS } from "../../../backend/scenario";

/** The modal opens only when setup recorded a bind intent for the selected
 *  agent; the loader records one the same way the setup flow does. */
const meta = {
  title: "Components/Sandboxes/Channels/PendingBindModal",
  component: PendingBindModal,
  decorators: [
    (Story) => {
      useStore.setState({ selectedAgent: IDS.codingAgent });
      return <Story />;
    },
  ],
} satisfies Meta<typeof PendingBindModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AfterSetupWithSlack: Story = {
  loaders: [
    () => {
      recordBindIntent(IDS.codingAgent, ["slack"]);
      return {};
    },
  ],
};

export const AfterSetupWithSlackAndTelegram: Story = {
  loaders: [
    () => {
      recordBindIntent(IDS.codingAgent, ["slack", "telegram"]);
      return {};
    },
  ],
};

/** No recorded intent: renders nothing. */
export const NoIntent: Story = {};
