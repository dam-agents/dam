import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { ProviderSelect } from "@/modules/providers/components/provider-select";

type Args = Omit<ComponentProps<typeof ProviderSelect>, "selected">;

const loadConnections = async () => ({
  connections: await api.connections.list.query(),
});
type Loaded = Awaited<ReturnType<typeof loadConnections>>;

const meta = {
  title: "Components/Providers/ProviderSelect",
  parameters: { layout: "padded" },
  loaders: [loadConnections],
  args: { onSelect: fn() },
  render: (args) => (
    <div className="max-w-md">
      <ProviderSelect {...args} selected={null} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingSelected: Story = {};

/** The fake backend's Anthropic connection is selected. */
export const Selected: Story = {
  render: (args, { loaded }) => {
    const { connections } = loaded as Loaded;
    const anthropic = connections.find((c) => c.templateId === "anthropic");
    return (
      <div className="max-w-md">
        <ProviderSelect
          {...args}
          selected={anthropic ? { id: anthropic.id } : null}
        />
      </div>
    );
  },
};

export const Recommended: Story = { args: { recommended: "anthropic" } };
export const RestrictedToAnthropicAndLitellm: Story = {
  args: { allow: ["anthropic", "ibm-litellm"], recommended: "ibm-litellm" },
};
export const Disabled: Story = { args: { disabled: true } };
/** `required` with nothing chosen shows the invalid outline. */
export const RequiredEmpty: Story = {
  args: { required: true, allow: ["bob", "ibm-litellm"] },
};
