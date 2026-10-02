import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { ConfirmRevokeDialog } from "@/modules/api-keys/components/confirm-revoke-dialog";

type Args = Omit<ComponentProps<typeof ConfirmRevokeDialog>, "apiKey">;

const loadKeys = async () => ({ keys: await api.apiKeys.list.query() });
type Loaded = Awaited<ReturnType<typeof loadKeys>>;

const meta = {
  title: "Components/ApiKeys/ConfirmRevokeDialog",
  loaders: [loadKeys],
  args: { onConfirm: fn(), onCancel: fn(), pending: false },
  render: (args, { loaded }) => {
    const { keys } = loaded as Loaded;
    return <ConfirmRevokeDialog {...args} apiKey={keys[0]} />;
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Revoking: Story = { args: { pending: true } };
