import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";

import { ConnectionBanner } from "@/components/connection-banner";
import { onFetchError, onFetchSuccess } from "@/lib/api-health";

/** Two failed fetches flip the health store to "reconnecting". The store polls
 *  /api/health and recovers, so keep reporting failures while the story shows. */
const WhileReconnecting: Decorator = (Story) => {
  useEffect(() => {
    const fail = () => {
      onFetchError();
      onFetchError();
    };
    fail();
    const timer = setInterval(fail, 500);
    return () => {
      clearInterval(timer);
      onFetchSuccess();
    };
  }, []);
  return <Story />;
};

/** The store reads navigator.onLine on the browser's offline event. */
const WhileOffline: Decorator = (Story) => {
  useEffect(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new Event("offline"));
    return () => {
      delete (navigator as { onLine?: boolean }).onLine;
      window.dispatchEvent(new Event("online"));
    };
  }, []);
  return <Story />;
};

const meta = {
  title: "Components/Shared/ConnectionBanner",
  component: ConnectionBanner,
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectionBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Connected: the banner renders nothing. */
export const Connected: Story = {};
export const Reconnecting: Story = { decorators: [WhileReconnecting] };
export const Offline: Story = { decorators: [WhileOffline] };
