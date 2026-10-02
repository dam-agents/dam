import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectionRowCard } from "@/modules/connections/components/connection-row-card";

import {
  connectionById,
  GITHUB_NEEDS_INSTALL,
  TEMPLATE_BY_ID,
} from "./catalog-data";

const card = (id: string) => {
  const connection = connectionById(id);
  return { connection, template: TEMPLATE_BY_ID.get(connection.templateId) };
};

const meta = {
  title: "Components/Connections/ConnectionRowCard",
  component: ConnectionRowCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { ...card("conn-github"), onDelete: fn() },
} satisfies Meta<typeof ConnectionRowCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GithubOAuth: Story = {};
export const ApiKey: Story = { args: card("conn-openai") };
export const Kubernetes: Story = { args: card("conn-k8s-staging") };
export const CustomHeader: Story = { args: card("conn-sentry") };
export const SlackMcp: Story = { args: card("conn-slack") };
export const ExpiredMcp: Story = {
  args: { ...card("conn-linear"), maintenance: { onReauthenticate: fn() } },
};

/** GitHub connection with an app to install: shows the steps callout. */
export const GithubNeedsInstall: Story = {
  args: { connection: GITHUB_NEEDS_INSTALL },
};

export const AddToAgent: Story = {
  args: { grant: { granted: false, onToggle: fn() } },
};
