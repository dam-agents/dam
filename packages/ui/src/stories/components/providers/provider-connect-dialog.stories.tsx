import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { ProviderConnectDialog } from "@/modules/providers/components/provider-connect-dialog";

type Args = ComponentProps<typeof ProviderConnectDialog>;

const loadConnections = async () => ({
  connections: await api.connections.list.query(),
});
type Loaded = Awaited<ReturnType<typeof loadConnections>>;

const meta = {
  title: "Components/Providers/ProviderConnectDialog",
  component: ProviderConnectDialog,
  args: { provider: "anthropic", onConnected: fn(), onClose: fn() },
} satisfies Meta<typeof ProviderConnectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectAnthropic: Story = {};
export const ConnectOpenAI: Story = { args: { provider: "openai" } };
export const ConnectBob: Story = { args: { provider: "bob" } };
export const ConnectIbmLitellm: Story = { args: { provider: "ibm-litellm" } };

/** Edit mode for an existing connection from the fake backend. */
const editing = (templateId: string): Story => ({
  loaders: [loadConnections],
  render: (args: Args, { loaded }) => {
    const { connections } = loaded as Loaded;
    const conn = connections.find((c) => c.templateId === templateId);
    return (
      <ProviderConnectDialog
        {...args}
        item={conn ? { id: conn.id, conn } : undefined}
      />
    );
  },
});

export const EditAnthropicKey: Story = editing("anthropic");
export const EditOpenAIKey: Story = {
  ...editing("openai"),
  args: { provider: "openai" },
};
