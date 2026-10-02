import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { EMPTY_REGISTRY_CREDENTIAL } from "@/modules/sandboxes/components/registry-credential-section";
import { CustomImageCard } from "@/modules/sandboxes/components/steps/custom-image-card";

const meta = {
  title: "Components/Sandboxes/Steps/CustomImageCard",
  component: CustomImageCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { value: "", selected: false, onChange: fn(), onSubmit: fn() },
} satisfies Meta<typeof CustomImageCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** An image typed in: the card is selected and offers registry credentials. */
export const WithImage: Story = {
  args: {
    value: "ghcr.io/acme/agent:latest",
    selected: true,
    registry: {
      value: EMPTY_REGISTRY_CREDENTIAL,
      onChange: fn(),
      partial: false,
      disclosureOverride: null,
      onDisclosureOverride: fn(),
    },
  },
};

export const WithRegistryOpen: Story = {
  args: {
    ...WithImage.args,
    registry: {
      value: { server: "ghcr.io", username: "octocat", password: "" },
      onChange: fn(),
      partial: true,
      disclosureOverride: true,
      onDisclosureOverride: fn(),
    },
  },
};
