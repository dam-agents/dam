import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppAtRoute } from "../app-at-route";

const meta = {
  title: "Pages/Other",
  component: AppAtRoute,
  args: { path: "/artifacts" },
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Artifacts: Story = {};
export const ArtifactsEmpty: Story = { args: { scenario: "empty" } };
export const Terms: Story = { args: { path: "/terms" } };
export const TelegramBind: Story = {
  args: { path: "/telegram/bind", query: { flow: "storybook-flow" } },
};
export const TelegramBindNoLink: Story = {
  args: { path: "/telegram/bind", query: { flow: null } },
};
export const SlackBind: Story = {
  args: { path: "/slack/bind", query: { flow: "storybook-flow" } },
};
export const SlackBindNoLink: Story = {
  args: { path: "/slack/bind", query: { flow: null } },
};
