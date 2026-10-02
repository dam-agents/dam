import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppAtRoute } from "../app-at-route";
import { IDS } from "../backend/scenario";

const meta = {
  title: "Pages/Chat",
  component: AppAtRoute,
  args: { path: `/chat/${IDS.codingAgent}` },
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewChat: Story = {};
export const Conversation: Story = {
  args: { path: `/chat/${IDS.codingAgent}/${IDS.session1}` },
};
export const KnowledgeBaseAgent: Story = {
  args: { path: `/chat/${IDS.kbAgent}` },
};
export const HibernatedAgent: Story = {
  args: { path: `/chat/${IDS.hibernatedAgent}` },
};
export const NoSessions: Story = {
  args: { path: `/chat/${IDS.freshAgent}` },
};
