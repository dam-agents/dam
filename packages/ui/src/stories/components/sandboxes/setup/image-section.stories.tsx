import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { EMPTY_REGISTRY_CREDENTIAL } from "@/modules/sandboxes/components/registry-credential-section";
import { ImageSection } from "@/modules/sandboxes/components/setup/image-section";

import { loadTemplates } from "../load";

type Args = Omit<ComponentProps<typeof ImageSection>, "harnesses">;

const loadHarnesses = async () => ({ harnesses: await loadTemplates() });
type Loaded = Awaited<ReturnType<typeof loadHarnesses>>;

const meta = {
  title: "Components/Sandboxes/Setup/ImageSection",
  parameters: { layout: "padded" },
  loaders: [loadHarnesses],
  args: {
    loading: false,
    error: false,
    onRetry: fn(),
    templateId: "claude-code",
    customImage: "",
    registry: {
      value: EMPTY_REGISTRY_CREDENTIAL,
      onChange: fn(),
      partial: false,
      disclosureOverride: null,
      onDisclosureOverride: fn(),
    },
    onPickTemplate: fn(),
    onCustomImageChange: fn(),
    onSubmit: fn(),
  },
  render: (args, { loaded }) => (
    <div className="max-w-3xl">
      <ImageSection {...args} harnesses={(loaded as Loaded).harnesses} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HarnessPicked: Story = {};

/** A custom image replaces the harness pick and reveals registry credentials. */
export const CustomImage: Story = {
  args: { templateId: null, customImage: "ghcr.io/acme/agent:latest" },
};

export const Loading: Story = { args: { loading: true } };
