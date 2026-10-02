import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppAtRoute } from "../app-at-route";
import { IDS } from "../backend/scenario";

const base = `/sandboxes/${IDS.codingAgent}`;

const meta = {
  title: "Pages/Sandbox",
  component: AppAtRoute,
  args: { path: base },
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Setup: Story = {};
export const Connections: Story = { args: { path: `${base}/connections` } };
export const Channels: Story = { args: { path: `${base}/channels` } };
export const Skills: Story = { args: { path: `${base}/skills` } };
export const Schedules: Story = { args: { path: `${base}/schedules` } };
export const Artifacts: Story = { args: { path: `${base}/artifacts` } };
export const Usage: Story = { args: { path: `${base}/usage` } };
export const NewAgent: Story = { args: { path: "/agents/new" } };
