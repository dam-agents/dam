import type { Meta, StoryObj } from "@storybook/react-vite";

import { useStore } from "@/store";

import { AppAtRoute } from "../app-at-route";
import { IDS } from "../backend/scenario";
import { withExpandedSidebar } from "./_shell";

const meta = {
  title: "Pages/Chat",
  component: AppAtRoute,
  args: { path: `/chat/${IDS.codingAgent}` },
  decorators: [withExpandedSidebar],
} satisfies Meta<typeof AppAtRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewChat: Story = {};

export const Conversation: Story = {
  args: { path: `/chat/${IDS.codingAgent}/${IDS.session1}` },
};

export const NoSessions: Story = {
  args: { path: `/chat/${IDS.freshAgent}` },
};

export const WithArtifactPanel: Story = {
  name: "Artifact Panel Open",
  args: { path: `/chat/${IDS.codingAgent}/${IDS.session1}` },
  decorators: [
    (Story) => {
      setTimeout(
        () =>
          useStore.setState({
            openArtifactId: "art-latency-report",
            openArtifactEdit: false,
          }),
        0,
      );
      return <Story />;
    },
  ],
};
