import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppAtRoute } from "../app-at-route";
import { withExpandedSidebar } from "./_shell";

const meta = {
  title: "Pages/Settings",
  component: AppAtRoute,
  args: { path: "/settings" },
  decorators: [withExpandedSidebar],
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Account: Story = {};
export const Appearance: Story = { args: { path: "/settings/appearance" } };
export const Providers: Story = { args: { path: "/settings/providers" } };
export const Connections: Story = { args: { path: "/settings/connections" } };
export const ApiKeys: Story = { args: { path: "/settings/api-keys" } };
export const Usage: Story = { args: { path: "/settings/usage" } };
export const SlackWorkspaces: Story = {
  args: { path: "/settings/slack-workspaces" },
};
// The tab is hidden by default; this key is the app's own debug reveal.
export const Features: Story = {
  args: {
    path: "/settings/features",
    storage: { "platform-debug:features-menu": "true" },
  },
};
