import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CatalogCreatePane } from "@/modules/connections/components/catalog-create-pane";

import { groupFor } from "./catalog-data";

const meta = {
  title: "Components/Connections/CatalogCreatePane",
  component: CatalogCreatePane,
  parameters: { layout: "padded" },
  decorators: [
    // The pane lays out as a flex column inside the catalogue modal.
    (Story) => (
      <div className="flex h-[640px] max-w-2xl flex-col rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: { group: groupFor("github"), onBack: fn(), onCreated: fn() },
} satisfies Meta<typeof CatalogCreatePane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several sign-in methods: a radio list, the selected one expanded. */
export const GithubMethods: Story = {};

export const GithubAppSelected: Story = {
  args: { initialTemplateId: "github-app" },
};

/** One method: its form directly. */
export const SingleMethodApiKey: Story = {
  args: { group: groupFor("anthropic") },
};

export const Kubernetes: Story = { args: { group: groupFor("kubernetes") } };

export const CustomHeader: Story = {
  args: { group: groupFor("custom-header") },
};
