import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ProviderRow } from "@/modules/providers/components/provider-row";
import { PROVIDER_ROWS } from "@/modules/providers/lib/provider-rows";

const row = (type: (typeof PROVIDER_ROWS)[number]["type"]) =>
  PROVIDER_ROWS.find((r) => r.type === type)!;

const meta = {
  title: "Components/Providers/ProviderRow",
  component: ProviderRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    type: "anthropic",
    description: row("anthropic").description,
    connected: false,
    onConnect: fn(),
    onEditKey: fn(),
    onRemoveKey: fn(),
  },
} satisfies Meta<typeof ProviderRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = {};
export const Connected: Story = { args: { connected: true } };
export const BobNotConnected: Story = {
  args: { type: "bob", description: row("bob").description },
};
export const IbmLitellmConnected: Story = {
  args: {
    type: "ibm-litellm",
    description: row("ibm-litellm").description,
    connected: true,
  },
};
export const Skeleton: Story = { render: () => <ProviderRow.Skeleton /> };
