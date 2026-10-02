import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { api } from "@/api";
import { ApiKeyRow } from "@/modules/api-keys/components/api-key-row";

/** `apiKey` comes from the fake backend (loader), not from args. */
type Args = Omit<ComponentProps<typeof ApiKeyRow>, "apiKey">;

const loadKeys = async () => ({ keys: await api.apiKeys.list.query() });
type Loaded = Awaited<ReturnType<typeof loadKeys>>;

/** Renders the fixture key at `index` (see fixtures/settings.ts). */
const keyAt = (index: number): Story => ({
  render: (args, { loaded }) => {
    const { keys } = loaded as Loaded;
    return (
      <ul className="max-w-2xl">
        <ApiKeyRow {...args} apiKey={keys[index]} />
      </ul>
    );
  },
});

const meta = {
  title: "Components/ApiKeys/ApiKeyRow",
  parameters: { layout: "padded" },
  loaders: [loadKeys],
  args: { onRevoke: fn(), revoking: false },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

/** Bound to one agent, with an expiry date. */
export const SingleAgent: Story = keyAt(0);
/** `agentIds: "*"` — all owned agents, no expiry. */
export const AllAgents: Story = keyAt(1);
export const SatelliteKey: Story = keyAt(2);
export const Revoking: Story = { ...keyAt(0), args: { revoking: true } };

/** Every key in the fake backend, as the list shows them. */
export const All: Story = {
  render: (args, { loaded }) => {
    const { keys } = loaded as Loaded;
    return (
      <ul className="max-w-2xl space-y-2">
        {keys.map((k) => (
          <ApiKeyRow key={k.id} {...args} apiKey={k} />
        ))}
      </ul>
    );
  },
};
