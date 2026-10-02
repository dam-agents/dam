import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { ConnectionsSetupSection } from "@/modules/sandboxes/components/setup/setup-sections";

import { IDS } from "../../../backend/scenario";
import { loadAgent } from "../load";

type Args = Omit<
  ComponentProps<typeof ConnectionsSetupSection>,
  "connectionIds"
>;

/** Pre-staged connections: the ones checkout-service is granted. */
const loadIds = async () => ({
  connectionIds: (await loadAgent(IDS.codingAgent)).grantedConnectionIds,
});
type Loaded = Awaited<ReturnType<typeof loadIds>>;

/** From setup-sections.tsx. Provider connections are hidden from the list. */
const meta = {
  title: "Components/Sandboxes/Setup/ConnectionsSetupSection",
  parameters: { layout: "padded" },
  args: {
    onToggle: fn(),
    satelliteNames: [],
    onToggleSatellite: fn(),
    onOpenCatalog: fn(),
    excludeIds: new Set<string>(),
  },
  render: (args, { loaded }) => (
    <div className="max-w-2xl">
      <ConnectionsSetupSection
        {...args}
        connectionIds={(loaded as Partial<Loaded>).connectionIds ?? []}
      />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithConnections: Story = { loaders: [loadIds] };

/** Nothing staged yet: the empty-state card. */
export const Empty: Story = {};
