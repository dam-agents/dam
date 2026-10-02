import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { NotificationsPanel } from "@/modules/home/components/notifications-panel";
import type { ActivityView } from "@/modules/platform/store/sidebar";
import { queryClient } from "@/query-client";
import { useStore } from "@/store";

import { type Scenario, setScenario } from "../../backend/scenario";

const setup =
  (s: Scenario, activityView: ActivityView): Decorator =>
  (Story) => {
    useState(() => {
      setScenario(s);
      queryClient.clear();
      useStore.setState({ activityView });
    });
    return <Story />;
  };

const meta = {
  title: "Components/Home/NotificationsPanel",
  component: NotificationsPanel,
  args: { onClose: fn() },
} satisfies Meta<typeof NotificationsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Activity drawer: filters, approvals entry and the session feed. */
export const Activity: Story = { decorators: [setup("populated", "feed")] };

/** "Needs you": only pending approvals. */
export const NeedsYou: Story = {
  decorators: [setup("populated", "approvals")],
};

export const Empty: Story = { decorators: [setup("empty", "feed")] };
