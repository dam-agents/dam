import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SatelliteRow } from "@/modules/satellites/components/satellite-row";

import {
  DRAINING_SATELLITE,
  NEVER_CONNECTED_SATELLITE,
  OFFLINE_SATELLITE,
  ONLINE_SATELLITE,
} from "./sample-satellites";

const meta = {
  title: "Components/Satellites/SatelliteRow",
  component: SatelliteRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: { satellite: ONLINE_SATELLITE, onRemove: fn() },
} satisfies Meta<typeof SatelliteRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Online: Story = {};
export const ShuttingDown: Story = { args: { satellite: DRAINING_SATELLITE } };
export const Offline: Story = { args: { satellite: OFFLINE_SATELLITE } };
export const NeverConnected: Story = {
  args: { satellite: NEVER_CONNECTED_SATELLITE },
};
export const AddToAgent: Story = {
  args: { grant: { granted: false, onToggle: fn() } },
};
export const InAgent: Story = {
  args: { grant: { granted: true, onToggle: fn() } },
};
