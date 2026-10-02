import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import {
  EMPTY_REGISTRY_CREDENTIAL,
  RegistryCredentialSection,
} from "@/modules/sandboxes/components/registry-credential-section";

const meta = {
  title: "Components/Sandboxes/RegistryCredentialSection",
  component: RegistryCredentialSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: {
    value: EMPTY_REGISTRY_CREDENTIAL,
    onChange: fn(),
    partial: false,
    disclosureOverride: null,
    onDisclosureOverride: fn(),
  },
} satisfies Meta<typeof RegistryCredentialSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};
export const Expanded: Story = { args: { disclosureOverride: true } };

export const Filled: Story = {
  args: {
    value: { server: "ghcr.io", username: "octocat", password: "ghp_token" },
  },
};

/** Some but not all fields filled: stays open and shows the error. */
export const Partial: Story = {
  args: {
    value: { server: "ghcr.io", username: "", password: "" },
    partial: true,
  },
};
